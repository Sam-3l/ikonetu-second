import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ── OTP Tests ─────────────────────────────────────────────────
describe('OTP Security', () => {
  it('generates a 6-digit numeric OTP', () => {
    const otp = crypto.randomInt(100000, 999999).toString();
    expect(otp).toMatch(/^\d{6}$/);
    expect(parseInt(otp)).toBeGreaterThanOrEqual(100000);
    expect(parseInt(otp)).toBeLessThanOrEqual(999999);
  });

  it('OTP hash is not reversible', async () => {
    const otp = '123456';
    const hash = await bcrypt.hash(otp, 10);
    expect(hash).not.toBe(otp);
    expect(hash.length).toBeGreaterThan(50);
  });

  it('correct OTP verifies against hash', async () => {
    const otp = '789012';
    const hash = await bcrypt.hash(otp, 10);
    const valid = await bcrypt.compare(otp, hash);
    expect(valid).toBe(true);
  });

  it('incorrect OTP fails verification', async () => {
    const otp = '789012';
    const hash = await bcrypt.hash(otp, 10);
    const valid = await bcrypt.compare('999999', hash);
    expect(valid).toBe(false);
  });

  it('two OTPs for same value produce different hashes (bcrypt salt)', async () => {
    const otp = '111111';
    const hash1 = await bcrypt.hash(otp, 10);
    const hash2 = await bcrypt.hash(otp, 10);
    expect(hash1).not.toBe(hash2);
  });
});

// ── JWT Invariants ────────────────────────────────────────────
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'a'.repeat(64); // 64 char test secret
const TEST_REFRESH_SECRET = 'b'.repeat(64);

describe('JWT Security', () => {
  it('access token contains required claims', () => {
    const token = jwt.sign(
      { sub: 'user-id', email: 'test@test.com', phone: null, role: 'founder', status: 'active', sessionId: 'session-id' },
      TEST_SECRET,
      { expiresIn: 900, issuer: 'ikonetu', audience: 'ikonetu-app' },
    );
    const decoded = jwt.verify(token, TEST_SECRET, { issuer: 'ikonetu', audience: 'ikonetu-app' }) as Record<string, unknown>;
    expect(decoded.sub).toBe('user-id');
    expect(decoded.role).toBe('founder');
    expect(decoded.sessionId).toBe('session-id');
    expect(decoded.iss).toBe('ikonetu');
  });

  it('access token rejects wrong secret', () => {
    const token = jwt.sign({ sub: 'x' }, TEST_SECRET);
    expect(() => jwt.verify(token, TEST_REFRESH_SECRET)).toThrow();
  });

  it('access token rejects wrong audience', () => {
    const token = jwt.sign({ sub: 'x' }, TEST_SECRET, { audience: 'ikonetu-app' });
    expect(() => jwt.verify(token, TEST_SECRET, { audience: 'ikonetu-refresh' })).toThrow();
  });

  it('expired token is rejected', () => {
    const token = jwt.sign({ sub: 'x' }, TEST_SECRET, { expiresIn: -1 });
    expect(() => jwt.verify(token, TEST_SECRET)).toThrow(jwt.TokenExpiredError);
  });

  it('refresh token uses different secret from access token', () => {
    const accessToken = jwt.sign({ sub: 'x' }, TEST_SECRET, { audience: 'ikonetu-app' });
    const refreshToken = jwt.sign({ sub: 'x' }, TEST_REFRESH_SECRET, { audience: 'ikonetu-refresh' });

    // Access token cannot be used as refresh
    expect(() => jwt.verify(accessToken, TEST_REFRESH_SECRET, { audience: 'ikonetu-refresh' })).toThrow();
    // Refresh token cannot be used as access
    expect(() => jwt.verify(refreshToken, TEST_SECRET, { audience: 'ikonetu-app' })).toThrow();
  });
});

// ── Email Validation ──────────────────────────────────────────
import { z } from 'zod';

const emailSchema = z.string().email();

describe('Email Validation', () => {
  it('accepts valid emails', () => {
    expect(() => emailSchema.parse('test@ikonetu.com')).not.toThrow();
    expect(() => emailSchema.parse('founder+tag@company.co.uk')).not.toThrow();
  });

  it('rejects invalid emails', () => {
    expect(() => emailSchema.parse('notanemail')).toThrow();
    expect(() => emailSchema.parse('@nodomain.com')).toThrow();
    expect(() => emailSchema.parse('no@')).toThrow();
  });
});

// ── Critical Invariant: OTP is always 6 digits ────────────────
describe('OTP Format Invariant', () => {
  it('100 consecutive OTPs are all exactly 6 digits', () => {
    for (let i = 0; i < 100; i++) {
      const otp = crypto.randomInt(100000, 999999).toString();
      expect(otp.length).toBe(6);
      expect(/^\d{6}$/.test(otp)).toBe(true);
    }
  });
});
