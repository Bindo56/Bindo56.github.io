import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, test } from 'node:test'
import { openPopulationDatabase, transaction } from '../server/population/database.mjs'
import { importMapAnchors, seedPopulation } from '../server/population/seed.mjs'

const roots = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'population-db-test-'))
  roots.push(root)
  const database = join(root, 'population.sqlite')
  const map = join(root, 'road-network.json')
  writeFileSync(map, JSON.stringify({ version: 1, zones: { city: {
    buildings: [
      { id: 'B1', name: 'One', x: 0, z: 0 },
      { id: 'B2', name: 'Two', x: 20, z: 0 },
    ],
    nodes: [{ id: 'N1', x: 0, z: 5 }, { id: 'N2', x: 20, z: 5 }],
    roads: [{ id: 'R1', name: 'Main', from: 'N1', to: 'N2', points: [[0, 5], [20, 5]] }],
  } } }))
  return { root, database, map }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    const safePrefix = resolve(tmpdir(), 'population-db-test-')
    assert.ok(resolve(root).startsWith(safePrefix), 'Refusing to delete an unexpected path')
    rmSync(root, { recursive: true, force: true })
  }
})

test('migration, deterministic resume, lookup and foreign-key integrity', () => {
  const { database, map } = fixture()
  let store = openPopulationDatabase(database)
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 3)
  assert.equal(store.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  assert.equal(importMapAnchors(store, map).anchors, 6)
  assert.equal(seedPopulation(store, { count: 10, seed: 42, mappedLimit: 6, batchSize: 4 }).count, 10)
  const first = store.getNpc(1)
  assert.equal(first.id, 1)
  assert.equal(first.home_zone_id, 'city')
  assert.ok(first.assignments.every((assignment) => assignment.provenance === 'synthetic'))
  assert.equal(store.listNpcByHomeArea('city', { limit: 100 }).length, 6)
  assert.equal(store.listNpcByHomeArea('off_map', { limit: 100 }).length, 4)
  assert.equal(seedPopulation(store, { count: 100, seed: 42, mappedLimit: 6, batchSize: 17 }).count, 100)
  assert.equal(store.getNpc(1).display_name, first.display_name)
  assert.equal(store.getNpc(1).home_anchor_id, first.home_anchor_id)
  store.moveHousehold(1, 'B1')
  assert.equal(store.getNpc(1).home_anchor_id, 'B1')
  store.moveHousehold(1, 'OFFMAP:NYC')
  assert.equal(store.getNpc(1).home_zone_id, 'off_map')
  assert.equal(store.listNpcByHomeArea('off_map', { limit: 100 }).length, 97)
  assert.throws(() => store.db.prepare('UPDATE household SET home_anchor_id=? WHERE id=1').run('R1'), /Home must|home must/i)
  assert.throws(() => store.db.prepare('UPDATE npc SET home_zone_id=? WHERE id=1').run('city'), /home zone/i)
  store.setAssignment({ npcId: 1, kind: 'work', anchorId: 'B2', scheduleCode: 'weekday_work' })
  assert.equal(store.getNpc(1).assignments.find((item) => item.kind === 'work').provenance, 'verified')
  assert.throws(() => store.db.prepare('UPDATE npc_assignment SET anchor_id=? WHERE npc_id=1 AND kind=?').run('R1', 'work'), /Assignment must/)
  assert.throws(() => seedPopulation(store, { count: 101, seed: 43, mappedLimit: 6 }), /settings differ/)
  assert.throws(() => store.db.prepare('INSERT INTO npc(id,household_id,display_name,birth_year,role,routine_code,appearance_seed,generator_version,home_zone_id) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(101, 999, 'Invalid', 1990, 'worker', 'work', 1, 'test', 'city'), /FOREIGN KEY/)
  assert.equal(store.integrity().ok, true)
  store.close()
  store = openPopulationDatabase(database)
  assert.equal(store.getNpc(1).display_name, first.display_name)
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM npc').get().n, 100)
  store.close()
})

test('external clock, checkpoint, events, rollback and backup restore', async () => {
  const { root, database, map } = fixture()
  const store = openPopulationDatabase(database)
  importMapAnchors(store, map)
  seedPopulation(store, { count: 12, seed: 7, mappedLimit: 12 })
  assert.equal(store.getWorldTime(), null)
  const time = 1_800_000_000_000
  transaction(store.db, () => {
    store.saveWorldTime(time)
    store.saveCheckpoint({ npcId: 1, worldTimeMs: time, activity: 'commuting', roadId: 'R1', routeStartMs: time, routeEndMs: time + 60000, status: { energy: 90 } })
    assert.equal(store.appendEvent({ npcId: 1, worldTimeMs: time, eventType: 'left_home', idempotencyKey: 'trip-1' }), true)
  })
  assert.equal(store.appendEvent({ npcId: 1, worldTimeMs: time, eventType: 'left_home', idempotencyKey: 'trip-1' }), false)
  assert.throws(() => store.appendEvent({ npcId: 2, worldTimeMs: time, eventType: 'left_home', idempotencyKey: 'trip-1' }), /already used/)
  store.saveCheckpoint({ npcId: 1, worldTimeMs: time - 1, activity: 'stale' })
  assert.equal(store.getNpc(1).state.activity, 'commuting')
  assert.equal(store.getNpc(1).state.status.energy, 90)
  assert.throws(() => store.db.prepare('UPDATE npc_state SET road_id=? WHERE npc_id=1').run('B1'), /road ID/i)
  assert.equal(store.getWorldTime(), time)
  assert.equal(store.listEvents(1).length, 1)
  assert.throws(() => transaction(store.db, () => {
    store.saveWorldTime(time + 1)
    throw new Error('interrupted')
  }), /interrupted/)
  assert.equal(store.getWorldTime(), time)
  const backup = join(root, 'backup.sqlite')
  await store.backup(backup)
  await assert.rejects(store.backup(backup), /already exists/)
  store.close()
  const restored = openPopulationDatabase(backup)
  assert.equal(restored.getWorldTime(), time)
  assert.equal(restored.getNpc(1).state.activity, 'commuting')
  assert.equal(restored.listEvents(1).length, 1)
  assert.equal(restored.integrity().ok, true)
  restored.close()
})

test('changed map is rejected after identities exist', () => {
  const { database, map } = fixture()
  const store = openPopulationDatabase(database)
  importMapAnchors(store, map)
  seedPopulation(store, { count: 3, mappedLimit: 3 })
  const data = JSON.parse(readFileSync(map))
  data.zones.city.buildings[0].name = 'Changed'
  writeFileSync(map, JSON.stringify(data))
  assert.throws(() => importMapAnchors(store, map), /Map changed/)
  store.close()
})

test('generation resumes after a completed batch and does not duplicate rows', () => {
  const { database, map } = fixture()
  const store = openPopulationDatabase(database)
  importMapAnchors(store, map)
  assert.throws(() => seedPopulation(store, {
    count: 25, seed: 77, mappedLimit: 6, batchSize: 10,
    onBatch: () => { throw new Error('process interrupted') },
  }), /process interrupted/)
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM npc').get().n, 10)
  assert.equal(seedPopulation(store, { count: 25, seed: 77, mappedLimit: 6, batchSize: 10 }).count, 25)
  assert.equal(store.db.prepare('SELECT COUNT(DISTINCT id) AS n FROM npc').get().n, 25)
  assert.equal(store.integrity().ok, true)
  store.close()
})
