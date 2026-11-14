export interface WeekService {
  summary(): unknown
  places(options: { kind: string; after?: string; limit?: number }): unknown
  person(npcId: number, worldTimeMs?: number): unknown
  week(npcId: number, weekStart?: string): unknown
  relationships(npcId: number): unknown
  close(): void
}
export declare function createWeekService(options?: { databasePath?: string; now?: () => number }): WeekService
