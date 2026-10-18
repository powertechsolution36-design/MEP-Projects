import { useEffect, useRef } from 'react';

/**
 * Finger / mouse signature capture — the PWA's `initSig()` / `clearSig()`
 * (MEP_PROJECTS_PWA/index.html:3610-3622): a 140px-high canvas, 2px round
 * dark stroke, exported as a PNG data URI. `onChange('')` while empty.
 */
export default function SignaturePad({ onChange, height = 140 }) {
  const canvasRef = useRef(null);
  const state = useRef({ drawing: false, empty: true });

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
    cv.width = cv.offsetWidth || 320;
    cv.height = height;
    const ctx = cv.getContext('2d');
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#16202e';
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return [t.clientX - r.left, t.clientY - r.top];
    };
    const start = (e) => {
      e.preventDefault();
      state.current.drawing = true;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
    };
    const move = (e) => {
      if (!state.current.drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      state.current.empty = false;
    };
    const end = () => {
      if (state.current.drawing && !state.current.empty) onChange(cv.toDataURL('image/png'));
      state.current.drawing = false;
    };
    cv.addEventListener('mousedown', start);
    cv.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    cv.addEventListener('touchstart', start, { passive: false });
    cv.addEventListener('touchmove', move, { passive: false });
    cv.addEventListener('touchend', end);
    return () => {
      cv.removeEventListener('mousedown', start);
      cv.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      cv.removeEventListener('touchstart', start);
      cv.removeEventListener('touchmove', move);
      cv.removeEventListener('touchend', end);
    };
  }, [height, onChange]);

  function clear() {
    const cv = canvasRef.current;
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    state.current.empty = true;
    onChange('');
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height, border: '1px solid #c9d3df', borderRadius: 6, background: '#fff', touchAction: 'none' }}
      />
      <div style={{ marginTop: 6 }}>
        <button type="button" className="btn sm sec" onClick={clear}>Clear signature</button>
      </div>
    </div>
  );
}
