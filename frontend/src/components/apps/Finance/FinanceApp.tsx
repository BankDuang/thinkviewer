import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { AppProps } from '@/types'
import { Icon, type IconName } from '@/components/common/Icon'
import { notify } from '@/store/notificationStore'
import { fin, baht, ymd, PROJECT_STATUS, PIPELINE_STAGES, REIMBURSE_STATUS, type Row } from './api'
import { Badge, CrudSection, FormGrid, type CrudConfig } from './ui'
import { FinDashboard } from './Dashboard'
import { FinDocuments } from './Documents'
import './finance.css'

function useLookups() {
  const [clients, setClients] = useState<Row[]>([])
  const [people, setPeople] = useState<Row[]>([])
  const [projects, setProjects] = useState<Row[]>([])
  const [cats, setCats] = useState<string[]>([])
  useEffect(() => {
    fin.clients().then(setClients).catch(() => {})
    fin.people().then(setPeople).catch(() => {})
    fin.projects().then(setProjects).catch(() => {})
    fin.expenses().then((r) => setCats(r.categories)).catch(() => {})
  }, [])
  const opts = (rows: Row[]) => rows.map((r) => ({ value: r.id, label: String(r.name) }))
  const name = (rows: Row[], id: unknown) => rows.find((r) => String(r.id) === String(id))?.name ?? '—'
  return { clients, people, projects, cats, opts, name }
}

export function FinanceApp(_props: AppProps) {
  const [active, setActive] = useState('dashboard')
  const lk = useLookups()

  const clientsCfg: CrudConfig = {
    title: 'Clients', singular: 'Client', icon: 'users', load: fin.clients,
    create: fin.createClient, update: fin.updateClient, remove: fin.deleteClient,
    columns: [{ key: 'name', label: 'Name' }, { key: 'company', label: 'Company' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'tax_id', label: 'Tax ID' }],
    fields: [{ key: 'name', label: 'Name' }, { key: 'company', label: 'Company' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'tax_id', label: 'Tax ID' }, { key: 'address', label: 'Address', type: 'textarea', full: true }],
  }
  const peopleCfg: CrudConfig = {
    title: 'People', singular: 'Person', icon: 'users', load: fin.people,
    create: fin.createPerson, update: fin.updatePerson, remove: fin.deletePerson,
    columns: [{ key: 'name', label: 'Name' }, { key: 'tax_id', label: 'Tax ID' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }],
    fields: [{ key: 'name', label: 'Name' }, { key: 'tax_id', label: 'Tax ID' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'address', label: 'Address', type: 'textarea', full: true }, { key: 'notes', label: 'Notes', type: 'textarea', full: true }],
  }
  const projectsCfg: CrudConfig = {
    title: 'Projects', singular: 'Project', icon: 'briefcase', load: fin.projects,
    create: fin.createProject, update: fin.updateProject, remove: fin.deleteProject, defaults: { status: 'active', pipeline_stage: 'negotiation' },
    columns: [{ key: 'name', label: 'Project' }, { key: 'client_id', label: 'Client', fmt: (v) => lk.name(lk.clients, v) }, { key: 'status', label: 'Status', fmt: (v) => <Badge v={v} /> }, { key: 'pipeline_stage', label: 'Stage', fmt: (v) => <Badge v={v} /> }, { key: 'budget', label: 'Budget', fmt: (v) => <span className="cp-mono">{baht(v, 0)}</span> }],
    fields: [
      { key: 'name', label: 'Project name' },
      { key: 'client_id', label: 'Client', type: 'select', options: lk.opts(lk.clients) },
      { key: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS.map((s) => ({ value: s, label: s })) },
      { key: 'pipeline_stage', label: 'Pipeline stage', type: 'select', options: PIPELINE_STAGES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })) },
      { key: 'budget', label: 'Budget', type: 'money' },
      { key: 'start_date', label: 'Start', type: 'date' }, { key: 'end_date', label: 'End', type: 'date' },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
    ],
  }
  const expensesCfg: CrudConfig = {
    title: 'Expenses', singular: 'Expense', icon: 'money', load: () => fin.expenses().then((r) => r.items),
    create: fin.createExpense, update: fin.updateExpense, remove: fin.deleteExpense, titleField: 'description',
    defaults: { reimbursement_status: 'pending', payment_method: 'cash', vat_rate: 0, wht_rate: 0, expense_date: new Date().toISOString().slice(0, 10) },
    columns: [{ key: 'expense_date', label: 'Date', fmt: (v) => <span className="cp-mono">{ymd(v)}</span> }, { key: 'description', label: 'Description' }, { key: 'category', label: 'Category' }, { key: 'vendor', label: 'Vendor' }, { key: 'total', label: 'Total', fmt: (v) => <span className="cp-mono">{baht(v)}</span> }, { key: 'reimbursement_status', label: 'Reimburse', fmt: (v) => <Badge v={v} /> }],
    fields: [
      { key: 'expense_date', label: 'Date', type: 'date' },
      { key: 'category', label: 'Category', type: 'select', options: lk.cats.map((c) => ({ value: c, label: c })) },
      { key: 'description', label: 'Description', full: true },
      { key: 'vendor', label: 'Vendor' },
      { key: 'amount', label: 'Amount (pre-VAT)', type: 'money' },
      { key: 'vat_rate', label: 'VAT %', type: 'number' },
      { key: 'wht_rate', label: 'WHT %', type: 'number' },
      { key: 'payment_method', label: 'Payment method' },
      { key: 'receipt_number', label: 'Receipt #' },
      { key: 'person_id', label: 'Person', type: 'select', options: lk.opts(lk.people) },
      { key: 'project_id', label: 'Project', type: 'select', options: lk.opts(lk.projects) },
      { key: 'reimbursement_status', label: 'Reimbursement', type: 'select', options: REIMBURSE_STATUS.map((s) => ({ value: s, label: s.replace(/_/g, ' ') })) },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
    extraForm: (form) => {
      const a = Number(form.amount) || 0, vr = Number(form.vat_rate) || 0, wr = Number(form.wht_rate) || 0
      return (
        <div className="fin-expcalc">
          VAT {baht((a * vr) / 100)} · WHT {baht((a * wr) / 100)} · <b>Total {baht(a + (a * vr) / 100)}</b>
          {form.category === 'ค่าจ้าง Outsource' && wr > 0 ? <span className="cp-dim"> · auto-creates a WHT certificate</span> : null}
        </div>
      )
    },
    headerExtra: (openWith) => <OcrScan onResult={openWith} />,
  }
  const whtCfg: CrudConfig = {
    title: 'Withholding Tax', singular: 'WHT', icon: 'clipboard', load: fin.wht,
    create: fin.createWht, update: fin.updateWht, remove: fin.deleteWht, titleField: 'payee_name', defaults: { form_type: 'pnd3', payment_type: 1, income_items: [], payment_date: new Date().toISOString().slice(0, 10) },
    columns: [{ key: 'wht_number', label: 'Number' }, { key: 'payee_name', label: 'Payee' }, { key: 'form_type', label: 'Form', fmt: (v) => <Badge v={v} /> }, { key: 'payment_date', label: 'Date', fmt: (v) => <span className="cp-mono">{ymd(v)}</span> }, { key: 'total_tax', label: 'Tax', fmt: (v) => <span className="cp-mono">{baht(v)}</span> }, { key: 'id', label: 'PDF', fmt: (_v, r) => <a className="cp-rowbtn" href={fin.pdfUrl('wht', r.id, '&lang=th')} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="PDF"><Icon name="download" size={14} /></a> }],
    fields: [
      { key: 'payee_name', label: 'Payee name' }, { key: 'payee_tax_id', label: 'Payee Tax ID' },
      { key: 'form_type', label: 'Form', type: 'select', options: [{ value: 'pnd3', label: 'ภ.ง.ด.3 (บุคคล)' }, { value: 'pnd53', label: 'ภ.ง.ด.53 (นิติบุคคล)' }] },
      { key: 'payment_date', label: 'Payment date', type: 'date' },
      { key: 'payer_name', label: 'Payer name' }, { key: 'payer_tax_id', label: 'Payer Tax ID' },
      { key: 'payee_address', label: 'Payee address', type: 'textarea', full: true },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
    extraForm: (form, set) => <WhtIncome items={(form.income_items as Row[]) ?? []} onChange={(v) => set('income_items', v)} />,
  }

  const SECTIONS: { key: string; label: string; icon: IconName; render: () => JSX.Element }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: 'grid', render: () => <FinDashboard /> },
    { key: 'documents', label: 'Documents', icon: 'clipboard', render: () => <FinDocuments /> },
    { key: 'clients', label: 'Clients', icon: 'users', render: () => <CrudSection cfg={clientsCfg} /> },
    { key: 'projects', label: 'Projects', icon: 'briefcase', render: () => <CrudSection cfg={projectsCfg} /> },
    { key: 'pipeline', label: 'Pipeline', icon: 'git-branch', render: () => <Pipeline /> },
    { key: 'expenses', label: 'Expenses', icon: 'money', render: () => <CrudSection cfg={expensesCfg} /> },
    { key: 'wht', label: 'Withholding Tax', icon: 'clipboard', render: () => <CrudSection cfg={whtCfg} /> },
    { key: 'people', label: 'People', icon: 'users', render: () => <CrudSection cfg={peopleCfg} /> },
    { key: 'settings', label: 'Settings', icon: 'gear', render: () => <FinSettings /> },
  ]
  const item = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0]

  return (
    <div className="cp-root fin-root">
      <nav className="cp-sidebar">
        <div className="cp-brand"><span className="fin-logo"><Icon name="chart-bar" size={15} /></span><span>Financial</span></div>
        <div className="cp-nav">
          {SECTIONS.map((s) => (
            <button key={s.key} className={clsx('cp-nav-item', active === s.key && 'is-active')} onClick={() => setActive(s.key)}>
              <Icon name={s.icon} size={16} /> <span>{s.label}</span>
            </button>
          ))}
        </div>
      </nav>
      <main className="cp-main">{item.render()}</main>
    </div>
  )
}

function WhtIncome({ items, onChange }: { items: Row[]; onChange: (v: Row[]) => void }) {
  const set = (i: number, k: string, v: unknown) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)))
  return (
    <div className="fin-items">
      <div className="cp-panel-title"><Icon name="list" size={14} /> <span>Income items</span></div>
      {items.map((it, i) => (
        <div className="fin-itemrow" key={i}>
          <input className="tv-field fin-iu" placeholder="type (1-6)" value={it.type ?? '5'} onChange={(e) => set(i, 'type', e.target.value)} />
          <input className="tv-field" type="date" value={ymd(it.date)} onChange={(e) => set(i, 'date', e.target.value)} />
          <input className="tv-field fin-ip" type="number" placeholder="amount" value={it.amount ?? ''} onChange={(e) => set(i, 'amount', Number(e.target.value))} />
          <input className="tv-field fin-ip" type="number" placeholder="tax" value={it.tax ?? ''} onChange={(e) => set(i, 'tax', Number(e.target.value))} />
          <button className="cp-rowbtn is-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="close" size={13} /></button>
        </div>
      ))}
      <button className="tv-btn" onClick={() => onChange([...items, { type: '5', date: '', amount: 0, tax: 0 }])}><Icon name="plus" size={13} /> Add income</button>
    </div>
  )
}

function Pipeline() {
  const [data, setData] = useState<Row | null>(null)
  const load = (silent = false) => fin.pipeline().then((d) => setData((p) => (silent && JSON.stringify(p) === JSON.stringify(d) ? p : d))).catch(() => {})
  useEffect(() => {
    load()
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(true), 7000)
    return () => window.clearInterval(id)
  }, [])
  const move = async (pid: number, stage: string) => { try { await fin.moveProject(pid, stage); load(true) } catch (e) { notify('error', (e as Error).message) } }
  if (!data) return <div className="cp-empty"><Icon name="refresh" size={26} className="spin" /></div>
  const stages: Row[] = data.stages
  const projects: Row[] = data.projects
  const t = data.totals
  const moveOpts = [...stages, { key: 'cancelled', label: 'ยกเลิก', color: 'red' }]
  const summary = [
    { label: 'Pipeline value', v: t.pipeline_value, c: '#b07cff' },
    { label: 'Invoiced', v: t.invoiced, c: '#54a8ff' },
    { label: 'Paid', v: t.paid, c: '#30d158' },
    { label: 'Outstanding', v: t.outstanding, c: '#ff9f0a' },
  ]
  return (
    <div className="cp-section fin-pipe">
      <div className="cp-section-head"><div className="cp-section-title"><Icon name="git-branch" size={18} /> <span>Pipeline</span></div></div>
      <div className="fin-pipe-summary">
        {summary.map((s) => (
          <div className="fin-pipe-sum" key={s.label}><div className="fin-pipe-sum-l">{s.label}</div><div className="fin-pipe-sum-v" style={{ color: s.c }}>{baht(s.v, 0)}</div></div>
        ))}
      </div>
      <div className="fin-kanban">
        {stages.map((st) => {
          const items = projects.filter((p) => p.stage === st.key)
          const total = items.reduce((a, p) => a + (p.contract_value || 0), 0)
          const outstanding = items.reduce((a, p) => a + (p.outstanding || 0), 0)
          return (
            <div className={clsx('fin-col', `stage-${st.color}`)} key={st.key}>
              <div className="fin-col-h">
                <span className="fin-col-dot" />
                <span className="fin-col-name">{st.label}</span>
                <span className="cp-count">{items.length}</span>
              </div>
              <div className="fin-col-total">{baht(total, 0)}{outstanding > 0 && <span className="fin-col-out"> · ค้างรับ {baht(outstanding, 0)}</span>}</div>
              <div className="fin-col-body">
                {items.map((p) => (
                  <div className="fin-card" key={p.id}>
                    <div className="fin-card-t">{p.name}</div>
                    <div className="fin-card-meta">{p.client || '—'} · <b style={{ color: '#e7ecf3' }}>{baht(p.contract_value, 0)}</b></div>
                    {p.contract_value > 0 && (
                      <div className="fin-card-bar"><div className="fin-card-bar-fill" style={{ width: `${p.payment_pct}%` }} /></div>
                    )}
                    <div className="fin-card-foot">
                      <span className="cp-dim">{p.payment_pct}% paid{p.outstanding > 0 ? ` · ${baht(p.outstanding, 0)} left` : ''}</span>
                      <select className="fin-card-move" value={st.key} onChange={(e) => void move(p.id, e.target.value)}>
                        {moveOpts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
                {!items.length && <div className="fin-col-empty">—</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OcrScan({ onResult }: { onResult: (prefill: Row) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    notify('info', 'Scanning receipt…')
    fin.ocr(file)
      .then((r) => { onResult(r); notify('ok', 'Receipt scanned — review & save') })
      .catch((err) => notify('error', (err as Error).message))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <input ref={ref} type="file" accept="image/*,application/pdf" hidden onChange={pick} />
      <button className="tv-btn" onClick={() => ref.current?.click()} disabled={busy} title="Scan a receipt with OCR">
        {busy ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="image" size={14} />} Scan receipt
      </button>
    </>
  )
}

function FinSettings() {
  const [s, setS] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { fin.settings().then(setS).catch(() => {}) }, [])
  if (!s) return <div className="cp-empty"><Icon name="refresh" size={26} className="spin" /></div>
  const set = (k: string, v: unknown) => setS((p) => ({ ...(p as Row), [k]: v }))
  const save = async () => { setBusy(true); try { await fin.updateSettings(s); notify('ok', 'Settings saved') } catch (e) { notify('error', (e as Error).message) } finally { setBusy(false) } }
  const F = [
    { key: 'name', label: 'Company name' }, { key: 'tagline', label: 'Tagline' },
    { key: 'tax_id', label: 'Tax ID' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
    { key: 'bank_name', label: 'Bank' }, { key: 'bank_account', label: 'Account #' }, { key: 'bank_account_name', label: 'Account name' },
    { key: 'approver_name', label: 'Approver name' }, { key: 'approver_position', label: 'Approver position' },
    { key: 'shareholder_investment', label: 'Shareholder investment', type: 'number' as const },
  ]
  return (
    <div className="cp-section">
      <div className="cp-section-head"><div className="cp-section-title"><Icon name="gear" size={18} /> <span>Settings</span></div>
        <button className="tv-btn tv-btn--primary" onClick={() => void save()} disabled={busy}>{busy ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="check" size={14} />} Save</button>
      </div>
      <FormGrid fields={F} form={s} set={set} />
      <div className="cp-field cp-field--full"><label className="cp-field-label">Address</label><textarea className="tv-field cp-input" rows={2} value={String(s.address ?? '')} onChange={(e) => set('address', e.target.value)} /></div>
    </div>
  )
}
