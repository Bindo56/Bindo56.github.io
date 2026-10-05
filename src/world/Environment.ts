import * as THREE from 'three'

type ThemeMode = 'dark' | 'light'

const THEMES = {
  dark: {
    background: 0x0b0d12,
    fog: 0x0b0d12,
    ground: 0x151a24,
    gridCenter: 0x2a3350,
    gridLines: 0x1c2230,
    skyLight: 0x9fb4ff,
    groundLight: 0x1a1f2a,
    ambientIntensity: 1.1,
    sun: 0xffffff,
    sunIntensity: 3,
  },
  light: {
    background: 0xf7faff,
    fog: 0xf7faff,
    ground: 0xe9eff8,
    gridCenter: 0x9cabc2,
    gridLines: 0xcad5e5,
    skyLight: 0xffffff,
    groundLight: 0xb9c9df,
    ambientIntensity: 1.5,
    sun: 0xfff8eb,
    sunIntensity: 2.2,
  },
} as const

const GRID_COLORS = {
  dark: [new THREE.Color(THEMES.dark.gridCenter), new THREE.Color(THEMES.dark.gridLines)],
  light: [new THREE.Color(THEMES.light.gridCenter), new THREE.Color(THEMES.light.gridLines)],
} as const

/** Lighting, sky, fog and ground. */
export class Environment {
  readonly group = new THREE.Group()

  private readonly disposables: { dispose(): void }[] = []
  private readonly background = new THREE.Color(THEMES.dark.background)
  private readonly fog = new THREE.Fog(THEMES.dark.fog, 50, 140)
  private readonly ambient: THREE.HemisphereLight
  private readonly sun: THREE.DirectionalLight
  private readonly groundMaterial: THREE.MeshStandardMaterial
  private readonly grid: THREE.GridHelper
  private readonly gridDivisions: number
  private mode: ThemeMode = 'dark'

  constructor(size: number) {
    const half = size / 0.2

    this.ambient = new THREE.HemisphereLight(
      THEMES.dark.skyLight,
      THEMES.dark.groundLight,
      THEMES.dark.ambientIntensity,
    )

    // The original scene's white key light at intensity 3, moved up and out to cover a whole world. Far
    // enough out that no corner of the world, nor the top of the slide, falls in front of the shadow camera.
    this.sun = new THREE.DirectionalLight(THEMES.dark.sun, THEMES.dark.sunIntensity)
    this.sun.position.set(32, 56, 40)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.left = -half
    this.sun.shadow.camera.right = half
    this.sun.shadow.camera.top = half
    this.sun.shadow.camera.bottom = -half
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 170
    // Without these, curved surfaces that both cast and receive (the slide) shadow themselves in stripes.
    this.sun.shadow.bias = -0.0005
    this.sun.shadow.normalBias = 0.04

    const groundGeometry = new THREE.PlaneGeometry(size, size)
    this.groundMaterial = new THREE.MeshStandardMaterial({ color: THEMES.dark.ground, roughness: 0.95 })
    const ground = new THREE.Mesh(groundGeometry, this.groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true

    this.gridDivisions = size
    this.grid = new THREE.GridHelper(size, this.gridDivisions, THEMES.dark.gridCenter, THEMES.dark.gridLines)
    this.grid.position.y = 0.01

    this.group.add(this.ambient, this.sun, this.sun.target, ground, this.grid)
    this.disposables.push(groundGeometry, this.groundMaterial, this.grid)
  }

  apply(scene: THREE.Scene): void {
    scene.background = this.background
    scene.fog = this.fog
    scene.add(this.group)
  }

  setTheme(mode: ThemeMode): void {
    if (mode === this.mode) return
    this.mode = mode

    const theme = THEMES[mode]
    this.background.setHex(theme.background)
    this.fog.color.setHex(theme.fog)
    this.groundMaterial.color.setHex(theme.ground)
    this.ambient.color.setHex(theme.skyLight)
    this.ambient.groundColor.setHex(theme.groundLight)
    this.ambient.intensity = theme.ambientIntensity
    this.sun.color.setHex(theme.sun)
    this.sun.intensity = theme.sunIntensity

    // GridHelper stores the line colors per vertex. Recolor its existing buffer instead of replacing
    // the helper and allocating a new geometry and material on every theme toggle.
    const colors = this.grid.geometry.getAttribute('color') as THREE.BufferAttribute
    const [center, line] = GRID_COLORS[mode]
    for (let vertex = 0; vertex < colors.count; vertex++) {
      const color = Math.floor(vertex / 4) === this.gridDivisions / 2 ? center : line
      colors.setXYZ(vertex, color.r, color.g, color.b)
    }
    colors.needsUpdate = true
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
  }
}
