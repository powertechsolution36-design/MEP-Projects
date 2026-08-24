import ResourcePage from '../components/ResourcePage';

export default function Companies() {
  return (
    <ResourcePage
      title="Companies"
      resource="companies"
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'code', label: 'Code' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'disabled', label: 'Status', render: v => v ? <span className="badge red">Disabled</span> : <span className="badge grn">Active</span> },
      ]}
      fields={[
        { key: 'name', label: 'Company Name', required: true },
        { key: 'code', label: 'Code (e.g. ACME)' },
        { key: 'address', label: 'Address', type: 'textarea' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'gstin', label: 'GSTIN' },
      ]}
    />
  );
}
