import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { CpRecord } from '@/types'
import * as api from '@/lib/restClient'

interface CpCtx {
  clients: CpRecord[]
  projects: CpRecord[]
  servers: string[] // names of managed services from the Servers app
  refreshRelations: () => void
}

const Ctx = createContext<CpCtx>({
  clients: [],
  projects: [],
  servers: [],
  refreshRelations: () => {},
})

export const useCp = () => useContext(Ctx)

/** Loads the cross-section lookups (clients, projects, server names) once and
 *  lets any section refresh them after a create/edit. */
export function CpProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<CpRecord[]>([])
  const [projects, setProjects] = useState<CpRecord[]>([])
  const [servers, setServers] = useState<string[]>([])

  const refreshRelations = useCallback(() => {
    api.cpList('clients').then((r) => setClients(r.items)).catch(() => {})
    api.cpList('projects').then((r) => setProjects(r.items)).catch(() => {})
    api
      .getServers()
      .then((r) => setServers(r.services.map((s) => s.name)))
      .catch(() => {})
  }, [])

  useEffect(() => refreshRelations(), [refreshRelations])

  return (
    <Ctx.Provider value={{ clients, projects, servers, refreshRelations }}>{children}</Ctx.Provider>
  )
}
