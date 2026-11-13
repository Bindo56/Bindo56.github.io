import * as THREE from 'three'

export type SkyPalette = {
  zenith: number
  horizon: number
  cloud: number
  sun: number
  cloudOpacity: number
  sunVisibility: number
  starVisibility: number
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
        starVisibility: { value: palette.starVisibility },
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
        uniform float starVisibility;
        varying vec3 direction;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vec3 ray = normalize(direction);
          float height = smoothstep(-0.08, 0.88, ray.y);
          vec3 color = mix(horizon, zenith, height);

          // Broad, soft cloud bands stay sparse near the horizon.
          float bands = sin(ray.x * 15.0 + ray.z * 7.0 + ray.y * 24.0) * 0.5
                      + sin(ray.x * 34.0 - ray.z * 19.0 + ray.y * 13.0) * 0.25
                      + sin(ray.x * 65.0 + ray.z * 41.0) * 0.125;
          float clouds = smoothstep(0.22, 0.62, bands) * smoothstep(0.02, 0.26, ray.y);
          color = mix(color, cloud, clouds * cloudOpacity);

          vec3 sunDirection = normalize(vec3(0.55, 0.42, -0.72));
          float facingSun = dot(ray, sunDirection);
          color = mix(color, sun, smoothstep(0.89, 0.999, facingSun) * sunVisibility * 0.22);
          color = mix(color, sun, smoothstep(0.9991, 0.9997, facingSun) * sunVisibility);

          vec2 starUv = vec2(atan(ray.z, ray.x), asin(ray.y));
          vec2 starGrid = starUv * vec2(210.0, 115.0);
          vec2 cell = floor(starGrid);
          float star = step(0.997, hash(cell));
          float point = 1.0 - smoothstep(0.03, 0.16, length(fract(starGrid) - 0.5));
          color += vec3(star * point * starVisibility * smoothstep(0.05, 0.4, ray.y));

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
    uniforms.starVisibility.value = palette.starVisibility
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}
