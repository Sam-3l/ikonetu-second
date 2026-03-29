// server.js — combines core services for demo deployment
process.env.NODE_ENV = 'production';

const express = require('express');
const app = express();
app.use(express.json());

// Mount each core service's router under a prefix
// Each service exports its Express app/router
const authApp = require('./services/auth-service/src/index');
const userApp = require('./services/user-service/src/index');
const scoringApp = require('./services/scoring-service/src/index');
const ventureApp = require('./services/venture-service/src/index');
const rolesApp = require('./services/roles-service/src/index');

app.use('/auth', authApp);
app.use('/user', userApp);
app.use('/scoring', scoringApp);
app.use('/venture', ventureApp);
app.use('/roles', rolesApp);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Demo server running on ${PORT}`));
