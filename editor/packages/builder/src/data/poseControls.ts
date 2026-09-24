/**
 * pose 面板滑杆清单（25 个）。静态数据，不进 engine。
 *
 * `min` / `max` 是每个旋钮的值域，各不相同：肘 / 膝是 0~150，
 * 抬臂到 180。统一按 -90~90 画滑杆会把「蹲下」的 146° 膝弯截掉。
 * 步长一律 0.1。
 */
export interface PoseControl {
  key: string
  label: string
  group: string
  min: number
  max: number
}

export const POSE_CONTROL_STEP = 0.1

export const POSE_CONTROLS: PoseControl[] = [
  { key: 'bodyBend', label: '身体弯曲', group: 'body', min: -90, max: 90 },
  { key: 'bodyTilt', label: '身体侧倾', group: 'body', min: -45, max: 45 },
  { key: 'bodyTurn', label: '身体扭转', group: 'body', min: -90, max: 90 },
  { key: 'torsoBend', label: '躯干弯曲', group: 'torso', min: -45, max: 45 },
  { key: 'torsoTilt', label: '躯干侧倾', group: 'torso', min: -30, max: 30 },
  { key: 'torsoTurn', label: '躯干扭转', group: 'torso', min: -45, max: 45 },
  { key: 'headNod', label: '点头', group: 'head', min: -60, max: 60 },
  { key: 'headTilt', label: '头部侧倾', group: 'head', min: -30, max: 30 },
  { key: 'headTurn', label: '转头', group: 'head', min: -90, max: 90 },
  { key: 'lArmRaise', label: '左臂抬升', group: 'leftArm', min: -90, max: 180 },
  { key: 'lArmStraddle', label: '左臂展开', group: 'leftArm', min: -10, max: 90 },
  { key: 'lArmTurn', label: '左臂扭转', group: 'leftArm', min: -90, max: 90 },
  { key: 'lElbowBend', label: '左肘弯曲', group: 'leftArm', min: 0, max: 150 },
  { key: 'rArmRaise', label: '右臂抬升', group: 'rightArm', min: -90, max: 180 },
  { key: 'rArmStraddle', label: '右臂展开', group: 'rightArm', min: -10, max: 90 },
  { key: 'rArmTurn', label: '右臂扭转', group: 'rightArm', min: -90, max: 90 },
  { key: 'rElbowBend', label: '右肘弯曲', group: 'rightArm', min: 0, max: 150 },
  { key: 'lLegRaise', label: '左腿抬升', group: 'leftLeg', min: -90, max: 90 },
  { key: 'lLegStraddle', label: '左腿外展', group: 'leftLeg', min: -30, max: 60 },
  { key: 'lLegTurn', label: '左腿扭转', group: 'leftLeg', min: -45, max: 45 },
  { key: 'lKneeBend', label: '左膝弯曲', group: 'leftLeg', min: 0, max: 150 },
  { key: 'rLegRaise', label: '右腿抬升', group: 'rightLeg', min: -90, max: 90 },
  { key: 'rLegStraddle', label: '右腿外展', group: 'rightLeg', min: -30, max: 60 },
  { key: 'rLegTurn', label: '右腿扭转', group: 'rightLeg', min: -45, max: 45 },
  { key: 'rKneeBend', label: '右膝弯曲', group: 'rightLeg', min: 0, max: 150 },
]
