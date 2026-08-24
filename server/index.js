require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { initWebSocket, broadcastUpdate, broadcastBulkData, broadcastDelete } = require('./websocket/sync');

const app = express();
let io = null;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/users', require('./routes/users'));
app.use('/api/enquiries', require('./routes/enquiries'));
app.use('/api/sales-orders', require('./routes/salesOrders'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/service-calls', require('./routes/serviceCalls'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/checklists', require('./routes/checklists'));
app.use('/api/inventory', require('./routes/inventory'));

const auth = require('./middleware/auth');
app.get('/api/data', auth, async (req, res) => {
  try {
    const Company = require('./models/Company');
    const User = require('./models/User');
    const Enquiry = require('./models/Enquiry');
    const SalesOrder = require('./models/SalesOrder');
    const Project = require('./models/Project');
    const ServiceCall = require('./models/ServiceCall');
    const Contract = require('./models/Contract');
    const Payment = require('./models/Payment');
    const Notification = require('./models/Notification');
    const Checklist = require('./models/Checklist');
    const InvCategory = require('./models/InvCategory');
    const InvLocation = require('./models/InvLocation');
    const InvItem = require('./models/InvItem');
    const InvIssue = require('./models/InvIssue');
    const InvTransaction = require('./models/InvTransaction');

    const co = req.user.co;
    const isSuper = req.user.role === 'super';
    const filter = isSuper ? {} : { co };

    const [companies, users, enquiries, sos, projects, svcCalls, contracts, payments, notifs, checklists, invCats, invLocs, invItems, invIssues, invTxns] = await Promise.all([
      isSuper ? Company.find() : Company.find({ _id: co }),
      User.find(filter).select('-pw'),
      Enquiry.find(filter),
      SalesOrder.find(filter),
      Project.find(filter),
      ServiceCall.find(filter),
      Contract.find(filter),
      Payment.find(filter),
      Notification.find(filter).sort({ createdAt: -1 }).limit(200),
      Checklist.find(filter),
      isSuper ? [] : InvCategory.find(filter),
      isSuper ? [] : InvLocation.find(filter),
      isSuper ? [] : InvItem.find(filter),
      isSuper ? [] : InvIssue.find(filter),
      isSuper ? [] : InvTransaction.find(filter).sort({ createdAt: -1 }).limit(500),
    ]);

    res.json({ companies, users, enquiries, sos, projects, svcCalls, contracts, payments, notifs, checklists, invCats, invLocs, invItems, invIssues, invTxns });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/data/sync', auth, async (req, res) => {
  try {
    const Company = require('./models/Company');
    const User = require('./models/User');
    const Enquiry = require('./models/Enquiry');
    const SalesOrder = require('./models/SalesOrder');
    const Project = require('./models/Project');
    const ServiceCall = require('./models/ServiceCall');
    const Contract = require('./models/Contract');
    const Payment = require('./models/Payment');
    const Notification = require('./models/Notification');
    const Checklist = require('./models/Checklist');
    const InvCategory = require('./models/InvCategory');
    const InvLocation = require('./models/InvLocation');
    const InvItem = require('./models/InvItem');
    const InvIssue = require('./models/InvIssue');
    const InvTransaction = require('./models/InvTransaction');

    const d = req.body;
    const co = req.user.co;

    async function syncCollection(Model, items) {
      if (!items || !Array.isArray(items)) return;
      for (const item of items) {
        const id = item._id;
        const data = { ...item };
        delete data._id;
        if (!data.co) data.co = co;
        if (id) { await Model.findByIdAndUpdate(id, data, { upsert: true, new: true }); }
        else { await Model.create(data); }
      }
    }

    if (req.user.role === 'super' && d.companies) { await syncCollection(Company, d.companies); }

    await Promise.all([
      syncCollection(Enquiry, d.enquiries),
      syncCollection(SalesOrder, d.sos),
      syncCollection(Project, d.projects),
      syncCollection(ServiceCall, d.svcCalls),
      syncCollection(Contract, d.contracts),
      syncCollection(Payment, d.payments),
      syncCollection(Notification, d.notifs),
      syncCollection(Checklist, d.checklists),
      syncCollection(InvCategory, d.invCats),
      syncCollection(InvLocation, d.invLocs),
      syncCollection(InvItem, d.invItems),
      syncCollection(InvIssue, d.invIssues),
      syncCollection(InvTransaction, d.invTxns),
    ]);

    res.json({ ok: true });
  } catch (err) { console.error('Sync error:', err); res.status(500).json({ error: err.message }); }
});

app.get('/api/ws/info', auth, (req, res) => {
  const { getConnectedUsers } = require('./websocket/sync');
  res.json({ connected: true, connectedUsers: getConnectedUsers(req.user.co) });
});

app.use((err, req, res, next) => { console.error(err.stack); res.status(500).json({ error: 'Internal server error' }); });

const PORT = process.env.PORT || 4001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mep_projects';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    const server = http.createServer(app);
    io = initWebSocket(server);
    console.log('WebSocket server initialized');
    global.io = io;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`WebSocket available at ws://localhost:${PORT}`);
    });
  })
  .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

module.exports = app;
