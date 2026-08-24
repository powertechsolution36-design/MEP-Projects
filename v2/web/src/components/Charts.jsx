// Self-contained SVG charts - no external dependencies

const PALETTE = ['#d92b2b', '#2563c9', '#1d9e5f', '#d98a00', '#7c3aed', '#0891b2', '#db2777', '#6b7a8c'];

export function DonutChart({ data, size = 180, hole = 0.55, title }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const cx = size / 2, cy = size / 2, r = size / 2;
  const rInner = r * hole;
  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const frac = d.value / total;
    const a2 = angle + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const xi1 = cx + rInner * Math.cos(a2), yi1 = cy + rInner * Math.sin(a2);
    const xi2 = cx + rInner * Math.cos(angle), yi2 = cy + rInner * Math.sin(angle);
    const path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${rInner} ${rInner} 0 ${large} 0 ${xi2} ${yi2} Z`;
    angle = a2;
    return { path, color: d.color || PALETTE[i % PALETTE.length], label: d.label, value: d.value };
  });
  return (
    <div className="chart-wrap">
      {title && <div className="chart-title">{title}</div>}
      <div className="chart-body">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {slices.length === 0 || total === 0 ? (
            <circle cx={cx} cy={cy} r={r} fill="#e3e8ef" />
          ) : slices.map((s, i) => (
            <path key={i} d={s.path} fill={s.color}>
              <title>{s.label}: {s.value}</title>
            </path>
          ))}
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize="24" fontWeight="700" fill="#1c2733">{total}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill="#6b7a8c">Total</text>
        </svg>
        <div className="chart-legend">
          {slices.map((s, i) => (
            <div key={i} className="legend-item">
              <span className="legend-dot" style={{ background: s.color }}></span>
              <span className="legend-label">{s.label}</span>
              <span className="legend-value">{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BarChart({ data, height = 200, title }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const barW = 100 / (data.length * 1.4);
  return (
    <div className="chart-wrap">
      {title && <div className="chart-title">{title}</div>}
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75, 1].map((g, i) => (
          <line key={i} x1="0" y1={height - g * (height - 20)} x2="100" y2={height - g * (height - 20)} stroke="#e3e8ef" strokeWidth="0.3" />
        ))}
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 30);
          const x = i * (100 / data.length) + (100 / data.length - barW) / 2;
          const y = height - 20 - h;
          const color = d.color || PALETTE[i % PALETTE.length];
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h} fill={color} rx="1">
                <title>{d.label}: {d.value}</title>
              </rect>
              <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize="4" fill="#1c2733" fontWeight="600">{d.value}</text>
            </g>
          );
        })}
      </svg>
      <div className="bar-labels">
        {data.map((d, i) => (
          <div key={i} className="bar-label" style={{ width: `${100 / data.length}%` }}>{d.label}</div>
        ))}
      </div>
    </div>
  );
}

export function LineChart({ data, height = 200, title, color = '#d92b2b' }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const w = 100;
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data.map((d, i) => ({
    x: i * step,
    y: height - 20 - (d.value / max) * (height - 30),
    ...d,
  }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const area = path + ` L ${w} ${height - 20} L 0 ${height - 20} Z`;
  return (
    <div className="chart-wrap">
      {title && <div className="chart-title">{title}</div>}
      <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75, 1].map((g, i) => (
          <line key={i} x1="0" y1={height - 20 - g * (height - 30)} x2={w} y2={height - 20 - g * (height - 30)} stroke="#e3e8ef" strokeWidth="0.3" />
        ))}
        <path d={area} fill={color} opacity="0.15" />
        <path d={path} fill="none" stroke={color} strokeWidth="1" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1.2" fill={color}>
            <title>{p.label}: {p.value}</title>
          </circle>
        ))}
      </svg>
      <div className="bar-labels">
        {data.map((d, i) => (
          <div key={i} className="bar-label" style={{ width: `${100 / data.length}%` }}>{d.label}</div>
        ))}
      </div>
    </div>
  );
}
