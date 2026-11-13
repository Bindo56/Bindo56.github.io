import type { ServerResponse } from 'node:http'
import { loadEnv, type Connect, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import { readConfig } from './config'
import { BadRequest, LivePostsService, parsePostQuery } from './service'

const ROUTE = '/api/live-posts'

// Vite re-imports this module when the config changes; keep one collector per process.
const shared = globalThis as typeof globalThis & { __livePostsService?: LivePostsService }

/**
 * Serves GET /api/live-posts from the Vite dev/preview server: social posts from the last hour
 * around a location, collected in the background. API keys are read from .env.local and never
 * reach the browser bundle.
 */
export function livePostsApi(): Plugin {
  let env: Record<string, string> = {}
  let root = process.cwd()

  const attach = (server: ViteDevServer | PreviewServer) => {
    const config = readConfig(env, root)
    if (!config.enabled) return
    shared.__livePostsService?.stop()
    const service = new LivePostsService(config, (message) =>
      server.config.logger.info(`[live-posts] ${message}`, { timestamp: true }),
    )
    shared.__livePostsService = service
    service.start()
    server.httpServer?.once('close', () => {
      service.stop()
      if (shared.__livePostsService === service) shared.__livePostsService = undefined
    })
    server.middlewares.use(handler(service, config))
  }

  return {
    name: 'live-posts-api',
    configResolved(config) {
      root = config.root
      env = loadEnv(config.mode, typeof config.envDir === 'string' ? config.envDir : config.root, '')
    },
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

function handler(service: LivePostsService, config: ReturnType<typeof readConfig>): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== ROUTE && url.pathname !== `${ROUTE}/status`) return next()
    if (req.method !== 'GET') return send(res, 405, { error: 'Use GET' })
    if (url.pathname.endsWith('/status')) return send(res, 200, service.status())

    let query
    try {
      query = parsePostQuery(url.searchParams, config)
    } catch (error) {
      return send(res, 400, { error: (error as Error).message })
    }
    service.query(query).then(
      (result) => send(res, 200, result),
      (error: unknown) => send(res, error instanceof BadRequest ? 400 : 500, { error: String(error) }),
    )
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}
