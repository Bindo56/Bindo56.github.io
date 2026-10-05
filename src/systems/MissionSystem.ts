export interface Mission {
  id: string
  title: string
  /** How many distinct things must be recorded to complete it. */
  target: number
  /** The name of the system completing this mission unlocks. */
  unlocks: string
}

export interface MissionProgress extends Mission {
  current: number
  complete: boolean
}

type Listener<T> = (value: T) => void

/** Tracks mission progress and announces changes and completions. */
export class MissionSystem {
  private readonly missions = new Map<string, MissionProgress>()
  private readonly recorded = new Map<string, Set<string>>()
  private readonly changeListeners = new Set<Listener<readonly MissionProgress[]>>()
  private readonly completeListeners = new Set<Listener<MissionProgress>>()

  get all(): readonly MissionProgress[] {
    return [...this.missions.values()]
  }

  /** Returns a function that removes the listener. */
  onChange(listener: Listener<readonly MissionProgress[]>): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  /** Returns a function that removes the listener. */
  onComplete(listener: Listener<MissionProgress>): () => void {
    this.completeListeners.add(listener)
    return () => this.completeListeners.delete(listener)
  }

  add(mission: Mission): void {
    if (this.missions.has(mission.id)) throw new Error(`Mission '${mission.id}' is already registered.`)

    this.missions.set(mission.id, { ...mission, current: 0, complete: mission.target <= 0 })
    this.recorded.set(mission.id, new Set())
    this.emitChange()
  }

  isComplete(missionId: string): boolean {
    return this.missions.get(missionId)?.complete ?? false
  }

  /**
   * Records progress. Each key counts once per mission, so inspecting the same project twice does
   * not advance it twice.
   */
  record(missionId: string, key: string): void {
    const mission = this.missions.get(missionId)
    const keys = this.recorded.get(missionId)

    if (!mission || !keys) {
      console.warn(`[MissionSystem] No mission '${missionId}' - progress for '${key}' was dropped.`)
      return
    }

    if (mission.complete || keys.has(key)) return

    keys.add(key)
    mission.current = keys.size
    mission.complete = mission.current >= mission.target
    this.emitChange()

    if (mission.complete) {
      for (const listener of this.completeListeners) listener(mission)
    }
  }

  dispose(): void {
    this.changeListeners.clear()
    this.completeListeners.clear()
  }

  private emitChange(): void {
    const snapshot = this.all
    for (const listener of this.changeListeners) listener(snapshot)
  }
}
