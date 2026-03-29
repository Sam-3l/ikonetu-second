import crypto from 'crypto';
import { env } from '@ikonetu/config';

// ════════════════════════════════════════════════════════════
// ENCRYPTION SERVICE
// AES-256-GCM field-level encryption for all PII
// Key versioning — old versions remain readable during rotation
// INVARIANT: encrypted values are always prefixed with version
// Format: "v{version}:{iv_hex}:{authTag_hex}:{ciphertext_hex}"
// ════════════════════════════════════════════════════════════

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

interface KeyStore {
  [version: string]: Buffer;
}

// Build key store — supports multiple key versions for rotation
function buildKeyStore(): KeyStore {
  const store: KeyStore = {};
  const currentKey = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  const currentVersion = env.ENCRYPTION_KEY_VERSION;

  if (currentKey.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes) for AES-256');
  }

  store[currentVersion] = currentKey;

  // Load previous key versions if present (set as ENCRYPTION_KEY_V{n})
  for (let v = 1; v < parseInt(currentVersion); v++) {
    const oldKey = process.env[`ENCRYPTION_KEY_V${v}`];
    if (oldKey) {
      store[String(v)] = Buffer.from(oldKey, 'hex');
    }
  }

  return store;
}

let _keyStore: KeyStore;
function getKeyStore(): KeyStore {
  if (!_keyStore) _keyStore = buildKeyStore();
  return _keyStore;
}

// ── Core encrypt/decrypt ─────────────────────────────────────

export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;

  const keyStore = getKeyStore();
  const version = env.ENCRYPTION_KEY_VERSION;
  const key = keyStore[version];

  if (!key) throw new Error(`Encryption key version ${version} not found`);

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `v${version}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ciphertext;

  // Handle unencrypted legacy values (migration period)
  if (!ciphertext.startsWith('v')) return ciphertext;

  const parts = ciphertext.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted value format');

  const [versionTag, ivHex, authTagHex, dataHex] = parts;
  const version = versionTag.slice(1); // remove 'v' prefix

  const keyStore = getKeyStore();
  const key = keyStore[version];

  if (!key) {
    throw new Error(
      `Cannot decrypt: key version ${version} not found. ` +
      `Add ENCRYPTION_KEY_V${version} to environment to decrypt old values.`
    );
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ── Deterministic encryption for searchable fields ───────────
// Uses HMAC instead of random IV — same input always produces same output
// Trade-off: less secure than random IV, only use for lookup fields (emails, phones)

export function encryptDeterministic(value: string): string {
  if (!value) return value;

  const keyStore = getKeyStore();
  const version = env.ENCRYPTION_KEY_VERSION;
  const key = keyStore[version];

  // Derive deterministic IV from value using HMAC
  const iv = crypto.createHmac('sha256', key).update(value).digest().slice(0, IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `vd${version}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// ── Hash for irreversible storage (passwords, OTP hashes) ────
export function hashValue(value: string, salt?: string): string {
  const s = salt || crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHmac('sha256', s).update(value).digest('hex');
  return `${s}:${hash}`;
}

export function verifyHash(value: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const expected = crypto.createHmac('sha256', salt).update(value).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'));
}

// ── PII field map — which DB fields get encrypted ─────────────
export const PII_FIELDS: Record<string, string[]> = {
  users:                   ['email', 'phone'],
  venture_financial_data:  ['revenue', 'expenses', 'profit'],
  bankability_scores:      ['total_score'],         // encrypted at rest for lender data
  otp_records:             ['identifier'],           // phone/email in OTP table
};

// ── Key rotation helper ───────────────────────────────────────
export async function rotateKey(
  tableName: string,
  fieldName: string,
  db: ReturnType<typeof import('@ikonetu/database').getDb>,
  dryRun = true
): Promise<{ total: number; rotated: number; failed: number }> {
  const rows = await db(tableName).select('id', fieldName);
  let rotated = 0;
  let failed = 0;

  for (const row of rows) {
    const value = row[fieldName];
    if (!value || !String(value).startsWith('v')) {
      // Not encrypted yet — encrypt it
      if (!dryRun) {
        await db(tableName).where({ id: row.id }).update({ [fieldName]: encrypt(String(value)) });
        rotated++;
      }
      continue;
    }

    // Check if already on current key version
    const version = String(value).split(':')[0].slice(1);
    if (version === env.ENCRYPTION_KEY_VERSION) continue;

    // Re-encrypt with new key
    try {
      const plaintext = decrypt(value);
      if (!dryRun) {
        await db(tableName).where({ id: row.id }).update({ [fieldName]: encrypt(plaintext) });
        rotated++;
      } else {
        rotated++; // dry run count
      }
    } catch {
      failed++;
    }
  }

  return { total: rows.length, rotated, failed };
}
