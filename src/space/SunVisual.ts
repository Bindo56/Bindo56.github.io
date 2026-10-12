import * as THREE from 'three'

// The surface and the plasma use the same continuous, seam-free heat pattern.
const SOLAR_PATTERN = /* glsl */ `
  float solarHeat(vec3 p, float time) {
    vec3 drift = vec3(time * 0.035, -time * 0.022, time * 0.027);
    p += drift;
    float broad = sin(p.x * 9.7 + sin(p.y * 6.1 + time * 0.13) * 1.8)
      * sin(p.z * 8.9 - p.y * 3.5 - time * 0.09);
    float current = sin(p.y * 20.0 + p.x * 5.8
      + sin(p.z * 11.0 + time * 0.18) * 2.3 + time * 0.22);
    float granules = sin(p.x * 63.0 + p.y * 29.0 - time * 0.44)
      * sin(p.z * 57.0 - p.x * 23.0 + time * 0.31);
    float darkCell = sin(p.x * 13.0 + p.z * 6.0)
      * sin(p.y * 11.0 - p.z * 4.0 + time * 0.035);
    return clamp(0.55 + broad * 0.21 + current * 0.15 + granules * 0.075
      - smoothstep(0.75, 0.95, darkCell) * 0.21, 0.0, 1.0);
  }

  vec3 solarColor(float heat) {
    vec3 ember = vec3(0.43, 0.058, 0.009);
    vec3 orange = vec3(1.1, 0.25, 0.018);
    vec3 gold = vec3(1.45, 0.67, 0.09);
    vec3 cream = vec3(1.8, 1.24, 0.52);
    vec3 color = mix(ember, orange, smoothstep(0.10, 0.55, heat));
    color = mix(color, gold, smoothstep(0.42, 0.83, heat));
    return mix(color, cream, smoothstep(0.76, 1.0, heat) * 0.72);
  }
`

/** World-fixed, procedural sun for the main portfolio solar system. */
export class SunVisual {
  readonly group = new THREE.Group()

  private readonly surfaceMaterial: THREE.ShaderMaterial
  private readonly plasmaMaterial: THREE.ShaderMaterial
  private readonly coronaMaterials: THREE.ShaderMaterial[] = []
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  private readonly motionQuery: MediaQueryList | null
  private readonly onMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches
  }
  private elapsed = 0
  private reducedMotion = false
  private disposed = false

  constructor() {
    this.group.name = 'Portfolio sun'

    this.motionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    this.reducedMotion = this.motionQuery?.matches ?? false
    this.motionQuery?.addEventListener('change', this.onMotionChange)

    this.surfaceMaterial = this.material(new THREE.ShaderMaterial({
      name: 'Procedural solar surface',
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vLocal;
        varying vec3 vViewNormal;
        varying vec3 vViewDirection;
        void main() {
          vLocal = normalize(position);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vViewNormal = normalize(normalMatrix * normal);
          vViewDirection = -viewPosition.xyz;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vLocal;
        varying vec3 vViewNormal;
        varying vec3 vViewDirection;
        ${SOLAR_PATTERN}
        void main() {
          float heat = solarHeat(normalize(vLocal), uTime);
          vec3 color = solarColor(heat);
          float facing = max(dot(normalize(vViewNormal), normalize(vViewDirection)), 0.0);
          // The warm limb keeps the sphere round without relying on scene lights.
          color *= 0.77 + 0.23 * smoothstep(0.0, 0.8, facing);
          color += vec3(0.24, 0.08, 0.01) * pow(1.0 - facing, 3.0);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      toneMapped: true,
    }))
    const surface = new THREE.Mesh(
      this.geometry(new THREE.SphereGeometry(1, 64, 48)),
      this.surfaceMaterial,
    )
    surface.name = 'Animated solar convection'
    this.group.add(surface)

    // Two thin three-dimensional shells give a soft halo from every angle.
    this.addCoronaShell(1.13, 0.26)
    this.addCoronaShell(1.47, 0.065)

    this.plasmaMaterial = this.material(new THREE.ShaderMaterial({
      name: 'Solar plasma splashes',
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        attribute float aProgress;
        attribute float aSeed;
        varying vec3 vLocal;
        varying float vProgress;
        varying float vSeed;
        void main() {
          float anchored = sin(aProgress * 3.14159265);
          vec3 moved = position + normalize(position)
            * anchored * sin(uTime * (1.3 + aSeed * 0.4) + aSeed * 8.0 + aProgress * 7.0) * 0.014;
          vLocal = moved;
          vProgress = aProgress;
          vSeed = aSeed;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(moved, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vLocal;
        varying float vProgress;
        varying float vSeed;
        ${SOLAR_PATTERN}
        void main() {
          float heat = solarHeat(normalize(vLocal) + vProgress * 0.03, uTime + vSeed);
          vec3 color = mix(solarColor(heat), vec3(1.85, 1.20, 0.37), 0.32);
          float tip = 1.0 - smoothstep(0.76, 1.0, vProgress);
          float flicker = 0.78 + 0.22 * sin(uTime * 2.3 + vSeed * 9.0 + vProgress * 8.0);
          gl_FragColor = vec4(color, (0.54 + heat * 0.31) * tip * flicker);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: true,
    }))
    const plasma = new THREE.Mesh(this.geometry(makePlasmaGeometry()), this.plasmaMaterial)
    plasma.name = 'Arched prominences and solar splashes'
    plasma.renderOrder = 2
    this.group.add(plasma)

    const light = new THREE.PointLight(0xffa349, 1700, 350, 2)
    light.name = 'Warm solar light'
    this.group.add(light)
  }

  update(dt: number): void {
    if (this.disposed) return
    if (!this.reducedMotion && Number.isFinite(dt)) {
      this.elapsed += THREE.MathUtils.clamp(dt, 0, 0.1)
    }
    this.surfaceMaterial.uniforms.uTime.value = this.elapsed
    this.plasmaMaterial.uniforms.uTime.value = this.elapsed
    this.coronaMaterials.forEach(material => {
      material.uniforms.uTime.value = this.elapsed
    })
  }

  /** The scene can forward its own accessibility setting here. */
  setReducedMotion(value: boolean): void {
    this.reducedMotion = value
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.motionQuery?.removeEventListener('change', this.onMotionChange)
    this.group.clear()
    this.geometries.forEach(geometry => geometry.dispose())
    this.materials.forEach(material => material.dispose())
  }

  private addCoronaShell(radius: number, strength: number): void {
    const material = this.material(new THREE.ShaderMaterial({
      name: 'Solar corona',
      uniforms: {
        uTime: { value: 0 },
        uStrength: { value: strength },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDirection;
        varying vec3 vLocal;
        void main() {
          vLocal = normalize(position);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDirection = -viewPosition.xyz;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStrength;
        varying vec3 vNormal;
        varying vec3 vViewDirection;
        varying vec3 vLocal;
        void main() {
          float facing = max(dot(normalize(vNormal), normalize(vViewDirection)), 0.0);
          float rim = pow(1.0 - facing, 3.0);
          float rays = 0.76 + 0.24 * sin(atan(vLocal.z, vLocal.x) * 19.0
            + vLocal.y * 15.0 + uTime * 0.3);
          float alpha = rim * uStrength * rays;
          gl_FragColor = vec4(vec3(1.45, 0.54, 0.13), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: true,
    }))
    const shell = new THREE.Mesh(this.geometry(new THREE.SphereGeometry(radius, 48, 32)), material)
    shell.name = radius < 1.3 ? 'Inner solar corona' : 'Outer solar corona'
    shell.renderOrder = 1
    this.coronaMaterials.push(material)
    this.group.add(shell)
  }

  private geometry<T extends THREE.BufferGeometry>(value: T): T {
    this.geometries.push(value)
    return value
  }

  private material<T extends THREE.Material>(value: T): T {
    this.materials.push(value)
    return value
  }
}

/** A single draw call of deterministic 3D arches and tapered jets. */
function makePlasmaGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const progress: number[] = []
  const seeds: number[] = []
  const indices: number[] = []
  const count = 25
  const lengthSegments = 14
  const sides = 5
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  for (let flare = 0; flare < count; flare++) {
    const y = 1 - (flare + 0.5) * 2 / count
    const radial = new THREE.Vector3(
      Math.sqrt(1 - y * y) * Math.cos(flare * goldenAngle),
      y,
      Math.sqrt(1 - y * y) * Math.sin(flare * goldenAngle),
    )
    const tangent = new THREE.Vector3().crossVectors(
      Math.abs(y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0),
      radial,
    ).normalize().applyAxisAngle(radial, flare * 1.87)
    const binormal = new THREE.Vector3().crossVectors(radial, tangent).normalize()
    const arch = flare % 3 !== 0
    const height = (arch ? 0.27 : 0.36) + hash(flare * 17 + 4) * 0.28
    const sweep = 0.18 + hash(flare * 19 + 7) * 0.28
    const width = arch ? 0.033 : 0.059
    const seed = hash(flare * 23 + 11)
    const start = positions.length / 3

    const centerAt = (t: number): THREE.Vector3 => {
      if (arch) {
        return radial.clone().multiplyScalar(0.99 + height * Math.sin(Math.PI * t))
          .addScaledVector(tangent, sweep * (t - 0.5))
          .addScaledVector(binormal, 0.035 * Math.sin(Math.PI * t) * Math.sin(flare * 2.4))
      }
      return radial.clone().multiplyScalar(0.985 + height * Math.sin(t * Math.PI * 0.5))
        .addScaledVector(tangent, sweep * t * t)
        .addScaledVector(binormal, 0.08 * Math.sin(Math.PI * t))
    }

    for (let step = 0; step <= lengthSegments; step++) {
      const t = step / lengthSegments
      const center = centerAt(t)
      const before = centerAt(Math.max(0, t - 0.01))
      const after = centerAt(Math.min(1, t + 0.01))
      const direction = after.sub(before).normalize()
      const side = new THREE.Vector3().crossVectors(direction, radial).normalize()
      if (side.lengthSq() < 0.001) side.copy(tangent)
      const up = new THREE.Vector3().crossVectors(direction, side).normalize()
      const taper = arch
        ? Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.48) * 0.85 + 0.15
        : Math.pow(1 - t, 1.25) * 1.2 + 0.015
      const radius = width * taper * (0.82 + 0.18 * Math.sin(t * 13 + seed * 8))
      for (let sideIndex = 0; sideIndex < sides; sideIndex++) {
        const angle = sideIndex * Math.PI * 2 / sides
        const point = center.clone()
          .addScaledVector(side, Math.cos(angle) * radius)
          .addScaledVector(up, Math.sin(angle) * radius)
        positions.push(point.x, point.y, point.z)
        progress.push(t)
        seeds.push(seed)
      }
      if (step === 0) continue
      for (let sideIndex = 0; sideIndex < sides; sideIndex++) {
        const next = (sideIndex + 1) % sides
        const lower = start + (step - 1) * sides
        const upper = start + step * sides
        indices.push(lower + sideIndex, lower + next, upper + sideIndex)
        indices.push(lower + next, upper + next, upper + sideIndex)
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aProgress', new THREE.Float32BufferAttribute(progress, 1))
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function hash(value: number): number {
  const result = Math.sin(value * 127.1) * 43758.5453
  return result - Math.floor(result)
}
