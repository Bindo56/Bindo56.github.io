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
      name: 'Travelling solar prominences',
      uniforms: {
        uTime: { value: 0 },
        uReducedMotion: { value: this.reducedMotion ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uReducedMotion;
        attribute float aProgress;
        attribute float aSeed;
        varying vec3 vLocal;
        varying float vProgress;
        varying float vSeed;
        varying float vLife;
        void main() {
          // Four staggered 7.2-second cycles leave three or four loops visible.
          // Each grows from one foot, then collapses toward the other foot.
          float age = mix(fract(uTime / 7.2 + aSeed), 0.5, uReducedMotion);
          float head = clamp((age - 0.08) / 0.25, 0.0, 1.0);
          float tail = clamp((age - 0.68) / 0.22, 0.0, 1.0);
          float growing = 1.0 - smoothstep(head - 0.12, head + 0.03, aProgress);
          float receding = smoothstep(tail - 0.03, tail + 0.12, aProgress);
          float life = growing * receding
            * smoothstep(0.06, 0.16, age)
            * (1.0 - smoothstep(0.83, 0.93, age));

          // The raised crest physically travels along the loop, rather than
          // only making a static arch brighter.
          float crestPosition = clamp((age - 0.12) / 0.61, 0.0, 1.0);
          float crestDistance = (aProgress - crestPosition) * 7.0;
          float crest = exp(-crestDistance * crestDistance);
          float anchored = sin(aProgress * 3.14159265);
          vec3 radial = normalize(position);
          float aboveSurface = max(length(position) - 1.0, 0.0);
          vec3 moved = radial * (1.0 + aboveSurface * life
            + anchored * crest * life * 0.095);

          // The anchored region drifts over the sphere; the sun itself never
          // turns to face the camera.
          float longitude = uTime * (0.045 + aSeed * 0.018);
          float c = cos(longitude);
          float s = sin(longitude);
          moved = vec3(c * moved.x + s * moved.z, moved.y,
            -s * moved.x + c * moved.z);
          vLocal = moved;
          vProgress = aProgress;
          vSeed = aSeed;
          vLife = life;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(moved, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uReducedMotion;
        varying vec3 vLocal;
        varying float vProgress;
        varying float vSeed;
        varying float vLife;
        ${SOLAR_PATTERN}
        void main() {
          float heat = solarHeat(normalize(vLocal) + vProgress * 0.03, uTime + vSeed);
          float age = mix(fract(uTime / 7.2 + vSeed), 0.5, uReducedMotion);
          // The bright crest follows the same moving bulge as the geometry.
          float crestPosition = clamp((age - 0.12) / 0.61, 0.0, 1.0);
          float distanceToCrest = vProgress - crestPosition;
          float crest = exp(-distanceToCrest * distanceToCrest * 95.0);
          float trail = step(vProgress, crestPosition)
            * exp(-max(crestPosition - vProgress, 0.0) * 15.0);
          vec3 color = mix(solarColor(heat), vec3(2.0, 1.32, 0.47),
            0.18 + crest * 0.7 + trail * 0.18);
          float footFade = 0.7 + 0.3 * sin(vProgress * 3.14159265);
          float alpha = (0.38 + heat * 0.32 + crest * 0.24)
            * vLife * footFade;
          gl_FragColor = vec4(color, alpha);
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
    plasma.name = 'Four travelling solar prominence waves'
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
    this.plasmaMaterial.uniforms.uReducedMotion.value = this.reducedMotion ? 1 : 0
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

/** Four broad, two-footed prominence loops in one draw call. */
function makePlasmaGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const progress: number[] = []
  const seeds: number[] = []
  const indices: number[] = []
  const count = 4
  const lengthSegments = 40
  const sides = 8
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const latitudes = [-0.47, -0.12, 0.24, 0.56]
  const phases = [0.19, 0.44, 0.69, 0.94]

  for (let flare = 0; flare < count; flare++) {
    const y = latitudes[flare]
    const longitude = flare * goldenAngle + 0.4
    const radial = new THREE.Vector3(
      Math.sqrt(1 - y * y) * Math.cos(longitude),
      y,
      Math.sqrt(1 - y * y) * Math.sin(longitude),
    )
    const tangent = new THREE.Vector3().crossVectors(
      new THREE.Vector3(0, 1, 0),
      radial,
    ).normalize().applyAxisAngle(radial, 0.35 + flare * 0.86)
    const binormal = new THREE.Vector3().crossVectors(radial, tangent).normalize()
    const height = 0.31 + hash(flare * 17 + 4) * 0.13
    const sweep = 0.52 + hash(flare * 19 + 7) * 0.16
    const width = 0.031 + hash(flare * 13 + 3) * 0.013
    const seed = phases[flare]
    const start = positions.length / 3

    const centerAt = (t: number): THREE.Vector3 => {
      const arch = Math.sin(Math.PI * t)
      return radial.clone().addScaledVector(tangent, sweep * (t - 0.5))
        .normalize().multiplyScalar(1 + height * arch)
        .addScaledVector(binormal, 0.025 * arch * Math.sin(flare * 2.4))
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
      const taper = 0.29 + 0.71 * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.55)
      const radius = width * taper * (0.89 + 0.11 * Math.sin(t * 17 + seed * 8))
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
  // The shader raises and drifts loops beyond their authored rest positions.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.7)
  return geometry
}

function hash(value: number): number {
  const result = Math.sin(value * 127.1) * 43758.5453
  return result - Math.floor(result)
}
