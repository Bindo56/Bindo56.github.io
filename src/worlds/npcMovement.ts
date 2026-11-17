import type { NpcEpisode } from '../../server/population/weekly-core.mjs'

export type NpcPlacePoint = { id: string; anchor_id: string; label: string; x: number; z: number }
export type NpcMovement = {
  from: NpcPlacePoint
  to: NpcPlacePoint
  startMinute: number
  endMinute: number
  progress: number
  observedAtMs: number
}

/** Derive a travel leg from a plan without changing the stored weekly schedule. */
export function movementFor(
  episodes: NpcEpisode[], index: number, minute: number, observedAtMs: number,
  getPlace: (id: string) => NpcPlacePoint | undefined,
): NpcMovement | null {
  const current = episodes[index]
  const previous = episodes[index - 1]
  if (!current || !previous || current.placeId === previous.placeId) return null
  const from = getPlace(previous.placeId)
  const to = getPlace(current.placeId)
  if (!from || !to || Math.hypot(from.x - to.x, from.z - to.z) < 1) return null
  const explicitCommute = current.activity.startsWith('commute_')
  const startMinute = current.startMinute
  const endMinute = explicitCommute
    ? current.endMinute
    : Math.min(current.endMinute, startMinute + Math.min(15, Math.max(3, (current.endMinute - startMinute) / 4)))
  if (minute < startMinute || minute >= endMinute || endMinute <= startMinute) return null
  return { from, to, startMinute, endMinute,
    progress: Math.max(0, Math.min(1, (minute - startMinute) / (endMinute - startMinute))),
    observedAtMs }
}
