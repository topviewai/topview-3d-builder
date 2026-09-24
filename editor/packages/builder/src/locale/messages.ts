import type { TranslateFn } from './types'

const MESSAGES: Record<string, string> = {
  "加载草稿…": "errors.loadingDraft",
  "就绪": "errors.ready",
  "连接中断，生成可能仍在进行，请稍后刷新": "errors.streamInterrupted",
  "当前浏览器不支持离线视频编码（需要 WebCodecs 的 H.264 或 VP9）。请改用最新版 Chrome 或 Edge。": "errors.videoUnsupported",
  "导出封装失败：没有生成视频数据": "errors.videoEmpty",
  "canvas.toBlob 返回 null": "errors.imageEmpty",
  "模型加载失败": "errors.modelLoad",
  "道具模型加载失败": "errors.propLoad",
  "路径不存在或点数不足": "errors.pathInvalid",
  "目标必须是角色、机位、道具或基础形状节点": "errors.pathTarget",
  "当前帧已到时间线末尾，无法生成走位片段": "errors.pathEnd"
}

const PREFIXES: Array<[string, string]> = [
  [
    "加载角色模型 ",
    "errors.loadingCharacter"
  ],
  [
    "加载动作 ",
    "errors.loadingMotion"
  ],
  [
    "加载失败: ",
    "errors.loadingFailed"
  ],
  [
    "动作加载失败: ",
    "errors.motionLoad"
  ],
  [
    "找不到相机 ",
    "errors.cameraMissing"
  ],
  [
    "找不到成片 ",
    "errors.filmMissing"
  ],
  [
    "无法解析成片帧 ",
    "errors.frameInvalid"
  ]
]

/** Localize known application messages; preserve host errors and user-authored text. */
export function localizeMessage(t: TranslateFn, value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? '')
  if (MESSAGES[message]) return t(MESSAGES[message])
  for (const [prefix, key] of PREFIXES) {
    if (message.startsWith(prefix)) return t(key, { detail: localizeMessage(t, message.slice(prefix.length)) })
  }
  return message
}
