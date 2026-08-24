import { useState } from 'react';
import ResourcePage from '../components/ResourcePage';
import { useStore } from '../store/useStore';

export default function Inventory() {
  const [tab, setTab] = useState('items');
  const cats = useStore(s => s.invCategories);
  const locs = useStore(s => s.invLocations);
  return (
    <div>
      <div className="main-header"><h2>Inventory</h2></div>
      <div className="row" style={{marginBottom: 20}}>
        {[['items','Items'],['categories','Categories'],['locations','Locations'],['issues','Issues']].map(([k,l]) => (
          <button key={k} className={`btn sm ${tab === k ? '' : 'sec'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'items' && <ResourcePage title="Items" resource="invItems"
        columns={[{key:'code',label:'Code'},{key:'name',label:'Name'},{key:'unit',label:'Unit'},{key:'qty',label:'Qty'},{key:'minQty',label:'Min Qty'},{key:'rate',label:'Rate'}]}
        fields={[
          {key:'code',label:'Code'},{key:'name',label:'Name',required:true},
          {key:'cat',label:'Category',type:'select',options:cats.map(c=>({value:c._id,label:c.name}))},
          {key:'location',label:'Location',type:'select',options:locs.map(l=>({value:l._id,label:l.name}))},
          {key:'unit',label:'Unit'},{key:'qty',label:'Qty',type:'number'},{key:'minQty',label:'Min Qty',type:'number'},{key:'rate',label:'Rate',type:'number'},
        ]} />}
      {tab === 'categories' && <ResourcePage title="Categories" resource="invCategories"
        columns={[{key:'name',label:'Name'},{key:'desc',label:'Description'}]}
        fields={[{key:'name',label:'Name',required:true},{key:'desc',label:'Description',type:'textarea'}]} />}
      {tab === 'locations' && <ResourcePage title="Locations" resource="invLocations"
        columns={[{key:'name',label:'Name'},{key:'address',label:'Address'}]}
        fields={[{key:'name',label:'Name',required:true},{key:'address',label:'Address',type:'textarea'}]} />}
      {tab === 'issues' && <ResourcePage title="Issues" resource="invIssues"
        columns={[{key:'staff',label:'Staff'},{key:'status',label:'Status'},{key:'notes',label:'Notes'}]}
        fields={[
          {key:'staff',label:'Staff',required:true},
          {key:'status',label:'Status',type:'select',options:['issued','returned','partial']},
          {key:'notes',label:'Notes',type:'textarea'},
        ]} />}
    </div>
  );
}
