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

// Start services one at a time with a delay between each
// so ts-node doesn't compile all 5 simultaneously and blow memory
function startService(index) {
  if (index >= services.length) {
    console.log('All services started');
    return;
  }
  const { name, port } = services[index];
  const env = { ...process.env, PORT: String(port) };
  const child = spawn('node', ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', `services/${name}/src/index.ts`], { env, stdio: 'inherit' });
  child.on('error', err => console.error(`Failed to start ${name}:`, err.message));
  child.on('exit', code => console.error(`${name} exited with code ${code}`));
  console.log(`▶ Starting ${name} on port ${port}`);
  // Wait 15 seconds before starting next service
  setTimeout(() => startService(index + 1), 15000);
}

startService(0);

// Start gateway after all services have had time to boot (5 services x 15s + 15s buffer)
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
}, 90000);
