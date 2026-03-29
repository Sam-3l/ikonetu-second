import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';
import { ZodSchema, ZodError } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';

// ─────────────────────────────────────────────────────────────
// 1. REQUEST ID — Every request gets a unique traceable ID
// ─────────────────────────────────────────────────────────────
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = req.headers['x-request-id'] as string || uuidv4();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
}

// ─────────────────────────────────────────────────────────────
// 2. RATE LIMITER — Redis sliding window
// ─────────────────────────────────────────────────────────────
let redis: ReturnType<typeof createClient>;

export async function initRedis(): Promise<void> {
  redis = createClient({ url: env.REDIS_URL });
  redis.on('error', (err) => console.error('Redis error:', err));
  await redis.connect();
  console.log('✅ Redis connected');
}

export function rateLimiter(options?: {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
}) {
  const windowMs = options?.windowMs ?? parseInt(env.RATE_LIMIT_WINDOW_MS);
  const max = options?.max ?? parseInt(env.RATE_LIMIT_MAX_REQUESTS);
  const keyPrefix = options?.keyPrefix ?? 'rl';

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `${keyPrefix}:${req.ip}:${req.path}`;
    const windowSecs = Math.ceil(windowMs / 1000);

    try {
      const [count] = await redis
        .multi()
        .incr(key)
        .expire(key, windowSecs)
        .exec() as [number, number];

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

      if (count > max) {
        res.status(429).json({
          type: 'https://ikonetu.com/errors/rate-limit-exceeded',
          title: 'Rate limit exceeded',
          status: 429,
          requestId: req.requestId,
          retryAfter: windowSecs,
        });
        return;
      }
    } catch {
      // Redis unavailable — fail open (do not block requests)
    }
    next();
  };
}

// Strict OTP rate limiter — 5 attempts, 30 min lockout
export function otpRateLimiter() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identifier = req.body?.email || req.body?.phone || req.ip;
    const key = `otp_attempt:${identifier}`;
    const lockKey = `otp_lock:${identifier}`;

    try {
      // Check if locked
      const locked = await redis.get(lockKey);
      if (locked) {
        const ttl = await redis.ttl(lockKey);
        res.status(429).json({
          type: 'https://ikonetu.com/errors/otp-locked',
          title: 'Too many OTP attempts. Account temporarily locked.',
          status: 429,
          requestId: req.requestId,
          retryAfter: ttl,
        });
        return;
      }

      const attempts = await redis.incr(key);
      await redis.expire(key, 600); // 10 min window

      if (attempts > parseInt(env.OTP_MAX_ATTEMPTS)) {
        await redis.set(lockKey, '1', { EX: parseInt(env.OTP_LOCKOUT_SECONDS) });
        await redis.del(key);
        res.status(429).json({
          type: 'https://ikonetu.com/errors/otp-locked',
          title: 'Too many OTP attempts. Account locked for 30 minutes.',
          status: 429,
          requestId: req.requestId,
        });
        return;
      }
    } catch {
      // Redis unavailable — fail open
    }
    next();
  };
}

// ─────────────────────────────────────────────────────────────
// 3. AUTHENTICATE — JWT verify, attaches req.user
// ─────────────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  role: 'founder' | 'investor' | 'provider' | 'lender' | 'university' | 'super_admin';
  status: string;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId: string;
    }
  }
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      type: 'https://ikonetu.com/errors/unauthorized',
      title: 'Authentication required',
      status: 401,
      requestId: req.requestId,
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as {
      sub: string;
      email: string | null;
      phone: string | null;
      role: AuthUser['role'];
      status: string;
      sessionId: string;
      iat: number;
      exp: number;
    };

    // Check if session is revoked
    const session = await db('user_sessions')
      .where({ id: payload.sessionId, revoked: false })
      .where('expires_at', '>', new Date())
      .first();

    if (!session) {
      res.status(401).json({
        type: 'https://ikonetu.com/errors/session-expired',
        title: 'Session expired or revoked',
        status: 401,
        requestId: req.requestId,
      });
      return;
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      phone: payload.phone,
      role: payload.role,
      status: payload.status,
      sessionId: payload.sessionId,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        type: 'https://ikonetu.com/errors/token-expired',
        title: 'Access token expired. Please refresh.',
        status: 401,
        requestId: req.requestId,
      });
      return;
    }
    res.status(401).json({
      type: 'https://ikonetu.com/errors/invalid-token',
      title: 'Invalid access token',
      status: 401,
      requestId: req.requestId,
    });
  }
}

// Optional authentication — attaches user if present, does not fail if absent
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }
  await authenticate(req, res, next);
}

// ─────────────────────────────────────────────────────────────
// 4. RBAC — Role-based access control
// ─────────────────────────────────────────────────────────────
type Role = AuthUser['role'];

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        type: 'https://ikonetu.com/errors/unauthorized',
        title: 'Authentication required',
        status: 401,
        requestId: req.requestId,
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        type: 'https://ikonetu.com/errors/forbidden',
        title: `Access denied. Required role: ${roles.join(' or ')}.`,
        status: 403,
        requestId: req.requestId,
      });
      return;
    }

    if (req.user.status === 'suspended' || req.user.status === 'banned') {
      res.status(403).json({
        type: 'https://ikonetu.com/errors/account-suspended',
        title: `Your account has been ${req.user.status}. Contact customer.service@ikonetu.com`,
        status: 403,
        requestId: req.requestId,
      });
      return;
    }

    next();
  };
}

export const requireAdmin = requireRole('super_admin');
export const requireFounder = requireRole('founder', 'super_admin');
export const requireInvestor = requireRole('investor', 'super_admin');
export const requireProvider = requireRole('provider', 'super_admin');
export const requireLender = requireRole('lender', 'super_admin');
export const requireUniversity = requireRole('university', 'super_admin');

// Ownership check — user can only access their own resources
export function requireOwnership(getResourceUserId: (req: Request) => Promise<string | null>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ type: 'https://ikonetu.com/errors/unauthorized', title: 'Authentication required', status: 401, requestId: req.requestId });
      return;
    }

    // Super admin can access everything
    if (req.user.role === 'super_admin') {
      next();
      return;
    }

    try {
      const resourceUserId = await getResourceUserId(req);
      if (!resourceUserId || resourceUserId !== req.user.id) {
        res.status(403).json({
          type: 'https://ikonetu.com/errors/forbidden',
          title: 'You do not have permission to access this resource',
          status: 403,
          requestId: req.requestId,
        });
        return;
      }
      next();
    } catch {
      res.status(500).json({ type: 'https://ikonetu.com/errors/internal', title: 'Internal server error', status: 500, requestId: req.requestId });
    }
  };
}

// ─────────────────────────────────────────────────────────────
// 5. VALIDATE — Zod schema validation
// ─────────────────────────────────────────────────────────────
export function validate(schema: {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.params) req.params = schema.params.parse(req.params) as typeof req.params;
      if (schema.query) req.query = schema.query.parse(req.query) as typeof req.query;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(422).json({
          type: 'https://ikonetu.com/errors/validation-failed',
          title: 'Validation failed',
          status: 422,
          requestId: req.requestId,
          errors: err.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        });
        return;
      }
      next(err);
    }
  };
}

// ─────────────────────────────────────────────────────────────
// 6. AUDIT LOG — Immutable record of every data-changing action
// ─────────────────────────────────────────────────────────────
export function auditLog(action: string, resourceType: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Capture original json method to intercept response
    const originalJson = res.json.bind(res);
    let responseBody: unknown;

    res.json = function (body: unknown) {
      responseBody = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      if (res.statusCode < 400) {
        // Write to audit log asynchronously — do not block the response
        db('audit_log').insert({
          user_id: req.user?.id ?? null,
          action,
          resource_type: resourceType,
          resource_id: req.params?.id ?? null,
          old_value: JSON.stringify({}),
          new_value: JSON.stringify(req.body ?? {}),
          ip: req.ip,
          user_agent: req.headers['user-agent'] ?? null,
          request_id: req.requestId,
        }).catch((err: Error) => {
          console.error('Audit log write failed:', err.message);
        });
      }
    });

    next();
  };
}

// ─────────────────────────────────────────────────────────────
// 7. ERROR HANDLER — RFC 7807 Problem Details
// Must be last middleware registered
// ─────────────────────────────────────────────────────────────
export function errorHandler(
  err: Error & { statusCode?: number; code?: string },
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? 'unknown';
  const status = err.statusCode ?? 500;

  // Log all errors
  console.error({
    requestId,
    error: err.message,
    code: err.code,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    stack: env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  res.status(status).json({
    type: `https://ikonetu.com/errors/${err.code ?? 'internal'}`,
    title: status === 500 ? 'An unexpected error occurred' : err.message,
    status,
    requestId,
    timestamp: new Date().toISOString(),
    ...(env.NODE_ENV !== 'production' && { debug: err.message, stack: err.stack }),
  });
}

// Custom error classes
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'internal',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'not-found');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'conflict');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'forbidden');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 422, 'validation-failed');
  }
}
