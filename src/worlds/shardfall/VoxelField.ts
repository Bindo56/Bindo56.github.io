import {
  Box3, BoxGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4,
  MeshBasicMaterial, MeshToonMaterial, Object3D, Quaternion, Ray, Vector3,
} from 'three'
import type { VoxelCell } from './types.ts'

export interface WorldVoxel { position: Vector3; rotation: Quaternion; color: number; size: number }
export interface VoxelHit { field: VoxelField; index: number; point: Vector3; distance: number }
export interface VoxelDamage { removed: WorldVoxel[]; collapsed: WorldVoxel[][]; reactors: Vector3[] }

interface StoredCell extends VoxelCell { alive: boolean; slot: number; luminous: boolean }

const key = (x: number, y: number, z: number): string => x + ',' + y + ',' + z
const offsets = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]

/** Shared cube instances, integer-grid picking, and six-neighbor structural support. */
export class VoxelField {
  readonly group = new Group()
  readonly cells: StoredCell[]
  readonly total: number
  aliveCount: number
  anchorSupport?: (point: Vector3, cell: Readonly<VoxelCell>) => boolean
  private readonly lookup = new Map<string, number>()
  private readonly solid: InstancedMesh
  private readonly glow: InstancedMesh
  private readonly bounds = new Box3()
  private readonly inverse = new Matrix4()
  private readonly rotation = new Quaternion()
  private readonly dummy = new Object3D()
  private readonly empty = new Matrix4().makeScale(0, 0, 0)
  private readonly localRay = new Ray()
  private readonly entry = new Vector3()
  private readonly localPoint = new Vector3()
  private readonly scratch = new Vector3()
  private dirty = false

  constructor(
    readonly id: string,
    data: VoxelCell[],
    readonly cellSize: number,
    geometry: BoxGeometry,
    solidMaterial: MeshToonMaterial,
    glowMaterial: MeshBasicMaterial,
    readonly structural: boolean,
  ) {
    let solidCount = 0
    let glowCount = 0
    this.cells = data.map(cell => ({
      ...cell, alive: true, luminous: !!cell.emissive,
      slot: cell.emissive ? glowCount++ : solidCount++,
    }))
    this.total = this.cells.length
    this.aliveCount = this.total
    this.solid = new InstancedMesh(geometry, solidMaterial, Math.max(1, solidCount))
    this.glow = new InstancedMesh(geometry, glowMaterial, Math.max(1, glowCount))
    this.solid.count = solidCount
    this.glow.count = glowCount
    this.solid.instanceMatrix.setUsage(DynamicDrawUsage)
    this.glow.instanceMatrix.setUsage(DynamicDrawUsage)
    this.solid.receiveShadow = true
    this.solid.castShadow = false
    this.group.add(this.solid, this.glow)
    const color = new Color()
    for (let index = 0; index < this.cells.length; index++) {
      const cell = this.cells[index]
      this.lookup.set(key(cell.x, cell.y, cell.z), index)
      this.localPoint.set(cell.x, cell.y, cell.z).multiplyScalar(cellSize)
      this.bounds.expandByPoint(this.localPoint)
      const mesh = cell.luminous ? this.glow : this.solid
      this.dummy.position.copy(this.localPoint)
      this.dummy.scale.setScalar(cellSize * 0.985)
      this.dummy.updateMatrix()
      mesh.setMatrixAt(cell.slot, this.dummy.matrix)
      mesh.setColorAt(cell.slot, color.setHex(cell.color))
    }
    this.bounds.expandByScalar(cellSize * 0.5)
    this.solid.computeBoundingSphere()
    this.glow.computeBoundingSphere()
    this.flush()
  }

  private transform(): void {
    this.group.updateWorldMatrix(true, false)
    this.inverse.copy(this.group.matrixWorld).invert()
    this.group.getWorldQuaternion(this.rotation)
  }

  /** DDA visits only the cells crossed by the ray, instead of raycasting every cube. */
  raycast(ray: Ray): VoxelHit | null {
    this.transform()
    this.localRay.copy(ray).applyMatrix4(this.inverse)
    const start = this.bounds.containsPoint(this.localRay.origin)
      ? this.entry.copy(this.localRay.origin)
      : this.localRay.intersectBox(this.bounds, this.entry)
    if (!start) return null
    start.addScaledVector(this.localRay.direction, 0.00001)
    const s = this.cellSize
    let x = Math.floor(start.x / s + 0.5)
    let y = Math.floor(start.y / s + 0.5)
    let z = Math.floor(start.z / s + 0.5)
    const d = this.localRay.direction
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z)
    let tx = d.x === 0 ? Infinity : ((x + sx * 0.5) * s - start.x) / d.x
    let ty = d.y === 0 ? Infinity : ((y + sy * 0.5) * s - start.y) / d.y
    let tz = d.z === 0 ? Infinity : ((z + sz * 0.5) * s - start.z) / d.z
    const dx = d.x === 0 ? Infinity : s / Math.abs(d.x)
    const dy = d.y === 0 ? Infinity : s / Math.abs(d.y)
    const dz = d.z === 0 ? Infinity : s / Math.abs(d.z)
    let distance = 0
    const maxDistance = this.bounds.getSize(this.scratch).length() + s
    for (let step = 0; step < 600 && distance <= maxDistance; step++) {
      const index = this.lookup.get(key(x, y, z))
      if (index !== undefined && this.cells[index].alive) {
        const point = start.clone().addScaledVector(d, Math.max(0, distance)).applyMatrix4(this.group.matrixWorld)
        return { field: this, index, point, distance: point.distanceTo(ray.origin) }
      }
      if (tx <= ty && tx <= tz) { distance = tx; tx += dx; x += sx }
      else if (ty <= tz) { distance = ty; ty += dy; y += sy }
      else { distance = tz; tz += dz; z += sz }
    }
    return null
  }

  damage(point: Vector3, radius: number, checkSupport = true): VoxelDamage {
    const result: VoxelDamage = { removed: [], collapsed: [], reactors: [] }
    this.transform()
    this.localPoint.copy(point).applyMatrix4(this.inverse)
    if (this.bounds.distanceToPoint(this.localPoint) > radius) return result
    const s = this.cellSize
    const half = radius + s * 0.4
    const minX = Math.max(Math.ceil(this.bounds.min.x / s), Math.ceil((this.localPoint.x - half) / s))
    const maxX = Math.min(Math.floor(this.bounds.max.x / s), Math.floor((this.localPoint.x + half) / s))
    const minY = Math.max(Math.ceil(this.bounds.min.y / s), Math.ceil((this.localPoint.y - half) / s))
    const maxY = Math.min(Math.floor(this.bounds.max.y / s), Math.floor((this.localPoint.y + half) / s))
    const minZ = Math.max(Math.ceil(this.bounds.min.z / s), Math.ceil((this.localPoint.z - half) / s))
    const maxZ = Math.min(Math.floor(this.bounds.max.z / s), Math.floor((this.localPoint.z + half) / s))
    const removeInRadius = (index: number): void => {
      const cell = this.cells[index]
      if (!cell.alive) return
      this.scratch.set(cell.x * s, cell.y * s, cell.z * s)
      if (this.scratch.distanceToSquared(this.localPoint) > half * half) return
      if (this.cells[index].reactor) result.reactors.push(this.toWorld(index).position)
      result.removed.push(this.remove(index))
    }
    // Sparse fine-detail fields have many empty coordinates; scan existing cells for wide blasts.
    const volume = Math.max(0, maxX - minX + 1) * Math.max(0, maxY - minY + 1) * Math.max(0, maxZ - minZ + 1)
    if (volume > this.total * 2) {
      for (let index = 0; index < this.total; index++) removeInRadius(index)
    } else {
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
        const index = this.lookup.get(key(x, y, z))
        if (index !== undefined) removeInRadius(index)
      }
    }
    if (result.removed.length && this.structural && checkSupport) result.collapsed = this.collapse()
    this.flush()
    return result
  }

  /** Remove disconnected components; the surviving ground cells anchor the city. */
  collapse(): WorldVoxel[][] {
    this.transform()
    const supported = new Uint8Array(this.total)
    const queue: number[] = []
    for (let i = 0; i < this.total; i++) {
      const cell = this.cells[i]
      if (!cell.alive || !cell.anchored) continue
      this.scratch.set(cell.x, cell.y, cell.z).multiplyScalar(this.cellSize).applyMatrix4(this.group.matrixWorld)
      if (this.anchorSupport && !this.anchorSupport(this.scratch, cell)) continue
      supported[i] = 1
      queue.push(i)
    }
    const walk = (start: number, output: number[], visited: Uint8Array): void => {
      for (let cursor = start; cursor < output.length; cursor++) {
        const cell = this.cells[output[cursor]]
        for (const [dx, dy, dz] of offsets) {
          const neighbor = this.lookup.get(key(cell.x + dx, cell.y + dy, cell.z + dz))
          if (neighbor === undefined || visited[neighbor] || !this.cells[neighbor].alive) continue
          visited[neighbor] = 1
          output.push(neighbor)
        }
      }
    }
    walk(0, queue, supported)
    const chunks: WorldVoxel[][] = []
    for (let i = 0; i < this.total; i++) {
      if (!this.cells[i].alive || supported[i]) continue
      const component = [i]
      supported[i] = 1
      walk(0, component, supported)
      chunks.push(component.map(index => this.remove(index)))
    }
    this.flush()
    return chunks
  }

  reset(): void {
    for (const cell of this.cells) {
      if (cell.alive) continue
      cell.alive = true
      this.dummy.position.set(cell.x, cell.y, cell.z).multiplyScalar(this.cellSize)
      this.dummy.scale.setScalar(this.cellSize * 0.985)
      this.dummy.updateMatrix()
      ;(cell.luminous ? this.glow : this.solid).setMatrixAt(cell.slot, this.dummy.matrix)
    }
    this.aliveCount = this.total
    this.dirty = true
    this.flush()
  }

  restoreNear(point: Vector3, radius: number): void {
    this.transform()
    this.localPoint.copy(point).applyMatrix4(this.inverse)
    for (const cell of this.cells) {
      if (cell.alive) continue
      this.scratch.set(cell.x, cell.y, cell.z).multiplyScalar(this.cellSize)
      if (this.scratch.distanceToSquared(this.localPoint) > radius * radius) continue
      cell.alive = true
      this.aliveCount++
      this.dummy.position.copy(this.scratch)
      this.dummy.scale.setScalar(this.cellSize * 0.985)
      this.dummy.updateMatrix()
      ;(cell.luminous ? this.glow : this.solid).setMatrixAt(cell.slot, this.dummy.matrix)
      this.dirty = true
    }
    this.flush()
  }

  /** Placement is fixed; damage/raycast refresh the cached inverse before support queries. */
  hasVoxel(point: Vector3): boolean {
    this.localPoint.copy(point).applyMatrix4(this.inverse).multiplyScalar(1 / this.cellSize)
    const index = this.lookup.get(key(Math.round(this.localPoint.x), Math.round(this.localPoint.y), Math.round(this.localPoint.z)))
    return index !== undefined && this.cells[index].alive
  }

  hasCell(x: number, y: number, z: number): boolean {
    const index = this.lookup.get(key(x, y, z))
    return index !== undefined && this.cells[index].alive
  }

  dispose(): void {
    this.group.removeFromParent()
    this.solid.dispose()
    this.glow.dispose()
    this.lookup.clear()
  }

  private toWorld(index: number): WorldVoxel {
    const cell = this.cells[index]
    return {
      position: new Vector3(cell.x, cell.y, cell.z).multiplyScalar(this.cellSize).applyMatrix4(this.group.matrixWorld),
      rotation: this.rotation.clone(), color: cell.color, size: this.cellSize,
    }
  }

  private remove(index: number): WorldVoxel {
    const cell = this.cells[index]
    cell.alive = false
    this.aliveCount--
    ;(cell.luminous ? this.glow : this.solid).setMatrixAt(cell.slot, this.empty)
    this.dirty = true
    return this.toWorld(index)
  }

  private flush(): void {
    if (this.dirty) {
      this.solid.instanceMatrix.needsUpdate = true
      this.glow.instanceMatrix.needsUpdate = true
      this.dirty = false
    }
  }
}
