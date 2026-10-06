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
      expect(pathForPlanet(planet)).toBe(`/worlds/${planet.slug}/`)
      expect(getPlanetByPath(pathForPlanet(planet))).toBe(planet)
      expect(getPlanetByPath(`${pathForPlanet(planet)}index.html`)).toBe(planet)
    }
  })

  it('recognizes home and rejects unknown or lookalike world paths', () => {
    expect(parseRoute('/')).toEqual({ kind: 'space' })
    expect(parseRoute('/index.html')).toEqual({ kind: 'space' })
    expect(parseRoute('/worlds/voxel')).toMatchObject({ kind: 'world', planet: { slug: 'voxel' } })
    expect(parseRoute('/worlds/missing/')).toEqual({ kind: 'unknown', pathname: '/worlds/missing/' })
    expect(parseRoute('/worlds/voxel/extra/').kind).toBe('unknown')
  })
})
