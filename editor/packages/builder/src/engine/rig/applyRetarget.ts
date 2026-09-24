// UAL1 重定向：mixamorig FBX 动作 → UAL1 骨骼（如用户上传的儿童角色）。
//
// 实测两套骨架的世界系 rest 朝向差异很大（手臂 90°、腿 180°），简单的
// rest 对齐（local delta 直搬）不可用。这里用**世界系增量 FK 传递**：
//   每条 clip 配一份克隆的 FBX 骨架做"提线木偶"，mixer.setTime(t) 驱动；
//   每帧对每根映射骨骼算世界增量 D = W_src(t)·W_src_rest⁻¹，
//   目标骨骼世界朝向 W_dst(t) = D·W_dst_rest，再折算回局部四元数。
// 位置轨道只迁移 pelvis：世界位移差按两边 rest 髋部高度比缩放（运行时实测）。
// 目标骨骼找不到的映射跳过并计数（unmatchedCount）。
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'
import { MIXAMORIG_TO_UAL1 } from '../../evaluate/retarget/RetargetMap'

interface Pair {
  src: THREE.Object3D
  dstNodeIdx: number
  srcRestInv: THREE.Quaternion // 源骨骼 rest 世界四元数的逆
  dstRestModel: THREE.Quaternion // 目标骨骼 rest 模型空间四元数
}

const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _v = new THREE.Vector3()

export class Ual1Retargeter {
  unmatchedCount = 0
  matchedCount = 0
  hipScaleRatio = 1

  private dstRoot: THREE.Object3D
  private nodes: THREE.Object3D[] = [] // dstRoot 遍历序（父先于子）
  private parentIdx: number[] = []
  private cur: THREE.Quaternion[] = [] // 当前模型空间四元数
  private pairs: Pair[] = []
  private pairByNode: number[] = [] // nodeIdx → pairs 下标，-1 未映射
  private dstRestLocalPos = new Map<number, THREE.Vector3>()

  private srcRoot: THREE.Object3D | null = null
  private srcMixer: THREE.AnimationMixer | null = null
  private srcAction: THREE.AnimationAction | null = null
  private srcHips: THREE.Object3D | null = null
  private srcHipsRestWorld = new THREE.Vector3() // 米（×0.01 后）
  private pelvisNodeIdx = -1
  private pelvisRestLocalPos = new THREE.Vector3()
  private activeClipId: string | null = null

  constructor(dstRoot: THREE.Object3D) {
    this.dstRoot = dstRoot
    // 捕获目标 rest（dstRoot 此时未挂场景、无变换 → 模型空间）
    dstRoot.updateMatrixWorld(true)
    dstRoot.traverse((o) => {
      const idx = this.nodes.length
      this.nodes.push(o)
      this.cur.push(new THREE.Quaternion())
      if (o === dstRoot) {
        this.parentIdx.push(-1)
      } else {
        this.parentIdx.push(this.nodes.indexOf(o.parent as THREE.Object3D))
      }
      this.dstRestLocalPos.set(idx, o.position.clone())
    })
    this.pairByNode = new Array(this.nodes.length).fill(-1)
  }

  /** 切换/设置当前 clip：克隆 FBX 骨架（rest 状态），建立映射对。 */
  setClip(clipId: string, fbxGroup: THREE.Object3D, clip: THREE.AnimationClip): void {
    if (this.activeClipId === clipId) return
    this.activeClipId = clipId

    this.srcRoot = skeletonClone(fbxGroup)
    this.srcRoot.updateMatrixWorld(true)
    this.srcMixer = new THREE.AnimationMixer(this.srcRoot)
    this.srcAction = this.srcMixer.clipAction(clip)
    this.srcAction.setLoop(THREE.LoopRepeat, Infinity)
    this.srcAction.play()

    // 建立映射对
    this.pairs = []
    this.pairByNode.fill(-1)
    this.unmatchedCount = 0
    this.matchedCount = 0
    const dstByName = new Map<string, number>()
    this.nodes.forEach((o, i) => {
      if (o.name) dstByName.set(o.name, i)
    })
    for (const [mx, ual] of Object.entries(MIXAMORIG_TO_UAL1)) {
      const dstIdx = dstByName.get(ual)
      if (dstIdx === undefined) {
        this.unmatchedCount++
        continue
      }
      const src = this.srcRoot.getObjectByName(mx)
      if (!src) continue // 源里没这根骨骼：不驱动，不算"目标未匹配"
      const srcRestInv = new THREE.Quaternion()
      src.getWorldQuaternion(srcRestInv).invert()
      const dstRestModel = new THREE.Quaternion()
      this.nodes[dstIdx].getWorldQuaternion(dstRestModel)
      this.pairByNode[dstIdx] = this.pairs.length
      this.pairs.push({ src, dstNodeIdx: dstIdx, srcRestInv, dstRestModel })
      this.matchedCount++
    }

    // pelvis 位置迁移：实测两边 rest 髋部高度定比例（不硬编码）
    this.srcHips = this.srcRoot.getObjectByName('mixamorigHips') ?? null
    const pelvisIdx = dstByName.get('pelvis')
    this.pelvisNodeIdx = pelvisIdx ?? -1
    if (this.srcHips && pelvisIdx !== undefined) {
      this.srcHips.getWorldPosition(this.srcHipsRestWorld).multiplyScalar(0.01)
      const pv = new THREE.Vector3()
      this.nodes[pelvisIdx].getWorldPosition(pv)
      this.hipScaleRatio =
        Math.abs(this.srcHipsRestWorld.y) > 1e-4 ? pv.y / this.srcHipsRestWorld.y : 1
      this.pelvisRestLocalPos.copy(this.nodes[pelvisIdx].position)
    }
  }

  /** 停掉源 mixer，并把目标骨骼局部位移恢复到 rest（髋部 root motion 残留）。 */
  resetToRest(): void {
    this.srcAction?.stop()
    this.activeClipId = null
    for (let i = 0; i < this.nodes.length; i++) {
      const rest = this.dstRestLocalPos.get(i)
      if (rest) this.nodes[i].position.copy(rest)
    }
  }

  /** 把 clip 定位到 timeSec 并传递给目标骨架（逐帧确定性）。 */
  apply(timeSec: number): void {
    if (!this.srcMixer || !this.srcRoot || !this.srcAction) return
    this.srcMixer.setTime(Math.max(0, timeSec))
    this.srcRoot.updateMatrixWorld(true)

    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i]
      // 父的模型空间四元数
      if (this.parentIdx[i] === -1) this.cur[i].identity()
      else this.cur[i].copy(this.cur[this.parentIdx[i]]).multiply(node.quaternion)

      const pi = this.pairByNode[i]
      if (pi < 0) continue
      const P = this.pairs[pi]
      // D = W_src(t) · W_src_rest⁻¹（世界/模型空间增量）
      P.src.getWorldQuaternion(_q1)
      _q1.multiply(P.srcRestInv)
      // 目标模型空间朝向 = D · W_dst_rest
      const desired = _q2.copy(_q1).multiply(P.dstRestModel)
      // 折回局部：q_local = parentModelQ⁻¹ · desired
      const parentQ = this.parentIdx[i] === -1 ? null : this.cur[this.parentIdx[i]]
      if (parentQ) node.quaternion.copy(_q1.copy(parentQ).invert().multiply(desired))
      else node.quaternion.copy(desired)
      this.cur[i].copy(desired)
    }

    // pelvis 位置：源 hips 世界位移（米）× 高度比 → 折进 pelvis 父空间
    if (this.srcHips && this.pelvisNodeIdx >= 0) {
      this.srcHips.getWorldPosition(_v).multiplyScalar(0.01)
      _v.sub(this.srcHipsRestWorld).multiplyScalar(this.hipScaleRatio)
      const pelvis = this.nodes[this.pelvisNodeIdx]
      const pIdx = this.parentIdx[this.pelvisNodeIdx]
      if (pIdx >= 0) _v.applyQuaternion(_q1.copy(this.cur[pIdx]).invert())
      pelvis.position.copy(this.pelvisRestLocalPos).add(_v)
    }
  }
}
