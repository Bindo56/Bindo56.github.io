import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { createProofService, ProofError } from './proof-service.mjs'

// Local development endpoint: the SQLite file stays on the server. The browser
// receives only one worker and the few customer identities in this proof scene.
export function npcProofApi(): Plugin {
  const proof = createProofService()
  return {
    name: 'npc-proof-api',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('close', () => proof.close())
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
        if (pathname !== '/api/npc-proof/state' && pathname !== '/api/npc-proof/control') return next()
        route(req, pathname).then(
          (body) => sendJson(res, 200, body),
          (error: unknown) => {
            const status = error instanceof ProofError ? error.status
              : error instanceof SyntaxError ? 400
                : error instanceof Error && /Database does not exist|Seed a mapped worker|requires map building anchor/.test(error.message) ? 503
                  : 500
            sendJson(res, status, { error: error instanceof Error ? error.message : String(error) })
          },
        )
      })
    },
  }

  async function route(req: IncomingMessage, pathname: string) {
    if (pathname === '/api/npc-proof/state') {
      if (req.method !== 'GET') throw new ProofError(405, 'Use GET for the proof state')
      return proof.state()
    }
    if (req.method !== 'POST') throw new ProofError(405, 'Use POST for proof controls')
    let command: unknown
    try { command = JSON.parse(await readBody(req)) }
    catch (error) { if (error instanceof ProofError) throw error; throw new ProofError(400, 'Send a JSON control object') }
    return proof.control(command)
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let tooLarge = false
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      if (tooLarge) return
      body += chunk
      if (body.length > 8192) {
        tooLarge = true
        reject(new ProofError(413, 'Control body is too large'))
      }
    })
    req.on('end', () => { if (!tooLarge) resolve(body) })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}
