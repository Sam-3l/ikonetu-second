import { createClient } from 'redis';

// ── Score cache — 5 minute TTL ─────────────────────────────
// Drop this into scoring-service/src/index.ts
// Replace the GET /api/v1/ventures/:id/score handler with the version below

let cacheClient: ReturnType<typeof createClient> | null = null;

export async function getScoreCache() {
  if (!cacheClient) {
    const { env } = await import('@ikonetu/config');
    cacheClient = createClient({ url: env.REDIS_URL });
    cacheClient.on('error', () => { cacheClient = null; }); // fail open
    await cacheClient.connect().catch(() => { cacheClient = null; });
  }
  return cacheClient;
}

const SCORE_TTL = 300; // 5 minutes
const SCORE_KEY = (ventureId: string) => `score:current:${ventureId}`;

export async function getCachedScore(ventureId: string): Promise<Record<string, unknown> | null> {
  try {
    const cache = await getScoreCache();
    if (!cache) return null;
    const cached = await cache.get(SCORE_KEY(ventureId));
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null; // cache miss — never fail a request
  }
}

export async function setCachedScore(ventureId: string, data: Record<string, unknown>): Promise<void> {
  try {
    const cache = await getScoreCache();
    if (!cache) return;
    await cache.set(SCORE_KEY(ventureId), JSON.stringify(data), { EX: SCORE_TTL });
  } catch {
    // cache write failure is non-fatal
  }
}

export async function invalidateScoreCache(ventureId: string): Promise<void> {
  try {
    const cache = await getScoreCache();
    if (!cache) return;
    await cache.del(SCORE_KEY(ventureId));
  } catch { /* non-fatal */ }
}

// ── Usage: in scoring-service GET /ventures/:id/score ─────
//
// BEFORE the DB query, check cache:
//   const cached = await getCachedScore(req.params.id);
//   if (cached) return res.json(cached);
//
// AFTER building the response object:
//   await setCachedScore(req.params.id, responseObject);
//   return res.json(responseObject);
//
// After POST /scoring/calculate/:id succeeds:
//   await invalidateScoreCache(ventureId);
