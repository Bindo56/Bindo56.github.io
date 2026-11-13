import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCameraCollision } from '../src/worlds/cameraCollision.ts'

const block = (minX, maxX, minZ, maxZ, top) => (x, y, z, radius) => {
  if (y - radius >= top) return 0
  const nearestX = Math.max(minX, Math.min(maxX, x))
  const nearestZ = Math.max(minZ, Math.min(maxZ, z))
  return (x - nearestX) ** 2 + (z - nearestZ) ** 2 < radius ** 2 ? top : 0
}

test('leaves a clear camera pose unchanged', () => {
  const desired = { x: 10, y: 2, z: 0 }
  assert.equal(resolveCameraCollision(desired, block(-2, 2, -2, 2, 20)), desired)
})

test('pushes a street-height camera outside a building footprint', () => {
  const solid = block(-2, 2, -2, 2, 20)
  const result = resolveCameraCollision({ x: 0, y: 2, z: 0 }, solid)
  assert.equal(result.y, 2)
  assert.equal(solid(result.x, result.y, result.z, 1.25), 0)
})

test('rises over a nearby roof instead of sliding across it', () => {
  const solid = block(-20, 20, -20, 20, 10)
  const result = resolveCameraCollision({ x: 0, y: 9.8, z: 0 }, solid)
  assert.equal(result.x, 0)
  assert.equal(result.z, 0)
  assert.ok(result.y > 11.25)
  assert.equal(solid(result.x, result.y, result.z, 1.25), 0)
})
