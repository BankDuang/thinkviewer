// Lightweight dependency-free SVG charts for the CRM (ring, donut, bar list).

export const CP_PALETTE = ['#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2', '#64d2ff', '#ffd60a', '#8a8a96']

interface RingProps {
  value: number // 0..100
  size?: number
  stroke?: number
  color?: string
  label?: string
  sub?: string
}

export function ProgressRing({ value, size = 64, stroke = 7, color = '#30d158', label, sub }: RingProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c - (v / 100) * c
  return (
    <div className="cp-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div className="cp-ring-label">
        <span className="cp-ring-val">{label ?? `${v}%`}</span>
        {sub && <span className="cp-ring-sub">{sub}</span>}
      </div>
    </div>
  )
}

export interface Slice {
  label: string
  value: number
  color?: string
}

export function DonutChart({ data, size = 150 }: { data: Slice[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const stroke = 22
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let acc = 0
  return (
    <div className="cp-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        {total > 0 &&
          data.map((d, i) => {
            const frac = d.value / total
            const dash = frac * c
            const seg = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color ?? CP_PALETTE[i % CP_PALETTE.length]}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-acc * c}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            )
            acc += frac
            return seg
          })}
        <text x="50%" y="48%" textAnchor="middle" className="cp-donut-total">
          {total}
        </text>
        <text x="50%" y="60%" textAnchor="middle" className="cp-donut-cap">
          total
        </text>
      </svg>
      <div className="cp-legend">
        {data.map((d, i) => (
          <div className="cp-legend-item" key={d.label}>
            <span className="cp-legend-dot" style={{ background: d.color ?? CP_PALETTE[i % CP_PALETTE.length] }} />
            <span className="cp-legend-label">{d.label}</span>
            <span className="cp-legend-val">{d.value}</span>
          </div>
        ))}
        {total === 0 && <div className="cp-dim">No data</div>}
      </div>
    </div>
  )
}

export function BarList({ data }: { data: Slice[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="cp-barlist">
      {data.map((d, i) => (
        <div className="cp-bar-row" key={d.label}>
          <span className="cp-bar-label">{d.label}</span>
          <div className="cp-bar-track">
            <div
              className="cp-bar-fill"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? CP_PALETTE[i % CP_PALETTE.length] }}
            />
          </div>
          <span className="cp-bar-val">{d.value}</span>
        </div>
      ))}
      {data.length === 0 && <div className="cp-dim">No data</div>}
    </div>
  )
}
