import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { createWeekService } from './week-service.mjs'

/** Bounded, read-only API for inspecting the 100,000-person cohort in local development. */
export function npcWeekApi(): Plugin {
  const service = createWeekService()
  return {
    name: 'npc-week-api',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('close', () => service.close())
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/npc-week/')) return next()
        if (req.method !== 'GET') return send(res, 405, { error: 'Use GET' })
        try {
          const path = url.pathname.slice('/api/npc-week/'.length)
          if (path === 'summary') return send(res, 200, service.summary())
          if (path === 'places') {
            const limit = Number(url.searchParams.get('limit') ?? 100)
            return send(res, 200, service.places({ kind: url.searchParams.get('kind') ?? '',
              after: url.searchParams.get('after') ?? '', limit }))
          }
          const match = /^npc\/(\d+)(?:\/(week|relationships))?$/.exec(path)
          if (!match) return send(res, 404, { error: 'Unknown NPC endpoint' })
          const id = Number(match[1])
          const result = match[2] === 'week' ? service.week(id, url.searchParams.get('start') ?? undefined)
            : match[2] === 'relationships' ? service.relationships(id) : service.person(id)
          return send(res, result === null ? 404 : 200, result ?? { error: 'NPC is not in the cohort' })
        } catch (error) {
          const status = error instanceof RangeError || error instanceof TypeError ? 400 : 500
          return send(res, status, { error: error instanceof Error ? error.message : String(error) })
        }
      })
    },
  }
}

function send(res: ServerResponse<IncomingMessage>, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}
