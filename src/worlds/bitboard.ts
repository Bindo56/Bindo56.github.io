import type { PlanetDefinition, PlanetHost, PlanetModule, PlanetSession, PreparedPlanet } from '../app/PlanetContracts.ts'
import { BitroomGame } from './bitroom/BitroomGame.ts'
import { BitroomVisual } from './bitroom/BitroomVisual.ts'

interface PreparedBitroom extends PreparedPlanet {
  visual: BitroomVisual
}

const module: PlanetModule = {
  async prepare(_definition: PlanetDefinition, signal: AbortSignal): Promise<PreparedPlanet> {
    if (signal.aborted) throw new DOMException('BitRoom preparation cancelled', 'AbortError')
    await Promise.resolve()
    if (signal.aborted) throw new DOMException('BitRoom preparation cancelled', 'AbortError')

    const visual = new BitroomVisual()
    let disposed = false
    const prepared: PreparedBitroom = {
      scene: visual.scene,
      camera: visual.camera,
      visual,
      dispose() {
        if (disposed) return
        disposed = true
        visual.dispose()
      },
    }
    if (signal.aborted) {
      prepared.dispose()
      throw new DOMException('BitRoom preparation cancelled', 'AbortError')
    }
    return prepared
  },

  mount(prepared: PreparedPlanet, host: PlanetHost): PlanetSession {
    return new BitroomGame((prepared as PreparedBitroom).visual, host)
  },
}

export default module
