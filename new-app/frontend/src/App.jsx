import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import Shell from './nav/Shell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ComingSoon from './pages/ComingSoon';

/* ── Commercial module screens (Stage 7 Pass 2) ── */
import EnquiryList from './pages/enquiries/EnquiryList';
import LostEnquiries from './pages/enquiries/LostEnquiries';
import EnquiryDetail from './pages/enquiries/EnquiryDetail';
import EnquiryCreate from './pages/enquiries/EnquiryCreate';
import EnquiryConvert from './pages/enquiries/EnquiryConvert';
import SalesOrderList from './pages/salesorders/SalesOrderList';
import SalesOrderDetail from './pages/salesorders/SalesOrderDetail';
import SalesOrderCreate from './pages/salesorders/SalesOrderCreate';
import PaymentLedger from './pages/payments/PaymentLedger';
import ProjectList from './pages/projects/ProjectList';
import ProjectDetail from './pages/projects/ProjectDetail';

/* ── Contract/AMC/Warranty module screens (Stage 7 Pass 3B) ── */
import ContractList from './pages/contracts/ContractList';
import ContractDetail from './pages/contracts/ContractDetail';
import ContractCreate from './pages/contracts/ContractCreate';
import AmcDocument from './pages/contracts/AmcDocument';

/* ── Quotation module screens (Stage 7) ── */
import QuotationList from './pages/quotations/QuotationList';
import QuotationCreate from './pages/quotations/QuotationCreate';
import QuotationDetail from './pages/quotations/QuotationDetail';

/* ── Service Call module screens (Stage 7 Pass 4A) ── */
import ServiceCallList from './pages/service/ServiceCallList';
import ServiceCallDetail from './pages/service/ServiceCallDetail';
import ServiceCallCreate from './pages/service/ServiceCallCreate';

/* ── Inventory module screens (Stage 7 Pass 4B) ── */
import InventoryStock from './pages/inventory/InventoryStock';
import InventoryIssue from './pages/inventory/InventoryIssue';
import InventoryReturns from './pages/inventory/InventoryReturns';
import InventoryTransfer from './pages/inventory/InventoryTransfer';
import InventoryCategories from './pages/inventory/InventoryCategories';
import InventoryHistory from './pages/inventory/InventoryHistory';
import MyMaterial from './pages/inventory/MyMaterial';

/* ── Notifications ── */
import Notifications from './pages/Notifications';

/* ── Checklist Template Library ── */
import ChecklistTemplateList from './pages/checklists/ChecklistTemplateList';
import ChecklistTemplateDetail from './pages/checklists/ChecklistTemplateDetail';

/* ── User Management ── */
import UserManagement from './pages/users/UserManagement';

/* ── Reports ── */
import Reports from './pages/Reports';

/* ── Super / Platform Admin ── */
import CompanyManagement from './pages/admin/CompanyManagement';
import ClientUsage from './pages/admin/ClientUsage';
import SubscriptionRevenue from './pages/admin/SubscriptionRevenue';
import ExpiringSubscriptions from './pages/admin/ExpiringSubscriptions';
import LocationSubscribers from './pages/admin/LocationSubscribers';
import SubscriptionManagement from './pages/admin/SubscriptionManagement';
import CompanyProfile from './pages/company/CompanyProfile';
import DailyTasks from './pages/DailyTasks';

function LoginRoute() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Login />;
}

/**
 * Routing skeleton for every module in the API contract.
 *
 * Stage 7 Pass 2: Enquiry, SalesOrder, and Payment screens are now real
 * React components wired to the dev backend HTTP API.
 * Everything else remains a "coming soon" stub.
 */
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Shell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />

          {/* ── Enquiries ── */}
          <Route path="enquiries" element={<EnquiryList />} />
          <Route path="enquiries/lost" element={<LostEnquiries />} />
          <Route path="enquiries/new" element={<EnquiryCreate />} />
          <Route path="enquiries/:id" element={<EnquiryDetail />} />
          <Route path="enquiries/:id/convert" element={<EnquiryConvert />} />

          {/* ── Sales Orders ── */}
          <Route path="sales-orders" element={<SalesOrderList />} />
          <Route path="sales-orders/new" element={<SalesOrderCreate />} />
          <Route path="sales-orders/:id" element={<SalesOrderDetail />} />

          {/* ── Payments / Finance ── */}
          <Route path="payments" element={<PaymentLedger />} />

          {/* ── Stubs (other modules) ── */}
          <Route path="checklists" element={<ChecklistTemplateList />} />
          <Route path="checklists/:id" element={<ChecklistTemplateDetail />} />
          <Route path="projects" element={<ProjectList />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="contracts" element={<ContractList />} />
          <Route path="contracts/new" element={<ContractCreate />} />
          <Route path="contracts/:id" element={<ContractDetail />} />
          {/* Stage 7 — paths as documented/navigated by the pages themselves
              (AmcDocument.jsx: /contracts/:id/amc-document?type=...;
              Quotation pages: /quotations, /quotations/new, /quotations/:id).
              Menu entries: nav/menuConfig.js NEW_APP_MENU_ADDITIONS (appended
              after the unchanged PWA menus). */}
          <Route path="contracts/:contractId/amc-document" element={<AmcDocument />} />
          <Route path="quotations" element={<QuotationList />} />
          <Route path="quotations/new" element={<QuotationCreate />} />
          <Route path="quotations/:id" element={<QuotationDetail />} />
          <Route path="service-calls" element={<ServiceCallList />} />
          <Route path="service-calls/new" element={<ServiceCallCreate />} />
          <Route path="service-calls/:id" element={<ServiceCallDetail />} />
          <Route path="my-material" element={<MyMaterial />} />
          <Route path="daily-tasks" element={<DailyTasks />} />
          <Route path="users" element={<UserManagement />} />
          <Route path="reports" element={<Reports />} />
          <Route path="notifications" element={<Notifications />} />

          <Route path="inventory/stock" element={<InventoryStock />} />
          <Route path="inventory/issue" element={<InventoryIssue />} />
          <Route path="inventory/returns" element={<InventoryReturns />} />
          <Route path="inventory/transfer" element={<InventoryTransfer />} />
          <Route path="inventory/categories" element={<InventoryCategories />} />
          <Route path="inventory/history" element={<InventoryHistory />} />

          {/* Platform / super-admin */}
          <Route path="admin/companies" element={<CompanyManagement />} />
          <Route path="admin/usage" element={<ClientUsage />} />
          <Route path="admin/revenue" element={<SubscriptionRevenue />} />
          <Route path="admin/expiring" element={<ExpiringSubscriptions />} />
          <Route path="admin/locations" element={<LocationSubscribers />} />
          <Route path="admin/subscriptions" element={<SubscriptionManagement />} />
          <Route path="company-profile" element={<CompanyProfile />} />

          <Route path="*" element={<ComingSoon title="Not Found" />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
