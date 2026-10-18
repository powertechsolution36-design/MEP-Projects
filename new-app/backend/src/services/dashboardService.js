'use strict';

const { ServiceError } = require('../errors');
const { getEffectiveDivisions } = require('./subscriptionService');

/**
 * Role dashboard — server-side reproduction of the PWA's `vDash()`
 * (MEP_PROJECTS_PWA/index.html:1380-1414) for the company roles that use
 * it: admin, sales, hvac_pm, solar_pm, mep_pm, service_mgr, finance.
 * (super -> superDash, inventory -> invDash and engineer/service_eng ->
 * engDash are separate PWA screens served by their own endpoints.)
 *
 * Every number and panel is computed from the caller's OWN company's data
 * only, and project / sales-order panels honour the PWA's `hasDiv()` filter
 * against the company's effective (purchased) divisions.
 *
 * KPI and panel definitions (all PWA FACT):
 *   KPIs        index.html:1389-1397
 *   delayPanel  2056-2066   segPanel 1591-1607   soStatusPanel 1608-1622
 *   followupPanel 1623-1632 projPanel 2067-2090  pmDuePanel 3645-3656
 *   openCallsPanel 3512-3519 payPanel 3705-3730
 *   delayedItems/timelineReady/projTargetEnd 2220-2228, pmDue 1368-1372
 */

const PM_DIV = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };
const DASH_ROLES = ['admin', 'sales', 'hvac_pm', 'solar_pm', 'mep_pm', 'service_mgr', 'finance'];

function dayKey(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromKey, toKey) {
  if (!fromKey || !toKey) return 0;
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000);
}

function delayedItems(project, today) {
  return (project.checklist || []).filter((c) => !c.done && c.targetDate && dayKey(c.targetDate) < today);
}

function timelineReady(project) {
  return !!project.timelineSet && (project.checklist || []).some((c) => c.targetDate);
}

function projTargetEnd(project) {
  let d = '';
  for (const c of project.checklist || []) {
    const k = dayKey(c.targetDate);
    if (k && k > d) d = k;
  }
  return d;
}

function payRcvd(payment) {
  return (payment.partPayments || []).reduce((a, b) => a + (Number(b.amount) || 0), 0);
}

function payBal(payment) {
  return Math.max(0, (payment.amount || 0) - payRcvd(payment));
}

/** PWA FACT (paySum, index.html:2257-2265). */
function paySum(so, payments) {
  const milestones = so.paymentMilestones || [];
  const tot = milestones.reduce((a, m) => a + (Number(m.amount) || 0), 0);
  let rcv = 0;
  milestones.forEach((m, i) => {
    if (m.received) {
      rcv += Number(m.amount) || 0;
      return;
    }
    const pr = payments.find((p) => String(p.salesOrderId) === String(so.id) && p.milestoneIndex === i);
    if (pr) rcv += payRcvd(pr);
  });
  return { tot, rcv, pen: tot - rcv, pct: tot ? Math.round((rcv * 100) / tot) : 0 };
}

function lastUpdate(project) {
  const u = project.executionUpdates || [];
  return u.length ? u[u.length - 1] : null;
}

async function getDashboard(actorAuth, deps) {
  if (!actorAuth || !actorAuth.companyId) {
    throw new ServiceError('No company context for this account.', 'NO_COMPANY_CONTEXT', 403);
  }
  if (!DASH_ROLES.includes(actorAuth.role)) {
    throw new ServiceError('This dashboard is not available for your role.', 'FORBIDDEN', 403);
  }
  const companyId = actorAuth.companyId;
  const role = actorAuth.role;
  const today = dayKey(new Date());
  const thisMonth = today.slice(0, 7);

  const [enquiries, sos, projects, calls, contracts, payments, users, divisions] = await Promise.all([
    deps.enquiryRepo.listByCompany(companyId),
    deps.salesOrderRepo.listByCompany(companyId),
    deps.projectRepo.listByCompany(companyId),
    deps.serviceCallRepo.listByCompany(companyId),
    deps.contractRepo.listByCompany(companyId),
    deps.paymentRepo.listByCompany(companyId),
    deps.userRepoForEnquiry.listByCompany(companyId),
    getEffectiveDivisions(companyId, deps),
  ]);
  const hasDiv = (div) => divisions.includes(div);
  const userName = new Map(users.map((u) => [String(u.id), u.name]));
  const engNames = (p) => (p.assignedEngineerIds || []).map((id) => userName.get(String(id)) || '').filter(Boolean);
  const soById = new Map(sos.map((s) => [String(s.id), s]));
  const pending = payments.filter((x) => x.status === 'Pending');

  const kpis = [];
  const panels = {};

  if (role === 'sales' || role === 'admin') {
    const open = enquiries.filter((x) => x.status === 'Open');
    const lost = enquiries.filter((x) => x.status === 'Lost');
    kpis.push(
      { label: 'Open Enquiries', value: open.length },
      { label: 'Open Enquiry Value', value: open.reduce((a, b) => a + (b.estimatedValue || 0), 0), money: true },
      { label: 'Sales Orders', value: sos.length },
      { label: 'Sales Order Value', value: sos.reduce((a, b) => a + (b.totalCost || 0), 0), money: true },
      { label: 'Lost Enquiries', value: lost.length },
      { label: 'Lost Value', value: lost.reduce((a, b) => a + (b.estimatedValue || 0), 0), money: true }
    );
  }

  if (role === 'admin' || PM_DIV[role]) {
    const dv = PM_DIV[role];
    const pp = dv ? projects.filter((x) => x.division === dv) : projects;
    const ongoing = pp.filter((x) => x.status === 'Ongoing');
    kpis.push(
      { label: `${dv || 'All'} Ongoing Projects`, value: ongoing.length },
      { label: 'Completed Projects', value: pp.filter((x) => x.status === 'Completed').length },
      { label: 'Delayed Projects', value: ongoing.filter((x) => delayedItems(x, today).length).length },
      { label: 'Timeline Not Set', value: ongoing.filter((x) => !timelineReady(x)).length }
    );
  }

  const pmDueRows = [];
  for (const c of contracts) {
    (c.scheduledVisits || []).forEach((v, i) => {
      if (!v.completedDate && v.month <= thisMonth) {
        pmDueRows.push({
          contractId: c.id, visitIndex: i, site: c.site, customer: c.customer, phone: c.phone,
          category: c.category, month: v.month, overdue: v.month < thisMonth,
        });
      }
    });
  }

  if (role === 'admin' || role === 'service_mgr') {
    kpis.push(
      { label: 'Open Service Calls', value: calls.filter((x) => x.status !== 'Completed').length },
      { label: 'PM Due / Overdue', value: pmDueRows.length }
    );
  }
  if (role === 'admin' || role === 'finance') {
    kpis.push({ label: 'Pending Payments', value: pending.reduce((a, b) => a + (b.amount || 0), 0), money: true });
  }

  const delayPanel = () =>
    projects
      .filter((p) => p.status === 'Ongoing' && hasDiv(p.division) && delayedItems(p, today).length)
      .map((p) => {
        const l = delayedItems(p, today);
        const worst = l.reduce((a, c) => Math.max(a, daysBetween(dayKey(c.targetDate), today)), 0);
        const so = soById.get(String(p.salesOrderId));
        return {
          projectId: p.id, name: p.name, orderNumber: so ? so.orderNumber : null, division: p.division,
          overduePoints: l.length, maxDelayDays: worst, targetEnd: projTargetEnd(p),
        };
      });

  const segPanel = () => {
    const segs = {};
    for (const x of enquiries) {
      const k = x.segment || 'Other';
      const s = (segs[k] = segs[k] || { segment: k, t: 0, tv: 0, o: 0, ov: 0, w: 0, wv: 0, l: 0, lv: 0 });
      const v = x.estimatedValue || 0;
      s.t += 1; s.tv += v;
      if (x.status === 'Open') { s.o += 1; s.ov += v; } else if (x.status === 'Won') { s.w += 1; s.wv += v; } else { s.l += 1; s.lv += v; }
    }
    return Object.keys(segs).sort().map((k) => segs[k]);
  };

  const soStatusPanel = () =>
    sos
      .filter((s) => hasDiv(s.division))
      .slice()
      .reverse()
      .map((s) => {
        const p = projects.find((x) => String(x.salesOrderId) === String(s.id));
        const ps = paySum(s, payments);
        const lu = p ? lastUpdate(p) : null;
        return {
          salesOrderId: s.id, projectId: p ? p.id : null, orderNumber: s.orderNumber, projectName: s.projectName,
          division: s.division, stage: p ? p.stage : 'Not started', projectStatus: p ? p.status : null,
          engineers: p ? engNames(p) : [], checklistDone: p ? (p.checklist || []).filter((c) => c.done).length : null,
          checklistTotal: p ? (p.checklist || []).length : null,
          lastUpdate: lu ? { actionDone: lu.actionDone || '', date: dayKey(lu.date) } : null,
          soValue: s.totalCost || 0, received: ps.rcv, pending: ps.pen,
        };
      });

  const followupPanel = () =>
    enquiries
      .filter((x) => x.status === 'Open' && x.nextActionDate && dayKey(x.nextActionDate) <= today)
      .map((x) => ({ enquiryId: x.id, name: x.name, segment: x.segment, nextAction: x.nextActionDescription || '', due: dayKey(x.nextActionDate) }));

  const projPanel = (div) => {
    let tR = 0;
    let tP = 0;
    const rows = projects
      .filter((p) => (!div || p.division === div) && hasDiv(p.division) && p.status !== 'Completed')
      .map((p) => {
        const lu = lastUpdate(p);
        const nd = lu ? dayKey(lu.nextActionDate) : '';
        const so = soById.get(String(p.salesOrderId));
        let pay = null;
        if (so) {
          const ps = paySum(so, payments);
          const next = (so.paymentMilestones || []).find((m) => !m.received) || null;
          pay = { received: ps.rcv, pending: ps.pen, nextMilestone: next ? { description: next.description, amount: next.amount } : null };
          tR += ps.rcv;
          tP += ps.pen;
        }
        const lt = delayedItems(p, today);
        const tl = timelineReady(p);
        return {
          projectId: p.id, orderNumber: so ? so.orderNumber : null, name: p.name, stage: p.stage, engineers: engNames(p),
          checklistDone: (p.checklist || []).filter((c) => c.done).length, checklistTotal: (p.checklist || []).length,
          timelineSet: tl, targetEnd: tl ? projTargetEnd(p) : '', overduePoints: lt.length,
          nextAction: lu ? lu.nextAction || '' : '', nextActionDate: nd, nextActionOverdue: !!nd && nd <= today, pay,
        };
      });
    return { division: div || null, rows, totalReceived: tR, totalPending: tP };
  };

  const openCallsPanel = () =>
    calls
      .filter((s) => s.status !== 'Completed')
      .map((s) => ({
        serviceCallId: s.id, complaintNumber: s.complaintNumber, type: s.type, customer: s.customer, site: s.site,
        engineer: s.engineerId ? userName.get(String(s.engineerId)) || '' : '', status: s.status,
      }));

  const payPanel = () => {
    const rows = pending.map((x) => ({
      paymentId: x.id, project: x.projectOrReference, person: x.personName, phone: x.phone, amount: x.amount,
      received: payRcvd(x), balance: payBal(x), nextCallDate: dayKey(x.nextCallDate),
      raised: x.raisedToFinance
        ? {
            priority: x.raisedToFinance.priority, by: userName.get(String(x.raisedToFinance.raisedByUserId)) || '',
            date: dayKey(x.raisedToFinance.raisedDate), collectBy: dayKey(x.raisedToFinance.collectByDate), note: x.raisedToFinance.note || '',
          }
        : null,
    }));
    return {
      billed: rows.reduce((a, b) => a + (b.amount || 0), 0),
      partReceived: rows.reduce((a, b) => a + b.received, 0),
      balance: rows.reduce((a, b) => a + b.balance, 0),
      rows,
    };
  };

  if (role === 'sales' || role === 'admin') {
    panels.delayed = delayPanel();
    panels.segments = segPanel();
    panels.salesOrders = soStatusPanel();
  }
  if (role === 'sales') panels.followups = followupPanel();
  if (PM_DIV[role]) {
    panels.delayed = delayPanel();
    panels.projects = projPanel(PM_DIV[role]);
  }
  if (role === 'service_mgr') {
    panels.pmDue = pmDueRows;
    panels.openCalls = openCallsPanel();
  }
  if (role === 'finance') panels.payments = payPanel();
  if (role === 'admin') {
    panels.projects = projPanel(null);
    panels.pmDue = pmDueRows;
    panels.showInventory = true; // admin also sees inventory KPIs / low stock (index.html:1403-1410)
  }

  return { role, today, divisions, kpis, panels };
}

module.exports = { getDashboard, delayedItems, timelineReady, projTargetEnd, paySum };
