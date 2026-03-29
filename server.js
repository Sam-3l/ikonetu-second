// server.js — single gateway for Render demo deployment
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

const services = [
  { name: 'auth-service',    port: 3001, prefixes: ['/api/v1/auth'] },
  { name: 'user-service',    port: 3002, prefixes: ['/api/v1/users'] },
  { name: 'scoring-service', port: 3003, prefixes: ['/api/v1/scoring'] },
  { name: 'venture-service', port: 3006, prefixes: ['/api/v1/ventures'] },
  { name: 'roles-service',   port: 3013, prefixes: ['/api/v1/investors', '/api/v1/providers', '/api/v1/universities'] },
];

// Start services one at a time to avoid blowing the 512MB memory limit
function startService(index) {
  if (index >= services.length) {
    console.log('✅ All services started');
    return;
  }

  const { name, port } = services[index];
  const env = {
    ...process.env,
    PORT: String(port),
    TS_NODE_PROJECT: 'tsconfig.runtime.json',
    TS_NODE_TRANSPILE_ONLY: 'true',
  };

  const child = spawn(
    'node',
    ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', `services/${name}/src/index.ts`],
    { env, stdio: 'inherit' }
  );

  child.on('error', (err) => console.error(`❌ Failed to start ${name}:`, err.message));
  child.on('exit', (code) => console.error(`⚠️  ${name} exited with code ${code}`));

  console.log(`▶ Starting ${name} on port ${port}`);

  // Wait 20s before starting the next service
  setTimeout(() => startService(index + 1), 20000);
}

// Boot all services sequentially
startService(0);

// Total boot time: 5 services x 20s = 100s, add 20s buffer = 120s
const GATEWAY_DELAY = 120000;

setTimeout(() => {
  services.forEach(({ prefixes, port }) => {
    prefixes.forEach((prefix) => {
      app.use(
        prefix,
        createProxyMiddleware({
          target: `http://localhost:${port}`,
          changeOrigin: true,
          on: {
            error: (err, req, res) => {
              console.error(`Proxy error on ${prefix}:`, err.message);
              res.status(502).json({ error: 'Service unavailable', detail: err.message });
            },
          },
        })
      );
    });
  });

  app.listen(PORT, () => {
    console.log(`\n✅ Gateway running on port ${PORT}`);
    console.log(`   Proxying ${services.length} core services\n`);
  });
}, GATEWAY_DELAY);
