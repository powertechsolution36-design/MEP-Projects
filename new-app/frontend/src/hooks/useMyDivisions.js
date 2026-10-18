import { useEffect, useState } from 'react';
import { api } from '../api/client';

const ALL = ['HVAC', 'Solar', 'MEP'];

/**
 * The logged-in company's effective (purchased) divisions — the PWA's
 * `myDivs()` (index.html:1216). Used to fill division / segment dropdowns;
 * the server enforces the same list on every create/edit.
 */
export default function useMyDivisions() {
  const [divisions, setDivisions] = useState(ALL);
  useEffect(() => {
    let cancelled = false;
    api.get('/api/subscriptions/my-divisions')
      .then((d) => { if (!cancelled && Array.isArray(d.divisions)) setDivisions(ALL.filter((x) => d.divisions.includes(x))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return divisions;
}
