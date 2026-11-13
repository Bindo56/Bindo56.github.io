import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openPopulationDatabase } from './database.mjs'
import { importMapAnchors, seedPopulation } from './seed.mjs'
import { createProofService } from './proof-service.mjs'

test('the cart worker keeps a stable identity and resumes after service restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'npc-proof-'))
  const databasePath = join(dir, 'population.sqlite')
  const mapPath = join(dir, 'map.json')
  let service
  try {
    writeFileSync(mapPath, JSON.stringify({
      version: 1,
      zones: { city: {
        buildings: [
          { id: 'W266170599', name: 'Proof home', x: -502, z: -67 },
          { id: 'W163629929', name: 'Proof workplace', x: -519, z: -36 },
        ],
        nodes: [
          { id: 'N00001', x: -501, z: -74 },
          { id: 'N00002', x: -530, z: -40 },
        ],
        roads: [{ id: 'R00001', name: 'Proof street', from: 'N00001', to: 'N00002', points: [[-501, -74], [-530, -40]] }],
      } },
    }))
    const seeded = openPopulationDatabase(databasePath)
    importMapAnchors(seeded, mapPath)
    seedPopulation(seeded, { count: 120, mappedLimit: 120 })
    seeded.close()

    let wallMs = 0
    const options = { databasePath, now: () => wallMs }
    service = createProofService(options)
    const start = service.state()
    assert.equal(start.worker.phase, 'home')
    assert.equal(start.worker.homeAnchorId, 'W266170599')
    assert.equal(start.cart.stock, 6)
    assert.equal(start.route.outbound.length, 7)

    wallMs += 30_000 / start.speed
    const walking = service.state()
    assert.equal(walking.worker.id, start.worker.id)
    assert.equal(walking.worker.phase, 'commute_to_cart')
    assert.equal(walking.worker.animation, 'walk')

    wallMs += (570_000 - 30_000) / start.speed
    const served = service.state()
    assert.equal(served.worker.phase, 'restock')
    assert.equal(served.cart.served, 1)
    assert.equal(served.cart.stock, 5)
    assert.equal(served.worker.name, start.worker.name)
    service.close()
    service = undefined

    const reopened = createProofService(options)
    service = reopened
    const resumed = reopened.state()
    assert.equal(resumed.worldTimeMs, served.worldTimeMs)
    assert.equal(resumed.worker.id, start.worker.id)
    assert.equal(resumed.cart.served, 1)

    const reader = openPopulationDatabase(databasePath, { create: false })
    const person = reader.getNpc(start.worker.id)
    assert.equal(person.state.activity, 'proof_restock')
    assert.equal(person.assignments.find((assignment) => assignment.kind === 'work').anchor_id, 'W163629929')
    assert.equal(reader.listEvents(start.worker.id).filter((event) => event.event_type === 'proof_customer_served').length, 1)
    reader.close()

    const paused = reopened.control({ action: 'pause' })
    assert.equal(paused.paused, true)
    wallMs += 10_000
    assert.equal(reopened.state().worldTimeMs, paused.worldTimeMs)
    assert.throws(() => reopened.control({ action: 'speed', speed: 200 }), /speed must be/)
    reopened.control({ action: 'speed', speed: 12 })
    reopened.control({ action: 'resume' })
    wallMs += 1_000
    assert.equal(reopened.state().worldTimeMs, paused.worldTimeMs + 12_000)

    wallMs += (1_370_000 - (paused.worldTimeMs + 12_000)) / 12
    const finished = reopened.state()
    assert.equal(finished.worker.phase, 'home')
    assert.equal(finished.cart.open, false)
    assert.equal(finished.cart.served, 4)
    assert.equal(finished.cart.stock, 6)
    const completed = openPopulationDatabase(databasePath, { create: false })
    assert.equal(completed.listEvents(start.worker.id).filter((event) => event.event_type === 'proof_customer_served').length, 4)
    completed.close()

    const reset = reopened.control({ action: 'reset' })
    assert.equal(reset.worker.phase, 'home')
    assert.equal(reset.cart.served, 0)
    assert.equal(reset.cart.stock, 6)
    assert.ok(reset.worldTimeMs > served.worldTimeMs)
    assert.equal(reset.shift, 2)
  } finally {
    service?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
