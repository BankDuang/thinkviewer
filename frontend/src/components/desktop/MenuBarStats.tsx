import { useEffect, useRef, useState } from 'react'
import type { SystemStats } from '@/types'
import * as api from '@/lib/restClient'
import { useConnectionStore } from '@/store/connectionStore'
import { useDesktopStore } from '@/store/desktopStore'

const POLL_MS = 2500

function gib(bytes: number | null): number {
  return bytes ? bytes / 1073741824 : 0
}

// CPU: green → amber → red by load %
function tone(p: number | null): string {
  if (p == null) return '#8a8a96'
  if (p >= 85) return '#ff453a'
  if (p >= 60) return '#ff9f0a'
  return '#34c759'
}

// RAM: colored by absolute GB used — ≤10 GB green, 10–14 GB amber, ≥14 GB red
function ramTone(usedGib: number): string {
  if (usedGib >= 14) return '#ff453a'
  if (usedGib > 10) return '#ff9f0a'
  return '#34c759'
}

// bytes/sec -> compact human rate (B/s, KB/s, MB/s)
function rate(bps: number | null): string {
  if (bps == null) return '—'
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(bps < 10 * 1024 ? 1 : 0)} KB/s`
  return `${(bps / 1048576).toFixed(1)} MB/s`
}

function Gauge({ label, percent, value, color }: { label: string; percent: number; value: string; color: string }) {
  return (
    <div className="mb-gauge" title={`${label}: ${value}`}>
      <span className="mb-gauge-label">{label}</span>
      <span className="mb-gauge-track">
        <span
          className="mb-gauge-fill"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: color }}
        />
      </span>
      <span className="mb-gauge-val">{value}</span>
    </div>
  )
}

export function MenuBarStats() {
  const status = useConnectionStore((s) => s.status)
  const showStats = useDesktopStore((s) => s.showMenuStats)
  const showNet = useDesktopStore((s) => s.showMenuNet)
  const show = showStats || showNet
  const [stats, setStats] = useState<SystemStats | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    if (!show) return // don't poll while the indicator is hidden
    mounted.current = true
    const tick = () => {
      api
        .getStats()
        .then((s) => mounted.current && setStats(s))
        .catch(() => {})
    }
    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => {
      mounted.current = false
      window.clearInterval(id)
    }
  }, [show])

  if (!show || status !== 'open' || !stats) return null
  const cpu = stats.cpu ?? 0
  // bar must reflect the SAME used/total we display in GB (psutil's mem_percent
  // counts reclaimable/wired memory on macOS, so it diverged from "X/Y GB").
  const usedGib = gib(stats.mem_used)
  const totalGib = gib(stats.mem_total)
  const memPct = totalGib > 0 ? (usedGib / totalGib) * 100 : 0
  return (
    <div className="mb-stats">
      {showStats && (
        <>
          <Gauge label="CPU" percent={cpu} value={`${Math.round(cpu)}%`} color={tone(stats.cpu)} />
          <Gauge
            label="RAM"
            percent={memPct}
            value={`${usedGib.toFixed(1)}/${Math.round(totalGib)} GB`}
            color={ramTone(usedGib)}
          />
        </>
      )}
      {showNet && (
        <div className="mb-net" title={`Network — down ${rate(stats.net_down)} / up ${rate(stats.net_up)}`}>
          <span className="mb-net-item">
            <span className="mb-net-arrow down">↓</span>
            {rate(stats.net_down)}
          </span>
          <span className="mb-net-item">
            <span className="mb-net-arrow up">↑</span>
            {rate(stats.net_up)}
          </span>
        </div>
      )}
    </div>
  )
}
