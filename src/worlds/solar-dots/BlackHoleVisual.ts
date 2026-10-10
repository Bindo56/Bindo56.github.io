import * as THREE from 'three'

const SHADOW_RADIUS = 2.5

/**
 * A procedural, camera-aware illustration of a black hole. The bent light is
 * an artistic approximation; SolarSimulation remains a Newtonian gravity lab.
 */
export class BlackHoleVisual {
  readonly group = new THREE.Group()

  private readonly diskMaterial: THREE.ShaderMaterial
  private readonly lensMaterial: THREE.ShaderMaterial
  private readonly shadowMask: THREE.Mesh
  private readonly lens: THREE.Mesh
  private readonly cameraDirection = new THREE.Vector3()
  private readonly cameraPosition = new THREE.Vector3()
  private readonly worldPosition = new THREE.Vector3()
  private readonly cameraRotation = new THREE.Quaternion()
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []

  constructor() {
    this.group.name = 'Gargantua-inspired black hole'

    const halo = new THREE.Mesh(
      this.geometry(new THREE.RingGeometry(3.1, 10.6, 160, 2).rotateX(-Math.PI / 2)),
      this.material(new THREE.MeshBasicMaterial({
        color: 0xd26b2d,
        transparent: true,
        opacity: 0.065,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })),
    )
    halo.name = 'Faint amber disk glow'
    halo.renderOrder = 4
    this.group.add(halo)

    this.diskMaterial = this.material(new THREE.ShaderMaterial({
      name: 'Accretion flow',
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vDisk;
        void main() {
          vDisk = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vDisk;
        void main() {
          float radius = length(vDisk);
          float angle = atan(vDisk.y, vDisk.x);
          float edge = smoothstep(3.08, 3.48, radius)
            * (1.0 - smoothstep(8.15, 8.85, radius));
          float broadFlow = 0.5 + 0.5 * sin(angle * 23.0 - uTime * 0.46 + radius * 3.6);
          float fineFlow = 0.5 + 0.5 * sin(angle * 67.0 - uTime * 0.9 + radius * 9.4);
          float bands = 0.58 + 0.26 * broadFlow + 0.16 * fineFlow;
          float inner = 1.0 - smoothstep(3.3, 6.7, radius);
          float hotRim = exp(-pow((radius - 3.52) / 0.38, 2.0));
          vec3 amber = vec3(0.52, 0.17, 0.045);
          vec3 gold = vec3(1.15, 0.56, 0.16);
          vec3 whiteGold = vec3(1.65, 1.25, 0.76);
          vec3 color = mix(amber, gold, clamp(bands + inner * 0.22, 0.0, 1.0));
          color = mix(color, whiteGold, clamp(inner * 0.65 + hotRim * 0.48, 0.0, 1.0));
          float alpha = edge * (0.38 + 0.54 * bands + 0.13 * hotRim);
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
    const disk = new THREE.Mesh(
      this.geometry(new THREE.RingGeometry(3.08, 8.85, 192, 10).rotateX(-Math.PI / 2)),
      this.diskMaterial,
    )
    disk.name = 'Thin equatorial accretion disk'
    disk.renderOrder = 5
    this.group.add(disk)

    // A camera-facing upper semicircle leaves the space below the disk open.
    this.shadowMask = new THREE.Mesh(
      this.geometry(new THREE.CircleGeometry(SHADOW_RADIUS * 1.025, 64, 0, Math.PI)),
      this.material(new THREE.MeshBasicMaterial({
        color: 0x000103,
        transparent: true,
        opacity: 1,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      })),
    )
    this.shadowMask.name = 'Upper black-hole shadow'
    this.shadowMask.renderOrder = 8
    this.group.add(this.shadowMask)

    this.lensMaterial = this.material(new THREE.ShaderMaterial({
      name: 'Upper lensed accretion arc',
      uniforms: {
        uTime: { value: 0 },
        uEdgeOn: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uEdgeOn;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * 15.0;
          // Keep a single illuminated half-circle above the disk.
          if (p.y <= 0.0) discard;
          float radius = length(p);
          float xFraction = abs(p.x) / 6.55;
          float arch = sqrt(max(0.0, 1.0 - xFraction * xFraction));
          float ends = 1.0 - smoothstep(0.88, 1.0, xFraction);
          float topY = 3.78 * arch + 0.04;
          float upper = exp(-pow((p.y - topY) / 0.25, 2.0)) * ends;
          float innerImage = exp(-pow((radius - 2.79) / 0.085, 2.0));
          float warmFlow = 0.79 + 0.21 * sin(p.x * 14.0 + uTime * 0.36);
          float arcStrength = smoothstep(0.12, 0.42, uEdgeOn);
          float arc = upper * 0.84 * warmFlow * arcStrength;
          float faintRing = innerImage * 0.28;
          float veil = exp(-pow((radius - 3.15) / 0.72, 2.0)) * 0.055;
          float flare = exp(-abs(p.y) / 0.09)
            * (1.0 - smoothstep(3.0, 7.2, abs(p.x))) * 0.065;
          float intensity = (arc + faintRing + veil + flare)
            * smoothstep(2.56, 2.64, radius);
          if (intensity < 0.004) discard;
          vec3 amber = vec3(0.9, 0.36, 0.10);
          vec3 cream = vec3(1.6, 1.18, 0.70);
          vec3 color = mix(amber, cream, clamp(upper * 0.7 + innerImage * 0.5, 0.0, 1.0));
          gl_FragColor = vec4(color, clamp(intensity, 0.0, 0.9));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: true,
    }))
    this.lens = new THREE.Mesh(this.geometry(new THREE.PlaneGeometry(15, 15)), this.lensMaterial)
    this.lens.name = 'Upper lensed disk half-circle'
    this.lens.renderOrder = 9
    this.group.add(this.lens)
  }

  update(time: number, camera: THREE.Camera): void {
    this.diskMaterial.uniforms.uTime.value = time
    this.lensMaterial.uniforms.uTime.value = time
    camera.getWorldPosition(this.cameraPosition)
    this.group.getWorldPosition(this.worldPosition)
    this.cameraDirection.copy(this.cameraPosition).sub(this.worldPosition)
    if (this.cameraDirection.lengthSq() > 0) this.cameraDirection.normalize()
    else this.cameraDirection.set(0, 0, 1)
    this.lensMaterial.uniforms.uEdgeOn.value = 1 - Math.abs(this.cameraDirection.y)
    camera.getWorldQuaternion(this.cameraRotation)
    this.shadowMask.quaternion.copy(this.cameraRotation)
    this.lens.quaternion.copy(this.cameraRotation)
  }

  dispose(): void {
    this.geometries.forEach(geometry => geometry.dispose())
    this.materials.forEach(material => material.dispose())
    this.group.clear()
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
