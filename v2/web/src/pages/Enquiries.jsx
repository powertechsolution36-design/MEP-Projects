import ResourcePage from '../components/ResourcePage';
const B = { new: 'blu', contacted: 'amb', quoted: 'blu', won: 'grn', lost: 'red' };
export default function Enquiries() {
  return (
    <ResourcePage
      title="Enquiries"
      resource="enquiries"
      columns={[
        { key: 'client', label: 'Client' },
        { key: 'subject', label: 'Subject' },
        { key: 'source', label: 'Source' },
        { key: 'value', label: 'Value', render: v => (v || 0).toLocaleString() },
        { key: 'owner', label: 'Owner' },
        { key: 'status', label: 'Status', render: v => <span className={`badge ${B[v] || ''}`}>{v}</span> },
      ]}
      fields={[
        { key: 'client', label: 'Client', required: true },
        { key: 'contact', label: 'Contact Person' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'source', label: 'Source' },
        { key: 'subject', label: 'Subject' },
        { key: 'desc', label: 'Description', type: 'textarea' },
        { key: 'value', label: 'Est. Value', type: 'number' },
        { key: 'owner', label: 'Owner' },
        { key: 'status', label: 'Status', type: 'select', options: ['new', 'contacted', 'quoted', 'won', 'lost'] },
      ]}
    />
  );
}
