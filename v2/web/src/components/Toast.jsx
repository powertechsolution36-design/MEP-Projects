import { useState, useEffect } from 'react';

let showFn = () => {};
export function toast(msg) { showFn(msg); }

export default function Toast() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    showFn = (m) => {
      setMsg(m);
      setTimeout(() => setMsg(''), 3000);
    };
    return () => { showFn = () => {}; };
  }, []);
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}
