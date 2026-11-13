export type CameraPoint = { x: number; y: number; z: number }
export type CameraCollisionSample = (x: number, y: number, z: number, radius: number) => number

/** Keep the camera sphere outside solid columns. Returns a new position without moving the look target. */
export function resolveCameraCollision(
  desired: CameraPoint,
  collisionTopAt: CameraCollisionSample,
  radius = 1.25,
): CameraPoint {
  const top = collisionTopAt(desired.x, desired.y, desired.z, radius)
  if (top <= 0) return desired

  // At a roof edge, rising a little is less disruptive than sliding down a whole block.
  const roofY = top + radius + .15
  const rise = roofY - desired.y
  const maxSidePush = Math.min(128, rise)
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
  for (let distance = .5; distance < maxSidePush; distance += .5) {
    for (const [dx, dz] of directions) {
      const x = desired.x + dx * distance
      const z = desired.z + dz * distance
      if (collisionTopAt(x, desired.y, z, radius) <= 0) return { x, y: desired.y, z }
    }
  }
  return { x: desired.x, y: roofY, z: desired.z }
}
