import ResourcePage from '../components/ResourcePage';

const STATUS_BADGE = { open: 'amb', assigned: 'blu', inprogress: 'blu', onhold: 'amb', closed: 'grn' };

export default function ServiceCalls() {
  return (
    <ResourcePage
      title="Service Calls"
      resource="serviceCalls"
      columns={[
        { key: 'psc', label: 'PSC#' },
        { key: 'client', label: 'Client' },
        { key: 'type', label: 'Type' },
        { key: 'priority', label: 'Priority' },
        { key: 'status', label: 'Status', render: v => <span className={`badge ${STATUS_BADGE[v] || ''}`}>{v}</span> },
        { key: 'eng', label: 'Engineer' },
      ]}
      fields={[
        { key: 'client', label: 'Client', required: true },
        { key: 'site', label: 'Site' },
        { key: 'contact', label: 'Contact Person' },
        { key: 'phone', label: 'Phone' },
        { key: 'type', label: 'Type', type: 'select', options: ['breakdown', 'amc', 'installation', 'inspection', 'other'] },
        { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'] },
        { key: 'status', label: 'Status', type: 'select', options: ['open', 'assigned', 'inprogress', 'onhold', 'closed'] },
        { key: 'eng', label: 'Assigned Engineer' },
        { key: 'scheduled', label: 'Scheduled Date', type: 'date' },
        { key: 'desc', label: 'Description', type: 'textarea' },
        { key: 'actions', label: 'Actions Taken', type: 'textarea' },
      ]}
    />
  );
}
