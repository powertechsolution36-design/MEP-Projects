const Notification = require('../models/Notification');

/**
 * Create a notification and broadcast it in real time.
 * roles: array of role IDs that should see it, or ['*'] for everyone in the company
 */
async function notify(io, { co, roles = ['*'], title, body, type = 'info', link }) {
  if (!co) return null;
  try {
    const doc = await Notification.create({ co, title, body, type, link, roles: Array.isArray(roles) ? roles : [roles] });
    if (io) {
      io.to(`co:${co}`).emit('notification:update', doc);
      io.to('super').emit('notification:update', doc);
    }
    return doc;
  } catch (err) {
    console.error('[notify] failed', err.message);
    return null;
  }
}

// Convenience wrappers - domain events
const events = {
  projectCreated: (io, project, byName) => notify(io, {
    co: project.co, roles: ['admin', 'mep_pm', 'hvac_pm', 'solar_pm', 'accounts'],
    title: `New project: ${project.name}`, body: `Created by ${byName} · ${project.client || ''} · ${project.div || ''}`,
    type: 'project', link: `/projects/${project._id}`,
  }),
  projectStatus: (io, project, oldStatus, byName) => notify(io, {
    co: project.co, roles: ['admin', `${(project.div || 'mep').toLowerCase()}_pm`, 'accounts'],
    title: `Project status changed: ${project.name}`, body: `${oldStatus} → ${project.status} · by ${byName}`,
    type: 'project', link: `/projects/${project._id}`,
  }),
  serviceCallCreated: (io, call, byName) => notify(io, {
    co: call.co, roles: ['admin', 'service_mgr', 'service_eng'],
    title: `New service call PSC-${call.psc}`, body: `${call.client} · ${call.priority || 'normal'} · logged by ${byName}`,
    type: 'service', link: `/service-calls/${call._id}`,
  }),
  serviceCallAssigned: (io, call) => notify(io, {
    co: call.co, roles: ['service_eng'],
    title: `Service call PSC-${call.psc} assigned to ${call.eng}`,
    body: `${call.client} · ${call.site || ''} · ${call.scheduled ? new Date(call.scheduled).toLocaleDateString() : 'no schedule'}`,
    type: 'service', link: `/service-calls/${call._id}`,
  }),
  paymentReceived: (io, payment, amount, byName) => notify(io, {
    co: payment.co, roles: ['admin', 'accounts'],
    title: `Payment received: ₹${amount.toLocaleString()}`, body: `${payment.client} · Inv ${payment.invNo || '—'} · by ${byName}`,
    type: 'payment', link: `/payments`,
  }),
  enquiryLost: (io, enq, reason, byName) => notify(io, {
    co: enq.co, roles: ['admin', 'sales'],
    title: `Enquiry lost: ${enq.client}`, body: `Reason: ${reason || '—'} · by ${byName}`,
    type: 'enquiry', link: `/lost-enquiries`,
  }),
  lowStock: (io, item) => notify(io, {
    co: item.co, roles: ['admin', 'store'],
    title: `Low stock: ${item.name}`, body: `Only ${item.qty} ${item.unit} left (min ${item.minQty})`,
    type: 'inventory', link: `/inventory/stock`,
  }),
  contractExpiring: (io, contract, daysLeft) => notify(io, {
    co: contract.co, roles: ['admin', 'service_mgr', 'accounts'],
    title: `Contract expiring in ${daysLeft} days: ${contract.client}`,
    body: `${contract.type} · ends ${new Date(contract.end).toLocaleDateString()}`,
    type: 'contract', link: `/contracts`,
  }),
  pmVisitDue: (io, contract, visitDate) => notify(io, {
    co: contract.co, roles: ['admin', 'service_mgr'],
    title: `PM visit due: ${contract.client}`,
    body: `Scheduled: ${new Date(visitDate).toLocaleDateString()}`,
    type: 'service', link: `/contracts`,
  }),
  soConfirmed: (io, so, byName) => notify(io, {
    co: so.co, roles: ['admin', 'mep_pm', 'hvac_pm', 'solar_pm', 'accounts'],
    title: `SO #${so.no} confirmed: ${so.client}`, body: `₹${(so.total || 0).toLocaleString()} · by ${byName}`,
    type: 'salesorder', link: `/sales-orders`,
  }),
};

module.exports = { notify, events };
