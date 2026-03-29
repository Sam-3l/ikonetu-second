import { z } from 'zod';

const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().default('3001'),

  // Database — Cloud SQL PostgreSQL
  DB_HOST: z.string().min(1, 'DB_HOST is required'),
  DB_PORT: z.string().default('5432'),
  DB_NAME: z.string().default('ikonetu'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DB_SSL: z.enum(['true', 'false']).default('true'),
  DB_POOL_MIN: z.string().default('2'),
  DB_POOL_MAX: z.string().default('20'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),

  // JWT
  JWT_SECRET: z.string().min(64, 'JWT_SECRET must be at least 64 characters'),
  JWT_REFRESH_SECRET: z.string().min(64, 'JWT_REFRESH_SECRET must be at least 64 characters'),
  JWT_ACCESS_TTL: z.string().default('900'),
  JWT_REFRESH_TTL: z.string().default('604800'),

  // SendGrid — OTP + transactional email
  SENDGRID_API_KEY: z.string().startsWith('SG.', 'Invalid SendGrid API key format'),
  SENDGRID_FROM_EMAIL: z.string().email('Invalid SendGrid from email'),
  SENDGRID_FROM_NAME: z.string().default('IkonetU'),

  // Google Cloud
  GOOGLE_CLOUD_PROJECT: z.string().default('ikonetu'),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().default('./service-account.json'),

  // Cloud Storage
  GCS_BUCKET: z.string().min(1, 'GCS_BUCKET is required'),
  GCS_REGION: z.string().default('europe-west2'),

  // Cloud Pub/Sub
  PUBSUB_PROJECT_ID: z.string().default('ikonetu'),

  // Firebase
  FIREBASE_VAPID_KEY: z.string().optional(),
  FIREBASE_HOSTING_SITE: z.string().default('ikonetu'),
  FIREBASE_PROJECT_NUMBER: z.string().default('714358463817'),

  // Gemini AI
  GEMINI_MODEL: z.string().default('gemini-1.5-pro'),
  GEMINI_LOCATION: z.string().default('europe-west2'),

  // Google Maps — Scout service
  GOOGLE_MAPS_API_KEY: z.string().startsWith('AIza', 'Invalid Google Maps API key format'),

  // BigQuery — Analytics
  BIGQUERY_DATASET: z.string().default('ikonetu_analytics'),
  BIGQUERY_PROJECT: z.string().default('ikonetu'),

  // Stripe — International payments
  STRIPE_SECRET_KEY: z.string().startsWith('sk_', 'Invalid Stripe secret key format'),
  STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_', 'Invalid Stripe publishable key format'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_', 'Invalid Stripe webhook secret format'),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),

  // Paystack — African payments
  PAYSTACK_SECRET_KEY: z.string().startsWith('sk_', 'Invalid Paystack secret key'),
  PAYSTACK_PUBLIC_KEY: z.string().startsWith('pk_', 'Invalid Paystack public key'),
  PAYSTACK_WEBHOOK_SECRET: z.string().min(8, 'Paystack webhook secret too short'),

  // Encryption — AES-256
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes)'),
  ENCRYPTION_KEY_VERSION: z.string().default('1'),

  // Hard guards — these NEVER change without a code deploy
  R12_COMMISSION_PCT: z.literal('9.5', {
    errorMap: () => ({ message: 'R12 commission must be exactly 9.5' }),
  }),
  R11_ACTIVE: z.literal('false', {
    errorMap: () => ({ message: 'R11 must remain false until legal clearance in each jurisdiction' }),
  }),

  // Feature flags
  DARK_MODE_ENABLED: z.literal('false', {
    errorMap: () => ({ message: 'Dark mode is permanently disabled — this is a design principle' }),
  }).default('false'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('60000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100'),

  // OTP config
  OTP_EXPIRY_SECONDS: z.string().default('300'),
  OTP_MAX_ATTEMPTS: z.string().default('5'),
  OTP_LOCKOUT_SECONDS: z.string().default('1800'),

  // CORS
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Service URLs (for inter-service communication)
  AUTH_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  USER_SERVICE_URL: z.string().url().default('http://localhost:3002'),
  SCORING_SERVICE_URL: z.string().url().default('http://localhost:3003'),
  NOTIFICATION_SERVICE_URL: z.string().url().default('http://localhost:3008'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('\n❌ ENVIRONMENT VALIDATION FAILED\n');
    console.error('The following environment variables are missing or invalid:\n');
    result.error.issues.forEach((issue) => {
      console.error(`  ✗ ${issue.path.join('.')}: ${issue.message}`);
    });
    console.error('\nCheck your .env file and try again.\n');
    process.exit(1);
  }

  _env = result.data;
  return _env;
}

// Convenience — use anywhere without calling getEnv()
export const env = new Proxy({} as Env, {
  get(_, key: string) {
    return getEnv()[key as keyof Env];
  },
});
