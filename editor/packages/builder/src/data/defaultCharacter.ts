/**
 * 新建文档默认落场的角色。
 *
 * 按 name 认是过渡方案：素材库行的 assetId 才是稳定标识（重传换 key、改分类换排序，
 * id 都不变），但库里目前没有「默认角色」的显式标记。后端补上标记后改按标记取。
 */
export interface DefaultCharacterPreset {
  /** 与素材库 name 做 trim + 忽略大小写的精确比较 */
  name: string
  gender: string
  color: string
  posePresetId: string
}

export const DEFAULT_CHARACTER: DefaultCharacterPreset = {
  name: 'Female',
  gender: 'female',
  color: '#bababa',
  posePresetId: 'stand',
}

/** 种过默认角色的新稿会在 `extra.initialSeed` 打上它，宿主据此识别「还没被用户动过」。 */
export const INITIAL_DRAFT_SEED = 'default-character-v1'
