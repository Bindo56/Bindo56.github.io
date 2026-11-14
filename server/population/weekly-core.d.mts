export interface NpcMember {
  npc_id: number
  display_name: string
  household_id: number
  role: 'worker' | 'student' | 'other'
  appearance_seed: number
  shift_pattern: string
  chronotype: 'early' | 'day' | 'late'
  commute_minute: number
  plan_seed: number
  home_place_id: string
  work_place_id: string | null
  cafe_place_id: string
  errand_place_id: string
  leisure_place_id: string
  [key: string]: unknown
}

export interface NpcMeeting {
  id: string
  week_start: string
  npc_a_id: number
  npc_b_id: number
  viewer_id: number
  place_id: string
  weekday: number
  start_minute: number
  duration_minute: number
  status: string
}

export interface NpcEpisode {
  startMinute: number
  endMinute: number
  activity: string
  placeId: string
  reason: string
  meetingId?: string
  withNpcId?: number
}

export interface NpcDay { localDate: string; weekday: number; episodes: NpcEpisode[] }
export interface NpcWeek {
  npcId: number
  name: string
  weekStart: string
  timezone: string
  materialized: boolean
  profile: NpcMember
  days: NpcDay[]
}

export const ZONE: string
export function mix(seed: number, id: number, salt?: number): number
export function dateAt(localDate: string, days: number): string
export function mondayOf(localDate: string): string
export function planSeedForWeek(planSeed: number, weekStart: string): number
export function newYorkLocalTime(worldTimeMs: number): { localDate: string; weekStart: string; minute: number }
export function workWindow(member: NpcMember, weekday: number): { start: number; end: number } | null
export function fillDay(member: NpcMember, weekday: number): NpcEpisode[]
export function overlayMeeting(day: NpcEpisode[], meeting: NpcMeeting): NpcEpisode[]
export function canMeet(member: NpcMember, weekday: number, start: number, duration: number): boolean
export function generateWeek(member: NpcMember, meetings: NpcMeeting[], weekStart: string,
  materialized?: boolean, planSeed?: number | null): NpcWeek
