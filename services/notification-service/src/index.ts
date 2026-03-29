import express from 'express';
import { getMessaging } from 'firebase-admin/messaging';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import sgMail from '@sendgrid/mail';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { z } from 'zod';
import { env } from '@ikonetu/config';
import { db } from '@ikonetu/database';
import {
  requestId, rateLimiter, authenticate, requireRole,
  validate, errorHandler, AppError,
} from '@ikonetu/shared/middleware';

const app = express();
app.use(express.json());
app.use(requestId);

const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: env.ALLOWED_ORIGINS.split(',') } });

// ── Firebase Admin init ──────────────────────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert(env.GOOGLE_APPLICATION_CREDENTIALS),
    projectId: env.GOOGLE_CLOUD_PROJECT,
  });
}

// ── SendGrid init ────────────────────────────────────────────
sgMail.setApiKey(env.SENDGRID_API_KEY);

// ── Socket rooms by userId ───────────────────────────────────
const userSockets = new Map<string, Set<string>>(); // userId → Set<socketId>

io.on('connection', (socket) => {
  const userId = socket.handshake.auth?.userId as string;
  if (userId) {
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId)!.add(socket.id);

    socket.join(`user:${userId}`);
    socket.on('disconnect', () => {
      userSockets.get(userId)?.delete(socket.id);
    });
  }
});

// ── Notification templates ───────────────────────────────────
const TEMPLATES: Record<string, { subject: string; title: string; body: string }> = {
  'score.calculated':       { subject: 'Your IkonetU Score has been updated', title: 'Score updated', body: 'Your IkonetU Score has been recalculated.' },
  'score.tier.changed':     { subject: 'Congratulations — your score tier has changed!', title: 'Tier change', body: 'You have moved to a new score tier.' },
  'investor.introduction':  { subject: 'An investor wants to connect with you', title: 'New introduction', body: 'An investor has requested an introduction.' },
  'booking.confirmed':      { subject: 'Your marketplace booking is confirmed', title: 'Booking confirmed', body: 'Your service booking has been confirmed.' },
  'booking.disputed':       { subject: 'Your dispute has been received', title: 'Dispute received', body: 'IkonetU is reviewing your dispute.' },
  'billing.payment_failed': { subject: 'Action required: payment failed', title: 'Payment failed', body: 'Your subscription payment failed.' },
  'account.suspended':      { subject: 'Your IkonetU account has been suspended', title: 'Account suspended', body: 'Your account has been suspended.' },
  'lender.alert':           { subject: 'Portfolio monitoring alert', title: 'Monitoring alert', body: 'A score change has been detected in your portfolio.' },
};

// ── Core send function ───────────────────────────────────────
interface SendOptions {
  userId: string;
  type: string;
  title?: string;
  body?: string;
  data?: Record<string, string>;
  channels?: ('push' | 'email' | 'in_app' | 'socket')[];
}

async function sendNotification(opts: SendOptions): Promise<void> {
  const { userId, type, data = {}, channels = ['in_app', 'socket'] } = opts;

  const user = await db('users').where({ id: userId }).first();
  if (!user || user.status === 'banned') return;

  const prefs = await db('user_preferences').where({ user_id: userId }).first();
  const notifPrefs = prefs?.notification_prefs || { email: true, push: true, in_app: true };

  const template = TEMPLATES[type] || { subject: opts.title || type, title: opts.title || type, body: opts.body || '' };
  const title = opts.title || template.title;
  const body = opts.body || template.body;

  // ACXM suppression check
  const suppression = await db('acxm_suppression').where({ user_id: userId }).first();
  if (suppression?.suppressed_until && new Date(suppression.suppressed_until) > new Date()) {
    console.log(`Notification suppressed for user ${userId} until ${suppression.suppressed_until}`);
    return;
  }

  const promises: Promise<void>[] = [];

  // In-app notification (always stored)
  if (channels.includes('in_app')) {
    promises.push(
      db('notifications').insert({
        user_id: userId, type, title, body,
        data: JSON.stringify(data),
      }).then(() => {})
    );
  }

  // Real-time socket delivery
  if (channels.includes('socket')) {
    io.to(`user:${userId}`).emit('notification', { type, title, body, data, timestamp: new Date().toISOString() });
  }

  // FCM push
  if (channels.includes('push') && notifPrefs.push) {
    const deviceTokens = await db('acxm_interventions')
      .where({ intervention_type: 'fcm_token' })
      .whereRaw("content->>'userId' = ?", [userId])
      .select('content');

    if (deviceTokens.length > 0) {
      promises.push(
        (async () => {
          try {
            const tokens = deviceTokens.map(d => JSON.parse(d.content).token).filter(Boolean);
            if (tokens.length > 0) {
              await getMessaging().sendEachForMulticast({
                tokens,
                notification: { title, body },
                data: { type, ...data },
                webpush: { fcmOptions: { link: '/' } },
              });
            }
          } catch (err) {
            console.error('FCM send failed:', (err as Error).message);
          }
        })()
      );
    }
  }

  // Email
  if (channels.includes('email') && notifPrefs.email && user.email) {
    promises.push(
      (async () => {
        try {
          await sgMail.send({
            to: user.email,
            from: { email: env.SENDGRID_FROM_EMAIL, name: env.SENDGRID_FROM_NAME },
            subject: template.subject,
            html: `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <div style="background:#0A0A0A;padding:16px 24px;border-radius:8px 8px 0 0">
    <p style="color:#F5C842;font-size:18px;font-weight:bold;margin:0">IkonetU</p>
  </div>
  <div style="background:#fff;border:1px solid #E8E6E0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
    <p style="font-size:16px;font-weight:bold;color:#0A0A0A;margin:0 0 12px">${title}</p>
    <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 20px">${body}</p>
    <p style="font-size:12px;color:#999;margin:0">
      IkonetU Technology Limited · Registered in England and Wales<br>
      <a href="mailto:customer.service@ikonetu.com" style="color:#999">customer.service@ikonetu.com</a>
    </p>
  </div>
</div>`,
          });
        } catch (err) {
          console.error('Email send failed:', (err as Error).message);
        }
      })()
    );
  }

  // Update ACXM suppression counters
  await db('acxm_suppression')
    .insert({ user_id: userId, intervention_count_24h: 1, intervention_count_7d: 1, last_intervention_at: new Date() })
    .onConflict('user_id')
    .merge({
      intervention_count_24h: db.raw('acxm_suppression.intervention_count_24h + 1'),
      intervention_count_7d: db.raw('acxm_suppression.intervention_count_7d + 1'),
      last_intervention_at: new Date(),
    });

  await Promise.allSettled(promises);
}

// ── Export for use by other services ─────────────────────────
export { sendNotification };

// ════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════

const SendSchema = z.object({
  userId:   z.string().uuid(),
  type:     z.string().min(1),
  title:    z.string().optional(),
  body:     z.string().optional(),
  data:     z.record(z.string()).optional(),
  channels: z.array(z.enum(['push', 'email', 'in_app', 'socket'])).optional(),
});

const BroadcastSchema = z.object({
  role:     z.enum(['founder', 'investor', 'provider', 'lender', 'university']).optional(),
  type:     z.string().min(1),
  title:    z.string().min(1),
  body:     z.string().min(1),
  channels: z.array(z.enum(['push', 'email', 'in_app'])).default(['in_app']),
});

// POST /api/v1/notifications/send (internal use)
app.post(
  '/api/v1/notifications/send',
  rateLimiter({ max: 500, keyPrefix: 'notif_send' }),
  authenticate,
  requireRole('super_admin'),
  validate({ body: SendSchema }),
  async (req, res, next) => {
    try {
      await sendNotification(req.body as z.infer<typeof SendSchema>);
      res.json({ success: true });
    } catch (err) { next(err); }
  },
);

// POST /api/v1/notifications/broadcast (admin mass send)
app.post(
  '/api/v1/notifications/broadcast',
  rateLimiter({ max: 10, keyPrefix: 'notif_broadcast' }),
  authenticate,
  requireRole('super_admin'),
  validate({ body: BroadcastSchema }),
  async (req, res, next) => {
    try {
      const { role, type, title, body, channels } = req.body as z.infer<typeof BroadcastSchema>;

      const query = db('users').where({ status: 'active' }).whereNull('deleted_at');
      if (role) query.where({ role });

      const users = await query.select('id');
      let sent = 0;

      // Batch in groups of 100 to avoid overwhelming the notification system
      for (let i = 0; i < users.length; i += 100) {
        const batch = users.slice(i, i + 100);
        await Promise.allSettled(
          batch.map(u => sendNotification({ userId: u.id, type, title, body, channels }))
        );
        sent += batch.length;
      }

      res.json({ success: true, sent, role: role || 'all' });
    } catch (err) { next(err); }
  },
);

// GET /api/v1/notifications (user's own)
app.get(
  '/api/v1/notifications',
  rateLimiter(),
  authenticate,
  async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

      const [notifications, [{ count }]] = await Promise.all([
        db('notifications')
          .where({ user_id: req.user!.id })
          .orderBy('created_at', 'desc')
          .limit(limit)
          .offset((page - 1) * limit),
        db('notifications').where({ user_id: req.user!.id, read: false }).count('id as count'),
      ]);

      res.json({ notifications, unreadCount: parseInt(String(count)), page, limit });
    } catch (err) { next(err); }
  },
);

// POST /api/v1/notifications/register-device
app.post(
  '/api/v1/notifications/register-device',
  rateLimiter(),
  authenticate,
  validate({ body: z.object({ token: z.string().min(1), platform: z.enum(['ios', 'android', 'web']) }) }),
  async (req, res, next) => {
    try {
      const { token, platform } = req.body as { token: string; platform: string };
      // Store FCM token — reuse acxm_interventions as device registry
      await db('acxm_interventions').insert({
        signal_id: req.user!.id,
        intervention_type: 'fcm_token',
        channel: 'push',
        content: JSON.stringify({ userId: req.user!.id, token, platform }),
      }).onConflict(['signal_id', 'intervention_type']).merge();

      res.json({ success: true });
    } catch (err) { next(err); }
  },
);

// Real-time active users (Golden Eye)
app.get(
  '/api/v1/analytics/realtime/active-users',
  rateLimiter(),
  authenticate,
  requireRole('super_admin'),
  async (req, res) => {
    const connected = userSockets.size;
    const byRole: Record<string, number> = {};

    for (const [userId] of userSockets) {
      const user = await db('users').where({ id: userId }).select('role').first();
      if (user) byRole[user.role] = (byRole[user.role] || 0) + 1;
    }

    res.json({ activeUsers: connected, byRole, timestamp: new Date().toISOString() });
  },
);

app.get('/health', (_, res) => res.json({
  service: 'notification-service', status: 'ok', version: '1.0.0',
  channels: ['push', 'email', 'in_app', 'websocket'],
  connectedUsers: userSockets.size,
  timestamp: new Date().toISOString(),
}));

app.use(errorHandler);

const PORT = parseInt(env.PORT) + 9; // 3010
httpServer.listen(PORT, () => {
  console.log(`✅ notification-service running on port ${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
});

export default app;
