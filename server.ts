// server.ts — single entrypoint for Render demo deployment
import 'ts-node/register';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

// We run each service in its own async context but proxy through one port
const PORT = process.env.PORT || 3000;
const app = express();

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Start all core services on their internal ports, then proxy
async function startServices() {
  process.env.PORT = '3001'; const auth = await import('./services/auth-service/src/index');
  process.env.PORT = '3002'; const user = await import('./services/user-service/src/index');
  process.env.PORT = '3003'; const scoring = await import('./services/scoring-service/src/index');
  process.env.PORT = '3006'; const venture = await import('./services/venture-service/src/index');
  process.env.PORT = '3013'; const roles = await import('./services/roles-service/src/index');

  app.use('/api/v1/auth', createProxyMiddleware({ target: 'http://localhost:3001', changeOrigin: true }));
  app.use('/api/v1/users', createProxyMiddleware({ target: 'http://localhost:3002', changeOrigin: true }));
  app.use('/api/v1/scoring', createProxyMiddleware({ target: 'http://localhost:3003', changeOrigin: true }));
  app.use('/api/v1/ventures', createProxyMiddleware({ target: 'http://localhost:3006', changeOrigin: true }));
  app.use('/api/v1/roles', createProxyMiddleware({ target: 'http://localhost:3013', changeOrigin: true }));

  app.listen(PORT, () => console.log(`Gateway running on port ${PORT}`));
}

startServices().catch(err => { console.error(err); process.exit(1); });
