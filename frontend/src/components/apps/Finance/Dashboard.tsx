import { useEffect, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { fin, num0, baht, ymd, type Row } from './api'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function FinDashboard() {
  const [d, setD] = useState<Row | null>(null)
  const [clients, setClients] = useState<Record<string, string>>({})
  const [logoOk, setLogoOk] = useState(true)
  const now = new Date()
  const [month, setMonth] = useState<string>('')
  const [year, setYear] = useState<string>('')

  useEffect(() => {
    fin.clients().then((cs) => setClients(Object.fromEntries(cs.map((c) => [String(c.id), String(c.name)])))).catch(() => {})
  }, [])
  useEffect(() => {
    const q = `?month=${month}&year=${year}`
    const tick = () => fin.dashboard(q).then(setD).catch(() => {})
    tick()
    const id = window.setInterval(() => document.visibilityState === 'visible' && tick(), 8000)
    return () => window.clearInterval(id)
  }, [month, year])

  if (!d) return <div className="cp-empty"><Icon name="refresh" size={26} className="spin" /></div>

  const vatPayable = (d.vat_output ?? 0) - (d.vat_input ?? 0)
  const maxRev = Math.max(...(d.monthly_data ?? []).map((m: Row) => m.revenue), 1)
  const ps = d.project_status ?? {}
  const years: number[] = d.years ?? [now.getFullYear()]
  const isThisMonth = month === String(now.getMonth() + 1) && year === String(now.getFullYear())
  const isAllTime = !month && !year

  const overview = [
    { v: d.total_projects, label: 'Projects', c: '#b07cff' },
    { v: d.total_clients, label: 'Clients', c: '#54a8ff' },
    { v: d.total_people, label: 'People', c: '#34d6c0' },
    { v: d.completed_projects, label: 'Completed', c: '#30d158' },
    { v: ps.active ?? 0, label: 'Active', c: '#ffd60a' },
    { v: `${Math.floor(d.success_rate ?? 0)}%`, label: 'Success Rate', c: (d.success_rate ?? 0) >= 50 ? '#30d158' : '#ff9f0a' },
  ]
  const money = [
    { title: 'Quotation', v: d.quotation_total, sub: `${d.quotation_count} items`, c: '#54a8ff' },
    { title: 'Cashflow', v: d.cashflow, sub: 'Net flow', c: '#34d6c0' },
    { title: 'Revenue', v: d.revenue, sub: `${d.paid_invoice_count} tax invoice paid`, c: '#30d158' },
    { title: 'Expenses', v: d.expenses_total, sub: 'Total expenses', c: '#ff453a' },
    { title: 'Profit', v: d.profit, sub: d.revenue ? `${Math.floor((d.profit / d.revenue) * 100)}% margin` : '', c: d.profit >= 0 ? '#30d158' : '#ff9f0a' },
  ]
  const tax = [
    { t: 'VAT ขาย', v: d.vat_output, sub: 'Output VAT', c: '#54a8ff' },
    { t: 'VAT ซื้อ', v: d.vat_input, sub: 'Input VAT (ลดภาระภาษี)', c: '#30d158' },
    { t: 'VAT ต้องจ่าย', v: vatPayable, sub: vatPayable > 0 ? 'ต้องนำส่ง' : 'ได้คืน', c: vatPayable > 0 ? '#ff453a' : '#30d158' },
    { t: 'WHT ถูกหัก', v: d.wht_deducted, sub: 'ลูกค้าหักเรา (ขอคืนได้)', c: '#ff9f0a' },
    { t: 'WHT ที่หัก', v: d.wht_withheld, sub: 'เราหักคนอื่น (ต้องนำส่ง)', c: '#b07cff' },
  ]

  return (
    <div className="fin-dash">
      {(d.company?.name || logoOk) && (
        <div className="fin-hero">
          <div className="fin-hero-l">
            {logoOk && d.company?.logo_filename && (
              <img className="fin-hero-logo" src={fin.logoUrl()} alt="" onError={() => setLogoOk(false)} />
            )}
            <div>
              <div className="fin-hero-name">{d.company?.name || 'Financial'}</div>
              {d.company?.tagline && <div className="fin-hero-tag">{d.company.tagline}</div>}
            </div>
          </div>
          <div className="fin-hero-r">
            <div><div className="fin-hero-v" style={{ color: d.profit >= 0 ? '#30d158' : '#ff9f0a' }}>{num0(d.profit)}</div><div className="fin-hero-k">Net Profit</div></div>
            <div className="fin-hero-sep" />
            <div><div className="fin-hero-v" style={{ color: '#54a8ff' }}>{d.total_projects}</div><div className="fin-hero-k">Projects</div></div>
          </div>
        </div>
      )}

      <div className="fin-dash-bar">
        <div className="fin-seg">
          <button className={isThisMonth ? 'is-on' : ''} onClick={() => { setMonth(String(now.getMonth() + 1)); setYear(String(now.getFullYear())) }}>This Month</button>
          <button className={isAllTime ? 'is-on' : ''} onClick={() => { setMonth(''); setYear('') }}>All Time</button>
        </div>
        <div className="fin-filters">
          <select className="tv-field" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All Months</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select className="tv-field" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All Years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="fin-cards fin-cards-6">
        {overview.map((o) => (
          <div className="fin-stat" key={o.label}>
            <div className="fin-stat-v" style={{ color: o.c }}>{o.v}</div>
            <div className="fin-stat-l">{o.label}</div>
          </div>
        ))}
      </div>

      <div className="fin-cards fin-cards-5">
        {money.map((m) => (
          <div className="fin-money" key={m.title} style={{ ['--accent' as string]: m.c }}>
            <div className="fin-money-t" style={{ color: m.c }}>{m.title}</div>
            <div className="fin-money-v">{num0(m.v)}</div>
            <div className="fin-money-s">{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="cp-panel">
        <div className="cp-panel-title"><Icon name="chart-bar" size={15} /> <span>Tax Summary (สรุปภาษี)</span></div>
        <div className="fin-cards fin-cards-5">
          {tax.map((t) => (
            <div className="fin-tax" key={t.t}>
              <div className="fin-tax-t" style={{ color: t.c }}>{t.t}</div>
              <div className="fin-tax-v">{baht(t.v)}</div>
              <div className="fin-tax-s">{t.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="fin-dash-grid">
        <div className="cp-panel">
          <div className="cp-panel-title"><Icon name="chart-bar" size={15} /> <span>Revenue (Last 6 Months)</span></div>
          <div className="fin-bars">
            {(d.monthly_data ?? []).map((m: Row, i: number) => (
              <div className="fin-bar-col" key={i} title={baht(m.revenue, 0)}>
                <div className="fin-bar" style={{ height: `${Math.round((m.revenue / maxRev) * 120)}px` }} />
                <div className="fin-bar-m">{m.month}</div>
                <div className="fin-bar-v">{Math.round(m.revenue / 1000).toLocaleString()}K</div>
              </div>
            ))}
          </div>
        </div>
        <div className="cp-panel">
          <div className="cp-panel-title"><Icon name="list" size={15} /> <span>Project Status</span></div>
          {[['active', '#30d158', 'Active'], ['completed', '#54a8ff', 'Completed'], ['on_hold', '#ffd60a', 'On Hold'], ['cancelled', '#ff453a', 'Cancelled']].map(([k, c, l]) => (
            <div className="fin-pstatus" key={k}>
              <span className="fin-dot" style={{ background: c as string }} />
              <span>{l}</span>
              <b style={{ color: c as string }}>{ps[k as string] ?? 0}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="fin-dash-grid">
        <div className="cp-panel">
          <div className="cp-panel-title"><Icon name="clipboard" size={15} /> <span>Recent Documents</span></div>
          {(d.recent_docs ?? []).map((r: Row) => (
            <div className="fin-recent" key={r.id}>
              <div><b>{r.doc_number}</b><span className="cp-dim"> · {clients[String(r.client_id)] ?? '—'}</span></div>
              <div><b>{num0(r.total)}</b> <span className="cp-dim">{ymd(r.issue_date)}</span></div>
            </div>
          ))}
          {!(d.recent_docs ?? []).length && <div className="cp-dim">No documents yet</div>}
        </div>
        <div className="cp-panel">
          <div className="cp-panel-title"><Icon name="money" size={15} /> <span>Recent Expenses</span></div>
          {(d.recent_expenses ?? []).map((r: Row) => (
            <div className="fin-recent" key={r.id}>
              <div>{String(r.description).slice(0, 36)}<span className="cp-dim"> · {r.category || '—'}</span></div>
              <div><b style={{ color: '#ff8b82' }}>{num0(r.total)}</b> <span className="cp-dim">{ymd(r.expense_date)}</span></div>
            </div>
          ))}
          {!(d.recent_expenses ?? []).length && <div className="cp-dim">No expenses yet</div>}
        </div>
      </div>
    </div>
  )
}
