require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');
const { connectDB } = require('./config/db');
const { initSocket } = require('./websocket/sync');

const PORT = process.env.PORT || 4001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

global.io = io;

// Middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), version: '2.0.0' });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/users', require('./routes/users'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/service-calls', require('./routes/serviceCalls'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/enquiries', require('./routes/enquiries'));
app.use('/api/sales-orders', require('./routes/salesOrders'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/checklists', require('./routes/checklists'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/reports', require('./routes/reportsDownload'));

// Bulk endpoint - fetch everything for initial app load
app.get('/api/bulk', require('./middleware/auth').auth, async (req, res) => {
  try {
    const co = req.user.co;
    const filter = req.user.role === 'super' ? {} : { co };
    // Division-based inventory filter for HVAC/Solar/MEP managers
    const divRoleMap = { hvac_dm:'HVAC', hvac_pm:'HVAC', solar_dm:'SOLAR', solar_pm:'SOLAR', mep_dm:'MEP', mep_pm:'MEP' };
    const userDiv = divRoleMap[req.user.role];
    const invFilter = userDiv ? { ...filter, $or: [{ division: userDiv }, { division: 'COMMON' }, { division: { $exists: false } }] } : filter;
    const [
      companies, users, projects, serviceCalls, contracts, payments,
      enquiries, salesOrders, notifications, checklists,
      invCategories, invLocations, invItems, invIssues
    ] = await Promise.all([
      require('./models/Company').find(req.user.role === 'super' ? {} : { _id: co }).lean(),
      require('./models/User').find(filter).select('-pw').lean(),
      require('./models/Project').find(filter).lean(),
      require('./models/ServiceCall').find(filter).lean(),
      require('./models/Contract').find(filter).lean(),
      require('./models/Payment').find(filter).lean(),
      require('./models/Enquiry').find(filter).lean(),
      require('./models/SalesOrder').find(filter).lean(),
      require('./models/Notification').find(filter).sort({ createdAt: -1 }).limit(100).lean(),
      require('./models/Checklist').find(filter).lean(),
      require('./models/InvCategory').find(filter).lean(),
      require('./models/InvLocation').find(filter).lean(),
      require('./models/InvItem').find(invFilter).lean(),
      require('./models/InvIssue').find(filter).lean(),
    ]);
    const invTransactions = await require('./models/InvTransaction').find(filter).sort({ createdAt: -1 }).limit(500).lean();
    res.json({
      companies, users, projects, serviceCalls, contracts, payments,
      enquiries, salesOrders, notifications, checklists,
      invCategories, invLocations, invItems, invIssues, invTransactions,
      loadedAt: new Date().toISOString(),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err.stack || err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

initSocket(io);

async function start() {
  try {
    await connectDB();
    server.listen(PORT, () => {
      console.log(`[server] MEP Projects API v2.0 running on port ${PORT}`);
      console.log(`[server] WebSocket ready. CORS origin: ${CORS_ORIGIN}`);
    });
  } catch (err) {
    console.error('[fatal]', err);
    process.exit(1);
  }
}

start();

process.on('SIGTERM', () => { console.log('SIGTERM received'); server.close(); process.exit(0); });
process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));
