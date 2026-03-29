#!/usr/bin/env node
// This script writes the correct package.json for every service.
// Run with: node fix-package-jsons.js

const fs = require('fs');
const path = require('path');

const SHARED_DEPS = {
  "@ikonetu/config": "*",
  "@ikonetu/database": "*",
  "@ikonetu/shared": "*",
  "express": "^4.18.0",
  "zod": "^3.22.0",
  "uuid": "^9.0.0",
  "redis": "^4.6.0",
  "knex": "^3.1.0",
  "pg": "^8.11.0",
};

const SHARED_DEV = {
  "@types/express": "^4.17.21",
  "@types/node": "^20.0.0",
  "@types/uuid": "^9.0.7",
  "ts-node-dev": "^2.0.0",
  "typescript": "^5.4.0",
};

const SERVICE_EXTRA_DEPS = {
  "auth-service": {
    "@sendgrid/mail": "^8.1.0",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.0",
  },
  "user-service": {
    "@google-cloud/storage": "^7.7.0",
    "@sendgrid/mail": "^8.1.0",
    "jsonwebtoken": "^9.0.0",
    "multer": "^1.4.5",
    "sharp": "^0.33.0",
  },
  "scoring-service": {
    "redis": "^4.6.0",
  },
  "bankability-service": {},
  "venture-service": {
    "@google-cloud/storage": "^7.7.0",
    "multer": "^1.4.5",
  },
  "consent-service": {},
  "scout-service": {
    "axios": "^1.6.0",
    "@google/generative-ai": "^0.3.0",
    "jsonwebtoken": "^9.0.0",
  },
  "billing-service": {
    "stripe": "^14.21.0",
    "axios": "^1.6.0",
  },
  "notification-service": {
    "@sendgrid/mail": "^8.1.0",
    "firebase-admin": "^12.0.0",
    "socket.io": "^4.7.0",
  },
  "analytics-service": {
    "@google-cloud/bigquery": "^7.3.0",
  },
  "admin-service": {
    "axios": "^1.6.0",
    "jsonwebtoken": "^9.0.0",
  },
  "roles-service": {},
  "acxm-service": {},
  "compliance-service": {
    "node-cron": "^3.0.3",
  },
};

const SERVICE_EXTRA_DEV = {
  "auth-service": {
    "@types/bcryptjs": "^2.4.6",
    "@types/jsonwebtoken": "^9.0.5",
  },
  "user-service": {
    "@types/multer": "^1.4.11",
    "@types/jsonwebtoken": "^9.0.5",
  },
  "scout-service": {
    "@types/jsonwebtoken": "^9.0.5",
  },
  "admin-service": {
    "@types/jsonwebtoken": "^9.0.5",
  },
  "notification-service": {},
  "billing-service": {},
  "compliance-service": {
    "@types/node-cron": "^3.0.11",
  },
};

const PORTS = {
  "auth-service":        3001,
  "user-service":        3002,
  "scoring-service":     3003,
  "consent-service":     3004,
  "bankability-service": 3005,
  "venture-service":     3006,
  "scout-service":       3007,
  "billing-service":     3008,
  "notification-service":3010,
  "analytics-service":   3011,
  "admin-service":       3012,
  "roles-service":       3013,
  "acxm-service":        3014,
  "compliance-service":  3015,
};

for (const [service, extraDeps] of Object.entries(SERVICE_EXTRA_DEPS)) {
  const pkg = {
    name: `@ikonetu/${service}`,
    version: "1.0.0",
    private: true,
    main: "dist/index.js",
    scripts: {
      dev:   `PORT=${PORTS[service]} ts-node-dev --respawn --transpile-only src/index.ts`,
      build: "tsc",
      start: `PORT=${PORTS[service]} node dist/index.js`,
      test:  "jest",
    },
    dependencies: {
      ...SHARED_DEPS,
      ...extraDeps,
    },
    devDependencies: {
      ...SHARED_DEV,
      ...(SERVICE_EXTRA_DEV[service] || {}),
    },
  };

  const dir = path.join(__dirname, 'services', service);
  if (!fs.existsSync(dir)) {
    console.log(`Skipping ${service} — directory not found`);
    continue;
  }

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  );
  console.log(`✅ Fixed ${service}/package.json`);
}

console.log('\nDone. Run: npm install\n');
