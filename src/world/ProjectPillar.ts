import * as THREE from 'three'
import type { Project } from '../data/projects.ts'
import { createGlowSprite, createGlowTexture } from './Glow.ts'
import { Interactable } from './Interactable.ts'
import { createTextTexture, cssColor } from './TextPanel.ts'
import type { Collider } from './World.ts'

/** How brightly each part glows while idle, and while the player is close enough to inspect. */
const GLOW = {
  idle: { core: 0.9, column: 0.18, halo: 0.55, haloSize: 1.9, light: 5 },
  focused: { core: 2, column: 0.45, halo: 1, haloSize: 2.6, light: 14 },
}

const COLUMN_HEIGHT = 1.8
const PLINTH_HEIGHT = 0.4
const PLINTH_RADIUS = 0.95

/** How far the coloured light reaches across the floor, in metres. */
const LIGHT_REACH = 6

/** The name label above the core, in metres, and how sharp its text is drawn. */
const LABEL_WIDTH = 3.2
const LABEL_HEIGHT = 1
const LABEL_PIXELS_PER_METRE = 320

/**
 * One project in the world: a cylinder on a plinth, a floating core glowing in the project's own colour
 * with a halo and a pool of light on the floor, and its name above. All of it brightens on focus.
 */
export class ProjectPillar extends Interactable {
  /** The floating core - public so the AnimationSystem can move it. The halo rides along with it. */
  readonly core: THREE.Mesh

  /** The plinth's footprint. */
  readonly collider: Collider

  private readonly columnMaterial: THREE.MeshStandardMaterial
  private readonly coreMaterial: THREE.MeshStandardMaterial
  private readonly halo: THREE.Sprite
  private readonly haloMaterial: THREE.SpriteMaterial
  private readonly light: THREE.PointLight

  constructor(project: Project, position: { x: number; z: number }, onInteract: (interactable: Interactable) => void) {
    super({ id: project.id, label: project.title, position, radius: 2, onInteract })
    this.collider = { kind: 'circle', x: position.x, z: position.z, radius: PLINTH_RADIUS }

    const plinthGeometry = new THREE.CylinderGeometry(0.8, PLINTH_RADIUS, PLINTH_HEIGHT, 32)
    const plinthMaterial = new THREE.MeshStandardMaterial({ color: 0x2a3040, roughness: 0.7 })
    const plinth = new THREE.Mesh(plinthGeometry, plinthMaterial)
    plinth.position.y = PLINTH_HEIGHT / 2
    plinth.castShadow = true
    plinth.receiveShadow = true

    const columnGeometry = new THREE.CylinderGeometry(0.5, 0.5, COLUMN_HEIGHT, 32)
    this.columnMaterial = new THREE.MeshStandardMaterial({
      color: 0x1b2130,
      emissive: project.color,
      emissiveIntensity: GLOW.idle.column,
      metalness: 0.4,
      roughness: 0.35,
    })
    const column = new THREE.Mesh(columnGeometry, this.columnMaterial)
    column.position.y = PLINTH_HEIGHT + COLUMN_HEIGHT / 2
    column.castShadow = true

    // Two bright rings in the project's colour, top and bottom of the column.
    const bandGeometry = new THREE.CylinderGeometry(0.52, 0.52, 0.12, 32)
    const bandMaterial = new THREE.MeshStandardMaterial({ color: project.color, emissive: project.color, emissiveIntensity: 1.2 })
    const topBand = new THREE.Mesh(bandGeometry, bandMaterial)
    topBand.position.y = PLINTH_HEIGHT + COLUMN_HEIGHT - 0.25
    const bottomBand = new THREE.Mesh(bandGeometry, bandMaterial)
    bottomBand.position.y = PLINTH_HEIGHT + 0.2

    // Six sides, so its spin is visible.
    const coreGeometry = new THREE.CylinderGeometry(0.28, 0.28, 0.55, 6)
    this.coreMaterial = new THREE.MeshStandardMaterial({
      color: project.color,
      emissive: project.color,
      emissiveIntensity: GLOW.idle.core,
      roughness: 0.3,
    })
    this.core = new THREE.Mesh(coreGeometry, this.coreMaterial)
    this.core.position.y = PLINTH_HEIGHT + COLUMN_HEIGHT + 0.6
    this.core.castShadow = true

    const glowTexture = createGlowTexture()
    this.halo = createGlowSprite(glowTexture, project.color, GLOW.idle.halo)
    this.haloMaterial = this.halo.material
    this.halo.scale.setScalar(GLOW.idle.haloSize)
    this.core.add(this.halo)

    this.light = new THREE.PointLight(project.color, GLOW.idle.light, LIGHT_REACH, 2)
    this.light.position.y = this.core.position.y

    // The project's name, wrapped - some run to eighty characters.
    const labelTexture = createTextTexture([{ text: project.title, size: 60, weight: 700, maxRows: 3 }], {
      width: LABEL_WIDTH * LABEL_PIXELS_PER_METRE,
      height: LABEL_HEIGHT * LABEL_PIXELS_PER_METRE,
      accent: cssColor(project.color),
      align: 'center',
    })
    const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture, depthWrite: false })
    const label = new THREE.Sprite(labelMaterial)
    label.scale.set(LABEL_WIDTH, LABEL_HEIGHT, 1)
    label.position.y = PLINTH_HEIGHT + COLUMN_HEIGHT + 1.2 + LABEL_HEIGHT / 2

    this.object.add(plinth, column, topBand, bottomBand, this.core, this.light, label)
    this.disposables.push(
      plinthGeometry, plinthMaterial, columnGeometry, this.columnMaterial, bandGeometry, bandMaterial,
      coreGeometry, this.coreMaterial, glowTexture, this.haloMaterial, labelTexture, labelMaterial,
    )
  }

  protected override onFocusChanged(focused: boolean): void {
    const glow = focused ? GLOW.focused : GLOW.idle
    this.coreMaterial.emissiveIntensity = glow.core
    this.columnMaterial.emissiveIntensity = glow.column
    this.haloMaterial.opacity = glow.halo
    this.halo.scale.setScalar(glow.haloSize)
    this.light.intensity = glow.light
  }
}
