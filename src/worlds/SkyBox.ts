import * as THREE from 'three'

export type SkyPalette = {
  zenith: number
  horizon: number
  cloud: number
  sun: number
  cloudOpacity: number
  sunVisibility: number
}

/** A camera-centred sky that stays behind all world geometry without a texture download. */
export class SkyBox {
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>

  constructor(palette: SkyPalette) {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        zenith: { value: new THREE.Color(palette.zenith) },
        horizon: { value: new THREE.Color(palette.horizon) },
        cloud: { value: new THREE.Color(palette.cloud) },
        sun: { value: new THREE.Color(palette.sun) },
        cloudOpacity: { value: palette.cloudOpacity },
        sunVisibility: { value: palette.sunVisibility },
      },
      vertexShader: `
        varying vec3 direction;
        void main() {
          direction = normalize(position);
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = clip.xyww;
        }
      `,
      fragmentShader: `
        uniform vec3 zenith;
        uniform vec3 horizon;
        uniform vec3 cloud;
        uniform vec3 sun;
        uniform float cloudOpacity;
        uniform float sunVisibility;
        varying vec3 direction;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 cell = floor(p);
          vec2 blend = fract(p);
          blend = blend * blend * (3.0 - 2.0 * blend);
          return mix(
            mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x),
            mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), blend.x),
            blend.y
          );
        }

        float cloudNoise(vec2 p) {
          float value = 0.0;
          float weight = 0.5;
          for (int octave = 0; octave < 4; octave++) {
            value += noise(p) * weight;
            p = p * 2.03 + vec2(13.7, 8.3);
            weight *= 0.5;
          }
          return value / 0.9375;
        }

        void main() {
          vec3 ray = normalize(direction);
          float height = pow(smoothstep(-0.08, 0.95, ray.y), 0.7);
          vec3 color = mix(horizon, zenith, height);

          vec3 sunDirection = normalize(vec3(0.55, 0.62, -0.56));
          float facingSun = dot(ray, sunDirection);
          float sunGlow = pow(max(facingSun, 0.0), 24.0) * 0.22;
          float sunDisc = smoothstep(0.99988, 0.99997, facingSun);
          color = mix(color, sun, (sunGlow + sunDisc) * sunVisibility);

          // Project a cloud layer onto the upper hemisphere. Fractal noise gives
          // irregular cumulus shapes without repeating bands or image seams.
          vec2 cloudPosition = ray.xz / max(ray.y + 0.18, 0.12) * 2.6;
          float broad = cloudNoise(cloudPosition);
          float detail = cloudNoise(cloudPosition * 2.9 + vec2(31.4, 17.8));
          float density = smoothstep(0.49, 0.64, broad * 0.78 + detail * 0.22);
          float cloudFade = smoothstep(0.015, 0.15, ray.y);
          vec3 cloudShade = mix(cloud * 0.82, cloud, clamp(ray.y * 0.55 + facingSun * 0.3 + 0.3, 0.0, 1.0));
          color = mix(color, cloudShade, density * cloudFade * cloudOpacity);

          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })

    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
    this.mesh.name = 'SkyBox'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1000
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      this.mesh.position.copy(camera.position)
    }
  }

  setPalette(palette: SkyPalette): void {
    const uniforms = this.mesh.material.uniforms
    ;(uniforms.zenith.value as THREE.Color).setHex(palette.zenith)
    ;(uniforms.horizon.value as THREE.Color).setHex(palette.horizon)
    ;(uniforms.cloud.value as THREE.Color).setHex(palette.cloud)
    ;(uniforms.sun.value as THREE.Color).setHex(palette.sun)
    uniforms.cloudOpacity.value = palette.cloudOpacity
    uniforms.sunVisibility.value = palette.sunVisibility
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
