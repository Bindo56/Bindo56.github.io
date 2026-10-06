import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Scene } from 'three'
import { PlanetLoader } from '../../src/app/PlanetLoader'
import type { PlanetDefinition, PlanetModule, PreparedPlanet } from '../../src/app/PlanetContracts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function prepared(): PreparedPlanet {
  return { scene: new Scene(), camera: new PerspectiveCamera(), dispose: vi.fn() }
}

function definition(slug: string, load: PlanetDefinition['load']): PlanetDefinition {
  return {
    slug,
    title: slug,
    projectKey: slug,
    position: { sector: [0, 0, 0], local: [0, 0, 0] },
    radius: 10,
    color: 0xffffff,
    load,
  }
}

function moduleWith(result: PreparedPlanet): PlanetModule {
  return { prepare: vi.fn(async () => result), mount: vi.fn() }
}

describe('planet background loader', () => {
  it('deduplicates an in-flight load and hands ready resources to the caller', async () => {
    const result = prepared()
    const module = moduleWith(result)
    const load = vi.fn(async () => module)
    const planet = definition('voxel', load)
    const loader = new PlanetLoader()

    const first = loader.prefetch(planet)
    const second = loader.prefetch(planet)
    expect(second).toBe(first)
    await first

    expect(load).toHaveBeenCalledTimes(1)
    expect(module.prepare).toHaveBeenCalledTimes(1)
    expect(loader.state.status).toBe('ready')
    expect(loader.takeReady(planet)).toEqual({ module, prepared: result })
    expect(loader.state.status).toBe('idle')
    loader.dispose()
    expect(result.dispose).not.toHaveBeenCalled()
  })

  it('disposes a result that finishes after another planet takes priority', async () => {
    const slowResult = prepared()
    const fastResult = prepared()
    const slowPreparation = deferred<PreparedPlanet>()
    const preparationStarted = deferred<void>()
    const slowModule: PlanetModule = {
      prepare: vi.fn(() => { preparationStarted.resolve(); return slowPreparation.promise }),
      mount: vi.fn(),
    }
    const slow = definition('voxel', vi.fn(async () => slowModule))
    const fast = definition('npc-ecs', vi.fn(async () => moduleWith(fastResult)))
    const loader = new PlanetLoader()

    const oldTask = loader.prefetch(slow)
    await preparationStarted.promise
    const newTask = loader.prefetch(fast)
    await newTask
    slowPreparation.resolve(slowResult)
    await oldTask

    expect(slowResult.dispose).toHaveBeenCalledTimes(1)
    expect(fastResult.dispose).not.toHaveBeenCalled()
    expect(loader.state.planet?.slug).toBe('npc-ecs')
    expect(loader.state.status).toBe('ready')
    loader.dispose()
    expect(fastResult.dispose).toHaveBeenCalledTimes(1)
  })

  it('offers retry after a load failure and clears the error on success', async () => {
    const result = prepared()
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('asset unavailable'))
      .mockResolvedValueOnce(moduleWith(result))
    const loader = new PlanetLoader()

    await loader.prefetch(definition('drone-fleet', load))
    expect(loader.state.status).toBe('error')
    expect(loader.state.error?.message).toBe('asset unavailable')
    await loader.retry()
    expect(load).toHaveBeenCalledTimes(2)
    expect(loader.state.status).toBe('ready')
    expect(loader.state.error).toBeUndefined()
    loader.dispose()
  })
})
