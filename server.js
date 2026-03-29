// server.js — runs pre-compiled JS, no ts-node at runtime
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const services = [
  { name: 'auth-service',    port: 3001, prefixes: ['/api/v1/auth'] },
  { name: 'user-service',    port: 3002, prefixes: ['/api/v1/users'] },
  { name: 'scoring-service', port: 3003, prefixes: ['/api/v1/scoring'] },
  { name: 'venture-service', port: 3006, prefixes: ['/api/v1/ventures'] },
  { name: 'roles-service',   port: 3013, prefixes: ['/api/v1/investors', '/api/v1/providers', '/api/v1/universities'] },
];

services.forEach(({ name, port }) => {
  const env = { ...process.env, PORT: String(port) };
  // Run compiled JS, not TypeScript
  const child = spawn('node', [`services/${name}/dist/index.js`], { env, stdio: 'inherit' });
  child.on('error', err => console.error(`Failed to start ${name}:`, err.message));
  child.on('exit', code => console.error(`${name} exited with code ${code}`));
  console.log(`▶ Started ${name} on port ${port}`);
});

setTimeout(() => {
  services.forEach(({ prefixes, port }) => {
    prefixes.forEach(prefix => {
      app.use(prefix, createProxyMiddleware({
        target: `http://localhost:${port}`,
        changeOrigin: true,
        on: {
          error: (err, req, res) => res.status(502).json({ error: 'Service unavailable' })
        }
      }));
    });
  });

  app.listen(PORT, () => console.log(`✅ Gateway on port ${PORT}`));
}, 5000);
