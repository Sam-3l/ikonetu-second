import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import sgMail from '@sendgrid/mail';
import crypto from 'crypto';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId,
  rateLimiter,
  otpRateLimiter,
  authenticate,
  validate,
  auditLog,
  errorHandler,
  AppError,
  NotFoundError,
} from '@ikonetu/shared/middleware';

// ── SendGrid init ────────────────────────────────────────────
sgMail.setApiKey(env.SENDGRID_API_KEY);

const app = express();
app.use(express.json());
app.use(requestId);

// ── Schemas ──────────────────────────────────────────────────
const RequestOTPSchema = z.object({
  email: z.string().email('Valid email address required'),
  role: z.enum(['founder', 'investor', 'provider', 'lender', 'university']),
  name: z.string().min(2).max(200).optional(),
});

const VerifyOTPSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, 'OTP must be exactly 6 digits').regex(/^\d{6}$/, 'OTP must be numeric'),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// ── OTP helpers ──────────────────────────────────────────────
function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
}

async function hashOTP(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10);
}

async function verifyOTPHash(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash);
}

// ── JWT helpers ──────────────────────────────────────────────
interface TokenPayload {
  sub: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  sessionId: string;
}

function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: parseInt(env.JWT_ACCESS_TTL),
    issuer: 'ikonetu',
    audience: 'ikonetu-app',
  });
}

function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: parseInt(env.JWT_REFRESH_TTL),
    issuer: 'ikonetu',
    audience: 'ikonetu-refresh',
  });
}

// ── Email templates ──────────────────────────────────────────
function buildOTPEmail(to: string, code: string, name: string, isNewUser: boolean): sgMail.MailDataRequired {
  return {
    to,
    from: {
      email: env.SENDGRID_FROM_EMAIL,
      name: env.SENDGRID_FROM_NAME,
    },
    subject: isNewUser ? `Welcome to IkonetU — your verification code` : `Your IkonetU login code`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isNewUser ? 'Welcome to IkonetU' : 'Your login code'}</title>
</head>
<body style="margin:0;padding:0;background:#F8F7F4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F7F4;padding:40px 20px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #E0DED8;overflow:hidden">
        <!-- Header -->
        <tr><td style="background:#0A0A0A;padding:28px 36px">
          <p style="margin:0;font-size:22px;font-weight:bold;color:#F5C842;letter-spacing:0.03em">IkonetU</p>
          <p style="margin:4px 0 0;font-size:13px;color:#888888">${isNewUser ? 'African Founder Scoring Platform' : 'Secure Login'}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px">
          <p style="margin:0 0 16px;font-size:16px;color:#1A1A1A">
            ${isNewUser ? `Welcome, ${name}.` : `Hello${name ? `, ${name}` : ''}.`}
          </p>
          <p style="margin:0 0 28px;font-size:15px;color:#555555;line-height:1.6">
            ${isNewUser
              ? 'Your IkonetU account is being created. Use the code below to verify your email address.'
              : 'Use the code below to log in to your IkonetU account. This code expires in 5 minutes.'
            }
          </p>
          <!-- OTP Code -->
          <div style="background:#F8F7F4;border:1px solid #E0DED8;border-radius:8px;padding:24px;text-align:center;margin:0 0 28px">
            <p style="margin:0 0 8px;font-size:12px;color:#888888;text-transform:uppercase;letter-spacing:0.08em">Verification Code</p>
            <p style="margin:0;font-size:40px;font-weight:bold;color:#0A0A0A;letter-spacing:0.2em;font-family:'Courier New',monospace">${code}</p>
            <p style="margin:8px 0 0;font-size:12px;color:#888888">Expires in 5 minutes</p>
          </div>
          <p style="margin:0 0 16px;font-size:13px;color:#888888;line-height:1.6">
            If you did not request this code, you can safely ignore this email. 
            Someone may have entered your email by mistake.
          </p>
          <p style="margin:0;font-size:13px;color:#888888">
            Never share this code with anyone, including IkonetU staff.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#F8F7F4;padding:20px 36px;border-top:1px solid #E0DED8">
          <p style="margin:0;font-size:12px;color:#999999">
            IkonetU Technology Limited &nbsp;·&nbsp; Registered in England and Wales, United Kingdom<br>
            <a href="mailto:customer.service@ikonetu.com" style="color:#999999">customer.service@ikonetu.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    text: `Your IkonetU verification code is: ${code}\n\nThis code expires in 5 minutes.\n\nIf you did not request this, please ignore this email.\n\n— IkonetU Technology Limited`,
  };
}

// ════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/v1/auth/otp/request
app.post(
  '/api/v1/auth/otp/request',
  rateLimiter({ max: 10, keyPrefix: 'otp_req' }),
  otpRateLimiter(),
  validate({ body: RequestOTPSchema }),
  async (req, res, next) => {
    try {
      const { email, role, name } = req.body as z.infer<typeof RequestOTPSchema>;

      // Check if user exists
      const existingUser = await db('users')
        .where({ email })
        .whereNull('deleted_at')
        .first();

      const isNewUser = !existingUser;

      // If existing user, verify role matches
      if (existingUser && existingUser.role !== role) {
        throw new AppError(
          `This email is registered as a ${existingUser.role}. Please use the correct role.`,
          409,
          'role-mismatch',
        );
      }

      // If new user, name is required
      if (isNewUser && !name) {
        throw new AppError('Name is required for new accounts', 422, 'name-required');
      }

      // Generate OTP
      const otp = generateOTP();
      const hash = await hashOTP(otp);
      const expiresAt = new Date(Date.now() + parseInt(env.OTP_EXPIRY_SECONDS) * 1000);

      // Invalidate any existing OTP for this email
      await db('otp_records')
        .where({ identifier: email, channel: 'email', verified: false })
        .update({ verified: true }); // mark old as used

      // Store new OTP
      await db('otp_records').insert({
        identifier: email,
        channel: 'email',
        code_hash: hash,
        expires_at: expiresAt,
        ip: req.ip,
      });

      // Send email via SendGrid
      const displayName = existingUser?.name ?? name ?? '';
      await sgMail.send(buildOTPEmail(email, otp, displayName, isNewUser));

      res.status(200).json({
        success: true,
        message: `Verification code sent to ${email}`,
        expiresIn: parseInt(env.OTP_EXPIRY_SECONDS),
        isNewUser,
        channel: 'email',
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/auth/otp/verify
app.post(
  '/api/v1/auth/otp/verify',
  rateLimiter({ max: 20, keyPrefix: 'otp_verify' }),
  validate({ body: VerifyOTPSchema }),
  async (req, res, next) => {
    try {
      const { email, code } = req.body as z.infer<typeof VerifyOTPSchema>;

      // Get the most recent valid OTP for this email
      const otpRecord = await db('otp_records')
        .where({ identifier: email, channel: 'email', verified: false })
        .where('expires_at', '>', new Date())
        .orderBy('created_at', 'desc')
        .first();

      if (!otpRecord) {
        throw new AppError('No valid verification code found. Please request a new one.', 400, 'otp-not-found');
      }

      // Increment attempt count
      await db('otp_records')
        .where({ id: otpRecord.id })
        .increment('attempts', 1);

      // Verify the code
      const valid = await verifyOTPHash(code, otpRecord.code_hash);
      if (!valid) {
        const remaining = parseInt(env.OTP_MAX_ATTEMPTS) - (otpRecord.attempts + 1);
        throw new AppError(
          remaining > 0
            ? `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
            : 'Too many invalid attempts. Please request a new code.',
          400,
          'otp-invalid',
        );
      }

      // Mark OTP as verified
      await db('otp_records').where({ id: otpRecord.id }).update({ verified: true });

      // Get or create user
      let user = await db('users')
        .where({ email })
        .whereNull('deleted_at')
        .first();

      if (!user) {
        // Extract role from the request body that accompanied the original OTP request
        // In practice, the frontend passes role again on verify — get it from the request
        const role = req.body.role ?? 'founder';
        const name = req.body.name ?? email.split('@')[0];

        [user] = await db('users').insert({
          email,
          email_verified: true,
          name,
          role,
          status: 'active',
        }).returning('*');

        // Create default profile and preferences
        await db('user_profiles').insert({ user_id: user.id });
        await db('user_preferences').insert({ user_id: user.id });

        // Log new user creation
        await db('audit_log').insert({
          user_id: user.id,
          action: 'user.registered',
          resource_type: 'user',
          resource_id: user.id,
          new_value: JSON.stringify({ email, role }),
          ip: req.ip,
          request_id: req.requestId,
        });
      } else {
        // Update last login
        await db('users').where({ id: user.id }).update({
          email_verified: true,
          last_login: new Date(),
          status: user.status === 'pending' ? 'active' : user.status,
        });
      }

      // Create session
      const accessToken = generateAccessToken({
        sub: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        sessionId: 'temp', // replaced below
      });

      const refreshToken = generateRefreshToken({
        sub: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        sessionId: 'temp',
      });

      const accessHash = crypto.createHash('sha256').update(accessToken).digest('hex');
      const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      const [session] = await db('user_sessions').insert({
        user_id: user.id,
        token_hash: accessHash,
        refresh_token_hash: refreshHash,
        device_info: JSON.stringify({
          userAgent: req.headers['user-agent'],
          ip: req.ip,
        }),
        ip: req.ip,
        user_agent: req.headers['user-agent'],
        expires_at: new Date(Date.now() + parseInt(env.JWT_REFRESH_TTL) * 1000),
      }).returning('*');

      // Re-issue tokens with real sessionId
      const finalAccessToken = generateAccessToken({
        sub: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        sessionId: session.id,
      });

      const finalRefreshToken = generateRefreshToken({
        sub: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        sessionId: session.id,
      });

      // Update session hashes with final tokens
      await db('user_sessions').where({ id: session.id }).update({
        token_hash: crypto.createHash('sha256').update(finalAccessToken).digest('hex'),
        refresh_token_hash: crypto.createHash('sha256').update(finalRefreshToken).digest('hex'),
      });

      // Log login
      await db('audit_log').insert({
        user_id: user.id,
        action: 'user.login',
        resource_type: 'session',
        resource_id: session.id,
        ip: req.ip,
        user_agent: req.headers['user-agent'],
        request_id: req.requestId,
      });

      res.status(200).json({
        success: true,
        accessToken: finalAccessToken,
        refreshToken: finalRefreshToken,
        expiresIn: parseInt(env.JWT_ACCESS_TTL),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
          onboardingCompleted: user.onboarding_completed,
          avatarUrl: user.avatar_url,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/auth/refresh
app.post(
  '/api/v1/auth/refresh',
  rateLimiter({ max: 30, keyPrefix: 'refresh' }),
  validate({ body: RefreshSchema }),
  async (req, res, next) => {
    try {
      const { refreshToken } = req.body as z.infer<typeof RefreshSchema>;

      let payload: TokenPayload & { iat: number; exp: number };
      try {
        payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, {
          issuer: 'ikonetu',
          audience: 'ikonetu-refresh',
        }) as typeof payload;
      } catch {
        throw new AppError('Invalid or expired refresh token', 401, 'invalid-refresh-token');
      }

      const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const session = await db('user_sessions')
        .where({ id: payload.sessionId, refresh_token_hash: refreshHash, revoked: false })
        .where('expires_at', '>', new Date())
        .first();

      if (!session) {
        throw new AppError('Refresh token revoked or expired', 401, 'refresh-token-revoked');
      }

      const user = await db('users').where({ id: payload.sub }).whereNull('deleted_at').first();
      if (!user || user.status === 'banned') {
        throw new AppError('Account not found or suspended', 401, 'account-unavailable');
      }

      // Issue new access token (sliding window — refresh stays same)
      const newAccessToken = generateAccessToken({
        sub: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        sessionId: session.id,
      });

      // Update session with new access token hash
      await db('user_sessions').where({ id: session.id }).update({
        token_hash: crypto.createHash('sha256').update(newAccessToken).digest('hex'),
      });

      res.status(200).json({
        accessToken: newAccessToken,
        expiresIn: parseInt(env.JWT_ACCESS_TTL),
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/auth/logout
app.post(
  '/api/v1/auth/logout',
  rateLimiter(),
  authenticate,
  auditLog('user.logout', 'session'),
  async (req, res, next) => {
    try {
      await db('user_sessions')
        .where({ id: req.user!.sessionId, user_id: req.user!.id })
        .update({ revoked: true, revoked_at: new Date() });

      res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/auth/logout-all
app.post(
  '/api/v1/auth/logout-all',
  rateLimiter(),
  authenticate,
  auditLog('user.logout-all', 'session'),
  async (req, res, next) => {
    try {
      const count = await db('user_sessions')
        .where({ user_id: req.user!.id, revoked: false })
        .update({ revoked: true, revoked_at: new Date() });

      res.status(200).json({ success: true, sessionsRevoked: count });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/auth/sessions
app.get(
  '/api/v1/auth/sessions',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const sessions = await db('user_sessions')
        .where({ user_id: req.user!.id, revoked: false })
        .where('expires_at', '>', new Date())
        .select('id', 'device_info', 'ip', 'created_at', 'expires_at')
        .orderBy('created_at', 'desc');

      res.status(200).json({
        sessions: sessions.map((s) => ({
          id: s.id,
          isCurrent: s.id === req.user!.sessionId,
          deviceInfo: s.device_info,
          ip: s.ip,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/auth/sessions/:id
app.delete(
  '/api/v1/auth/sessions/:id',
  rateLimiter(),
  authenticate,
  auditLog('session.revoke', 'session'),
  async (req, res, next) => {
    try {
      const affected = await db('user_sessions')
        .where({ id: req.params.id, user_id: req.user!.id })
        .update({ revoked: true, revoked_at: new Date() });

      if (!affected) throw new NotFoundError('Session');

      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/auth/me
app.get(
  '/api/v1/auth/me',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const user = await db('users')
        .where({ id: req.user!.id })
        .whereNull('deleted_at')
        .select(
          'id', 'email', 'email_verified', 'phone', 'phone_verified',
          'name', 'role', 'country', 'language', 'avatar_url',
          'status', 'last_login', 'onboarding_completed', 'created_at',
        )
        .first();

      if (!user) throw new NotFoundError('User');

      const profile = await db('user_profiles').where({ user_id: req.user!.id }).first();
      const preferences = await db('user_preferences').where({ user_id: req.user!.id }).first();

      res.status(200).json({ user, profile, preferences });
    } catch (err) {
      next(err);
    }
  },
);

// Health check
app.get('/health', (_, res) => {
  res.status(200).json({
    service: 'auth-service',
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Error handler — always last
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────
const PORT = parseInt(env.PORT);

async function start(): Promise<void> {
  try {
    // Validate env first — will crash with clear message if anything is missing
    env.NODE_ENV; // triggers Proxy → validates all env vars

    const { initRedis } = await import('@ikonetu/shared/middleware');
    await initRedis();

    app.listen(PORT, () => {
      console.log(`\n✅ auth-service running on port ${PORT}`);
      console.log(`   Environment: ${env.NODE_ENV}`);
      console.log(`   OTP channel: email (SendGrid)`);
      console.log(`   Health: http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error('Failed to start auth-service:', err);
    process.exit(1);
  }
}

start();

export default app;
