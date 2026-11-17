import type { NpcWeek } from '../../server/population/weekly-core.mjs'
import type { NpcMovement } from './npcMovement'

export type PopulationRequest =
  | { type: 'init'; baseUrl: string; x: number; z: number }
  | { type: 'nearby'; requestId: number; x: number; z: number; radius: number; limit: number; timeMs: number; followId?: number }
  | { type: 'inspect'; requestId: number; npcId: number; timeMs: number }

export type NearbyNpc = {
  npcId: number
  name: string
  role: string
  appearanceSeed: number
  activity: string
  placeId: string
  placeLabel: string
  placeKind: string
  x: number
  z: number
  distance: number
  movement: NpcMovement | null
}

export type InspectedNpc = {
  npcId: number
  name: string
  role: string
  localDate: string
  current: NpcWeek['days'][number]['episodes'][number]
  next: NpcWeek['days'][number]['episodes'][number]
  currentPlace: string
  movement: NpcMovement | null
  assignments: { home: string; work: string | null; cafe: string; errand: string; leisure: string }
  week: NpcWeek
}

export type PopulationResponse =
  | { type: 'progress'; loaded: number; total: number; shardsLoaded: number; shardsTotal: number; cached: boolean }
  | { type: 'ready'; loaded: number; total: number; cached: boolean }
  | { type: 'complete'; loaded: number; total: number; relationships: number; cached: boolean }
  | { type: 'error'; message: string; initial: boolean }
  | { type: 'nearby'; requestId: number; people: NearbyNpc[] }
  | { type: 'inspect'; requestId: number; result: InspectedNpc | null; error?: string }
