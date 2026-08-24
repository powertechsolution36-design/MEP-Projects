import ResourcePage from '../components/ResourcePage';

const STATUS_BADGE = { active: 'grn', planning: 'amb', onhold: 'blu', completed: 'grn', cancelled: 'red' };

export default function Projects() {
  return (
    <ResourcePage
      title="Projects"
      resource="projects"
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'client', label: 'Client' },
        { key: 'div', label: 'Division' },
        { key: 'status', label: 'Status', render: v => <span className={`badge ${STATUS_BADGE[v] || ''}`}>{v}</span> },
        { key: 'pm', label: 'Project Manager' },
        { key: 'value', label: 'Value', render: v => (v || 0).toLocaleString() },
      ]}
      fields={[
        { key: 'name', label: 'Project Name', required: true },
        { key: 'code', label: 'Project Code' },
        { key: 'client', label: 'Client' },
        { key: 'site', label: 'Site' },
        { key: 'div', label: 'Division', type: 'select', options: ['MEP', 'HVAC', 'Solar', 'Other'] },
        { key: 'status', label: 'Status', type: 'select', options: ['planning', 'active', 'onhold', 'completed', 'cancelled'] },
        { key: 'start', label: 'Start Date', type: 'date' },
        { key: 'target', label: 'Target Date', type: 'date' },
        { key: 'value', label: 'Value', type: 'number' },
        { key: 'pm', label: 'Project Manager' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ]}
    />
  );
}
