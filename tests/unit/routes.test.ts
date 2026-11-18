import { describe, expect, it } from 'vitest'
import {
  getPlanetByPath,
  parseRoute,
  pathForPlanet,
  PLANET_SLUGS,
  planetDefinitions,
} from '../../src/worlds/registry'

describe('shareable planet routes', () => {
  it('assigns one distinct canonical URL to every authored planet', () => {
    expect(planetDefinitions).toHaveLength(9)
    expect(planetDefinitions.map(planet => planet.slug)).toEqual(PLANET_SLUGS)
    const urls = planetDefinitions.map(pathForPlanet)
    expect(new Set(urls).size).toBe(9)

    for (const planet of planetDefinitions) {
      const route = `/worlds/${planet.slug}/`
      // A world with its own entry page links there; its planet route still resolves for old links.
      expect(pathForPlanet(planet)).toBe('entryPath' in planet ? `/${planet.entryPath}` : route)
      expect(getPlanetByPath(route)).toBe(planet)
      expect(getPlanetByPath(`${route}index.html`)).toBe(planet)
    }
  })

  it('opens Ambient NPCs directly from the NPC ECS world', () => {
    const planet = planetDefinitions.find(item => item.slug === 'npc-ecs')!
    expect(planet.title).toBe('Ambient NPCs')
    expect(pathForPlanet(planet)).toBe('/worlds/ambient-npcs/')
  })

  it('recognizes home and rejects unknown or lookalike world paths', () => {
    expect(parseRoute('/')).toEqual({ kind: 'space' })
    expect(parseRoute('/index.html')).toEqual({ kind: 'space' })
    expect(parseRoute('/worlds/voxel')).toMatchObject({ kind: 'world', planet: { slug: 'voxel' } })
    expect(parseRoute('/worlds/missing/')).toEqual({ kind: 'unknown', pathname: '/worlds/missing/' })
    expect(parseRoute('/worlds/voxel/extra/').kind).toBe('unknown')
  })
})
