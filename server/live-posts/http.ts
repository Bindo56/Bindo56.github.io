export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const summarize = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, 240)

/** GET/POST JSON with a timeout. Error messages never include the request URL, which may carry API keys. */
export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  const body = await response.text()
  if (!response.ok) throw new HttpError(response.status, `HTTP ${response.status}: ${summarize(body) || response.statusText}`)
  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error(`Expected JSON, got: ${summarize(body)}`)
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.name === 'TimeoutError' ? 'Request timed out' : error.message
  return String(error)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === '#') {
        const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
        return Number.isFinite(value) ? String.fromCodePoint(value) : entity
      }
      return ENTITIES[code.toLowerCase()] ?? entity
    })
    .trim()
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
