/**
 * 旧 25 旋钮姿势预设（19 个）。静态数据，不进 engine。
 * 检查器网格已改走姿势库（见 poseLibraryBank.ts）；本表只服务
 * 已落盘草稿里的 `stand` / `tpose` / `sit` 等 id。
 *
 * `stand` 的 25 个值与 `STAND_DEFAULTS` 逐项相同。
 *
 * 前 16 个在「姿势预设」面板 4×4 网格里展示；stretch / arms_crossed /
 * phone 三个标 `hidden: true`（数据可用、网格不渲染）。
 *
 * `controlValues` 只列非 0 项，缺的按 0 算；写进草稿时由 `applyPosePreset` 补齐 25 个键。
 * `rootOffsetY` 是坐 / 蹲 / 跪类预设要下沉的根节点高度（米），只有这 4 个预设有。
 */
export interface PosePreset {
  id: string
  /** 中文名，locale 缺 `pose.preset.<id>` 时的兜底 */
  name: string
  controlValues: Record<string, number>
  rootOffsetY?: number
  /** 预设表里有、但姿势预设网格不展示的项 */
  hidden?: boolean
}

export const POSE_PRESETS: PosePreset[] = [
  {
    id: 'stand',
    name: '站立',
    controlValues: {
      torsoBend: 2, headNod: -10, lArmRaise: -5, lArmStraddle: 12,
      rArmRaise: -5, rArmStraddle: 14, lElbowBend: 15, rElbowBend: 15,
    },
  },
  {
    id: 'tpose',
    name: 'T型',
    controlValues: {},
  },
  {
    id: 'walk',
    name: '行走',
    controlValues: {
      torsoBend: 3, torsoTurn: 5, headNod: -5, lArmRaise: 40,
      lArmStraddle: 9, rArmRaise: -8, rArmStraddle: 27, rArmTurn: -4,
      lElbowBend: 37, rElbowBend: 26, lLegRaise: -10, rLegRaise: 36,
      rLegStraddle: -2, lKneeBend: 22, rKneeBend: 41,
    },
  },
  {
    id: 'run',
    name: '跑步',
    controlValues: {
      bodyBend: -2, torsoBend: 3, torsoTurn: 5, headNod: -10,
      lArmRaise: -26, lArmStraddle: 23, lArmTurn: 14, rArmRaise: 23,
      rArmStraddle: 14, rArmTurn: 19, lElbowBend: 60, rElbowBend: 89,
      lLegRaise: 50, rLegRaise: -20, lKneeBend: 18, rKneeBend: 36,
    },
  },
  {
    id: 'sit',
    name: '坐姿',
    controlValues: {
      bodyBend: -5, torsoBend: 5, headNod: -5, lArmStraddle: 8,
      lArmTurn: 6, rArmStraddle: 15, rArmTurn: 16, lElbowBend: 80,
      rElbowBend: 80, lLegRaise: 90, lLegStraddle: 5, rLegRaise: 90,
      rLegStraddle: 5, lKneeBend: 90, rKneeBend: 90,
    },
    rootOffsetY: -0.28,
  },
  {
    id: 'crouch',
    name: '蹲下',
    controlValues: {
      bodyBend: 20, bodyTurn: 4, bodyTilt: 1, torsoBend: 32,
      torsoTilt: -3, headNod: -24, headTurn: -6, headTilt: 1,
      lArmRaise: 34, lArmStraddle: 18, lArmTurn: 18, rArmRaise: 34,
      rArmStraddle: 18, rArmTurn: -18, lElbowBend: 86, rElbowBend: 86,
      lLegRaise: 88, lLegStraddle: 12, lLegTurn: -3, rLegRaise: 88,
      rLegStraddle: 8, rLegTurn: 2, lKneeBend: 146, rKneeBend: 146,
    },
    rootOffsetY: -0.58,
  },
  {
    id: 'one_knee',
    name: '单膝跪',
    controlValues: {
      bodyBend: -4, bodyTurn: -2, bodyTilt: 6, torsoBend: 24,
      torsoTurn: -6, torsoTilt: -3, headNod: -10, headTurn: 3,
      headTilt: -2, lArmRaise: 14, lArmStraddle: 18, lArmTurn: 6,
      rArmRaise: 8, rArmStraddle: 18, rArmTurn: -4, lElbowBend: 70,
      rElbowBend: 42, lLegRaise: 82, lLegStraddle: 6, lLegTurn: 4,
      rLegRaise: -5, rLegStraddle: 6, rLegTurn: -8, lKneeBend: 86,
      rKneeBend: 130,
    },
    rootOffsetY: -0.54,
  },
  {
    id: 'two_knees',
    name: '双膝跪',
    controlValues: {
      bodyBend: 8, torsoBend: 6, headNod: -5, lArmRaise: -5,
      lArmStraddle: 7, rArmRaise: -5, rArmStraddle: 10, lElbowBend: 15,
      rElbowBend: 15, lLegRaise: -10, rLegRaise: -9, lKneeBend: 108,
      rKneeBend: 104,
    },
    rootOffsetY: -0.26,
  },
  {
    id: 'lean',
    name: '倚靠',
    controlValues: {
      bodyTilt: -5, torsoBend: -3, torsoTurn: 5, torsoTilt: -5,
      headNod: -10, headTurn: 10, headTilt: -5, lArmRaise: -5,
      lArmStraddle: 13, rArmRaise: -10, rArmStraddle: 16, lElbowBend: 15,
      rElbowBend: 20, lLegStraddle: 5, rLegRaise: 20, rLegTurn: 10,
      rKneeBend: 40,
    },
  },
  {
    id: 'bow',
    name: '鞠躬',
    controlValues: {
      bodyBend: 24, bodyTurn: 1, torsoBend: 30, torsoTilt: -1,
      headNod: 18, headTurn: -3, headTilt: 1, lArmRaise: -8,
      lArmStraddle: 8, rArmRaise: -8, rArmStraddle: 8, lElbowBend: 4,
      rElbowBend: 4, lKneeBend: 4, rKneeBend: 4,
    },
  },
  {
    id: 'think',
    name: '思考',
    controlValues: {
      bodyBend: -2, bodyTurn: 2, bodyTilt: 1, torsoBend: 7,
      torsoTurn: 2, torsoTilt: 1, headNod: 14, headTurn: 8,
      headTilt: -3, lArmRaise: 42, lArmStraddle: -8, lArmTurn: -10,
      rArmRaise: 8, rArmStraddle: 22, rArmTurn: 39, lElbowBend: 98,
      rElbowBend: 107, lLegStraddle: 4, rLegStraddle: 4,
    },
  },
  {
    id: 'fight',
    name: '格斗',
    controlValues: {
      bodyBend: 10, bodyTurn: -24, bodyTilt: 8, torsoBend: 18,
      torsoTilt: -4, headNod: -7, headTurn: 24, headTilt: -10,
      lArmRaise: 78, lArmStraddle: 24, lArmTurn: 8, rArmRaise: 82,
      rArmStraddle: 48, rArmTurn: 45, lElbowBend: 84, rElbowBend: 124,
      lLegRaise: 46, lLegStraddle: 18, lLegTurn: 8, rLegRaise: 34,
      rLegStraddle: 14, rLegTurn: -2, lKneeBend: 55, rKneeBend: 78,
    },
  },
  {
    id: 'kick',
    name: '踢球',
    controlValues: {
      bodyBend: -8, bodyTurn: -12, bodyTilt: -5, torsoBend: -10,
      torsoTurn: -16, torsoTilt: 8, headNod: 8, headTurn: -12,
      headTilt: 2, lArmRaise: -34, lArmStraddle: 34, lArmTurn: -8,
      rArmRaise: 42, rArmStraddle: 28, rArmTurn: 12, lElbowBend: 34,
      rElbowBend: 44, lLegRaise: -8, lLegStraddle: 3, lLegTurn: -4,
      rLegRaise: 104, rLegStraddle: 3, lKneeBend: 16, rKneeBend: 10,
    },
  },
  {
    id: 'throw',
    name: '投掷',
    controlValues: {
      bodyBend: 5, bodyTurn: -2, torsoBend: 4, torsoTurn: 15,
      torsoTilt: -5, headNod: -5, headTurn: -15, lArmRaise: 7,
      lArmStraddle: 17, rArmRaise: 77, rArmTurn: 90, lElbowBend: 88,
      rElbowBend: 96, lLegRaise: 15, lLegStraddle: 5, rLegRaise: -10,
      rLegStraddle: 5, lKneeBend: 26, rKneeBend: 36,
    },
  },
  {
    id: 'push',
    name: '推进',
    controlValues: {
      bodyBend: -1, torsoBend: 19, headNod: -5, lArmRaise: 100,
      lArmStraddle: 6, lArmTurn: 5, rArmRaise: 101, rArmStraddle: 11,
      lElbowBend: 14, lLegRaise: 41, rLegRaise: -15, lKneeBend: 35,
      rKneeBend: 10,
    },
  },
  {
    id: 'wave',
    name: '招手',
    controlValues: {
      torsoBend: 2, torsoTurn: -10, headNod: -5, headTurn: 15,
      headTilt: 5, lArmStraddle: 6, rArmRaise: 62, rArmStraddle: -10,
      rArmTurn: 90, lElbowBend: 62, rElbowBend: 94,
    },
  },
  // 以下 3 个在预设表里但 UI 网格未展示（hidden）。
  {
    id: 'stretch',
    name: '伸手',
    hidden: true,
    controlValues: {
      bodyBend: -5, torsoBend: -16, torsoTilt: 3, headNod: -25,
      lArmRaise: 115, lArmStraddle: -10, lArmTurn: 10, rArmRaise: 133,
      rArmStraddle: -10, rArmTurn: -10, lElbowBend: 59, rElbowBend: 53,
      lLegStraddle: 10, rLegStraddle: 10,
    },
  },
  {
    id: 'arms_crossed',
    name: '抱臂',
    hidden: true,
    controlValues: {
      torsoTurn: 2, headNod: -8, lArmRaise: 7, lArmStraddle: 22,
      lArmTurn: 17, rArmRaise: 8, rArmStraddle: 22, rArmTurn: 39,
      lElbowBend: 107, rElbowBend: 107, lLegStraddle: 5, rLegStraddle: 5,
    },
  },
  {
    id: 'phone',
    name: '看手机',
    hidden: true,
    controlValues: {
      torsoBend: 5, headNod: 17, lArmRaise: 55, lArmStraddle: -10,
      lArmTurn: -4, rArmRaise: 24, rArmStraddle: -10, rArmTurn: -13,
      lElbowBend: 89, rElbowBend: 43, lLegStraddle: 5, rLegStraddle: 5,
    },
  },
]

export const POSE_PRESET_BY_ID: Record<string, PosePreset> = Object.fromEntries(
  POSE_PRESETS.map((p) => [p.id, p]),
)
