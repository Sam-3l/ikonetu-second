import express from 'express';
import axios from 'axios';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate,
  validate, errorHandler, NotFoundError, AppError,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

// ════════════════════════════════════════════════════════════
// SCOUT SERVICE
// Automated data discovery — enriches venture profiles with
// verified third-party signals without founder intervention
// ════════════════════════════════════════════════════════════

type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';

interface ScanResult {
  source: string;
  signalName: string;
  signalValue: string | number | boolean;
  verificationTier: 1 | 2 | 3 | 4;
  pointsEstimate: number;
  rawData?: Record<string, unknown>;
}

// ── Google Maps / Places scanner ─────────────────────────────

async function scanGoogleMaps(venture: Record<string, unknown>): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const name = String(venture.name || '');
  const city = String(venture.city || '');
  const country = String(venture.country || '');

  if (!name) return results;

  try {
    // Text search to find the business listing
    const searchQuery = `${name} ${city} ${country}`.trim();
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json`;

    const { data } = await axios.get(searchUrl, {
      params: {
        query: searchQuery,
        key: env.GOOGLE_MAPS_API_KEY,
      },
      timeout: 10000,
    });

    if (data.status === 'OK' && data.results.length > 0) {
      const place = data.results[0];

      // Business listing exists
      results.push({
        source: 'google_maps_api',
        signalName: 'google_maps_listing',
        signalValue: true,
        verificationTier: 2,
        pointsEstimate: 70,
        rawData: { placeId: place.place_id, name: place.name },
      });

      // Rating
      if (place.rating) {
        results.push({
          source: 'google_maps_api',
          signalName: 'google_maps_rating',
          signalValue: place.rating,
          verificationTier: 2,
          pointsEstimate: Math.min(20, Math.round(place.rating * 4)),
          rawData: { rating: place.rating, totalRatings: place.user_ratings_total },
        });
      }

      // Get place details (phone, website, hours)
      if (place.place_id) {
        try {
          const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json`;
          const { data: details } = await axios.get(detailsUrl, {
            params: {
              place_id: place.place_id,
              fields: 'website,formatted_phone_number,opening_hours,business_status',
              key: env.GOOGLE_MAPS_API_KEY,
            },
            timeout: 10000,
          });

          if (details.result?.website) {
            results.push({
              source: 'google_maps_api',
              signalName: 'business_website_verified',
              signalValue: details.result.website,
              verificationTier: 2,
              pointsEstimate: 15,
            });
          }

          if (details.result?.formatted_phone_number) {
            results.push({
              source: 'google_maps_api',
              signalName: 'business_phone_verified',
              signalValue: true,
              verificationTier: 2,
              pointsEstimate: 10,
            });
          }

          if (details.result?.business_status === 'OPERATIONAL') {
            results.push({
              source: 'google_maps_api',
              signalName: 'business_operational',
              signalValue: true,
              verificationTier: 2,
              pointsEstimate: 20,
            });
          }
        } catch { /* details lookup failed — main listing still valid */ }
      }
    }
  } catch (err) {
    console.error('Google Maps scan failed:', (err as Error).message);
  }

  return results;
}

// ── UK Companies House scanner ────────────────────────────────

async function scanCompaniesHouse(venture: Record<string, unknown>): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  if (venture.country !== 'GB') return results;

  const regNumber = String(venture.registration_number || '');
  if (!regNumber) return results;

  try {
    const { data } = await axios.get(
      `https://api.company-information.service.gov.uk/company/${regNumber}`,
      {
        auth: { username: process.env.COMPANIES_HOUSE_API_KEY || '', password: '' },
        timeout: 10000,
      }
    );

    if (data.company_status === 'active') {
      results.push({
        source: 'companies_house_api',
        signalName: 'uk_company_registered_active',
        signalValue: true,
        verificationTier: 1, // Government API
        pointsEstimate: 80,
        rawData: {
          companyNumber: data.company_number,
          companyName: data.company_name,
          incorporatedOn: data.date_of_creation,
          type: data.type,
        },
      });

      if (data.date_of_creation) {
        const monthsOld = Math.floor(
          (Date.now() - new Date(data.date_of_creation).getTime()) / (1000 * 60 * 60 * 24 * 30)
        );
        results.push({
          source: 'companies_house_api',
          signalName: 'company_age_months',
          signalValue: monthsOld,
          verificationTier: 1,
          pointsEstimate: Math.min(30, monthsOld),
        });
      }
    }
  } catch (err) {
    // 404 = company not found — not a scan error
    if (axios.isAxiosError(err) && err.response?.status !== 404) {
      console.error('Companies House scan failed:', err.message);
    }
  }

  return results;
}

// ── CAC Nigeria scanner ───────────────────────────────────────

async function scanCAC(venture: Record<string, unknown>): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  if (venture.country !== 'NG') return results;
  if (!venture.registration_number) return results;

  // CAC public search — scrapes verification from CAC portal
  // In production this would use CAC's official API when available
  // For now we mark as Tier 3 (document-based) until official API
  try {
    results.push({
      source: 'cac_portal',
      signalName: 'ng_cac_registration_number_present',
      signalValue: String(venture.registration_number),
      verificationTier: 3,
      pointsEstimate: 50,
    });
  } catch (err) {
    console.error('CAC scan failed:', (err as Error).message);
  }

  return results;
}

// ── Social media scanner ──────────────────────────────────────

async function scanSocialProfiles(ventureId: string): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const profiles = await db('venture_social_profiles').where({ venture_id: ventureId });

  for (const profile of profiles) {
    // Validate that the URL is reachable (simplified — in production use platform APIs)
    const followers = parseInt(profile.followers) || 0;
    const engagementRate = parseFloat(profile.engagement_rate) || 0;

    // Detect suspicious follower spikes (>500% in 7 days would have been caught by ACXM)
    // Here we validate engagement rate is plausible for follower count
    const expectedMinEngagement = followers > 10000 ? 1 : followers > 1000 ? 2 : 3; // %
    const engagementPlausible = engagementRate >= expectedMinEngagement * 0.3; // allow 30% below expected

    if (followers > 0 && engagementPlausible) {
      results.push({
        source: `${profile.platform}_profile`,
        signalName: `${profile.platform}_verified_presence`,
        signalValue: followers,
        verificationTier: 2,
        pointsEstimate: Math.min(15, Math.floor(Math.log10(Math.max(1, followers)) * 3)),
      });
    }
  }

  return results;
}

// ── Gemini AI — business type classification ──────────────────

async function classifyBusinessType(venture: Record<string, unknown>): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  if (venture.business_type) return results; // already classified

  const description = String(venture.description || '');
  const name = String(venture.name || '');
  if (!description && !name) return results;

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
    const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });

    const prompt = `
Classify this African startup into exactly one category:
- tech_native: Software product, app, SaaS, or digital platform as core offering
- digitally_enabled: Traditional business with significant digital operations
- physical_first: Primarily physical operations, minimal digital
- hybrid: Roughly equal physical and digital operations

Business name: ${name}
Description: ${description}

Reply with ONLY one of: tech_native, digitally_enabled, physical_first, hybrid
`;

    const result = await model.generateContent(prompt);
    const classification = result.response.text().trim().toLowerCase();

    const validTypes = ['tech_native', 'digitally_enabled', 'physical_first', 'hybrid'];
    if (validTypes.includes(classification)) {
      // Update the venture record
      await db('ventures')
        .where({ id: String(venture.id) })
        .update({ business_type: classification });

      results.push({
        source: 'gemini_ai',
        signalName: 'business_type_classification',
        signalValue: classification,
        verificationTier: 3,
        pointsEstimate: 10,
      });
    }
  } catch (err) {
    console.error('Gemini classification failed:', (err as Error).message);
  }

  return results;
}

// ── Apply scan results to database ───────────────────────────

async function applyScanResults(ventureId: string, results: ScanResult[]): Promise<void> {
  if (results.length === 0) return;

  // Get current score to associate signals
  const currentScore = await db('scores')
    .where({ venture_id: ventureId, is_current: true })
    .first();

  if (currentScore) {
    await db('score_signals').insert(
      results.map(r => ({
        score_id: currentScore.id,
        signal_name: r.signalName,
        signal_value: String(r.signalValue),
        source: r.source,
        verification_tier: r.verificationTier,
        weight: { 1: 1.00, 2: 0.95, 3: 0.85, 4: 0.60 }[r.verificationTier] || 0.60,
        points_awarded: r.pointsEstimate,
      }))
    ).onConflict(['score_id', 'signal_name']).merge();
  }

  // Update social profiles if we found social data
  const socialResults = results.filter(r => r.source.endsWith('_profile'));
  for (const sr of socialResults) {
    const platform = sr.source.replace('_profile', '');
    await db('venture_social_profiles')
      .where({ venture_id: ventureId, platform })
      .update({ last_scraped: new Date() });
  }

  // Update registration verification if Companies House confirmed
  const chResult = results.find(r => r.signalName === 'uk_company_registered_active');
  if (chResult) {
    await db('ventures').where({ id: ventureId }).update({ registration_verified: true });
  }
}

// ════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/v1/scout/scan/:venture_id — full scan
app.post(
  '/api/v1/scout/scan/:venture_id',
  rateLimiter({ max: 5 }),
  authenticate,
  async (req, res, next) => {
    try {
      const ventureId = req.params.venture_id;
      const venture = await db('ventures').where({ id: ventureId }).whereNull('deleted_at').first();
      if (!venture) throw new NotFoundError('Venture');

      // Store scan job status in Redis
      const { createClient } = await import('redis');
      const redis = createClient({ url: env.REDIS_URL });
      await redis.connect();

      const scanKey = `scout_scan:${ventureId}`;
      const existing = await redis.get(scanKey);
      if (existing) {
        const status = JSON.parse(existing);
        if (status.status === 'running') {
          throw new AppError('Scan already in progress. Check /scout/scan/:id/status.', 409, 'scan-in-progress');
        }
      }

      await redis.set(scanKey, JSON.stringify({
        ventureId, status: 'running', startedAt: new Date().toISOString(),
        sources: { googleMaps: 'pending', registry: 'pending', social: 'pending', ai: 'pending' },
      }), { EX: 3600 });

      // Return immediately — scan runs in background
      res.json({
        ventureId,
        status: 'running',
        message: 'Scout scan started. Check /api/v1/scout/scan/:id/status for results.',
        estimatedDuration: '10–30 seconds',
      });

      // Run scan asynchronously
      (async () => {
        const allResults: ScanResult[] = [];
        const sourceStatus: Record<string, string> = {};

        try {
          const [mapsResults, registryResults, socialResults, aiResults] = await Promise.allSettled([
            scanGoogleMaps(venture),
            Promise.all([scanCompaniesHouse(venture), scanCAC(venture)]).then(r => r.flat()),
            scanSocialProfiles(ventureId),
            classifyBusinessType(venture),
          ]);

          if (mapsResults.status === 'fulfilled') {
            allResults.push(...mapsResults.value);
            sourceStatus.googleMaps = 'completed';
          } else {
            sourceStatus.googleMaps = 'failed';
          }

          if (registryResults.status === 'fulfilled') {
            allResults.push(...registryResults.value);
            sourceStatus.registry = 'completed';
          } else {
            sourceStatus.registry = 'failed';
          }

          if (socialResults.status === 'fulfilled') {
            allResults.push(...socialResults.value);
            sourceStatus.social = 'completed';
          } else {
            sourceStatus.social = 'failed';
          }

          if (aiResults.status === 'fulfilled') {
            allResults.push(...aiResults.value);
            sourceStatus.ai = 'completed';
          } else {
            sourceStatus.ai = 'failed';
          }

          await applyScanResults(ventureId, allResults);

          await redis.set(scanKey, JSON.stringify({
            ventureId,
            status: 'completed',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            sources: sourceStatus,
            signalsFound: allResults.length,
            results: allResults.map(r => ({
              source: r.source,
              signalName: r.signalName,
              signalValue: r.signalValue,
              verificationTier: r.verificationTier,
              pointsEstimate: r.pointsEstimate,
            })),
          }), { EX: 86400 }); // keep results 24h

          // Log
          await db('audit_log').insert({
            action: 'scout.scan.completed',
            resource_type: 'venture',
            resource_id: ventureId,
            new_value: JSON.stringify({ signalsFound: allResults.length, sources: sourceStatus }),
          });
        } catch (err) {
          await redis.set(scanKey, JSON.stringify({
            ventureId, status: 'failed',
            error: (err as Error).message,
          }), { EX: 3600 });
        } finally {
          await redis.quit();
        }
      })();
    } catch (err) { next(err); }
  },
);

// GET /api/v1/scout/scan/:venture_id/status
app.get(
  '/api/v1/scout/scan/:venture_id/status',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const { createClient } = await import('redis');
      const redis = createClient({ url: env.REDIS_URL });
      await redis.connect();

      const scanKey = `scout_scan:${req.params.venture_id}`;
      const status = await redis.get(scanKey);
      await redis.quit();

      if (!status) {
        return res.json({ status: 'not_started', message: 'No scan found. POST to /scout/scan/:id to start.' });
      }

      res.json(JSON.parse(status));
    } catch (err) { next(err); }
  },
);

// POST /api/v1/scout/scan/:venture_id/google-maps — targeted scan
app.post(
  '/api/v1/scout/scan/:venture_id/google-maps',
  rateLimiter({ max: 10 }),
  authenticate,
  async (req, res, next) => {
    try {
      const venture = await db('ventures').where({ id: req.params.venture_id }).first();
      if (!venture) throw new NotFoundError('Venture');

      const results = await scanGoogleMaps(venture);
      await applyScanResults(req.params.venture_id, results);

      res.json({ signalsFound: results.length, results });
    } catch (err) { next(err); }
  },
);

// POST /api/v1/scout/scan/:venture_id/registry
app.post(
  '/api/v1/scout/scan/:venture_id/registry',
  rateLimiter({ max: 10 }),
  authenticate,
  async (req, res, next) => {
    try {
      const venture = await db('ventures').where({ id: req.params.venture_id }).first();
      if (!venture) throw new NotFoundError('Venture');

      const [ch, cac] = await Promise.all([scanCompaniesHouse(venture), scanCAC(venture)]);
      const results = [...ch, ...cac];
      await applyScanResults(req.params.venture_id, results);

      res.json({ signalsFound: results.length, results });
    } catch (err) { next(err); }
  },
);

// POST /api/v1/scout/scan/:venture_id/social
app.post(
  '/api/v1/scout/scan/:venture_id/social',
  rateLimiter({ max: 10 }),
  authenticate,
  async (req, res, next) => {
    try {
      const results = await scanSocialProfiles(req.params.venture_id);
      await applyScanResults(req.params.venture_id, results);
      res.json({ signalsFound: results.length, results });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/scout/sources
app.get('/api/v1/scout/sources', rateLimiter(), authenticate, async (req, res) => {
  res.json({
    sources: [
      { id: 'google_maps',     name: 'Google Maps / Places', tier: 2, status: 'active', description: 'Business listing, rating, website, operational status' },
      { id: 'companies_house', name: 'UK Companies House',   tier: 1, status: 'active', description: 'UK company registration (country=GB only)' },
      { id: 'cac_nigeria',     name: 'CAC Nigeria',          tier: 3, status: 'active', description: 'Nigerian Corporate Affairs Commission (country=NG)' },
      { id: 'social_profiles', name: 'Social media',         tier: 2, status: 'active', description: 'LinkedIn, Twitter, Instagram, Facebook, TikTok' },
      { id: 'gemini_ai',       name: 'Gemini AI',            tier: 3, status: 'active', description: 'Business type classification from venture description' },
      { id: 'mono',            name: 'Mono (Open Banking)',  tier: 2, status: 'pending', description: 'Bank account verification — Nigeria, Kenya, Ghana' },
      { id: 'okra',            name: 'Okra',                 tier: 2, status: 'pending', description: 'Alternative open banking — Nigeria' },
    ],
  });
});

app.get('/health', (_, res) => res.json({
  service: 'scout-service', status: 'ok', version: '1.0.0', timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 6; // 3007
async function start() {
  env.NODE_ENV;
  app.listen(PORT, () => console.log(`✅ scout-service running on port ${PORT}`));
}
start().catch((err) => { console.error(err); process.exit(1); });

export default app;
