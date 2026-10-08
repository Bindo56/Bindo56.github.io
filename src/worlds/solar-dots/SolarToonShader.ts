import * as THREE from 'three'

export interface SolarToonPalette {
  base: number
  shadow: number
  highlight: number
  outline: number
  /** Emissive color used by the sun; ignored for orbiting stones. */
  glow?: number
  sun?: boolean
}

/**
 * Four discrete light bands with a dark, view-facing silhouette.
 * Colors are supplied as the same sRGB hex values used by Three materials;
 * THREE.Color converts them to linear values before the shader applies the
 * renderer's tone mapping and output color space.
 */
export function createSolarToonMaterial(palette: SolarToonPalette): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: palette.sun ? 'Solar Toon Core' : 'Solar Toon Stone',
    uniforms: {
      uBase: { value: new THREE.Color(palette.base) },
      uShadow: { value: new THREE.Color(palette.shadow) },
      uHighlight: { value: new THREE.Color(palette.highlight) },
      uOutline: { value: new THREE.Color(palette.outline) },
      uGlow: { value: new THREE.Color(palette.glow ?? palette.base) },
      uEmissiveStrength: { value: palette.sun ? 0.12 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vViewNormal;
      varying vec3 vViewDirection;

      void main() {
        vec4 localPosition = vec4(position, 1.0);
        vec3 localNormal = normal;

        #ifdef USE_INSTANCING
          // Match Three's normal correction for non-uniform instance scaling.
          mat3 instanceRotationScale = mat3(instanceMatrix);
          vec3 scaleSquared = vec3(
            dot(instanceRotationScale[0], instanceRotationScale[0]),
            dot(instanceRotationScale[1], instanceRotationScale[1]),
            dot(instanceRotationScale[2], instanceRotationScale[2])
          );
          localNormal = instanceRotationScale * (localNormal / max(scaleSquared, vec3(0.0001)));
          localPosition = instanceMatrix * localPosition;
        #endif

        vec4 viewPosition = modelViewMatrix * localPosition;
        vViewNormal = normalize(normalMatrix * localNormal);
        vViewDirection = -viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase;
      uniform vec3 uShadow;
      uniform vec3 uHighlight;
      uniform vec3 uOutline;
      uniform vec3 uGlow;
      uniform float uEmissiveStrength;

      varying vec3 vViewNormal;
      varying vec3 vViewDirection;

      void main() {
        vec3 normal = normalize(vViewNormal);
        vec3 viewDirection = normalize(vViewDirection);
        vec3 lightDirection = normalize(mat3(viewMatrix) * vec3(-0.45, 0.72, 0.53));
        float diffuse = max(dot(normal, lightDirection), 0.0);

        // Keep the steps hard so the light reads as illustrated shading.
        vec3 ink = uShadow;
        if (diffuse >= 0.2) ink = mix(uShadow, uBase, 0.55);
        if (diffuse >= 0.5) ink = uBase;
        if (diffuse >= 0.78) ink = uHighlight;

        float facing = max(dot(normal, viewDirection), 0.0);
        float silhouette = 1.0 - smoothstep(0.08, 0.28, facing);
        ink = mix(ink, uOutline, silhouette);

        // The core stays bright in the shadow band without washing out the ink.
        ink += uGlow * uEmissiveStrength * (0.65 + 0.35 * diffuse) * (1.0 - silhouette);
        gl_FragColor = vec4(ink, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    toneMapped: true,
  })
}
