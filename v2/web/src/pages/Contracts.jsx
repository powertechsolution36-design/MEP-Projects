import ResourcePage from '../components/ResourcePage';
const B = { active: 'grn', expired: 'red', renewed: 'blu', cancelled: 'red' };
export default function Contracts() {
  return (
    <ResourcePage
      title="Contracts"
      resource="contracts"
      columns={[
        { key: 'no', label: 'No.' },
        { key: 'client', label: 'Client' },
        { key: 'type', label: 'Type' },
        { key: 'value', label: 'Value', render: v => (v || 0).toLocaleString() },
        { key: 'status', label: 'Status', render: v => <span className={`badge ${B[v] || ''}`}>{v}</span> },
      ]}
      fields={[
        { key: 'client', label: 'Client', required: true },
        { key: 'site', label: 'Site' },
        { key: 'no', label: 'Contract No.' },
        { key: 'type', label: 'Type', type: 'select', options: ['AMC', 'CAMC', 'One-time', 'Rental', 'Other'] },
        { key: 'freq', label: 'Frequency', type: 'select', options: ['monthly', 'quarterly', 'halfyearly', 'yearly'] },
        { key: 'start', label: 'Start Date', type: 'date' },
        { key: 'end', label: 'End Date', type: 'date' },
        { key: 'value', label: 'Value', type: 'number' },
        { key: 'status', label: 'Status', type: 'select', options: ['active', 'expired', 'renewed', 'cancelled'] },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ]}
    />
  );
}
