import type { PlanetDefinition, PlanetHost, PlanetModule, PlanetSession, PreparedPlanet } from '../app/PlanetContracts.ts'
import { ShardfallWorld } from './shardfall/ShardfallWorld.ts'

interface PreparedShardfall extends PreparedPlanet { world: ShardfallWorld }

const module: PlanetModule = {
  async prepare(_definition: PlanetDefinition, signal: AbortSignal): Promise<PreparedPlanet> {
    if (signal.aborted) throw new DOMException('Shardfall preparation cancelled', 'AbortError')
    // Let the shell paint its loading state before constructing the voxel fields.
    await new Promise<void>(resolve => window.setTimeout(resolve, 0))
    if (signal.aborted) throw new DOMException('Shardfall preparation cancelled', 'AbortError')
    const world = new ShardfallWorld()
    const prepared: PreparedShardfall = {
      world, scene: world.scene, camera: world.camera,
      dispose() { world.dispose() },
    }
    if (signal.aborted) {
      prepared.dispose()
      throw new DOMException('Shardfall preparation cancelled', 'AbortError')
    }
    return prepared
  },
  mount(prepared: PreparedPlanet, host: PlanetHost): PlanetSession {
    const shardfall = prepared as PreparedShardfall
    shardfall.world.mount(host)
    return {
      scene: shardfall.scene, camera: shardfall.camera,
      update(dt) { shardfall.world.update(dt) },
      dispose() { shardfall.dispose() },
    }
  },
}

export default module
