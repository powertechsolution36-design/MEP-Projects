import ResourcePage from '../components/ResourcePage';
const B = { draft: 'amb', confirmed: 'blu', delivered: 'grn', cancelled: 'red' };
export default function SalesOrders() {
  return (
    <ResourcePage
      title="Sales Orders"
      resource="salesOrders"
      columns={[
        { key: 'no', label: 'No.' },
        { key: 'client', label: 'Client' },
        { key: 'date', label: 'Date', render: v => v ? new Date(v).toLocaleDateString() : '—' },
        { key: 'total', label: 'Total', render: v => (v || 0).toLocaleString() },
        { key: 'status', label: 'Status', render: v => <span className={`badge ${B[v] || ''}`}>{v}</span> },
      ]}
      fields={[
        { key: 'client', label: 'Client', required: true },
        { key: 'contact', label: 'Contact' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'tax', label: 'Tax', type: 'number' },
        { key: 'status', label: 'Status', type: 'select', options: ['draft', 'confirmed', 'delivered', 'cancelled'] },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ]}
    />
  );
}
