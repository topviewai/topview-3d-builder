import { Stage, poseRootOffsetScale } from '/node_modules/@topview/3d-builder/dist/engine/index.mjs'
import { Box3, Quaternion, Vector3 } from 'three'
import { resolveHeadlessMediaUrl } from '/mediaUrl.mjs'

const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const ual = { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head' }
for (const [side, suffix] of [['Left', 'l'], ['Right', 'r']]) {
  for (const [part, target] of Object.entries({ Shoulder: 'clavicle', Arm: 'upperarm', ForeArm: 'lowerarm', Hand: 'hand', UpLeg: 'thigh', Leg: 'calf', Foot: 'foot', ToeBase: 'ball' })) ual[side + part] = `${target}_${suffix}`
  for (const finger of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
    for (let i = 1; i <= 3; i++) ual[`${side}Hand${finger}${i}`] = `${finger.toLowerCase()}_0${i}_${suffix}`
  }
}

// The package's evaluate/headless entrypoints do not expose its dynamic pose
// bank. Materialize the same world-delta retargeting as supported joint controls,
// so both the Editor and headless renderer can replay the static pose unaided.
export async function compileLibraryPose({ document, nodeId, pose, libraryId, publicAssetBase, dracoDecoderPath, localAssetUrls }) {
  const doc = structuredClone(document)
  const node = doc.content.nodes.find(n => n.id === nodeId)
  if (!node?.character) throw new Error('DIRECTOR_POSE_REQUIRES_CHARACTER')
  if (node.locked) throw new Error('NODE_LOCKED')
  node.character.animation = { mode: 'pose', controlValues: {} }
  const stage = new Stage(ref => resolveHeadlessMediaUrl(ref, publicAssetBase || '', localAssetUrls), { dracoDecoderPath })
  try {
    await stage.load(doc)
    const character = stage.characters.get(nodeId)
    if (!character) throw new Error('DIRECTOR_POSE_CHARACTER_NOT_LOADED')
    const { root, restPose } = character
    const savedRoot = root.quaternion.clone()
    root.quaternion.identity()
    root.traverse(obj => { if (restPose.has(obj.name)) obj.quaternion.copy(restPose.get(obj.name)) })
    root.updateMatrixWorld(true)
    const byName = new Map(), restWorld = new Map(), assigned = new Map()
    root.traverse(obj => {
      if (obj.isBone) byName.set(normalize(obj.name), obj)
      restWorld.set(obj, obj.getWorldQuaternion(new Quaternion()))
    })
    for (const [name, value] of Object.entries(pose.bones)) {
      const mapped = character.rig === 'ual1' ? ual[name.replace(/^mixamorig:?/i, '')] : null
      const bone = byName.get(normalize(mapped || name))
      if (bone) assigned.set(bone, value)
    }
    if (assigned.size < 10) throw new Error('DIRECTOR_POSE_INCOMPATIBLE_SKELETON')
    const controls = {}
    const apply = obj => {
      const values = assigned.get(obj)
      if (values) {
        const desired = new Quaternion(...values).normalize().multiply(restWorld.get(obj))
        const parent = obj.parent?.getWorldQuaternion(new Quaternion()) || new Quaternion()
        obj.quaternion.copy(parent.invert().multiply(desired))
        obj.updateWorldMatrix(true, false)
      }
      if (obj.isBone) {
        for (const axis of ['x', 'y', 'z']) controls[`joint:${obj.name}:${axis}`] = obj.rotation[axis] * 180 / Math.PI
      }
      for (const child of obj.children) apply(child)
    }
    apply(root)
    const animation = { mode: 'pose', posePresetId: pose.pose_id || libraryId.replace(/^a3d_pose_/, ''),
      controlValues: controls, rootPositionOffset: { x: pose.hips[0], y: pose.hips[1], z: pose.hips[2] } }
    // Return only character pose fields: signed model URLs must not be persisted.
    // Same root drop as applySnapshot: library hips scale with the character's leg length.
    character.inner.position.set(...pose.hips.map(value => value * poseRootOffsetScale(character.legLength)))
    root.quaternion.copy(savedRoot)
    root.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(character.inner, true)
    const point = value => ({ x: value.x, y: value.y, z: value.z })
    return { animation, pose: { libraryId, matchedBones: assigned.size,
      size: point(bounds.getSize(new Vector3())), bounds: { min: point(bounds.min), max: point(bounds.max) } } }
  } finally { stage.dispose() }
}
