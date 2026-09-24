// Pose 系统：controlValues（25 个旋钮，度数）→ 骨骼旋转。
// 分三个阶段：
//
//   阶段 0  复位：整副骨架回到「基准姿态」，再叠加旋钮。基准 = 模型加载后
//           捕获的运行时姿势，绝不是蒙皮 bind pose——即 CharacterObject 载入时
//           缓存的 restPose（T-pose 模型：左臂世界方向 (0.998, 0.056, 0.005)）。
//   阶段 1  直接欧拉表：固定倍率的度数叠加到指定骨骼的本地欧拉分量
//           （THREE.Euler 默认 XYZ 顺序），度 → degToRad。
//   阶段 2  语义四元数阶段：世界基向量（up/right/forward）由骨骼世界坐标运行时
//           求出；世界轴经骨骼世界四元数逆变换到本地后，右乘轴角增量
//           （q = q_current * axisAngle(localAxis, rad)）。包含：
//           - 手臂：raise ×0.32 / twist ×0.35 / 肘 ×0.92，外展经肘弯衰减
//             （最多 72%）并乘运行时检测的 abductionDirection 符号；上臂先乘
//             neutralRotation（rest→中立位对齐，rest 已是 T-pose 且三旋钮≈0
//             时跳过），肘弯前先把前臂摆直到与上臂共线（点积 <0.96 时）；
//           - 脊柱链：bodyBend ×0.35（hips）、torsoBend ×0.46/×0.42（spine/chest）；
//           - 大腿外展：世界叉积轴，直接度数；
//           - 语义检测失败时回退 legacy 欧拉路径（f = 左 +1 / 右 -1）。
//
// 旋钮语义：controlValues 是「绝对旋钮设置」（stand 预设 = STAND_DEFAULTS，
// 新角色默认 = tpose 全 0），读取时按各旋钮 min/max 夹取，缺键按 0。
//
// ⚠ 基准姿势：旧实现把 STAND_BASE_QUATS
// （stand 完成态）当作基准、叠加 controlValues − STAND_DEFAULTS 的
// 差值。该方案 stand 可以恒等成立，但 tpose 无法回到 T 型（基准里已烘入
// neutralRotation 的手臂下垂，差值退不掉，左臂水平度只有 0.04）。改用
// 当前语义（基准 = 载入捕获姿势 + 绝对旋钮值 + 完整 neutral/对齐）后，stand
// 预设复算结果与 STAND_BASE_QUATS 全部 65 根骨骼最大偏差仅 0.12°，tpose 精确
// 回到 T-pose。
// STAND_BASE_QUATS 因此降级为验证夹具（见 standBasePose.ts），不再参与运行时。
//
// 骨骼查找：19 个 canonical 键（hips/spine/chest/...）→ 实际骨骼。优先走
// nameMap（ual1 用户骨架，见 evaluate/retarget/RetargetMap.ts），再按别名表
// （名字 toLowerCase 并剥掉非 [a-z0-9] 后匹配，mixamorig / CC_Base / 通用名）。
import * as THREE from 'three'

const D2R = THREE.MathUtils.degToRad

type CanonicalKey =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'leftShoulder' | 'leftUpperArm' | 'leftLowerArm' | 'leftHand'
  | 'rightShoulder' | 'rightUpperArm' | 'rightLowerArm' | 'rightHand'
  | 'leftUpperLeg' | 'leftLowerLeg' | 'leftFoot'
  | 'rightUpperLeg' | 'rightLowerLeg' | 'rightFoot'

const CANONICAL_KEYS: CanonicalKey[] = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
]

/** canonical 键 → mixamorig 名（已 sanitize，无冒号），ual1 nameMap 的查表入口 */
const CANONICAL_TO_MIXAMORIG: Record<CanonicalKey, string> = {
  hips: 'mixamorigHips',
  spine: 'mixamorigSpine',
  // chest 的别名按顺序先命中 mixamorigSpine1（不是 Spine2）
  chest: 'mixamorigSpine1',
  neck: 'mixamorigNeck',
  head: 'mixamorigHead',
  leftShoulder: 'mixamorigLeftShoulder',
  leftUpperArm: 'mixamorigLeftArm',
  leftLowerArm: 'mixamorigLeftForeArm',
  leftHand: 'mixamorigLeftHand',
  rightShoulder: 'mixamorigRightShoulder',
  rightUpperArm: 'mixamorigRightArm',
  rightLowerArm: 'mixamorigRightForeArm',
  rightHand: 'mixamorigRightHand',
  leftUpperLeg: 'mixamorigLeftUpLeg',
  leftLowerLeg: 'mixamorigLeftLeg',
  leftFoot: 'mixamorigLeftFoot',
  rightUpperLeg: 'mixamorigRightUpLeg',
  rightLowerLeg: 'mixamorigRightLeg',
  rightFoot: 'mixamorigRightFoot',
}

/** 别名表（归一化后）。匹配 = 实际骨名归一化后按别名顺序先命中 */
const CANONICAL_ALIASES: Record<CanonicalKey, string[]> = {
  hips: ['hips', 'pelvis', 'hip', 'mixamorighips', 'ccbasehip'],
  spine: ['spine', 'waist', 'lowerback', 'mixamorigspine', 'ccbasewaist'],
  chest: ['chest', 'spine1', 'spine01', 'spine2', 'spine02', 'upperbody', 'mixamorigspine1', 'mixamorigspine2', 'ccbasespine01', 'ccbasespine02'],
  neck: ['neck', 'mixamorigneck', 'ccbasenecktwist01'],
  head: ['head', 'mixamorighead', 'ccbasehead'],
  leftShoulder: ['leftshoulder', 'leftclavicle', 'lshoulder', 'lclavicle', 'mixamorigleftshoulder', 'ccbaselclavicle'],
  leftUpperArm: ['leftupperarm', 'leftarm', 'lupperarm', 'luparm', 'larm', 'mixamorigleftarm', 'ccbaselupperarm'],
  leftLowerArm: ['leftlowerarm', 'leftforearm', 'llowerarm', 'lforearm', 'leftelbow', 'mixamorigleftforearm', 'ccbaselforearm'],
  leftHand: ['lefthand', 'leftwrist', 'lhand', 'mixamoriglefthand', 'ccbaselhand'],
  rightShoulder: ['rightshoulder', 'rightclavicle', 'rshoulder', 'rclavicle', 'mixamorigrightshoulder', 'ccbaserclavicle'],
  rightUpperArm: ['rightupperarm', 'rightarm', 'rupperarm', 'ruparm', 'rarm', 'mixamorigrightarm', 'ccbaserupperarm'],
  rightLowerArm: ['rightlowerarm', 'rightforearm', 'rlowerarm', 'rforearm', 'rightelbow', 'mixamorigrightforearm', 'ccbaserforearm'],
  rightHand: ['righthand', 'rightwrist', 'rhand', 'mixamorigrighthand', 'ccbaserhand'],
  leftUpperLeg: ['leftupperleg', 'leftupleg', 'leftthigh', 'lupperleg', 'lupleg', 'lthigh', 'mixamorigleftupleg', 'ccbaselthigh'],
  leftLowerLeg: ['leftlowerleg', 'leftleg', 'leftcalf', 'llowerleg', 'lleg', 'lcalf', 'mixamorigleftleg', 'ccbaselcalf'],
  leftFoot: ['leftfoot', 'leftankle', 'lfoot', 'mixamorigleftfoot', 'ccbaselfoot'],
  rightUpperLeg: ['rightupperleg', 'rightupleg', 'rightthigh', 'rupperleg', 'rupleg', 'rthigh', 'mixamorigrightupleg', 'ccbaserthigh'],
  rightLowerLeg: ['rightlowerleg', 'rightleg', 'rightcalf', 'rlowerleg', 'rleg', 'rcalf', 'mixamorigrightleg', 'ccbasercalf'],
  rightFoot: ['rightfoot', 'rightankle', 'rfoot', 'mixamorigrightfoot', 'ccbaserfoot'],
}

/** 旋钮 min/max，读取时夹取。与 data/poseControls.ts 保持一致 */
const KNOB_RANGES: Record<string, { min: number; max: number }> = {
  bodyBend: { min: -90, max: 90 },
  bodyTurn: { min: -90, max: 90 },
  bodyTilt: { min: -45, max: 45 },
  torsoBend: { min: -45, max: 45 },
  torsoTurn: { min: -45, max: 45 },
  torsoTilt: { min: -30, max: 30 },
  headNod: { min: -60, max: 60 },
  headTurn: { min: -90, max: 90 },
  headTilt: { min: -30, max: 30 },
  lArmRaise: { min: -90, max: 180 },
  lArmStraddle: { min: -10, max: 90 },
  lArmTurn: { min: -90, max: 90 },
  rArmRaise: { min: -90, max: 180 },
  rArmStraddle: { min: -10, max: 90 },
  rArmTurn: { min: -90, max: 90 },
  lElbowBend: { min: 0, max: 150 },
  rElbowBend: { min: 0, max: 150 },
  lLegRaise: { min: -90, max: 90 },
  lLegStraddle: { min: -30, max: 60 },
  lLegTurn: { min: -45, max: 45 },
  rLegRaise: { min: -90, max: 90 },
  rLegStraddle: { min: -30, max: 60 },
  rLegTurn: { min: -45, max: 45 },
  lKneeBend: { min: 0, max: 150 },
  rKneeBend: { min: 0, max: 150 },
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0)
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1)

type Side = 'left' | 'right'

interface PoseRig {
  canonical: Partial<Record<CanonicalKey, THREE.Object3D>>
}

interface BasisVector {
  mode: 'legacy' | 'semantic'
  vector: THREE.Vector3
}

interface UpperArmProfile {
  mode: 'legacy' | 'semantic'
  isTPoseRestArm: boolean
  neutralRotation?: THREE.Quaternion
}

interface LowerArmProfile {
  mode: 'legacy' | 'semantic'
}

interface SemanticProfile {
  basis: { up: BasisVector; right: BasisVector; forward: BasisVector }
  arms: Record<Side, { upperArm: UpperArmProfile; lowerArm: LowerArmProfile }>
}

const normalizeBoneName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '')

export type PoseCanonicalKey = CanonicalKey

export function findCanonicalBones(
  root: THREE.Object3D,
  nameMap?: (mixamorigRawName: string) => string | undefined,
): Partial<Record<CanonicalKey, THREE.Object3D>> {
  const byNorm = new Map<string, THREE.Object3D>()
  root.traverse((obj) => {
    if (obj.name) {
      const norm = normalizeBoneName(obj.name)
      if (!byNorm.has(norm)) byNorm.set(norm, obj)
    }
  })
  const canonical: Partial<Record<CanonicalKey, THREE.Object3D>> = {}
  for (const key of CANONICAL_KEYS) {
    if (nameMap) {
      const mapped = nameMap(CANONICAL_TO_MIXAMORIG[key])
      const bone = mapped ? root.getObjectByName(mapped) : undefined
      if (bone) {
        canonical[key] = bone
        continue
      }
    }
    for (const alias of CANONICAL_ALIASES[key]) {
      const bone = byNorm.get(alias)
      if (bone) {
        canonical[key] = bone
        break
      }
    }
  }
  return canonical
}

function buildPoseRig(
  root: THREE.Object3D,
  nameMap?: (mixamorigRawName: string) => string | undefined,
): PoseRig {
  return { canonical: findCanonicalBones(root, nameMap) }
}

// ---------------------------------------------------------------------------
// 数学辅助（H / Z / W / z / U / q / V）
// ---------------------------------------------------------------------------

const _worldQuat = new THREE.Quaternion()
const _axisQuat = new THREE.Quaternion()
const _poseLibDelta = new THREE.Quaternion()
const _poseLibDesired = new THREE.Quaternion()
const _poseLibParent = new THREE.Quaternion()

/** H: 骨骼方向 = 子骨骼本地位置归一化（缺省取第一个 isBone 子节点） */
function childDirLocal(bone: THREE.Object3D, child?: THREE.Object3D): THREE.Vector3 | undefined {
  const c = child ?? bone.children.find((x) => (x as THREE.Bone).isBone)
  if (!c) return undefined
  const v = c.position.clone()
  return v.lengthSq() > 1e-5 ? v.normalize() : undefined
}

/** Z: 世界轴 → 骨骼本地轴 */
function worldAxisToLocal(bone: THREE.Object3D, worldAxis: THREE.Vector3): THREE.Vector3 {
  bone.getWorldQuaternion(_worldQuat)
  return worldAxis.clone().applyQuaternion(_worldQuat.invert()).normalize()
}

/** z: 骨骼方向（世界空间） */
function boneDirWorld(bone: THREE.Object3D, child?: THREE.Object3D): THREE.Vector3 | undefined {
  const d = childDirLocal(bone, child)
  if (!d) return undefined
  bone.getWorldQuaternion(_worldQuat)
  return d.applyQuaternion(_worldQuat).normalize()
}

/**
 * W: 在当前四元数上右乘（本地空间后乘）轴角增量。
 * 实现是 q_final = rest * (rest⁻¹ * q_current) * axisAngle ≡ q_current * axisAngle，
 * 这里直接后乘；骨骼不在 rest 表里时跳过。
 */
function rightMultiplyAxisAngles(
  bone: THREE.Object3D,
  restMap: Map<string, THREE.Quaternion>,
  rotations: { axis: THREE.Vector3; degrees: number }[],
): void {
  if (!restMap.has(bone.name)) return
  for (const { axis, degrees } of rotations) {
    if (Math.abs(degrees) < 1e-4 || axis.lengthSq() < 1e-5) continue
    bone.quaternion.multiply(_axisQuat.setFromAxisAngle(axis, D2R(degrees)))
  }
}

function hasMeaningfulPoseKnobs(controlValues: Record<string, number>): boolean {
  for (const [key, raw] of Object.entries(controlValues)) {
    if (!Number.isFinite(raw) || Math.abs(raw) < 1e-4) continue
    if (key.startsWith('joint:') || KNOB_RANGES[key]) return true
  }
  return false
}

/** U: 读旋钮值（绝对设置）并按 min/max 夹取；缺键 / 非有限值按 0 */
function knobValue(controlValues: Record<string, number>, key: string): number {
  const raw = controlValues[key]
  if (!Number.isFinite(raw)) return 0
  const range = KNOB_RANGES[key]
  return range ? Math.max(range.min, Math.min(range.max, raw as number)) : (raw as number)
}

/** q: 臂外展随肘弯衰减（最多 72%） */
function attenuateAbduction(straddle: number, elbowBend: number): number {
  const r =
    Math.min(0.72, 0.72 * Math.max(0, elbowBend / 150)) *
    (1 - 0.85 * THREE.MathUtils.clamp(Math.abs(straddle) / 28, 0, 1))
  return straddle * (1 - r)
}

/** V: 膝弯 > 40° 时的脚背补偿，封顶 36° */
function footCompensation(kneeBend: number): number {
  return kneeBend > 40 ? Math.min(36, 0.28 * kneeBend) : 0
}

// ---------------------------------------------------------------------------
// 语义骨骼分析（世界基向量 + 手臂轴向检测）
// ---------------------------------------------------------------------------

function dirBetween(a?: THREE.Object3D, b?: THREE.Object3D): THREE.Vector3 | undefined {
  if (!a || !b) return undefined
  const pa = a.getWorldPosition(new THREE.Vector3())
  const pb = b.getWorldPosition(new THREE.Vector3())
  const d = pb.sub(pa)
  return d.lengthSq() >= 1e-5 ? d.normalize() : undefined
}

/** 骨骼 → 子骨骼的世界方向（缺省第一个 isBone 子节点） */
function boneChildDirWorld(bone?: THREE.Object3D, child?: THREE.Object3D): THREE.Vector3 | undefined {
  if (!bone) return undefined
  const c = child ?? bone.children.find((x) => (x as THREE.Bone).isBone)
  return c ? dirBetween(bone, c) : undefined
}

function firstNonZero(cands: (THREE.Vector3 | undefined)[], fallback: THREE.Vector3): THREE.Vector3 {
  for (const c of cands) if (c && c.lengthSq() >= 1e-5) return c.clone()
  return fallback.clone()
}

/** 投影到 ⟂n 平面；投影退化时返回原向量 */
function projectOnPlaneSafe(v: THREE.Vector3, n: THREE.Vector3): THREE.Vector3 {
  const p = v.clone().projectOnPlane(n)
  return p.lengthSq() >= 1e-5 ? p : v.clone()
}

/** 按 cross(e,t)·r 的符号对齐 e 的方向 */
function alignSign(e: THREE.Vector3, t: THREE.Vector3, r: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3().crossVectors(e, t).dot(r) >= 0
    ? e.clone().normalize()
    : e.clone().negate().normalize()
}

/** 对象 +Z 的水平投影（骨骼缺省时用 root），退化回退 (0,0,1) */
function horizontalForward(root: THREE.Object3D, bone?: THREE.Object3D): THREE.Vector3 {
  if (bone) {
    bone.getWorldQuaternion(_worldQuat)
    const f = WORLD_FORWARD.clone().applyQuaternion(_worldQuat).projectOnPlane(WORLD_UP)
    if (f.lengthSq() >= 1e-5) return f.normalize()
  }
  root.getWorldQuaternion(_worldQuat)
  const f = WORLD_FORWARD.clone().applyQuaternion(_worldQuat).projectOnPlane(WORLD_UP)
  return f.lengthSq() >= 1e-5 ? f.normalize() : WORLD_FORWARD.clone()
}

function legacyUpperArm(): UpperArmProfile {
  return { mode: 'legacy', isTPoseRestArm: false }
}

/** 上臂轴向检测 + neutralRotation（rest → 中立位对齐四元数） */
function upperArmProfile(
  side: Side,
  rig: PoseRig,
  up: THREE.Vector3,
  right: THREE.Vector3,
  forward: THREE.Vector3,
): UpperArmProfile {
  const upper = rig.canonical[side === 'left' ? 'leftUpperArm' : 'rightUpperArm']
  const lower = rig.canonical[side === 'left' ? 'leftLowerArm' : 'rightLowerArm']
  if (!upper || !lower) return legacyUpperArm()
  const c = dirBetween(upper, lower)
  if (!c) return legacyUpperArm()
  const mirroredRight = side === 'left' ? right.clone().negate() : right.clone()
  const isT = Math.abs(c.dot(right)) > 0.94
  const h = isT
    ? side === 'left'
      ? WORLD_UP.clone().negate()
      : WORLD_UP.clone()
    : alignSign(right, c, forward)
  const f = isT
    ? side === 'left'
      ? WORLD_FORWARD.clone().negate()
      : WORLD_FORWARD.clone()
    : alignSign(forward, c, mirroredRight)
  const y = c.clone().multiplyScalar(side === 'left' ? 1 : -1).normalize()
  const b = up
    .clone()
    .negate()
    .add(mirroredRight.clone().multiplyScalar(isT ? 0.03 : 0.12))
    .normalize()
  const x = childDirLocal(upper, lower)
  const neutralRotation =
    x && b.lengthSq() >= 1e-5
      ? new THREE.Quaternion().setFromUnitVectors(x, worldAxisToLocal(upper, b))
      : undefined
  if (![h, f, y].every((v) => v && v.lengthSq() >= 1e-5)) return legacyUpperArm()
  return { mode: 'semantic', isTPoseRestArm: isT, neutralRotation }
}

/** 下臂（肘）轴向检测。手臂阶段只用它的 mode，轴向在实际弯曲时重算 */
function lowerArmProfile(
  side: Side,
  rig: PoseRig,
  up: THREE.Vector3,
  right: THREE.Vector3,
  forward: THREE.Vector3,
): LowerArmProfile {
  const upper = rig.canonical[side === 'left' ? 'leftUpperArm' : 'rightUpperArm']
  const lower = rig.canonical[side === 'left' ? 'leftLowerArm' : 'rightLowerArm']
  const hand = rig.canonical[side === 'left' ? 'leftHand' : 'rightHand']
  const other = rig.canonical[side === 'left' ? 'rightLowerArm' : 'leftLowerArm']
  if (!lower) return { mode: 'legacy' }
  const otherDir = boneChildDirWorld(other)
  const mirrored = otherDir
    ? otherDir.clone().sub(right.clone().multiplyScalar(2 * otherDir.dot(right))).normalize()
    : undefined
  const p = boneChildDirWorld(lower, hand) ?? boneChildDirWorld(lower) ?? mirrored
  if (!p) return { mode: 'legacy' }
  const mirroredRight = side === 'left' ? right.clone().negate() : right.clone()
  const upperDir = upper ? dirBetween(upper, lower) : undefined
  const y = firstNonZero(
    (upperDir?.dot(up) ?? -1) > -0.2
      ? [
          WORLD_FORWARD.clone(),
          new THREE.Vector3().crossVectors(p, WORLD_FORWARD).normalize(),
          new THREE.Vector3().crossVectors(p, mirroredRight).normalize(),
        ]
      : [
          new THREE.Vector3().crossVectors(p, mirroredRight).normalize(),
          new THREE.Vector3().crossVectors(mirroredRight, p).normalize(),
          new THREE.Vector3().crossVectors(p, forward).normalize(),
        ],
    new THREE.Vector3().crossVectors(p, WORLD_FORWARD).normalize(),
  )
  const b = p.clone().multiplyScalar(side === 'left' ? 1 : -1).normalize()
  if (![y, b].every((v) => v && v.lengthSq() >= 1e-5)) return { mode: 'legacy' }
  return { mode: 'semantic' }
}

function computeSemanticProfile(root: THREE.Object3D, rig: PoseRig): SemanticProfile {
  root.updateMatrixWorld(true)
  const up = firstNonZero(
    [
      dirBetween(rig.canonical.hips, rig.canonical.chest),
      dirBetween(rig.canonical.hips, rig.canonical.neck),
      dirBetween(rig.canonical.hips, rig.canonical.head),
      dirBetween(rig.canonical.hips, rig.canonical.spine),
    ],
    WORLD_UP,
  )
  const rightCand = firstNonZero(
    [
      dirBetween(rig.canonical.leftShoulder, rig.canonical.rightShoulder),
      dirBetween(rig.canonical.leftUpperArm, rig.canonical.rightUpperArm),
      dirBetween(rig.canonical.leftUpperLeg, rig.canonical.rightUpperLeg),
    ],
    WORLD_RIGHT,
  )
  const right = projectOnPlaneSafe(rightCand, up).normalize()
  if (right.lengthSq() < 1e-5) {
    right.copy(projectOnPlaneSafe(horizontalForward(root), up).cross(up).normalize())
  }
  const forward = new THREE.Vector3().crossVectors(right, up).normalize()
  if (forward.lengthSq() < 1e-5) {
    forward.copy(projectOnPlaneSafe(horizontalForward(root, rig.canonical.chest), up).normalize())
  } else {
    const chestForward = horizontalForward(root, rig.canonical.chest)
    if (chestForward.lengthSq() >= 1e-5 && forward.dot(chestForward) < 0) forward.negate()
  }
  const rightFinal = new THREE.Vector3().crossVectors(up, forward).normalize()
  const basis = {
    up: { mode: up.equals(WORLD_UP) ? 'legacy' : 'semantic', vector: up.clone() } as BasisVector,
    right: { mode: rightFinal.equals(WORLD_RIGHT) ? 'legacy' : 'semantic', vector: rightFinal } as BasisVector,
    forward: { mode: forward.equals(WORLD_FORWARD) ? 'legacy' : 'semantic', vector: forward.clone() } as BasisVector,
  }
  const u = basis.up.vector
  const r = basis.right.vector
  const f = basis.forward.vector
  return {
    basis,
    arms: {
      left: {
        upperArm: upperArmProfile('left', rig, u, r, f),
        lowerArm: lowerArmProfile('left', rig, u, r, f),
      },
      right: {
        upperArm: upperArmProfile('right', rig, u, r, f),
        lowerArm: lowerArmProfile('right', rig, u, r, f),
      },
    },
  }
}

/** armAbductionDirection：左→右上臂世界向量与 basis.right 同向 ? +1 : -1 */
function armAbductionDirection(rig: PoseRig, profile: SemanticProfile): number {
  const l = rig.canonical.leftUpperArm
  const r = rig.canonical.rightUpperArm
  if (!l || !r) return 1
  const dir = dirBetween(l, r)
  if (!dir) return 1
  return dir.dot(profile.basis.right.vector) >= 0 ? 1 : -1
}

// ---------------------------------------------------------------------------
// 手臂：肩 / 上臂语义四元数 + 肘弯曲，legacy 欧拉回退
// ---------------------------------------------------------------------------

function addEulerDelta(bone: THREE.Object3D | undefined, dx = 0, dy = 0, dz = 0): void {
  if (!bone) return
  bone.rotation.set(bone.rotation.x + D2R(dx), bone.rotation.y + D2R(dy), bone.rotation.z + D2R(dz))
}

/** 手臂阶段的上臂语义函数 */
function applyUpperArmSemantic(
  side: Side,
  upper: THREE.Object3D,
  lower: THREE.Object3D | undefined,
  restMap: Map<string, THREE.Quaternion>,
  armProfile: UpperArmProfile,
  profile: SemanticProfile,
  s: { abduction: number; raise: number; twist: number },
): void {
  const rest = restMap.get(upper.name)
  const d = childDirLocal(upper, lower)
  if (!rest || !d) return
  const right = profile.basis.right.vector
  const forward = profile.basis.forward.vector
  upper.quaternion.copy(rest)
  const allZero =
    Math.abs(s.raise) < 1e-4 && Math.abs(s.abduction) < 1e-4 && Math.abs(s.twist) < 1e-4
  // neutralRotation：rest → 中立位对齐四元数；rest 已是 T-pose 且三旋钮≈0 时跳过
  // （短路，这就是 tpose 预设能精确停在 T-pose 的原因）。
  if (armProfile.neutralRotation && !(armProfile.isTPoseRestArm && allZero)) {
    upper.quaternion.multiply(armProfile.neutralRotation)
  }
  // raise：轴 = -basis.right（两侧同轴）
  const raiseRad = D2R(s.raise)
  if (Math.abs(raiseRad) > 1e-5) {
    upper.updateMatrixWorld(true)
    const axis = worldAxisToLocal(upper, right.clone().negate())
    upper.quaternion.multiply(_axisQuat.setFromAxisAngle(axis, raiseRad))
  }
  // abduction：轴 = ∓basis.forward（左负右正）
  const abdRad = D2R(s.abduction)
  if (Math.abs(abdRad) > 1e-5) {
    upper.updateMatrixWorld(true)
    const worldAxis = side === 'left' ? forward.clone().negate() : forward.clone()
    const axis = worldAxisToLocal(upper, worldAxis)
    upper.quaternion.multiply(_axisQuat.setFromAxisAngle(axis, abdRad))
  }
  // twist：轴 = 骨轴（世界，右侧取反）
  const twistRad = D2R(s.twist)
  if (Math.abs(twistRad) > 1e-5) {
    upper.updateMatrixWorld(true)
    const boneAxis = boneDirWorld(upper, lower)
    if (boneAxis) {
      const axis = worldAxisToLocal(upper, boneAxis)
      if (side === 'right') axis.negate()
      upper.quaternion.multiply(_axisQuat.setFromAxisAngle(axis, twistRad))
    }
  }
}

/** 肘部对齐检查：肘世界轴与上臂方向点积 < 0.96 时需要先摆直前臂 */
function elbowNeedsAlign(upper: THREE.Object3D | undefined, lower: THREE.Object3D): boolean {
  if (!upper) return false
  const upperDir = boneDirWorld(upper, lower)
  const lowerChild = childDirLocal(lower)
  if (!upperDir || !lowerChild) return false
  lower.getWorldQuaternion(_worldQuat)
  const lowerDir = lowerChild.clone().applyQuaternion(_worldQuat).normalize()
  return upperDir.dot(lowerDir) < 0.96
}

/** 对齐实现：setFromUnitVectors 把前臂摆到与上臂共线（基于 rest 四元数） */
function alignForearmToUpperArm(
  upper: THREE.Object3D | undefined,
  lower: THREE.Object3D,
  restMap: Map<string, THREE.Quaternion>,
): void {
  if (!upper) return
  const upperDir = boneDirWorld(upper, lower)
  const lowerChild = childDirLocal(lower)
  const rest = restMap.get(lower.name)
  const parent = lower.parent
  if (!upperDir || !lowerChild || !rest || !parent) return
  parent.getWorldQuaternion(_worldQuat)
  const targetDir = upperDir.clone().applyQuaternion(_worldQuat.invert()).normalize()
  const restDir = lowerChild.clone().applyQuaternion(rest).normalize()
  if (targetDir.lengthSq() < 1e-5 || restDir.lengthSq() < 1e-5) return
  const swing = new THREE.Quaternion().setFromUnitVectors(restDir, targetDir)
  lower.quaternion.copy(swing.multiply(rest))
}

/** 肘弯曲：轴随臂外展在 forward → 镜像 right 间混合 */
function applyElbowBendSemantic(
  side: Side,
  upper: THREE.Object3D | undefined,
  lower: THREE.Object3D,
  restMap: Map<string, THREE.Quaternion>,
  profile: SemanticProfile,
  o: { armStraddle: number; degrees: number },
): void {
  if (Math.abs(o.degrees) < 1e-4 || !upper) return
  const upperDir = boneDirWorld(upper, lower)
  const lowerChild = childDirLocal(lower)
  if (!upperDir || !lowerChild) return
  const right = profile.basis.right.vector
  const forward = profile.basis.forward.vector
  const mirroredRight = side === 'left' ? right.clone() : right.clone().negate()
  const p =
    THREE.MathUtils.clamp(Math.abs(o.armStraddle) / 45, 0, 1) *
    THREE.MathUtils.clamp((Math.abs(o.degrees) - 15) / 45, 0, 1)
  const m = forward
    .clone()
    .multiplyScalar(1 - p)
    .add(mirroredRight.multiplyScalar(p))
    .normalize()
  const h = new THREE.Vector3().crossVectors(m, upperDir).normalize()
  if (h.lengthSq() < 1e-5) return
  lower.getWorldQuaternion(_worldQuat)
  const lowerDir = lowerChild.clone().applyQuaternion(_worldQuat).normalize()
  const sign = new THREE.Vector3().crossVectors(h, lowerDir).dot(m) >= 0 ? 1 : -1
  const axis = worldAxisToLocal(lower, h)
  rightMultiplyAxisAngles(lower, restMap, [{ axis, degrees: o.degrees * sign }])
}

interface ArmKnobs {
  raise: number
  abduction: number // 肘弯衰减后
  abductionDirection: number
  armStraddle: number // 原始值（肘轴混合用）
  twist: number
  elbowBend: number
}

function applyArm(
  side: Side,
  rig: PoseRig,
  restMap: Map<string, THREE.Quaternion>,
  profile: SemanticProfile,
  knobs: ArmKnobs,
): void {
  const shoulderKey: CanonicalKey = side === 'left' ? 'leftShoulder' : 'rightShoulder'
  const upperKey: CanonicalKey = side === 'left' ? 'leftUpperArm' : 'rightUpperArm'
  const lowerKey: CanonicalKey = side === 'left' ? 'leftLowerArm' : 'rightLowerArm'
  const f = side === 'left' ? 1 : -1
  const armProfile = profile.arms[side]
  const shoulder = rig.canonical[shoulderKey]
  const upper = rig.canonical[upperKey]
  const lower = rig.canonical[lowerKey]
  const b = knobs.abduction * knobs.abductionDirection
  if (upper) {
    if (armProfile.upperArm.mode === 'semantic') {
      if (shoulder && Math.abs(b) >= 1e-4) {
        const worldAxis =
          side === 'left'
            ? profile.basis.right.vector.clone().negate()
            : profile.basis.right.vector.clone()
        rightMultiplyAxisAngles(shoulder, restMap, [
          { axis: worldAxisToLocal(shoulder, worldAxis), degrees: 0.14 * b },
        ])
      }
      applyUpperArmSemantic(side, upper, lower, restMap, armProfile.upperArm, profile, {
        abduction: b,
        raise: 0.32 * knobs.raise,
        twist: 0.35 * knobs.twist,
      })
    } else {
      // legacy 回退：欧拉叠加（用未乘方向的衰减外展 + f 镜像）
      addEulerDelta(shoulder, 0, 0, 0.1 * knobs.abduction * f)
      addEulerDelta(upper, 0.32 * knobs.raise, 0.35 * knobs.twist * f, 0.72 * knobs.abduction * f)
    }
  }
  if (lower) {
    if (armProfile.lowerArm.mode === 'semantic') {
      const degrees = 0.92 * knobs.elbowBend
      // 肘弯前先把前臂摆直到与上臂共线（肘轴与上臂方向点积 < 0.96 时）
      if (elbowNeedsAlign(upper, lower)) alignForearmToUpperArm(upper, lower, restMap)
      applyElbowBendSemantic(side, upper, lower, restMap, profile, {
        armStraddle: knobs.armStraddle,
        degrees,
      })
    } else {
      addEulerDelta(lower, 0, 0, -1.12 * knobs.elbowBend * f)
    }
  }
}

// ---------------------------------------------------------------------------
// 脊柱链与大腿外展
// ---------------------------------------------------------------------------

/** B: 脊柱链弯曲。轴 = 世界 right，按 cross(right, 骨方向)·forward 的符号取正/负 */
function applySpineBend(
  bone: THREE.Object3D | undefined,
  child: THREE.Object3D | undefined,
  restMap: Map<string, THREE.Quaternion>,
  profile: SemanticProfile,
  degrees: number,
): void {
  if (!bone || Math.abs(degrees) < 1e-4) return
  const d = childDirLocal(bone, child)
  if (!d) return
  bone.getWorldQuaternion(_worldQuat)
  const boneWorldDir = d.clone().applyQuaternion(_worldQuat).normalize()
  const right = profile.basis.right.vector
  const worldAxis =
    new THREE.Vector3().crossVectors(right, boneWorldDir).dot(profile.basis.forward.vector) >= 0
      ? right.clone().normalize()
      : right.clone().negate().normalize()
  rightMultiplyAxisAngles(bone, restMap, [
    { axis: worldAxisToLocal(bone, worldAxis), degrees },
  ])
}

/** $: 大腿外展。世界叉积轴；腿笔直朝下（dir·up < -0.94）时取 ∓forward */
function applyLegStraddle(
  side: Side,
  rig: PoseRig,
  restMap: Map<string, THREE.Quaternion>,
  profile: SemanticProfile,
  abduction: number,
): void {
  const bone = rig.canonical[side === 'left' ? 'leftUpperLeg' : 'rightUpperLeg']
  if (!bone || Math.abs(abduction) < 1e-4) return
  const d = childDirLocal(bone)
  if (!d) return
  bone.getWorldQuaternion(_worldQuat)
  const legWorldDir = d.clone().applyQuaternion(_worldQuat).normalize()
  let worldAxis: THREE.Vector3
  if (legWorldDir.dot(WORLD_UP) < -0.94) {
    worldAxis =
      side === 'left'
        ? profile.basis.forward.vector.clone().negate()
        : profile.basis.forward.vector.clone()
  } else {
    const axis = new THREE.Vector3().crossVectors(legWorldDir, WORLD_UP).normalize()
    const mirroredRight =
      side === 'left'
        ? profile.basis.right.vector.clone().negate()
        : profile.basis.right.vector.clone()
    const sign = new THREE.Vector3().crossVectors(axis, legWorldDir).dot(mirroredRight) >= 0 ? 1 : -1
    worldAxis = axis.multiplyScalar(sign)
  }
  rightMultiplyAxisAngles(bone, restMap, [
    { axis: worldAxisToLocal(bone, worldAxis), degrees: abduction },
  ])
}

// ---------------------------------------------------------------------------
// 阶段 1：内置直接欧拉表（apply() 内联，additive）
// ---------------------------------------------------------------------------

function applyBuiltinEulerTable(
  rig: PoseRig,
  d: (key: string) => number,
): void {
  const table: Partial<Record<CanonicalKey, { x?: number; y?: number; z?: number }>> = {
    hips: { y: 0.35 * d('bodyTurn'), z: 0.35 * d('bodyTilt') },
    spine: { y: 0.48 * d('torsoTurn'), z: 0.43 * d('torsoTilt') },
    chest: { y: 0.44 * d('torsoTurn'), z: 0.4 * d('torsoTilt') },
    neck: { x: 0.45 * d('headNod'), y: 0.45 * d('headTurn'), z: 0.38 * d('headTilt') },
    head: { x: 0.55 * d('headNod'), y: 0.55 * d('headTurn'), z: 0.45 * d('headTilt') },
    leftUpperLeg: { x: -0.9 * d('lLegRaise'), y: 0.45 * d('lLegTurn') },
    leftLowerLeg: { x: -0.85 * d('lKneeBend') },
    leftFoot: { x: footCompensation(d('lKneeBend')) },
    rightUpperLeg: { x: -0.9 * d('rLegRaise'), y: -0.45 * d('rLegTurn') },
    rightLowerLeg: { x: -0.85 * d('rKneeBend') },
    rightFoot: { x: footCompensation(d('rKneeBend')) },
  }
  // canonical → 实际骨骼，重复骨骼的度数求和后一次性叠加到当前欧拉角
  const perBone = new Map<THREE.Object3D, { x: number; y: number; z: number }>()
  for (const [key, rot] of Object.entries(table)) {
    const bone = rig.canonical[key as CanonicalKey]
    if (!bone || !rot) continue
    const acc = perBone.get(bone) ?? { x: 0, y: 0, z: 0 }
    acc.x += rot.x ?? 0
    acc.y += rot.y ?? 0
    acc.z += rot.z ?? 0
    perBone.set(bone, acc)
  }
  for (const [bone, acc] of perBone) addEulerDelta(bone, acc.x, acc.y, acc.z)
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 把 姿势库的**世界系增量**叠到骨架上（与 Ual1Retargeter 同构）：
 *   D = W_src_posed · W_src_rest⁻¹
 *   W_dst = D · W_dst_rest
 *   q_local = parentWorld⁻¹ · W_dst
 *
 * D 与路径 / 关键帧根旋转不对易：采样时把 root 临时拨到单位朝向，写完局部
 * 再还原，避免 D·R_yaw·rest 把跪姿拧成「世界系抬手」。
 *
 * 库值来自素材库 pose JSON（FBXLoader 采样后灌库），不是 Blender
 * pose.rotation_quaternion。本地 rest*delta 过不了 mixamorig hips −90°X /
 * ual1 手臂 90° 的 rest 差。调用前骨架必须已复位到 restPose。
 */
export function applyPoseLibraryBoneRotations(
  root: THREE.Object3D,
  restPose: Map<string, THREE.Quaternion>,
  bones: Record<string, readonly [number, number, number, number]>,
  nameMap?: (mixamorigRawName: string) => string | undefined,
): void {
  const byNorm = new Map<string, THREE.Object3D>()
  root.traverse((obj) => {
    if (obj.name && !byNorm.has(normalizeBoneName(obj.name))) {
      byNorm.set(normalizeBoneName(obj.name), obj)
    }
  })
  const assigned = new Map<THREE.Object3D, readonly [number, number, number, number]>()
  for (const [sanitized, quat] of Object.entries(bones)) {
    const safe = THREE.PropertyBinding.sanitizeNodeName(sanitized)
    let bone: THREE.Object3D | undefined
    if (nameMap) {
      const mapped = nameMap(safe) ?? nameMap(sanitized)
      if (mapped) bone = root.getObjectByName(mapped)
    }
    if (!bone) bone = root.getObjectByName(safe) ?? root.getObjectByName(sanitized)
    if (!bone) bone = byNorm.get(normalizeBoneName(safe))
    if (!bone || assigned.has(bone)) continue
    assigned.set(bone, quat)
  }
  if (assigned.size === 0) return

  root.traverse((obj) => {
    const rest = restPose.get(obj.name)
    if (rest) obj.quaternion.copy(rest)
  })
  // D 是世界系增量，跟根上的路径 / 关键帧 yaw 不对易。必须在单位朝向上采样局部四元数，
  // 再把根旋转还原——等价于 gizmo「先摆好姿势再转整棵」。
  const savedRoot = root.quaternion.clone()
  root.quaternion.identity()
  root.updateMatrixWorld(true)
  const destRestWorld = new Map<THREE.Object3D, THREE.Quaternion>()
  root.traverse((obj) => {
    destRestWorld.set(obj, obj.getWorldQuaternion(new THREE.Quaternion()))
  })

  const applyOne = (obj: THREE.Object3D) => {
    const quat = assigned.get(obj)
    if (quat) {
      const restW = destRestWorld.get(obj)
      if (restW) {
        _poseLibDesired.copy(_poseLibDelta.set(quat[0], quat[1], quat[2], quat[3])).multiply(restW)
        if (obj.parent) {
          obj.parent.getWorldQuaternion(_poseLibParent)
          obj.quaternion.copy(_poseLibParent.invert().multiply(_poseLibDesired))
        } else {
          obj.quaternion.copy(_poseLibDesired)
        }
        obj.updateWorldMatrix(true, false)
      }
    }
    for (const child of obj.children) applyOne(child)
  }
  applyOne(root)
  root.quaternion.copy(savedRoot)
  root.updateMatrixWorld(true)
}

/**
 * 应用 pose：先把整副骨架复位到基准姿态，再按 controlValues 叠加（两阶段算法，
 * 见文件头注释）。纯函数式，逐帧可重现。
 *
 * 基准姿态 = restPose（载入时捕获的运行时姿势；
 * T-pose 模型即 T-pose）。若传入姿势库骨骼，按世界系增量
 * 叠到 rest 上，再把结果当作旋钮叠加的 rest，手动调节是「在该库姿势上微调」。
 *
 * mixamorig 与 ual1 走完全相同的语义，唯一差别是骨骼名查找（ual1 经 nameMap）。
 *
 * rootPositionOffset（坐/蹲/跪的根下沉）由调用方处理（applySnapshot 写到 inner），
 * 等价于 applyRootPositionOffset。
 */
export function applyPose(
  root: THREE.Object3D,
  restPose: Map<string, THREE.Quaternion>,
  controlValues: Record<string, number>,
  nameMap?: (mixamorigRawName: string) => string | undefined,
  poseLibraryBones?: Record<string, readonly [number, number, number, number]> | null,
): void {
  // 阶段 0：复位到基准姿态（绝不回蒙皮 bind pose）
  root.traverse((obj) => {
    const q = restPose.get(obj.name)
    if (q) obj.quaternion.copy(q)
  })

  let restMap = restPose
  if (poseLibraryBones && Object.keys(poseLibraryBones).length > 0) {
    applyPoseLibraryBoneRotations(root, restPose, poseLibraryBones, nameMap)
    if (!hasMeaningfulPoseKnobs(controlValues)) return
    restMap = new Map(restPose)
    root.traverse((obj) => {
      if (restPose.has(obj.name)) restMap.set(obj.name, obj.quaternion.clone())
    })
  }

  const rig = buildPoseRig(root, nameMap)
  const d = (key: string) => knobValue(controlValues, key)

  // 阶段 1：直接欧拉表
  applyBuiltinEulerTable(rig, d)

  // 阶段 2：语义四元数阶段
  const profile = computeSemanticProfile(root, rig)
  const abductionDirection = armAbductionDirection(rig, profile)
  for (const side of ['left', 'right'] as const) {
    const p = side === 'left' ? 'l' : 'r'
    const straddle = d(`${p}ArmStraddle`)
    const elbow = d(`${p}ElbowBend`)
    applyArm(side, rig, restMap, profile, {
      raise: d(`${p}ArmRaise`),
      abduction: attenuateAbduction(straddle, elbow),
      abductionDirection,
      armStraddle: straddle,
      twist: d(`${p}ArmTurn`),
      elbowBend: elbow,
    })
  }
  const c = rig.canonical
  applySpineBend(c.hips, c.spine ?? c.chest, restMap, profile, 0.35 * d('bodyBend'))
  applySpineBend(c.spine, c.chest, restMap, profile, 0.46 * d('torsoBend'))
  applySpineBend(c.chest, c.neck ?? c.head, restMap, profile, 0.42 * d('torsoBend'))
  applyLegStraddle('left', rig, restMap, profile, d('lLegStraddle'))
  applyLegStraddle('right', rig, restMap, profile, d('rLegStraddle'))
}
