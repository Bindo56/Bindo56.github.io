import type { Keyword } from './types'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word, case-insensitive pattern source for a keyword ("NYC" also matches "#nyc"). */
function patternSource(keyword: Keyword) {
  const body = typeof keyword === 'string' ? escapeRegExp(keyword.trim()).replace(/\s+/g, '\\s+') : keyword.source
  return `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])`
}

export const keywordLabel = (keyword: Keyword) => (typeof keyword === 'string' ? keyword : keyword.source)

/** One combined regex for fast "does this post mention any watched term" checks. */
export function compileAny(keywords: Keyword[]): RegExp | null {
  const sources = [...new Set(keywords.filter((keyword) => keywordLabel(keyword).trim()).map(patternSource))]
  return sources.length ? new RegExp(sources.join('|'), 'iu') : null
}

export type TermMatcher = (text: string) => string[]

/** Returns the labels of every keyword found in the text. */
export function compileTerms(keywords: Keyword[]): TermMatcher {
  const terms = keywords
    .filter((keyword) => keywordLabel(keyword).trim())
    .map((keyword) => ({ label: keywordLabel(keyword), pattern: new RegExp(patternSource(keyword), 'iu') }))
  return (text) => terms.filter((term) => term.pattern.test(text)).map((term) => term.label)
}

/** Splits a `q` query value ("Empire State Building, ESB") into keywords. */
export function parseKeywords(value: string | null | undefined): string[] {
  if (!value) return []
  return [...new Set(value.split(',').map((term) => term.trim()).filter((term) => term.length >= 2))].slice(0, 20)
}
