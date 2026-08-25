/**
 * Role-based scoping helpers. Applied server-side to enforce
 * division isolation and personal work views.
 */

// Division a PM is scoped to
const PM_DIV = { hvac_pm: 'HVAC', solar_pm: 'Solar', mep_pm: 'MEP' };

/**
 * Add division/company/personal filters to a Mongo query filter for Projects.
 * - super: no scoping
 * - admin / accounts / viewer: only own company
 * - hvac_pm/solar_pm/mep_pm: only own company + division
 * - engineer: only own company + projects where they are in engs
 * - anyone with ?mine=true param: personal filter regardless
 */
function scopeProjects(filter, req) {
  const u = req.user;
  if (u.role !== 'super') filter.co = u.co;
  const div = PM_DIV[u.role];
  if (div) filter.div = div;
  if (u.role === 'engineer' || req.query.mine === 'true') {
    filter.$or = [{ engs: u.name }, { pm: u.name }];
  }
  return filter;
}

function scopeServiceCalls(filter, req) {
  const u = req.user;
  if (u.role !== 'super') filter.co = u.co;
  if (u.role === 'service_eng' || req.query.mine === 'true') {
    filter.eng = u.name;
  }
  return filter;
}

function scopeIssues(filter, req) {
  const u = req.user;
  if (u.role !== 'super') filter.co = u.co;
  if (['engineer', 'service_eng'].includes(u.role) || req.query.mine === 'true') {
    filter.staff = u.name;
  }
  return filter;
}

function scopeCompany(filter, req, idField = '_id') {
  const u = req.user;
  if (u.role === 'super') return filter;
  filter[idField] = u.co;
  return filter;
}

module.exports = { scopeProjects, scopeServiceCalls, scopeIssues, scopeCompany, PM_DIV };
