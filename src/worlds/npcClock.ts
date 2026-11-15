const NEW_YORK = 'America/New_York'

type WallTime = {
  year: number; month: number; day: number
  hour: number; minute: number; second: number; millisecond: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()
const nyOffsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NEW_YORK, timeZoneName: 'shortOffset',
})
const offsetCache = new Map<string, number[]>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

function wallTimeAt(epoch: number, timeZone: string): WallTime {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(epoch)
    .map(({ type, value }) => [type, value]))
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    millisecond: ((epoch % 1000) + 1000) % 1000,
  }
}

function deviceWallTimeAt(epoch: number): WallTime {
  const date = new Date(epoch)
  return {
    year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
    hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(),
    millisecond: date.getMilliseconds(),
  }
}

function wallValue(wall: WallTime): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour,
    wall.minute, wall.second, wall.millisecond)
}

function newYorkOffsetMinutes(epoch: number): number {
  const value = nyOffsetFormatter.formatToParts(epoch)
    .find(({ type }) => type === 'timeZoneName')?.value
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(value ?? '')
  if (!match) throw new RangeError(`Cannot read New York time offset: ${value}`)
  return (match[1] === '+' ? 1 : -1) *
    (Number(match[2]) * 60 + Number(match[3] ?? 0))
}

function offsetsForDate(wall: WallTime): number[] {
  const key = `${wall.year}-${wall.month}-${wall.day}`
  const cached = offsetCache.get(key)
  if (cached) return cached
  const noon = Date.UTC(wall.year, wall.month - 1, wall.day, 12)
  // Check both sides of the local date so a DST transition contributes both offsets.
  const offsets = [...new Set([-24, -12, 0, 12, 24]
    .map((hours) => newYorkOffsetMinutes(noon + hours * 3600000)))]
  offsetCache.set(key, offsets)
  if (offsetCache.size > 16) offsetCache.delete(offsetCache.keys().next().value!)
  return offsets
}

/**
 * Run New York NPC schedules at the viewer's wall-clock date and time.
 * On fall's repeated hour, choose its first New York occurrence. On spring's
 * missing hour, advance to the corresponding time after the gap (2:30 → 3:30).
 */
export function localClockAsNewYorkEpoch(epoch: number, localTimeZone?: string): number {
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new RangeError('epoch must be a nonnegative safe integer')
  const wall = localTimeZone ? wallTimeAt(epoch, localTimeZone) : deviceWallTimeAt(epoch)
  const target = wallValue(wall)
  const candidates = offsetsForDate(wall).map((offset) => target - offset * 60000)
  const evaluated = candidates.map((candidate) => ({
    candidate, actual: wallValue(wallTimeAt(candidate, NEW_YORK)),
  }))
  const exact = evaluated.filter(({ actual }) => actual === target)
  if (exact.length) return Math.min(...exact.map(({ candidate }) => candidate))
  const after = evaluated.filter(({ actual }) => actual > target)
    .sort((a, b) => a.actual - b.actual || a.candidate - b.candidate)
  if (after.length) return after[0].candidate
  throw new RangeError('Could not map local time to New York schedule time')
}
