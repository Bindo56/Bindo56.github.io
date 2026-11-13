/**
 * The swarm wave mode, as data: weapons, enemies, and the ten waves. The simulation (WaveSystem) reads
 * nothing else, so a server can run these same tables later and only positions and events need to travel.
 *
 * Balance rule: a wave's `intensity` multiplies weapon damage, enemy health AND enemy damage alike. So an
 * enemy always takes the same number of hits from a given weapon, whatever the wave - waves get harder
 * through how many enemies come, which kinds, and how hard they hit, never through bullet sponges.
 *
 * Direct hits to kill, the same on every wave (splash does less toward its edge):
 *            Pistol  Bomb  Rocket
 *   Crawler     2      1      1
 *   Drone       3      1      1
 *   Spitter     4      2      1
 *   Brute      12      5      4
 */

export type WeaponId = 'pistol' | 'bomb' | 'rocket'
export type EnemyId = 'crawler' | 'drone' | 'spitter' | 'brute'

export interface Weapon {
  name: string
  /** Shots per second. */
  rate: number
  /** Damage per hit at intensity 1. */
  damage: number
  /** How far it looks for a target to aim at, in metres. With none in range it fires straight ahead. */
  range: number
  /** Projectile speed, metres per second. Ignored for lobbed weapons. */
  speed: number
  /** 0 hits one enemy; above 0, everything within this many metres of where it bursts - less at the edge. */
  splash: number
  /** Lobbed over enemies' heads onto the target spot, taking this many seconds. */
  lob?: number
  color: number
}

export const WEAPONS: Record<WeaponId, Weapon> = {
  pistol: { name: 'Pistol', rate: 4, damage: 25, range: 16, speed: 32, splash: 0, color: 0xffe066 },
  bomb: { name: 'Bomb', rate: 1.2, damage: 60, range: 11, speed: 0, splash: 3.5, lob: 0.7, color: 0xff7a2f },
  rocket: { name: 'Rocket Launcher', rate: 0.8, damage: 90, range: 22, speed: 17, splash: 2.5, color: 0xff4d5e },
}

export interface Enemy {
  name: string
  /** Health at intensity 1. */
  health: number
  /** Metres per second. The player walks at 6, so everything can be outrun. */
  speed: number
  /** Body radius in metres, for hits and crowding. */
  radius: number
  /** Damage per attack at intensity 1, and seconds between attacks. */
  damage: number
  cooldown: number
  /** Ranged enemies hang back at about this distance and shoot, instead of closing to touch. */
  shot?: { range: number; speed: number }
  color: number
}

export const ENEMIES: Record<EnemyId, Enemy> = {
  // Small, fast, fragile: the swarm itself.
  crawler: { name: 'Crawler', health: 30, speed: 4.2, radius: 0.35, damage: 6, cooldown: 0.6, color: 0xff4d8d },
  // The world's sentinel, off its patrol.
  drone: { name: 'Drone', health: 60, speed: 3, radius: 0.45, damage: 8, cooldown: 0.8, color: 0x4f8cff },
  // Keeps its distance and spits - slow enough to sidestep, which is most of the skill in the late waves.
  spitter: { name: 'Spitter', health: 80, speed: 2.4, radius: 0.5, damage: 7, cooldown: 2.6, shot: { range: 9, speed: 7 }, color: 0xb8e04a },
  // Slow, huge, hits hard.
  brute: { name: 'Brute', health: 300, speed: 1.6, radius: 0.9, damage: 16, cooldown: 1.2, color: 0xa78bfa },
}

export interface Wave {
  /** The weapon the player fights this wave with. */
  weapon: WeaponId
  /** Multiplies weapon damage, enemy health and enemy damage. */
  intensity: number
  /** How many of each enemy, released in a shuffled order. */
  enemies: Partial<Record<EnemyId, number>>
}

// Weapons rotate so each suits its wave: the pistol for thin early waves and fast-picking, bombs for dense
// crawler packs, rockets for the waves that bring brutes.
export const WAVES: readonly Wave[] = [
  { weapon: 'pistol', intensity: 1.0, enemies: { crawler: 8 } },
  { weapon: 'pistol', intensity: 1.15, enemies: { crawler: 10, drone: 2 } },
  { weapon: 'bomb', intensity: 1.3, enemies: { crawler: 16, drone: 2 } },
  { weapon: 'bomb', intensity: 1.45, enemies: { crawler: 14, drone: 4, spitter: 2 } },
  { weapon: 'rocket', intensity: 1.6, enemies: { crawler: 10, drone: 4, spitter: 2, brute: 1 } },
  { weapon: 'pistol', intensity: 1.75, enemies: { crawler: 18, drone: 6, spitter: 3 } },
  { weapon: 'bomb', intensity: 1.9, enemies: { crawler: 24, drone: 4, spitter: 4, brute: 1 } },
  { weapon: 'rocket', intensity: 2.05, enemies: { crawler: 14, drone: 6, spitter: 4, brute: 3 } },
  { weapon: 'bomb', intensity: 2.2, enemies: { crawler: 30, drone: 8, spitter: 5, brute: 2 } },
  { weapon: 'rocket', intensity: 2.35, enemies: { crawler: 24, drone: 10, spitter: 6, brute: 4 } },
]

// Tuned against a simple bot that only runs from the nearest enemy and never dodges: across eight seeds it
// reaches waves 8 to 10, so a player who sidesteps the spit can finish.
export const WAVE_RULES = {
  playerHealth: 100,
  playerRadius: 0.4,
  /** Seconds between waves - and before the first - with the player healed to full. */
  breather: 4,
  /** Seconds between enemies arriving, and the most alive at once. */
  spawnInterval: 0.45,
  maxAlive: 30,
  /** Enemies arrive on this circle round the arena's centre, never nearer the player than `spawnClearance`. */
  arenaRadius: 13,
  spawnClearance: 7,
  /** Seconds the victory or defeat result stays up before the arena resets. */
  resultTime: 5,
  /** Simulation steps per second. Fixed, so every machine running it gets the same result. */
  tickRate: 60,
}
