import ResourcePage from '../components/ResourcePage';
const B = { pending: 'amb', partial: 'blu', paid: 'grn', overdue: 'red' };
export default function Payments() {
  return (
    <ResourcePage
      title="Payments"
      resource="payments"
      columns={[
        { key: 'invNo', label: 'Invoice #' },
        { key: 'client', label: 'Client' },
        { key: 'amount', label: 'Amount', render: v => (v || 0).toLocaleString() },
        { key: 'due', label: 'Due', render: v => v ? new Date(v).toLocaleDateString() : '—' },
        { key: 'status', label: 'Status', render: v => <span className={`badge ${B[v] || ''}`}>{v}</span> },
      ]}
      fields={[
        { key: 'client', label: 'Client', required: true },
        { key: 'invNo', label: 'Invoice No.' },
        { key: 'invDate', label: 'Invoice Date', type: 'date' },
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        { key: 'due', label: 'Due Date', type: 'date' },
        { key: 'status', label: 'Status', type: 'select', options: ['pending', 'partial', 'paid', 'overdue'] },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ]}
    />
  );
}
