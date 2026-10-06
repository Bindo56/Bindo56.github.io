import type { PlanetModule } from '../app/PlanetContracts.ts'

/**
 * Chromium may remember a failed dynamic import for the lifetime of a page.
 * On a later Retry, fetch the same Vite chunk with a new URL so the visitor
 * can recover after a transient network error without refreshing the shell.
 */
export function retryableLoad(load: () => Promise<{ default: PlanetModule }>): () => Promise<PlanetModule> {
  let failedChunk: string | null = null
  let cachedModule: PlanetModule | null = null
  let attempt = 0
  return async () => {
    if (cachedModule) return cachedModule
    if (failedChunk) {
      const separator = failedChunk.includes('?') ? '&' : '?'
      const url = failedChunk + separator + 'retry=' + ++attempt
      const module = await import(/* @vite-ignore */ url) as { default: PlanetModule }
      cachedModule = module.default
      return cachedModule
    }
    try {
      const module = await load()
      cachedModule = module.default
      return cachedModule
    } catch (error) {
      failedChunk = failedModuleUrl(error)
      throw error
    }
  }
}

function failedModuleUrl(error: unknown): string | null {
  if (!(error instanceof Error) || !/fetch dynamically imported module/i.test(error.message)) return null
  const match = /https?:\/\/[^\s)]+\.js(?:\?[^\s)]*)?/.exec(error.message)
  if (!match) return null
  const url = new URL(match[0])
  if (url.origin !== window.location.origin || !url.pathname.includes('/assets/')) return null
  return url.href
}
