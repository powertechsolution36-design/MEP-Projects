import ResourcePage from '../components/ResourcePage';

const ROLES = ['super', 'admin', 'hvac_pm', 'solar_pm', 'mep_pm', 'engineer', 'service_eng', 'sales', 'store', 'accounts', 'viewer'];

export default function Users() {
  return (
    <ResourcePage
      title="Users"
      resource="users"
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'un', label: 'Username' },
        { key: 'role', label: 'Role' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'disabled', label: 'Status', render: v => v ? <span className="badge red">Disabled</span> : <span className="badge grn">Active</span> },
      ]}
      fields={[
        { key: 'name', label: 'Full Name', required: true },
        { key: 'un', label: 'Username', required: true },
        { key: 'pw', label: 'Password (leave blank to keep)', type: 'password' },
        { key: 'role', label: 'Role', type: 'select', options: ROLES, required: true },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
      ]}
    />
  );
}
