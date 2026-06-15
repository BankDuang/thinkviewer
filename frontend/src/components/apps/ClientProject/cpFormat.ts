// Display helpers shared by the CRM views.

export function cpMoney(v: unknown): string {
  const n = Number(v)
  if (v === '' || v == null || Number.isNaN(n)) return '—'
  return '฿' + n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function cpDate(v: unknown): string {
  return v ? String(v).slice(0, 10) : '—'
}

export function cpBool(v: unknown): boolean {
  return v === '1' || v === 1 || v === true || v === 'true'
}

/** human label for an enum-ish value: "in_progress" -> "in progress" */
export function cpLabel(v: unknown): string {
  return String(v ?? '').replace(/_/g, ' ').trim()
}

/** tone class for a status/severity/priority badge (see cp.css). */
export function cpBadgeClass(v: unknown): string {
  const s = String(v ?? '').toLowerCase()
  if (['active', 'done', 'approved', 'verified', 'paid', 'delivered', 'fixed'].includes(s)) return 'is-ok'
  if (['critical', 'urgent', 'rejected', 'cancelled', 'blocked', 'open'].includes(s)) return 'is-bad'
  if (['high', 'in_progress', 'doing', 'requested', 'on_hold', 'waiting_client', 'lead', 'proposed'].includes(s))
    return 'is-warn'
  return 'is-neutral'
}

/** Project completion %: combined done-ratio of its tasks + requirements. */
export function cpProgress(
  tasks: Array<Record<string, unknown>>,
  reqs: Array<Record<string, unknown>>,
): number {
  const tDone = tasks.filter((t) => String(t.status) === 'done').length
  const rDone = reqs.filter((r) => String(r.status) === 'done').length
  const total = tasks.length + reqs.length
  return total ? Math.round(((tDone + rDone) / total) * 100) : 0
}

export function cpRelDate(iso: unknown): string {
  if (!iso) return ''
  const t = new Date(String(iso)).getTime()
  if (Number.isNaN(t)) return String(iso)
  const diff = Date.now() - t
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d}d ago` : new Date(t).toISOString().slice(0, 10)
}
