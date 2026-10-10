import * as THREE from 'three'

export interface SpaceToonPalette {
  base: number | THREE.Color
  shadow: number | THREE.Color
  highlight: number | THREE.Color
  outline?: number | THREE.Color
  doubleSided?: boolean
}

/** A fixed key light keeps the illustrated bands legible while the ship turns. */
export function createSpaceToonMaterial(palette: SpaceToonPalette): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Space Toon',
    uniforms: {
      uBase: { value: new THREE.Color(palette.base) },
      uShadow: { value: new THREE.Color(palette.shadow) },
      uHighlight: { value: new THREE.Color(palette.highlight) },
      uOutline: { value: new THREE.Color(palette.outline ?? 0x020715) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vViewNormal;
      varying vec3 vViewDirection;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vViewNormal = normalize(normalMatrix * normal);
        vViewDirection = -viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase;
      uniform vec3 uShadow;
      uniform vec3 uHighlight;
      uniform vec3 uOutline;
      varying vec3 vViewNormal;
      varying vec3 vViewDirection;

      void main() {
        // Double-sided wings need their normal reversed on the back face.
        vec3 normal = normalize(vViewNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 viewDirection = normalize(vViewDirection);
        vec3 lightDirection = normalize(mat3(viewMatrix) * vec3(-0.45, 0.72, 0.53));
        float light = dot(normal, lightDirection);

        vec3 ink = uShadow;
        if (light >= 0.06) ink = mix(uShadow, uBase, 0.58);
        if (light >= 0.4) ink = uBase;
        if (light >= 0.76) ink = uHighlight;

        // A thin dark rim gives curved surfaces an inked silhouette.
        float facing = max(dot(normal, viewDirection), 0.0);
        float rim = 1.0 - smoothstep(0.06, 0.2, facing);
        ink = mix(ink, uOutline, rim);
        gl_FragColor = vec4(ink, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: palette.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    toneMapped: true,
  })
}

/** Derive readable ink and highlight values from each destination's authored color. */
export function planetToonPalette(color: number): SpaceToonPalette {
  const base = new THREE.Color(color)
  return {
    base,
    shadow: base.clone().multiplyScalar(0.3).lerp(new THREE.Color(0x071223), 0.24),
    highlight: base.clone().lerp(new THREE.Color(0xffffff), 0.42),
    outline: 0x020715,
  }
}
