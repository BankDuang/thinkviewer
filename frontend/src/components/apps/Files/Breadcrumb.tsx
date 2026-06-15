import { Fragment, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { Icon } from '@/components/common/Icon'

interface BreadcrumbProps {
  path: string
  onNavigate: (p: string) => void
}

/** Clickable path segments derived from the resolved current path. */
export function Breadcrumb({ path, onNavigate }: BreadcrumbProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Keep the deepest (current) segment in view.
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [path])

  if (!path) return <div className="fm-breadcrumb" ref={ref} />

  const isAbsolute = path.startsWith('/')
  const parts = path.split('/').filter(Boolean)
  const crumbs = parts.map((name, i) => ({
    name,
    full: (isAbsolute ? '/' : '') + parts.slice(0, i + 1).join('/'),
  }))

  return (
    <div className="fm-breadcrumb" ref={ref}>
      <button
        className="fm-crumb fm-crumb--root"
        onClick={() => onNavigate('/')}
        title="Root"
        aria-label="Root"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="6" width="18" height="12" rx="2.5" />
          <circle cx="16.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {crumbs.map((c, i) => {
        const current = i === crumbs.length - 1
        return (
          <Fragment key={c.full}>
            <span className="fm-crumb-sep" aria-hidden="true">
              <Icon name="chevron-right" size={12} strokeWidth={2} />
            </span>
            <button
              className={clsx('fm-crumb', current && 'is-current')}
              onClick={() => !current && onNavigate(c.full)}
              disabled={current}
              title={c.full}
            >
              {c.name}
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}
