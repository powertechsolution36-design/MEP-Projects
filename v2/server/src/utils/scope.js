/**
 * Department-based data scoping utilities.
 *
 * Rules:
 *  - super, admin (ADMIN dept): see all data in company
 *  - Managers (HVAC/SOLAR/MEP): see only their department's projects/enquiries/SO
 *  - Engineers: see only their own assigned records within their department
 *  - Service dept: sees all service calls, contracts
 *  - Sales dept: sees all enquiries, sales orders, quotations
 *  - Accounts dept: sees payments, sales orders
 *  - Store dept: sees inventory, transactions
 */

// Division field mapping: 'HVAC' | 'Solar' | 'MEP'
const DEPT_TO_DIVISION = {
  HVAC: 'HVAC',
  SOLAR: 'Solar',
  MEP: 'MEP',
};

// Does the user have unrestricted access within their company?
function isAdminLevel(user) {
  return user.role === 'super' || user.role === 'admin' || user.department === 'ADMIN';
}

// Get the division this user belongs to (returns null if not a division-based dept)
function userDivision(user) {
  if (user.division) return user.division === 'HVAC' ? 'HVAC' : user.division === 'SOLAR' ? 'Solar' : user.division === 'MEP' ? 'MEP' : null;
  return DEPT_TO_DIVISION[user.department] || null;
}

/**
 * Build a MongoDB filter for a resource based on user's role/department.
 * @param {Object} user - authenticated user
 * @param {String} resource - 'projects' | 'enquiries' | 'salesOrders' | 'quotations' | 'serviceCalls' | 'contracts' | 'payments' | 'inventory'
 * @param {Object} extra - additional filter to merge
 */
function scopeFilter(user, resource, extra = {}) {
  const f = { ...extra };

  // Super admin sees all (or scoped company via query)
  if (user.role === 'super') return f;

  // Everyone else scoped to their company
  f.co = user.co;

  if (isAdminLevel(user)) return f;

  const div = userDivision(user);

  switch (resource) {
    case 'projects':
    case 'enquiries':
    case 'salesOrders':
    case 'quotations':
      // Division-based scoping for HVAC/SOLAR/MEP managers
      if (div) f.division = div;
      // Engineers see only their assigned projects
      if (user.designation === 'engineer' || user.designation === 'technician') {
        f.$or = [
          { assignedTo: user._id },
          { 'team.userId': user._id },
        ];
        if (div) delete f.division; // team assignments override division
      }
      break;

    case 'serviceCalls':
    case 'contracts':
      // Only SERVICE dept sees these (unless admin)
      if (user.department !== 'SERVICE') {
        f._blocked = true; // returns nothing
      }
      // Service engineers see only their assigned calls
      if (user.designation === 'engineer' || user.designation === 'technician') {
        f.assignedTo = user._id;
      }
      break;

    case 'payments':
      // Only ACCOUNTS + Admin see payments
      if (user.department !== 'ACCOUNTS') f._blocked = true;
      break;

    case 'inventory':
    case 'inventoryTransactions':
      // Inventory is shared across all divisions/departments — no restriction
      // Users can filter by division on the frontend if needed
      break;

    case 'users':
      // Managers see users in their department only
      if (user.designation === 'manager' && user.department) {
        f.department = user.department;
      }
      break;
  }

  return f;
}

module.exports = { scopeFilter, isAdminLevel, userDivision, DEPT_TO_DIVISION };
