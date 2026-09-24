# 成片剪辑 `content.editorial` 维护文档

> **这份文档是成片功能底层数据的权威说明**，后续逻辑按它维护。改行为前先改这里，再改代码。
>
> 与其它文档的分工：
>
> | 文档 | 管什么 |
> |---|---|
> | 本文件 | `editorial` 的语义、不变量、纯函数 API、事务 / 播放 / 导出入口契约、扩展流程 |
> | [`draft-format.md`](draft-format.md) §7.1 | 同一批字段的**速查表**，属于整份草稿格式的一节 |
> | [`architecture.md`](architecture.md) | 分层与依赖方向；**离线编码栈（Mediabunny）**见 §5.8 |
>
> 两边如有出入，以**代码 + 本文件**为准，并顺手修正 `draft-format.md`。

---

## 1. 心智模型：两条时间轴

整个功能只有一个核心概念——**源世界时间**和**成片时间**是两套坐标，永不混用。

```text
源世界（唯一一份，写在 content.timeline + content.nodes）
  frame:  0 ────────────────────────────────────────────── frameEnd
          角色动作 / 相机运动 / 路径行走 在同一时刻并行发生
          所有相机同时存在，随时可求值任意一帧

成片（editorial.sequences[i]，可以有多条并列版本）
  sequenceFrame: 0 ─────────────────────────── duration-1
          clips[0]          clips[1]        clips[2]
          camA @ 100..159   camB @ 40..99   camA @ 300..359
```

推论（这几条解释了 90% 的设计选择）：

1. 成片**不产生新内容**，只记录「第几段用哪个相机、取源世界的哪一段」。
2. 同一份源世界可以有多个成片版本（导演版 / 预告版 / 15 秒版），它们共享 `nodes`、`environment`、`timeline`，只复制剪辑决定。
3. 剪辑**永远不改源世界**。要改角色动作或相机运动本身，回 Scene 模式改 `timeline`，或整份草稿另存。
4. `timeline.animation.cameraMotionClips` 是**源世界里的相机运动**，不是成片顺序。🚫 禁止用它表达剪辑。
5. `evaluateFrame()` 只吃源世界帧，**永远不读 `editorial`**。成片播放 = 先把成片帧映射成源帧，再调用同一个 `evaluateFrame`。

---

## 2. 数据模型（wire 契约）

```jsonc
{
  "content": {
    "timeline": { "fps": 30, "frameStart": 0, "frameEnd": 1996, "...": "源世界" },
    "editorial": {
      "version": 1,
      "activeSequenceId": "sequence_main",
      "sequences": [
        {
          "id": "sequence_main",
          "name": "导演剪辑版",
          "clips": [
            {
              "id": "edit_clip_mx8f2a_q3k9d1",
              "cameraNodeId": "user_cam_1789376711353",
              "sourceFrameStart": 100,
              "sourceFrameEnd": 159
            }
          ]
        },
        { "id": "sequence_trailer", "name": "15s Trailer", "clips": [] }
      ]
    }
  }
}
```

TypeScript 定义在 `packages/builder/src/contract/types.ts`：

```ts
export interface EditSequenceClip {
  id: string
  cameraNodeId: string
  sourceFrameStart: number  // 闭区间起点
  sourceFrameEnd: number    // 闭区间终点
}
export interface EditSequence {
  id: string
  name?: string
  clips: EditSequenceClip[]
}
export interface EditorialData {
  version: 1
  activeSequenceId: string
  sequences: EditSequence[]
}
```

### 2.1 字段语义

| 字段 | 必填 | 语义与约束 |
|---|---|---|
| `editorial.version` | 是 | 剪辑域 schema 版本，当前恒为 `1`。**不是**成片修订号，也不等于 `content.version` |
| `editorial.activeSequenceId` | 是 | 重新打开草稿时默认编辑的版本。只表示**编辑焦点**，不表示「主交付版本」。必须指向存在的 `sequences[].id` |
| `editorial.sequences` | 是 | 至少一条。数组顺序只用于版本列表展示，不影响任何播放结果 |
| `sequence.id` | 是 | 在 `sequences` 内唯一。重命名、换序、切 active 都不得改它 |
| `sequence.name` | 否 | 用户可见名称。存在时不能是纯空白。**缺省不写默认名**——UI 显示本地化文案，不把 "Sequence 1" 落盘 |
| `sequence.clips` | 是 | 该版成片的剪辑实例。**数组顺序就是播放顺序**，是唯一权威排序。空数组 = 还没剪 |
| `clip.id` | 是 | 在**整个 `editorial`**（跨 sequence）内唯一。同一源段重复插入必须是不同 ID |
| `clip.cameraNodeId` | 是 | 指向 `content.nodes[].id` 且该节点 `type === "camera"`。只存引用，不复制相机名 / 镜头参数 |
| `clip.sourceFrameStart` | 是 | 源世界首帧，整数 |
| `clip.sourceFrameEnd` | 是 | 源世界末帧，整数，`>= sourceFrameStart` |

### 2.2 持久化边界：只存「不能可靠派生的决定」

| 持久化 | 不持久化（每次从数据算） |
|---|---|
| Sequence / Clip ID | Clip 时长、秒数、Sequence 总时长 |
| 可选 `name` | Clip 在成片上的起点 `sequenceStart`、排序号 |
| `cameraNodeId` 引用 | 相机名称、fov、宽高比 |
| `sourceFrameStart/End` | 播放头、选中态、时间轴缩放、拖拽预览、新建草稿（`FilmAddDraft`） |
| `clips` 数组顺序 | 缩略图 |

🚫 往 `editorial` 里写任何可派生量，都会在「源数据改了但派生量没改」时产生不一致，这是本设计明确要避免的。

---

## 3. 不变量（Invariants）

Review 和写代码时按编号引用。任何改动都不得破坏这几条。

| # | 不变量 |
|---|---|
| **I1** | `sequences.length >= 1`。最后一条版本不允许删，只允许清空 `clips` |
| **I2** | `sequence.id` 在 `sequences` 内唯一；`clip.id` 在**整个** `editorial` 内唯一 |
| **I3** | `activeSequenceId` 必须命中某条 `sequences[].id`。删除 active 版本时，必须在**同一个文档事务**里把它切到相邻版本 |
| **I4** | `clip.sourceFrameEnd >= clip.sourceFrameStart`，两者都是整数 |
| **I5** | `[sourceFrameStart, sourceFrameEnd]` 必须落在 `[timeline.frameStart, timeline.frameEnd]` 内 |
| **I6** | `clip.cameraNodeId` 指向的节点存在且 `type === 'camera'`；相机被删后 clip **保留 dangling 引用**（见 §7.3） |
| **I7** | 成片顺序只由 `clips` 数组顺序决定，没有第二处排序来源 |
| **I8** | 剪辑操作只写 `content.editorial`，绝不写 `content.timeline` / `content.nodes` |
| **I9** | 一次用户操作 = 一条文档事务 = 一条 Undo（拖拽全过程只入栈一次，见 §8） |
| **I10** | 播放 / 导出底层 API 必须**显式收 `sequenceId`**，不得隐式读 `activeSequenceId` |

---

## 4. 时间映射（唯一算法）

### 4.1 区间约定

- 源范围是**闭区间**：`[sourceFrameStart, sourceFrameEnd]`，首尾都播。
- 成片累计用**半开区间**：第 i 段占 `[cursor, cursor + duration)`，切点属于**后一段**，不重复播源帧。

```text
durationFrames(clip) = sourceFrameEnd - sourceFrameStart + 1
sequenceDuration     = Σ durationFrames(clip)   // 只累加 > 0 的
```

`sequenceFrame` 从 `0` 起算，有效区间 `[0, sequenceDuration - 1]`。

### 4.2 `resolveEditSequenceFrame(clips, sequenceFrame)`

成片帧 → 源帧的**唯一**映射，播放和导出必须共用它，禁止各自再写一份累加：

```ts
{
  clipId: string          // 命中的 clip
  cameraNodeId: string    // 该帧用哪个相机
  sourceFrame: number     // = clip.sourceFrameStart + clipLocalFrame
  clipIndex: number
  clipLocalFrame: number  // 段内第几帧，从 0 起
}
```

边界行为（改动时必须保持）：

- `sequenceFrame` 非整数或 `< 0` → 返回 `null`。
- 超出总时长 → 返回 `null`（调用方自己决定是停播还是回头）。
- `duration <= 0` 的 clip 被**跳过**，不占成片时间（正常数据不会出现，脏数据下保证不死循环）。

### 4.3 时码

`packages/builder/src/evaluate/timecode.ts`，格式固定 `HH:MM:SS:FF`：

- `formatTimecode(frame, fps)`：`fps` 会被 `Math.max(1, Math.round(fps))` 兜底；帧数负值按 0 处理。
- `parseTimecode(value, fps)`：严格匹配 `^(\d+):(\d{2}):(\d{2}):(\d{2})$`；`mm > 59`、`ss > 59`、`ff >= fps` 一律返回 `null`（由 UI 决定是回退旧值还是报错）。

时码是**展示层**概念，任何持久化字段都存帧，不存秒、不存时码字符串。

---

## 5. 读写规则：旧草稿只读，写时才落盘

这是 `editorial` 可选（`editorial?: EditorialData`）带来的唯一复杂度，处理方式是固定的两个函数：

| 场景 | 函数 | 行为 |
|---|---|---|
| **读**（渲染 UI、算时长、校验） | `getEditorial(document)` | 缺省时返回一份**临时**默认值 `{ version: 1, activeSequenceId: 'sequence_1', sequences: [{ id: 'sequence_1', clips: [] }] }`，**不写回文档** |
| **写**（任何 ops 之前） | `materializeEditorial(document)` | 有则深拷贝，无则生成上面的默认值。ops 在这份拷贝上改，成功后整体替换 `content.editorial` |

结论：

- 打开一份 2024 年的老草稿、只看不剪 → 文件不会被改动，不会产生「打开即 dirty」。
- 第一次真正剪辑 → 通过正常文档事务写入完整 `editorial`。
- `makeEmptyDraft()` 生成的新草稿**直接带**空 `editorial`（`contract/emptyDraft.ts`），所以新草稿不走降级路径。

### 5.1 ID 分配

```ts
allocateSequenceId(editorial) // "sequence_<base36 时间戳>_<6 位随机>"
allocateClipId(editorial)     // "edit_clip_<base36 时间戳>_<6 位随机>"
```

- 分配前会 `collectIds()` 扫全量已用 ID，最多重试 32 次，撞满抛错（实际不可能发生）。
- **复制版本**（`duplicateSequence`）必须先把副本插进数组、再逐个分配新 clip ID，否则新 ID 可能和副本自身的旧 ID 撞（这是历史上真踩过的坑）。
- 任何写操作入口都会先 `hasDuplicateIds()` 体检，发现外部塞进来的重复 ID 直接 `{ ok: false, error: 'duplicate-id' }`，不尝试自动改名。

---

## 6. 纯函数层 API（`packages/builder/src/evaluate/`）

这一层**不依赖 React / engine / stores**，可在 Node、脚本、Agent 侧直接用。从包根按 `@topview/3d-builder/evaluate` 导出。

### 6.1 查询（`editSequence.ts`）

| 函数 | 说明 |
|---|---|
| `getEditorial(doc)` | 读，带降级（§5） |
| `getEditSequence(doc, sequenceId)` | 找一条版本，找不到返回 `null` |
| `getClipDurationFrames(clip)` | `end - start + 1` |
| `getEditSequenceDurationFrames(clips)` | 总时长，跳过非正时长 |
| `resolveEditSequenceFrame(clips, sequenceFrame)` | §4.2 |
| `validateEditorial(doc, options?)` | 领域校验，返回 issue 数组（§7.2） |

### 6.2 操作（`editSequenceOps.ts`）

全部是**纯函数**：输入 `document`，输出新的 `editorial`，**不修改传入文档**，也不碰历史栈。

```ts
type EditOpResult =
  | { ok: true; editorial: EditorialData; createdId?: string }
  | { ok: false; error: EditOpError; issues?: EditSequenceIssue[] }
```

| 函数 | 关键语义 |
|---|---|
| `createSequence(doc, { name?, activate? })` | 追加到末尾；`activate` 缺省 `true` |
| `renameSequence(doc, id, name)` | `name` 传 `null` 或空白 → 删除 `name` 字段（回到本地化默认名） |
| `duplicateSequence(doc, id, { activate? })` | 副本插在原版**之后**，新 sequence ID + 全量新 clip ID |
| `deleteSequence(doc, id)` | 只剩一条时返回 `last-sequence`；删的是 active 时自动切到 `index - 1` 的邻居（I3） |
| `activateSequence(doc, id)` | 只改 `activeSequenceId` |
| `clearSequenceClips(doc, id)` | 清空 `clips`，保留版本（配合 I1） |
| `insertEditClip(doc, { sequenceId, cameraNodeId, sourceFrameStart, sourceFrameEnd, index? })` | `index` 缺省追加到末尾，允许 `0..clips.length`；返回 `createdId` |
| `updateEditClip(doc, clipId, patch)` | `patch` 可含 `cameraNodeId` / `sourceFrameStart` / `sourceFrameEnd`；只有显式传 `cameraNodeId` 才校验相机 |
| `moveEditClip(doc, clipId, toIndex)` | **先摘除再插入**，所以 `toIndex` 是「移除后数组」的目标下标，合法区间 `0..clips.length - 1` |
| `duplicateEditClip(doc, clipId, { index? })` | 缺省插在原 clip 之后 |
| `deleteEditClip(doc, clipId)` | 只删 clip，不动版本 |
| `defaultInsertRange(doc, sourceFrame, spanFrames = 60)` | 生成一段默认入出点。窗口能放下就从 `sourceFrame` 起；后面不够长则按同样时长截机位尾巴 |
| `findEditClip(editorial, clipId)` | 跨 sequence 定位：`{ sequence, sequenceIndex, clipIndex }` |
| `clipSequenceSpan(clips, index)` | 算某段在成片上的 `{ sequenceStart, duration }`（UI 布局用，不落盘） |
| `getActiveEditSequence(doc)` | `sequences` 里匹配 `activeSequenceId` 的那条 |
| `playbackIssues(doc, sequenceId)` | 能否播 / 能否导出的判定（§7.2） |

### 6.3 错误码 `EditOpError`

| 错误码 | 触发条件 |
|---|---|
| `no-document` | 传入 `null` 文档 |
| `missing-editorial` | 保留码（当前降级逻辑下不会触发） |
| `missing-sequence` / `missing-clip` | 目标 ID 不存在 |
| `last-sequence` | 试图删掉唯一一条版本（I1） |
| `duplicate-id` | 入参文档里已有重复 ID（I2 体检失败） |
| `invalid-name` | 保留码，当前 `renameSequence` 用空白 → 清除语义，不报错 |
| `active-sequence-missing` | 保留码。同名的 issue 由 `validateEditorial` 报（§7.2），ops 侧不返回它——`deleteSequence` 会自动维护 active 指针 |
| `invalid-index` | 插入 / 换序下标越界或非整数 |
| `invalid-camera` | `cameraNodeId` 不存在或节点 `type !== 'camera'`（I6） |
| `invalid-range` | 取整后仍然 `end < start` 或越出 `timeline`（I4 / I5）。**注意是拒绝，不是夹紧**——夹紧只发生在 `defaultInsertRange` |

---

## 7. 三层校验

三层职责不重叠，不要在其中一层重复实现另一层。

### 7.1 结构层：Zod（`contract/validate.ts`）

读盘时拦明显坏结构：`version` 必须字面量 `1`、ID 非空串、`name` 非空白、帧是整数、`sourceFrameEnd >= sourceFrameStart`、`sequences` 至少一条。全部 `.passthrough()`，未知字段原样保留（向前兼容）。

`packages/builder/schema/director-document.schema.json` 是同一份约束的 JSON Schema 镜像，供外部（含 Agent 侧）校验用。注意它**表达不了** Zod 的两条 refine——`name` 非空白与 `sourceFrameEnd >= sourceFrameStart`，这两条只有走 Zod 或 `validateEditorial` 才会被拦。

### 7.2 领域层：`validateEditorial(doc, options?)`

Zod 看不到跨字段关系（相机是否存在、ID 是否唯一、帧是否越界），由它负责。

```ts
validateEditorial(doc, {
  sequenceId?: string,   // 只校验这一条，且要求它存在
  requireClips?: boolean // 把空版本记成 issue（编辑中允许空，播放时不允许）
})
```

| issue code | 含义 | 阻断播放 / 导出 |
|---|---|---|
| `empty-editorial` | `sequences` 为空 | 是 |
| `missing-sequence` | 指定 `sequenceId` 不存在 | 是 |
| `empty-sequence` | 版本里没有 clip（仅 `requireClips` 时报） | 是 |
| `duplicate-sequence-id` / `duplicate-clip-id` | 违反 I2 | 是 |
| `missing-camera` | 违反 I6（相机被删或类型不对） | 是 |
| `non-integer-frame` | 违反 I4 | 是 |
| `inverted-range` | `end < start` | 是 |
| `out-of-timeline` | 违反 I5 | 是 |
| `active-sequence-missing` | 违反 I3 | 否（只影响默认焦点，UI 提示即可） |

`playbackIssues(doc, sequenceId)` = `validateEditorial(doc, { sequenceId, requireClips: true })` 去掉 `active-sequence-missing`。**它是播放按钮禁用态和导出前置检查的唯一判据。**

### 7.3 修复策略：只报告，不自动改

**这条是硬规则。** 失效相机、越界区间、坏 active 指针一律保留原样 + 结构化报告，因为：

- 用户删相机常常是误操作，dangling 引用保住了「撤销删除」和「换个机位」两条恢复路径；自动删 clip 会把用户的剪辑决定一起吃掉。
- 自动夹紧越界区间会在 `timeline.frameEnd` 变短又改回来时静默改写用户入出点。

UI 的处理方式是：标红该 clip、禁用该版本的播放与导出、把 issue 文案本地化后展示。Agent 侧同理——**报错让人决策，不要替人修数据**。

---

## 8. 会话层与 Undo（`sync/filmWorkspace.ts`）

纯函数层只产出新的 `editorial`；把它落进文档 + 入历史栈的唯一出口是 `FilmWorkspace.commitEditorial(label, result)`：

```text
ops 返回 ok → snapshotDocState(docModel) 抓 before（content + userKeys + fcurves）→ 写 content.editorial → docModel.touch() → pushDocSnapshot(label, before)
```

规则：

| 规则 | 说明 |
|---|---|
| **一次操作一条 Undo** | 添加 / 裁剪 / 换序 / 复制 / 删除 / 切版本，各自一条快照（I9） |
| **拖拽只入栈一次** | `beginFilmDrag` 记下基线文档与 `revision`，`previewFilmDrag` 期间**只改 UI 预览态和 Program 预览画面，不碰文档**，`commitFilmDrag` 才调 ops 并经 `commitEditorial` 入栈一次。拖拽中途 `revision` 变了（撤销 / 外部改动）→ 自动 `cancelFilmDrag` 丢弃这次拖拽 |
| **新建草稿不入文档** | `FilmAddDraft`（机位 + 入出点）是纯 UI 态，只有 `commitFilmAddDraft` 调 `insertEditClip` 才落盘。草稿存在时它**优先于选中片段**决定预览与「预览选段」的范围 |
| **选中即弃草稿** | 选中已有 clip 时自动清掉草稿，避免编辑卡停在「新镜头」不跟手 |
| **锁** | `exporting` 或拖拽预览进行中时，`locked === true`，所有写操作直接 return；模式切换也被拒 |
| **文档变更后自检** | `handleDocumentChange()` 会丢弃已不存在的选中 clip，并刷新 Program 预览 |

模式切换（`setWorkspaceMode`）保存 / 恢复 Scene 现场：进入 Film 时记住 `frame / cameraId / selection / followMode / 左右面板开合`，收起两侧面板、关 orbit、开 Program 预览；退出时原样恢复，**不记忆 Film 模式下的面板状态**。

---

## 9. 播放与导出契约

### 9.1 Program 预览（引擎 facade）

```ts
engine.beginProgramPreview()
engine.previewProgramFrame(sourceFrame, cameraId)  // 求值某源帧 + 临时跟随某相机
engine.endProgramPreview()
```

硬约束：**不得改写 Scene 的 `currentFrame` / `activeCameraId`**。Scene 与 Film 是两套时钟，退出 Film 必须能原样回到进入前的那一帧那个机位。Film 的高频播放头走 `FilmPlaybackController`（`rAF` + 外部订阅，模式 `idle | sequence | source`），不进 MobX，避免每帧全局重渲。

两条源轴动作的边界不同，别混：

| 动作 | 夹取范围 | 理由 |
|---|---|---|
| `seekFilmSource(frame)`（拖源条播放头 / 逐帧） | 整条时间轴 `[frameStart, frameEnd]` | 源条是整条素材，找画面时必须能走出入出点 |
| `playSource(start, end)`（预览选段） | 当前片段 / 草稿的入出点 | 预览的就是这一段；播放头落在区间外时回到 `start` |

### 9.2 导出（`engine/io/VideoRecorder.ts`）

编码栈、库与时间戳规则见 [`architecture.md`](./architecture.md) §5.8。本节只定成片入口契约。

```ts
engine.recordSequence({ sequenceId, label, width, height, fps, userKeys, ..., signal, onProgress })
```

- **显式收 `sequenceId`**（I10），不读 active。
- 开头先跑 `playbackIssues`，有问题**直接抛第一条 issue 的 message**，不导出半成品。
- 逐帧 `sequenceFrame = 0 .. total-1`，每帧经 `resolveEditSequenceFrame` 拿到 `sourceFrame + cameraNodeId` 后复用与 Scene 导出同一套 `renderExportFrame`。
- 文件时长必须等于 `total / fps`（恒定帧率）。时间戳由编码器按 `i / fps` 写入，不按墙钟。
- 文件名 `${label}_${sequenceId}_${width}x${height}.mp4`（`video/mp4`）；探测不到 AVC 时才降 WebM，见 §5.8。`onProgress` 回传 `clipId / sourceFrame / cameraNodeId`，便于 UI 显示「正在导出第几个镜头」。
- 取消走 `AbortSignal`；调用方的 `AbortController` 必须放在 `useRef`，否则 React StrictMode 双调会把上一轮的 controller abort 掉（历史 bug）。取消不交付半成品。
- 分辨率由宽高比推导（`widthFromAspectHeight(height, engine.resolvedAspect())`），不落盘。

Scene 的 `recordRange`（单机位连续帧段）和 Film 的 `recordSequence` 是两个入口，共用同一套离线编码器，互不干扰。

---

## 10. Agent / 脚本集成指南

### 10.1 推荐姿势：用 ops，不要手写 JSON

```ts
import { insertEditClip, validateEditorial } from '@topview/3d-builder/evaluate'

// 逐条加镜头：每次都把上一次的 editorial 写回 doc 再继续，ID 唯一性才有保证
let doc = draft
for (const shot of plan) {
  const r = insertEditClip(doc, {
    sequenceId: shot.sequenceId,
    cameraNodeId: shot.cameraNodeId,
    sourceFrameStart: shot.in,
    sourceFrameEnd: shot.out,           // 闭区间！时长 = out - in + 1
  })
  if (!r.ok) throw new Error(`insert failed: ${r.error}`)
  doc = { ...doc, content: { ...doc.content, editorial: r.editorial } }
}

// 交付前必须自检
const issues = validateEditorial(doc)
if (issues.length) throw new Error(issues.map((i) => i.message).join('\n'))
```

理由：ops 已经内置了 ID 分配、唯一性体检、相机类型校验、范围校验、`activeSequenceId` 维护。手写 JSON 意味着把 §3 的十条不变量全部自己扛。

### 10.2 生成剪辑方案时的硬约束

- 帧是**闭区间**：想要 2 秒（30fps）就是 `out = in + 59`，不是 `+ 60`。
- 每段都要落在 `[timeline.frameStart, timeline.frameEnd]` 内，越界是拒绝不是夹紧。
- `cameraNodeId` 必须是 `content.nodes` 里 `type === 'camera'` 的节点 id，不要用相机的显示名。
- 需要运镜 → 去源世界加 `timeline.animation.cameraMotionClips`，再用成片段截取它；**不要**试图在 `editorial` 里表达运动。
- 需要另一版剪法 → `createSequence` / `duplicateSequence`，不要复制整份草稿（除非要改源世界）。
- 不要写 `name: "Sequence 1"` 这类默认名，留空让 UI 出本地化文案。

### 10.3 反模式速查

| 🚫 反模式 | 后果 |
|---|---|
| 在 `editorial` 里存秒数 / 时长 / 成片起点 | 源数据一改就不一致（§2.2） |
| 用 `cameraMotionClips` 表达镜头顺序 | 污染源世界，多版本剪辑直接不成立 |
| 自动删除 dangling clip / 自动夹紧越界区间 | 静默吞掉用户决定（§7.3） |
| 播放 / 导出隐式用 `activeSequenceId` | 导出到错误版本（I10） |
| 拖拽过程中每帧写文档 | Undo 栈被拖拽噪声灌满（I9） |
| 直接 `setState` 改 clip 字段绕过 ops | 绕过唯一性与范围校验，脏数据落盘 |
| 在 `evaluateFrame` 里读 `editorial` | 破坏「成片不产生新内容」的分层，golden 基线会炸 |
| 给 `editorial` 加 `revisions[]` 之类历史快照 | 历史属于宿主文档版本系统，不属于剪辑域 |

---

## 11. 当前边界与扩展流程

### 11.1 v1 明确不做

单条顺序 clip 列表 + 硬切。**没有** Track、Gap、Transition、变速、音频、嵌套 Sequence、关键帧化的剪辑参数。

不提前写空壳字段——真出现需求时再升级。

### 11.2 要加字段 / 升 `version` 时的改动清单

按顺序改完这几处，缺一处就会出现「某一层认这个字段、另一层丢掉它」：

1. `packages/builder/src/contract/types.ts` — TS 类型
2. `packages/builder/src/contract/validate.ts` — Zod schema
3. `packages/builder/schema/director-document.schema.json` — JSON Schema 镜像
4. `packages/builder/src/contract/emptyDraft.ts` — 新草稿初值（若涉及）
5. `packages/builder/src/evaluate/editSequenceOps.ts` — ops 读写逻辑。注意 `duplicateSequence` / `duplicateEditClip` 用 JSON 深拷贝，新字段会**自动带过去**；若新字段要求唯一（类似 `id`），必须显式重新分配
6. `packages/builder/src/evaluate/editSequence.ts` — 若新字段影响时长或映射，改 `resolveEditSequenceFrame` / 校验
7. `docs/film-editorial.md`（本文件）+ `docs/draft-format.md` §7.1
8. 测试：`evaluate/__tests__/editSequence*.test.ts`，必要时补 `sync/__tests__/filmSession.test.ts`

升 `editorial.version` 时额外要求：写明旧版本的读取降级路径，**不得**让老草稿打开即报错。

### 11.3 测试基线

| 文件 | 覆盖 |
|---|---|
| `evaluate/__tests__/editSequence.test.ts` | 时长、成片帧映射、校验与 issue 码 |
| `evaluate/__tests__/editSequenceOps.test.ts` | 全部 ops 的成功路径与错误码、ID 唯一性 |
| `evaluate/__tests__/timecode.test.ts` | 时码格式化 / 解析边界 |
| `sync/__tests__/filmSession.test.ts` | 事务粒度、拖拽只入一次栈、失效版本禁播、Film 逐帧不影响 Scene 时钟 |
| `engine/__tests__/filmPlayback.test.ts` | 播放时钟模式切换与播放头边界 |
| `evaluate/__tests__/golden.test.ts` | `evaluateFrame` 逐字节基线——**改了剪辑逻辑它也必须不变**，变了说明污染了源世界求值 |

改动 `editorial` 相关代码后按 AGENTS.md §4 全跑：

```bash
pnpm typecheck && pnpm lint && pnpm test:evaluate && pnpm build
```

`docs/samples/golden/` 禁止默默 regenerate。
