import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { m } from './skyline/kit'

/** One visible instance of the supplied 100 People FBX pack. World position belongs to `group`. */
export type ProofCharacter = {
  group: THREE.Group
  setAction(action: string): void
  update(dt: number): void
  dispose(): void
}

type Curve = { path: string; keys: number[][] }
type Clip = { duration: number; rotation: Curve[]; position: Curve[]; visibility: Curve[] }
type AnimationFile = { clips: Record<string, Clip> }
type Assets = { variants: THREE.Object3D[]; clips: Record<string, Clip>; material: THREE.MeshBasicMaterial }
type Pose = { position: THREE.Vector3; quaternion: THREE.Quaternion; visible: boolean }
type NodeState = { object: THREE.Object3D; base: Pose }
type ActionDef = { clip: string; speed: number; pingPong?: boolean; upperBodyOnly?: boolean }

const assetBase = `${import.meta.env.BASE_URL}assets/clockwork/`
// One city block is a 3 m building floor; NPCs should stand about half a floor tall.
const BODY_HEIGHT = m(1.5)
const FBX_UNITS_PER_METER = 100
const FADE_SECONDS = 0.2
const DEG = Math.PI / 180

// This Unity pack contains motions in separate .anim files, not in the FBX.
// Work gestures borrow those authored motions; the cart and goods supply their meaning.
const actions: Record<string, ActionDef> = {
  idle: { clip: 'idle', speed: 1 },
  walk: { clip: 'walk', speed: 1 },
  work: { clip: 'happy_dance_2', speed: 0.7, upperBodyOnly: true },
  talk: { clip: 'sitting+hand_up', speed: 0.95, upperBodyOnly: true },
  prepare: { clip: 'happy_dance_2', speed: 0.7, upperBodyOnly: true },
  serve: { clip: 'sitting+hand_up', speed: 0.95, upperBodyOnly: true },
  restock: { clip: 'on_all_fours', speed: 0.4, pingPong: true },
  break: { clip: 'sitting+idle', speed: 1 },
  close: { clip: 'hands_on_head', speed: 0.75 },
}

let cachedAssets: Promise<Assets> | undefined

function loadAssets(): Promise<Assets> {
  if (!cachedAssets) {
    const manager = new THREE.LoadingManager()
    // The exported FBX still points to MagicaVoxel's original relative PNG path.
    // Resolve that internal reference to the palette supplied with this pack.
    manager.setURLModifier((url) => /\.png(?:\?.*)?$/i.test(url) ? `${assetBase}Texture.png` : url)
    cachedAssets = Promise.all([
      new FBXLoader(manager).loadAsync(`${assetBase}100-people.fbx`),
      new THREE.TextureLoader().loadAsync(`${assetBase}Texture.png`),
      fetch(`${assetBase}animations.json`).then(async (response) => {
        if (!response.ok) throw new Error(`Could not load NPC animations: ${response.status}`)
        return response.json() as Promise<AnimationFile>
      }),
    ]).then(([fbx, palette, animationFile]) => {
      const variants = fbx.children.filter((child) => /^body_root_\d+$/.test(child.name))
      if (variants.length < 2 || !animationFile.clips.walk || !animationFile.clips.idle) {
        throw new Error('The 100 People asset is missing character variants or motion clips.')
      }
      palette.colorSpace = THREE.SRGBColorSpace
      palette.magFilter = THREE.NearestFilter
      palette.minFilter = THREE.NearestFilter
      palette.generateMipmaps = false
      palette.wrapS = THREE.ClampToEdgeWrapping
      palette.wrapT = THREE.ClampToEdgeWrapping
      palette.needsUpdate = true
      const material = new THREE.MeshBasicMaterial({ map: palette, color: 0xffffff, side: THREE.DoubleSide })
      return { variants, clips: animationFile.clips, material }
    }).catch((error) => {
      cachedAssets = undefined
      throw error
    })
  }
  return cachedAssets
}

function basePose(object: THREE.Object3D): Pose {
  return { position: object.position.clone(), quaternion: object.quaternion.clone(), visible: object.visible }
}

function indexNodes(root: THREE.Object3D): Map<string, NodeState> {
  const nodes = new Map<string, NodeState>()
  function visit(object: THREE.Object3D, path: string): void {
    nodes.set(path, { object, base: basePose(object) })
    for (const child of object.children) {
      // FBXLoader appends _2, _3… to like-named parts in later character variants.
      const name = child.name.replace(/_\d+$/, '')
      visit(child, path ? `${path}/${name}` : name)
    }
  }
  visit(root, '')
  return nodes
}

function sample(keys: number[][], time: number): number[] {
  if (keys.length === 1 || time <= keys[0][0]) return keys[0].slice(1)
  for (let i = 1; i < keys.length; i++) {
    if (time > keys[i][0]) continue
    const left = keys[i - 1]
    const right = keys[i]
    const span = right[0] - left[0]
    const alpha = span > 0 ? (time - left[0]) / span : 1
    return left.slice(1).map((value, axis) => value + (right[axis + 1] - value) * alpha)
  }
  return keys[keys.length - 1].slice(1)
}

function clipTime(elapsed: number, clip: Clip, action: ActionDef): number {
  if (action.pingPong) {
    const phase = (elapsed * action.speed) % (2 * clip.duration)
    return phase <= clip.duration ? phase : 2 * clip.duration - phase
  }
  return (elapsed * action.speed) % clip.duration
}

function applyClipPose(nodes: Map<string, NodeState>, clip: Clip, action: ActionDef, elapsed: number): Map<string, Pose> {
  const pose = new Map<string, Pose>()
  for (const [path, state] of nodes) {
    if (path) pose.set(path, { position: state.base.position.clone(), quaternion: state.base.quaternion.clone(), visible: state.base.visible })
  }
  const time = clipTime(elapsed, clip, action)
  const allowed = (path: string) => path !== '' && (!action.upperBodyOnly || path.startsWith('body/'))

  for (const curve of clip.rotation) {
    if (!allowed(curve.path)) continue
    const target = pose.get(curve.path)
    if (!target) continue
    const [x, y, z] = sample(curve.keys, time)
    // Unity is left-handed. FBXLoader's scene is right-handed and mirrors X.
    target.quaternion.setFromEuler(new THREE.Euler(x * DEG, -y * DEG, -z * DEG, 'XYZ'))
  }
  for (const curve of clip.position) {
    if (!allowed(curve.path)) continue
    const target = pose.get(curve.path)
    if (!target) continue
    const [x, y, z] = sample(curve.keys, time)
    target.position.set(-x * FBX_UNITS_PER_METER, y * FBX_UNITS_PER_METER, z * FBX_UNITS_PER_METER)
  }
  for (const curve of clip.visibility) {
    if (!allowed(curve.path)) continue
    const target = pose.get(curve.path)
    if (target) target.visible = sample(curve.keys, time)[0] >= 0.5
  }
  return pose
}

export async function loadProofCharacter(variantIndex = 0): Promise<ProofCharacter> {
  const assets = await loadAssets()
  const index = ((Math.floor(variantIndex) % assets.variants.length) + assets.variants.length) % assets.variants.length
  const model = assets.variants[index].clone(true)
  model.position.set(0, 0, 0) // The source FBX lays all 100 characters out on a display grid.
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) object.material = assets.material
  })

  const group = new THREE.Group()
  group.name = `proof-npc-${index}`
  group.add(model)
  const bounds = new THREE.Box3().setFromObject(model)
  const height = bounds.getSize(new THREE.Vector3()).y
  if (!Number.isFinite(height) || height <= 0) throw new Error(`Invalid character dimensions for ${model.name}`)
  // Put the feet at the group's origin before scaling to the city's 3 m blocks.
  model.position.y -= bounds.min.y
  group.scale.setScalar(BODY_HEIGHT / height)
  group.userData.variant = model.name

  const nodes = indexNodes(model)
  let actionName = 'idle'
  let elapsed = 0
  let fadeAge = FADE_SECONDS
  let outgoing = new Map<string, Pose>()
  let disposed = false

  const character: ProofCharacter = {
    group,
    setAction(nextAction) {
      if (disposed || nextAction === actionName) return
      outgoing = new Map()
      for (const [path, state] of nodes) if (path) outgoing.set(path, basePose(state.object))
      actionName = actions[nextAction] ? nextAction : 'idle'
      elapsed = 0
      fadeAge = 0
    },
    update(dt) {
      if (disposed) return
      elapsed += Math.max(0, Math.min(dt, 0.25))
      fadeAge = Math.min(FADE_SECONDS, fadeAge + Math.max(0, dt))
      const def = actions[actionName]
      const clip = assets.clips[def.clip]
      if (!clip) return
      const targetPose = applyClipPose(nodes, clip, def, elapsed)
      const alpha = fadeAge / FADE_SECONDS
      for (const [path, state] of nodes) {
        if (!path) continue
        const target = targetPose.get(path)!
        const old = outgoing.get(path)
        state.object.position.copy(target.position)
        state.object.quaternion.copy(target.quaternion)
        state.object.visible = target.visible
        if (old && alpha < 1) {
          state.object.position.lerpVectors(old.position, target.position, alpha)
          state.object.quaternion.slerpQuaternions(old.quaternion, target.quaternion, alpha)
          state.object.visible = alpha < 0.5 ? old.visible : target.visible
        }
      }
      if (alpha >= 1) outgoing.clear()
    },
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      group.clear()
      nodes.clear()
      outgoing.clear()
      // Geometry and palette are shared by cached variants; the page owns that cache.
    },
  }
  character.update(0)
  return character
}
