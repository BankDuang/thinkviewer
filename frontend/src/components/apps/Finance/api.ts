// Native Financial app API client — talks to the same-origin /api/fin/* backend
// (FastAPI over FinanceHub's invoice.db). Replaces the old iframe embed.
import { getAuthToken } from '@/lib/restClient'

export type Row = Record<string, any>

async function req(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch('/api/fin' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken() ?? ''}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    let detail = r.statusText
    try {
      detail = (await r.json()).detail || detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return r.status === 204 ? null : r.json()
}

const list = (p: string) => req('GET', p).then((r) => (r.items ?? r) as Row[])

export const fin = {
  dashboard: (q = '') => req('GET', '/dashboard' + q) as Promise<Row>,

  clients: () => list('/clients'),
  createClient: (b: Row) => req('POST', '/clients', b),
  updateClient: (id: number, b: Row) => req('PUT', `/clients/${id}`, b),
  deleteClient: (id: number) => req('DELETE', `/clients/${id}`),

  people: () => list('/people'),
  createPerson: (b: Row) => req('POST', '/people', b),
  updatePerson: (id: number, b: Row) => req('PUT', `/people/${id}`, b),
  deletePerson: (id: number) => req('DELETE', `/people/${id}`),

  projects: () => list('/projects'),
  project: (id: number) => req('GET', `/projects/${id}`) as Promise<Row>,
  createProject: (b: Row) => req('POST', '/projects', b),
  updateProject: (id: number, b: Row) => req('PUT', `/projects/${id}`, b),
  moveProject: (id: number, stage: string) => req('POST', `/projects/${id}/pipeline`, { stage }),
  deleteProject: (id: number) => req('DELETE', `/projects/${id}`),

  documents: (type?: string) => list('/documents' + (type ? `?type=${type}` : '')),
  document: (id: number) => req('GET', `/documents/${id}`) as Promise<Row>,
  createDocument: (b: Row) => req('POST', '/documents', b),
  updateDocument: (id: number, b: Row) => req('PUT', `/documents/${id}`, b),
  documentStatus: (id: number, status: string) => req('POST', `/documents/${id}/status`, { status }),
  duplicateDocument: (id: number) => req('POST', `/documents/${id}/duplicate`),
  convertDocument: (id: number, newType: string) => req('POST', `/documents/${id}/convert/${newType}`),
  deleteDocument: (id: number) => req('DELETE', `/documents/${id}`),

  expenses: () => req('GET', '/expenses') as Promise<{ items: Row[]; categories: string[] }>,
  createExpense: (b: Row) => req('POST', '/expenses', b),
  updateExpense: (id: number, b: Row) => req('PUT', `/expenses/${id}`, b),
  expenseReimbursement: (id: number, status: string) =>
    req('POST', `/expenses/${id}/reimbursement`, { reimbursement_status: status }),
  deleteExpense: (id: number) => req('DELETE', `/expenses/${id}`),

  wht: () => list('/wht'),
  whtOne: (id: number) => req('GET', `/wht/${id}`) as Promise<Row>,
  createWht: (b: Row) => req('POST', '/wht', b),
  updateWht: (id: number, b: Row) => req('PUT', `/wht/${id}`, b),
  deleteWht: (id: number) => req('DELETE', `/wht/${id}`),

  settings: () => req('GET', '/settings') as Promise<Row>,
  updateSettings: (b: Row) => req('PUT', '/settings', b),

  pipeline: () => req('GET', '/pipeline') as Promise<Row>,

  ocr: async (file: File): Promise<Row> => {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch('/api/fin/ocr', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAuthToken() ?? ''}` },
      body: fd,
    })
    if (!r.ok) {
      let detail = r.statusText
      try { detail = (await r.json()).detail || detail } catch { /* ignore */ }
      throw new Error(detail)
    }
    return r.json()
  },

  // token in query so an <img>/<a> can load it without headers
  logoUrl: () => `/api/fin/logo?token=${encodeURIComponent(getAuthToken() ?? '')}`,
  pdfUrl: (kind: 'documents' | 'wht', id: number, extra = '') =>
    `/api/fin/${kind}/${id}/pdf?token=${encodeURIComponent(getAuthToken() ?? '')}${extra}`,
}

// ---- formatters (match FinanceHub's Jinja filters) ----
export const baht = (v: unknown, dp = 2): string => {
  const n = Number(v)
  if (!isFinite(n)) return '฿0.00'
  return '฿' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
export const num0 = (v: unknown): string => '฿' + Math.round(Number(v) || 0).toLocaleString('en-US')
export const ymd = (v: unknown): string => (v ? String(v).slice(0, 10) : '')

export const DOC_TYPES = [
  { key: 'quotation', label: 'Quotations', singular: 'Quotation', th: 'ใบเสนอราคา' },
  { key: 'invoice', label: 'Invoices', singular: 'Invoice', th: 'ใบแจ้งหนี้' },
  { key: 'tax_invoice', label: 'Tax Invoices', singular: 'Tax Invoice', th: 'ใบกำกับภาษี' },
]
export const DOC_STATUS = ['draft', 'sent', 'paid', 'cancelled']
export const PIPELINE_STAGES = ['negotiation', 'signed', 'in_progress', 'delivered', 'completed', 'cancelled']
export const PROJECT_STATUS = ['active', 'completed', 'on_hold', 'cancelled']
export const REIMBURSE_STATUS = ['pending', 'reimbursed', 'company_paid', 'owner_paid', 'not_required']
