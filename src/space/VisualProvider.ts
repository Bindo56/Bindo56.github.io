import type { Group } from 'three'
import type { PlanetDefinition } from '../app/PlanetContracts.ts'

/**
 * Future art-source boundary. SpaceSession currently builds all visible objects
 * from Three.js primitives. A GLB provider can implement this contract later
 * without changing flight, routes, or planet-session modules.
 */
export interface SpaceVisualProvider {
  loadShip(signal: AbortSignal): Promise<Group>
  loadPlanet(definition: PlanetDefinition, signal: AbortSignal): Promise<Group>
  release(group: Group): void
}
