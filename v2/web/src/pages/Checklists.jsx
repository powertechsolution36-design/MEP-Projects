import ResourcePage from '../components/ResourcePage';
export default function Checklists() {
  return (
    <ResourcePage
      title="Checklists"
      resource="checklists"
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'div', label: 'Division' },
        { key: 'items', label: 'Items', render: v => (v?.length || 0) },
      ]}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'div', label: 'Division' },
        { key: 'desc', label: 'Description', type: 'textarea' },
      ]}
    />
  );
}
