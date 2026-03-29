// server.js — plain JS gateway, no TypeScript compilation needed
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// We'll start each service as a child process so they run independently
const { spawn } = require('child_process');

const services = [
  { name: 'auth-service',    port: 3001, prefix: '/api/v1/auth' },
  { name: 'user-service',    port: 3002, prefix: '/api/v1/users' },
  { name: 'scoring-service', port: 3003, prefix: '/api/v1/scoring' },
  { name: 'venture-service', port: 3006, prefix: '/api/v1/ventures' },
  { name: 'roles-service',   port: 3013, prefix: ['/api/v1/investors', '/api/v1/providers', '/api/v1/universities'] },
];

// Start each service as a child process
services.forEach(({ name, port }) => {
  const env = { ...process.env, PORT: String(port) };
  const child = spawn(
    'node',
    ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', `services/${name}/src/index.ts`],
    { env, stdio: 'inherit' }
  );
  child.on('error', (err) => console.error(`Failed to start ${name}:`, err));
  child.on('exit', (code) => console.error(`${name} exited with code ${code}`));
  console.log(`Started ${name} on port ${port}`);
});

// Give services 5 seconds to boot, then start proxying
setTimeout(() => {
  services.forEach(({ prefix, port }) => {
    const prefixes = Array.isArray(prefix) ? prefix : [prefix];
    prefixes.forEach(p => {
      app.use(p, createProxyMiddleware({
        target: `http://localhost:${port}`,
        changeOrigin: true,
        on: {
          error: (err, req, res) => {
            res.status(502).json({ error: 'Service unavailable', detail: err.message });
          }
        }
      }));
    });
  });

  app.listen(PORT, () => {
    console.log(`\n✅ Gateway running on port ${PORT}`);
    console.log(`   Proxying ${services.length} services\n`);
  });
}, 5000);
