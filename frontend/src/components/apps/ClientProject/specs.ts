// Field-spec config that drives the generic CRM table + form. Each entity
// declares its list columns and its form fields; CpTable / CpForm / CrudSection
// render everything from this, so a section is just <CrudSection spec={...} />.

export type CpFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'tags'
  | 'relation'
  | 'server'

export interface CpField {
  key: string
  label: string
  type?: CpFieldType // default 'text'
  options?: string[]
  relation?: 'clients' | 'projects'
  full?: boolean // span the full form width
  placeholder?: string
}

export type CpColType = 'text' | 'badge' | 'money' | 'date' | 'relation' | 'server' | 'bool'

export interface CpColumn {
  key: string
  label: string
  type?: CpColType
  relation?: 'clients' | 'projects'
}

export interface CpSpec {
  entity: string
  title: string // plural section title
  singular: string // for "New <singular>"
  icon: string
  titleField: string // record's display label
  columns: CpColumn[]
  fields: CpField[]
  defaults?: Record<string, unknown>
}

export const CLIENT_STATUS = ['lead', 'active', 'inactive', 'done']
export const PROJECT_STATUS = ['planning', 'active', 'on_hold', 'delivered', 'maintenance', 'cancelled']
export const PHASE_NAMES = ['Requirement', 'UX/UI', 'Development', 'Test', 'UAT', 'Deploy', 'Maintenance']
export const PHASE_STATUS = ['not_started', 'in_progress', 'blocked', 'waiting_client', 'done']
export const TASK_STATUS = ['todo', 'doing', 'blocked', 'done']
export const PRIORITY = ['low', 'medium', 'high', 'urgent']
export const ISSUE_SEVERITY = ['low', 'medium', 'high', 'critical']
export const ISSUE_STATUS = ['open', 'in_progress', 'fixed', 'verified', 'closed']
export const CR_STATUS = ['requested', 'approved', 'rejected', 'done']
export const REQ_STATUS = ['proposed', 'approved', 'in_progress', 'done']

export const CP_SPECS: Record<string, CpSpec> = {
  clients: {
    entity: 'clients',
    title: 'Clients',
    singular: 'Client',
    icon: 'users',
    titleField: 'name',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'company', label: 'Company' },
      { key: 'contact_name', label: 'Contact' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'value', label: 'Value', type: 'money' },
    ],
    fields: [
      { key: 'name', label: 'Client name' },
      { key: 'company', label: 'Company' },
      { key: 'status', label: 'Status', type: 'select', options: CLIENT_STATUS },
      { key: 'value', label: 'Total value', type: 'money' },
      { key: 'contact_name', label: 'Contact person' },
      { key: 'contact_email', label: 'Email' },
      { key: 'contact_phone', label: 'Phone' },
      { key: 'channels', label: 'Channels', type: 'tags', placeholder: 'email, line, phone…' },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
    defaults: { status: 'lead' },
  },
  projects: {
    entity: 'projects',
    title: 'Projects',
    singular: 'Project',
    icon: 'briefcase',
    titleField: 'name',
    columns: [
      { key: 'name', label: 'Project' },
      { key: 'client_id', label: 'Client', type: 'relation', relation: 'clients' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'budget', label: 'Budget', type: 'money' },
      { key: 'deliver_date', label: 'Deliver', type: 'date' },
      { key: 'server_service', label: 'Server' },
    ],
    fields: [
      { key: 'name', label: 'Project name' },
      { key: 'client_id', label: 'Client', type: 'relation', relation: 'clients' },
      { key: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS },
      { key: 'owner', label: 'Owner / PM' },
      { key: 'budget', label: 'Budget', type: 'money' },
      { key: 'start_date', label: 'Start date', type: 'date' },
      { key: 'deliver_date', label: 'Deliver date', type: 'date' },
      { key: 'server_service', label: 'Linked server (Servers app)', type: 'server' },
      { key: 'domain', label: 'Domain' },
      { key: 'server', label: 'Server / host' },
      { key: 'repository', label: 'Repository' },
      { key: 'tech_stack', label: 'Tech stack' },
      { key: 'scope', label: 'Scope', type: 'textarea', full: true },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
    defaults: { status: 'planning' },
  },
  phases: {
    entity: 'phases',
    title: 'Phases / Milestones',
    singular: 'Phase',
    icon: 'list',
    titleField: 'name',
    columns: [
      { key: 'name', label: 'Phase' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'owner', label: 'Owner' },
      { key: 'waiting_client', label: 'Waiting client' },
    ],
    fields: [
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'name', label: 'Phase', type: 'select', options: PHASE_NAMES },
      { key: 'status', label: 'Status', type: 'select', options: PHASE_STATUS },
      { key: 'owner', label: 'Owner' },
      { key: 'order_idx', label: 'Order', type: 'number' },
      { key: 'pending', label: 'Pending work', type: 'textarea', full: true },
      { key: 'waiting_client', label: 'Waiting for client', type: 'textarea', full: true },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
    defaults: { status: 'not_started' },
  },
  tasks: {
    entity: 'tasks',
    title: 'Tasks',
    singular: 'Task',
    icon: 'check',
    titleField: 'title',
    columns: [
      { key: 'title', label: 'Task' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'assignee', label: 'Assignee' },
      { key: 'priority', label: 'Priority', type: 'badge' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'due_date', label: 'Due', type: 'date' },
    ],
    fields: [
      { key: 'title', label: 'Task' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'status', label: 'Status', type: 'select', options: TASK_STATUS },
      { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY },
      { key: 'assignee', label: 'Assignee' },
      { key: 'due_date', label: 'Due date', type: 'date' },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
    ],
    defaults: { status: 'todo', priority: 'medium' },
  },
  issues: {
    entity: 'issues',
    title: 'Issues / Bugs',
    singular: 'Issue',
    icon: 'bug',
    titleField: 'title',
    columns: [
      { key: 'title', label: 'Issue' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'severity', label: 'Severity', type: 'badge' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'assignee', label: 'Owner' },
      { key: 'client_confirmed', label: 'Confirmed', type: 'bool' },
    ],
    fields: [
      { key: 'title', label: 'Issue title' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'severity', label: 'Severity', type: 'select', options: ISSUE_SEVERITY },
      { key: 'status', label: 'Status', type: 'select', options: ISSUE_STATUS },
      { key: 'assignee', label: 'Assignee' },
      { key: 'fixed_date', label: 'Fixed date', type: 'date' },
      { key: 'client_confirmed', label: 'Client confirmed', type: 'checkbox' },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
      { key: 'resolution', label: 'Resolution', type: 'textarea', full: true },
    ],
    defaults: { severity: 'medium', status: 'open' },
  },
  change_requests: {
    entity: 'change_requests',
    title: 'Change Requests',
    singular: 'Change Request',
    icon: 'git-branch',
    titleField: 'title',
    columns: [
      { key: 'title', label: 'Change request' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'man_days', label: 'Man-days' },
      { key: 'impact_budget', label: 'Budget impact', type: 'money' },
    ],
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'status', label: 'Status', type: 'select', options: CR_STATUS },
      { key: 'man_days', label: 'Man-days', type: 'number' },
      { key: 'impact_budget', label: 'Budget impact', type: 'money' },
      { key: 'impact_timeline', label: 'Timeline impact' },
      { key: 'impact_scope', label: 'Scope impact' },
      { key: 'approved_by', label: 'Approved by' },
      { key: 'approved_date', label: 'Approved date', type: 'date' },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
    ],
    defaults: { status: 'requested' },
  },
  meeting_notes: {
    entity: 'meeting_notes',
    title: 'Meeting Notes',
    singular: 'Meeting Note',
    icon: 'clipboard',
    titleField: 'title',
    columns: [
      { key: 'title', label: 'Meeting' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'attendees', label: 'Attendees' },
    ],
    fields: [
      { key: 'title', label: 'Title' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'client_id', label: 'Client', type: 'relation', relation: 'clients' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'attendees', label: 'Attendees' },
      { key: 'summary', label: 'Summary', type: 'textarea', full: true },
      { key: 'decisions', label: 'Decisions', type: 'textarea', full: true },
      { key: 'waiting_client', label: 'Waiting for client', type: 'textarea', full: true },
    ],
  },
  requirements: {
    entity: 'requirements',
    title: 'Requirements / Scope',
    singular: 'Requirement',
    icon: 'list',
    titleField: 'feature',
    columns: [
      { key: 'feature', label: 'Feature' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'priority', label: 'Priority', type: 'badge' },
      { key: 'status', label: 'Status', type: 'badge' },
      { key: 'in_scope', label: 'In scope', type: 'bool' },
    ],
    fields: [
      { key: 'feature', label: 'Feature' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY },
      { key: 'status', label: 'Status', type: 'select', options: REQ_STATUS },
      { key: 'in_scope', label: 'In scope (vs change request)', type: 'checkbox' },
      { key: 'wireframe', label: 'Wireframe link' },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
      { key: 'conditions', label: 'Acceptance conditions', type: 'textarea', full: true },
    ],
    defaults: { priority: 'medium', status: 'proposed', in_scope: '1' },
  },
  payments: {
    entity: 'payments',
    title: 'Payments / Invoices',
    singular: 'Payment',
    icon: 'money',
    titleField: 'title',
    columns: [
      { key: 'title', label: 'Item' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'invoice_no', label: 'Invoice #' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'due_date', label: 'Due', type: 'date' },
      { key: 'paid', label: 'Paid', type: 'bool' },
    ],
    fields: [
      { key: 'title', label: 'Item / milestone' },
      { key: 'project_id', label: 'Project', type: 'relation', relation: 'projects' },
      { key: 'client_id', label: 'Client', type: 'relation', relation: 'clients' },
      { key: 'invoice_no', label: 'Invoice #' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'installment', label: 'Installment' },
      { key: 'due_date', label: 'Due date', type: 'date' },
      { key: 'paid', label: 'Paid', type: 'checkbox' },
      { key: 'paid_date', label: 'Paid date', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
    defaults: { paid: '0' },
  },
}
