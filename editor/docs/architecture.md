# 3D 导演台架构设计

> **本文档是目标架构的权威源。** 它描述"应该长成什么样"，与当前代码现状无关。
> 全部结论来自对小云雀 Scene3D Editor 运行时行为与数据格式的观测，以及可嵌入包的工程约束。

各文档管一件事，互不重复：

| 文档                                         | 管什么                                             | 变更规则             |
| -------------------------------------------- | -------------------------------------------------- | -------------------- |
| [`AGENTS.md`](../AGENTS.md)（仓库根）        | **协作**——分支、合入方向、门禁、包/宿主边界红线    | 唯一权威源，先读它   |
| [`draft-format.md`](./draft-format.md)       | **数据契约**——持久化 JSON 的字段、语义、求值规则   | 改字段先改这里       |
| **`architecture.md`**（本文档）              | **目标架构**——分层、依赖方向、关键接口、运行时设计；离线视频导出栈（Mediabunny）见 §5.8 | 改分层先改这里       |
| [`film-editorial.md`](./film-editorial.md)   | **成片剪辑契约**——两条时间轴、播放 / 导出入口；编码实现不写在那里，指向 §5.8 | 改 editorial 语义先改那里 |
| [`assets-manifest.md`](./assets-manifest.md) | **素材清单**——S3 key 布局、骨架/重定向约束、素材库接口  | 加素材先改这里       |
| [`workbench.md`](./workbench.md)             | **宿主实现**——apps/studio 的草稿存储与工作台形态   | 只描述宿主，不定义包 |

第 12 节的达成度矩阵是本文档与实际代码之间唯一的对账表。任何阶段完成后必须更新它，否则目标态文档会在两三个阶段内和代码脱节，变成摆设。

**怎么读这份文档**：§4.1 的目标树、§3.x 的接口示例描述的是**目标形态**，文件名与签名
未必等于当前代码。要写代码时，当前形态以 `packages/builder/src/index.ts`（导出面）、
`host/types.ts`（adapter 接口）为准，§4.4 记录了已发生的改名。

**矩阵里标 `—` 不等于待办**：outline 描边已明确**取消**，不要去实现（相关条目下方
有标注）。旋转 / 缩放 handle 与 two-bone IK 已解禁并落地，见 §12。其余未收敛项先问维护者。

---

## 1. 定位与约束

### 1.1 交付形态

**一个可嵌入的 npm 包 `@topview/3d-builder`，不是独立应用。**

`apps/studio` 是开发调试台兼模拟宿主，不是产品。它存在的意义是让导演台能脱离宿主独立开发，并在开发期就暴露 SSR、动态导入、`"use client"`、样式层叠这类只在真实集成时才出现的问题。它的形态就是真实宿主的形态：工作台首页管列表 / 新建，点开一份草稿在当前页以 **overlay** 挂 `DirectorStudio`（详见 [`workbench.md`](./workbench.md)）。

已知宿主形态不同，这决定了包必须与宿主彻底解耦：

| 宿主             | 形态                                                  | 特点                   |
| ---------------- | ----------------------------------------------------- | ---------------------- |
| 首个宿主         | 无限画布上的节点，点开为 `document.body` 全屏 overlay | 有协同房、持久化、tRPC |
| 第二宿主（待定） | 普通 React 项目的独立页面或弹窗                       | 无画布、无协同         |

包本身对两者一无所知，宿主能力全部经 `HostAdapter` 注入（§3.5）。

单包而非多包：内部靠目录分层 + ESLint 强制依赖方向，得到与多包等价的约束力，但省掉多包永远同版本发布的协调成本。将来若出现"只要引擎不要 UI"的真实需求（服务端离屏渲染、CLI 批量导出），`evaluate/` + `engine/` 两层可以原样拆出独立包——分层设计已经为此预留了边界。

### 1.2 两个硬约束

**其一，Three.js 不能 SSR。** Three 在模块顶层访问 `window` / `document`，服务端渲染直接 `ReferenceError`。作为可嵌入包这一条不能指望宿主处理，要在包内闭环：产物自带 `"use client"` banner。宿主若在 Server Component 里挂载仍需自己加一层 `'use client'` 边界——Next.js App Router 规定 `next/dynamic` 的 `ssr: false` 不允许在 Server Component 中使用。这是宿主侧唯一的 SSR 义务，写进集成文档即可。

**其二，状态库绝不能碰每帧状态。** 播放时 60fps × 30 个节点 × 9 个属性分量 ≈ **每秒 1.6 万次写入**。这些字段一旦是 observable，所有订阅组件都会被拖进重渲染。逐帧变化的值必须是普通 JS 字段，走 §2.6 的独立订阅通道。这条与选哪个状态库无关，MobX、zustand、Recoil 一视同仁。

### 1.3 三条不可妥协的正确性要求

这三条排在所有性能与优雅性考量之前。违反任何一条，产品就是坏的。

**求值必须是纯函数。** 同一 `frame` 求值两次，结果必须逐位相同。不依赖 RAF 的 `deltaTime`，不依赖上一帧的残留状态，不依赖调用顺序。否则导出视频和实时预览会对不上——而这个 bug 只有在用户导出成片后才会被发现。

**导出与预览必须同源。** 导出走离屏 renderer，但求值管线、曲线采样、骨骼重定向必须与预览共用同一份代码。任何"导出专用分支"都是未来不一致的种子。

**三条求值语义红线**（依据 [`draft-format.md`](./draft-format.md) §14 与小云雀线上逐帧对账）：

| 语义           | 正确行为                                                        | 常见误实现     |
| -------------- | --------------------------------------------------------------- | -------------- |
| 运镜曲线       | **绝对值**，段与段之间不做偏移衔接                              | 以为要链式衔接 |
| fcurve 缺手柄  | 段 1/3 处补**水平自动切线**；两端都缺等价 smoothstep `t²(3−2t)` | 回退成 linear  |
| 路径 clip 区间 | `[frameStart, frameEnd)`，**末帧不生效**                        | 写成闭区间     |

这三条全部落在求值层。§2.4 把求值层设计成零 three 的纯函数，直接目的就是让这三条能在 Node 里写断言——本项目没有数值对账工具链，这是唯一可行的红线防护手段。

---

## 2. 分层与依赖

### 2.1 分层结构

```
contract/  ─┬─→ evaluate/ ─────────────┐
  （底座）   ├─→ data/                  ├─→ engine/ ─→ bridge/ ─→ components/
            ├─→ document/ ─┬─→ sync/ ──┘                            ↑
            ├─→ stores/ ───┘                                        │
            └─→ host/ ──────────────────────────────────────────────┘
```

| 层            | 职责                                     | 关键特征                   |
| ------------- | ---------------------------------------- | -------------------------- |
| `contract/`   | 持久化类型、序列化、版本迁移、校验       | **零运行时依赖**           |
| `evaluate/`   | 帧求值、曲线采样、运镜烘焙、重定向计算   | **零 three**、纯函数       |
| `engine/`     | Three 场景图、渲染、交互、资产加载、导出 | 零 React、零状态库         |
| `document/`   | 可编辑文档模型、命令、撤销、事务         | observable，不知道渲染存在 |
| `stores/`     | 编辑器意图（选中、播放、面板、视口模式） | observable，不持有文档数据 |
| `sync/`       | 把 document / stores 的变化绑到 engine   | 唯一的绑定点               |
| `bridge/`     | React 生命周期 ↔ 引擎生命周期           | 很薄                       |
| `components/` | React UI                                 | 看不到 Three 类型          |
| `host/`       | 宿主能力契约 + 包内默认实现              | 只定接口                   |
| `data/`       | 静态预设库（机位、运镜、姿势）           | 纯数据                     |
| `styles/`     | CSS 与设计变量                           | 自包含                     |

### 2.2 依赖规则（ESLint 强制，见附录）

| 层            | 允许依赖                                                  | 禁止                                | 这条禁令买到了什么                            |
| ------------- | --------------------------------------------------------- | ----------------------------------- | --------------------------------------------- |
| `contract/`   | —                                                         | 一切                                | 契约有依赖就不再是契约                        |
| `evaluate/`   | contract、data                                            | **three**、react、状态库            | 可在 Node / worker / 测试里跑；红线可断言     |
| `engine/`     | contract、evaluate、data、three                           | react、状态库、**document**、stores | `new Engine()` 即可跑；不持有 observable 引用 |
| `document/`   | contract、evaluate、mobx                                  | react、three、engine                | 文档模型不知道渲染存在                        |
| `stores/`     | contract、evaluate、document、mobx                        | react、three、engine                | 编辑器意图与渲染解耦                          |
| `sync/`       | contract、document、stores、engine、mobx                  | react                               | 唯一绑定点，所有 reaction 集中在此            |
| `bridge/`     | engine、host、react                                       | 状态库、three                       | React ↔ 引擎的生命周期适配                   |
| `components/` | contract、evaluate、stores、document、bridge、host、react | three、**直接引用 engine**          | UI 看不到 Three 类型                          |
| `host/`       | contract                                                  | 其它所有层                          | 宿主契约独立可替换                            |
| `data/`       | contract（仅类型）                                        | 其它所有层                          | 静态数据无副作用                              |

`contract/` 与 `evaluate/` 是**谁都可以依赖的底座**——零依赖的类型和纯函数被任何层引用都不会产生耦合，这正是把它们做成零依赖、零 three 所换来的东西。上表里没有任何一层禁止它们。

外加一条跨层的可嵌入底线：**包内任何位置不得出现 `fetch` / `localStorage` / `sessionStorage`**，一律经 `HostAdapter`。破一次就回不去了。


### 2.3 为什么 contract 与 document 必须分开

"引擎能不能依赖文档层"这个问题之所以难回答，是因为"文档"一词被用来指两个生命周期完全不同的东西：

|        | wire format                  | in-memory editable model        |
| ------ | ---------------------------- | ------------------------------- |
| 是什么 | 持久化 JSON 的类型与序列化   | observable 对象树 + 命令 + 撤销 |
| 稳定性 | 必须稳定，破坏性变更要版本号 | 随编辑器功能频繁演进            |
| 谁需要 | 引擎、求值、宿主、后端       | 只有编辑器 UI                   |

正确答案是"引擎依赖前者，不依赖后者"。合成一个目录就表达不出来，于是依赖规则必然自相矛盾。拆开之后：

- `engine → contract` 合法且必须——引擎要知道场景长什么样
- `engine ↛ document` 是硬禁令——引擎若持有 observable 引用，会在遍历场景时意外触发 reaction，也无法在 Node 或 worker 里跑，测试还得先构造一个 observable 文档才能启动

这条禁令在引入 MobX 之前就要立住，否则等 `document/` 变成 observable 那天，依赖图已经长歪了。

### 2.4 为什么 evaluate 与 engine 必须分开

三条独立理由，任一条都足以支撑这次拆分。

**求值是纯数学，Three 只是结果的消费者。** fcurve 三次贝塞尔采样、关键帧插值、运镜曲线烘焙、路径插值、骨骼重定向的矩阵运算——这些全部可以用普通数组和标量完成。把它们和 `Object3D` 操作混在一个目录里，是把"计算什么"和"画在哪"两件事绑死。

**导出场景要求求值脱离 WebGL。** 后台逐帧 `evaluate` 生成帧序列时不需要任何 GL context 在场。求值层零 three 之后，这条路径天然成立，不需要为导出准备一套"无渲染模式"。

**三条语义红线全在求值层。** 零 three 意味着可以在 Node 里直接 `import { evaluateFrame }` 然后对曲线端点、区间边界、切线方向写断言。这是本项目唯一可行的红线回归手段。

**唯一看似无法纯化的点是 FBX 动作采样**——它依赖 `AnimationMixer`，天然带 three。解法是不让求值层自己采样，而是输出**播放指令**：

```ts
// evaluate 输出："节点 X 播 clip Y 的第 Z 秒"
{
  motionPlayback: [{ nodeId, clipId, timeSeconds, weight }];
}

// engine 执行
mixer.setTime(timeSeconds);
```

求值层决定"播什么、播到哪一刻"，引擎执行采样。这样求值层 100% 纯、100% 零 three，没有例外分支。

### 2.5 状态读写规则

| 操作                     | 读                      | 写                                                     |
| ------------------------ | ----------------------- | ------------------------------------------------------ |
| Inspector 数值框         | 直接读 observable       | 输入过程中直改（preview），blur / Enter 时提交 command |
| Gizmo 拖拽               | 引擎直接操作 Three 对象 | 拖拽中直改 observable，松手时提交一条 command          |
| 时间轴关键帧增删改       | 直接读                  | 必须走 command                                         |
| 添加 / 删除 / 重父级节点 | 直接读                  | 必须走 command                                         |
| 播放头位置               | 非 observable，见 §2.6  | —                                                      |

一句话概括：**读永远直接读，写在交互过程中可以直改、在交互结束时必须落成一条 command。**

这是专业编辑器的标准做法——一次拖拽产生几百个中间值，它们不该各占一格撤销栈，只有最终结果入历史。

开发期加一道断言防止绕过：

```ts
// document/devGuard.ts
if (isDev()) {
  deepObserve(doc, (change, path) => {
    if (!Transaction.isActive() && !Interaction.isActive()) {
      console.warn('[document] 绕过 command 直接写入', path, change);
    }
  });
}
```

### 2.6 currentFrame 的特殊通道

当前帧号是唯一"既是 UI 状态又是高频状态"的值，必须拆成两条通道：

- **高频通道**：引擎内部的普通字段，每帧变化。需要跟手的消费者（时间轴播放头、帧号数字）通过引擎事件拿到值后用 ref 直接改 DOM，不经过 React 渲染。
- **节流通道**：引擎按固定间隔（建议 100ms）发 `frame:throttled` 事件，React 侧用 `useSyncExternalStore` 订阅。Inspector 这类展示求值结果的面板走这条。

验收判据是可量化的：播放一整条时间轴，React commit 次数应当 ≈ 节流事件数，而不是帧数。

---

## 3. 关键接口

### 3.1 契约层

`contract/` 是 [`draft-format.md`](./draft-format.md) 的 TypeScript 实现。它只有类型、纯函数和常量，没有类实例、没有状态。

```ts
// contract/types.ts —— 与 draft-format.md 字段一一对应
export interface SceneContract {
  meta: { fps: number; frameStart: number; frameEnd: number };
  nodes: readonly NodeContract[];
  timeline: TimelineContract;
}

// contract/serialize.ts
export function parseScene(json: unknown): SceneContract; // 含 zod 校验
export function serializeScene(scene: SceneContract): unknown;

// contract/migrate/
export function migrateToLatest(json: unknown): unknown; // v1 → v2 → ...
```

契约层**不做任何 URL 解析**。资产引用在契约里是不透明标识（S3 key / assetId / 相对路径），解析成可加载 URL 是 `HostAdapter.resolveMediaUrl` 的职责。这条是包内零路径硬编码的前提。

### 3.2 求值层

```ts
// evaluate/evaluateFrame.ts
export function evaluateFrame(
  scene: SceneContract,
  frame: number,
  out: FrameSnapshot // 调用方预分配，复用缓冲，零分配
): void;

export interface FrameSnapshot {
  /** 每个节点的最终 transform */
  transforms: Map<NodeId, TransformValue>;
  /** 角色骨骼姿态（语义旋钮求值结果，非 FBX 采样） */
  poses: Map<NodeId, BonePose[]>;
  /** 动作播放指令，由 engine 执行 mixer.setTime */
  motionPlayback: MotionPlaybackCommand[];
  /** 激活相机的求值结果 */
  camera: { position: Vec3; lookAt: Vec3; fov: number } | null;
}
```

`out` 参数是刻意的：60fps 下每帧 new 一个 Map 加几十个对象会产生持续 GC 压力，播放时表现为周期性掉帧。预分配缓冲由引擎持有并复用。

**求值管线的执行顺序决定叠加优先级**，后面的层覆写前面的层。这个顺序由数据结构反推得出，改动顺序会直接产生逐帧位姿偏差：

```
1. 角色复位到静态 transform
2. 动作 clip → 输出 motionPlayback 指令；无 clip 则摆 pose
   异构骨架的重定向映射在此计算
3. 官方 fcurves 覆写根 transform（仅被 K 过的分量）
4. 道具 / group / primitive 复位
5. 路径走位 pathMotionClips（与 fcurves 同源时让位，只贡献 yaw；必须在静态复位之后，否则道具 / 基础形状走位会被盖掉）
6. 用户关键帧覆写（非相机节点）
7. 相机：运镜 clip → camera fcurves 覆写 → 用户关键帧覆写
8. 写入 FrameSnapshot
```

### 3.3 引擎门面

UI 永远只看到这个接口，看不到 Three 类型。**门面不接收 `document` 或 `stores`**——参数一律是契约类型或标量，observable → 契约的转换由 `sync/` 负责。

下面是**目标签名**。当前门面在 `engine/DirectorEngine.ts`（接口，由 `core/Stage.ts`
`implements`），实际方法是 `load` / `setEvalContext` / `setFcurves` / `addRuntimeNode` /
`captureFrame` 等，尚未收敛到这个形状——以代码为准。

```ts
// 目标形态（当前实现见 engine/DirectorEngine.ts）
export class DirectorEngine {
  static create(opts: EngineOptions): DirectorEngine; // 不吃 document / stores
  dispose(): void;

  // 场景图对账
  reconcile(nodes: readonly NodeContract[]): void;
  applySnapshot(snapshot: FrameSnapshot): void;

  // 视口挂载（由 bridge/useViewportAttach 调用）
  attachViewport(role: 'main' | 'preview', canvas: HTMLCanvasElement): void;
  detachViewport(role: 'main' | 'preview'): void;

  // 时钟
  seek(frame: number): void;
  play(direction: 'forward' | 'reverse'): void;
  pause(): void;

  // 编辑器意图（标量入参，不是 store 引用）
  setActiveCamera(nodeId: string | null): void;
  setSelection(nodeIds: readonly string[]): void;
  setTransformMode(mode: TransformMode): void;

  // 只读查询：返回普通对象，不是 Three 实例
  getNodeSnapshot(nodeId: string): NodeSnapshot | null;
  pickAt(x: number, y: number): string | null;

  // 输出
  captureFrame(opts: CaptureOptions): Promise<Blob>;
  recordRange(opts: RecordOptions): Promise<Blob>;

  // 反向通道
  on<E extends EngineEventName>(e: E, fn: EngineEventHandler<E>): () => void;
  invalidate(): void;
}

type EngineEventName =
  | 'frame' // 每帧，高频，只给 ref 直改 DOM 用
  | 'frame:throttled' // 节流帧，给 React 用
  | 'loading'
  | 'error';
```

引擎→UI 的反向通道不用状态库。引擎内部维护一个极薄的通知点，在场景发生需要 UI 感知的变化时调 `invalidate()`，`bridge/` 用 `useSyncExternalStore` 订阅。

### 3.4 sync 层

引擎不认识 mobx，绑定集中在这一个文件里。这是"引擎零状态库"这个设计的代价与兑现点——代价是多一层薄绑定，收益是引擎完全可移植。

```ts
// sync/DocumentSync.ts
export class DocumentSync {
  private disposers: IReactionDisposer[] = [];

  constructor(
    doc: DirectorDocument,
    stores: RootStore,
    engine: DirectorEngine
  ) {
    // 节点增删 → 场景图对账。注意传出去的是契约快照，不是 observable
    this.disposers.push(
      reaction(
        () => doc.toContract().nodes,
        (nodes) => {
          engine.reconcile(nodes);
          engine.invalidate();
        },
        { fireImmediately: true }
      )
    );

    // 静态 transform 变化 → 重求值当前帧
    this.disposers.push(
      reaction(
        () => doc.nodes.map((n) => n.transformSignature),
        () => {
          engine.seek(engine.currentFrame);
          engine.invalidate();
        }
      )
    );

    // 编辑器意图 → 引擎（全部标量入参）
    this.disposers.push(
      reaction(
        () => stores.selection.nodeIds.slice(),
        (ids) => {
          engine.setSelection(ids);
          engine.invalidate();
        }
      )
    );
    this.disposers.push(
      reaction(
        () => stores.viewport.transformMode,
        (m) => {
          engine.setTransformMode(m);
          engine.invalidate();
        }
      )
    );
    this.disposers.push(
      reaction(
        () => stores.viewport.activeCameraId,
        (id) => {
          engine.setActiveCamera(id);
          engine.invalidate();
        }
      )
    );
    this.disposers.push(
      reaction(
        () => stores.playback.isPlaying,
        (p) => (p ? engine.play('forward') : engine.pause())
      )
    );
  }

  dispose() {
    this.disposers.forEach((d) => d());
  }
}
```

`doc.toContract()` 这一步是关键：跨过 `sync/` 边界的永远是不可变契约快照，observable 对象绝不进入引擎。

### 3.5 HostAdapter

包内**禁止**出现任何 `fetch`、`localStorage`、上传逻辑、埋点，全部经这个接口拿。它的形状决定第二个宿主的接入成本，所以宁可设计得笨一点、显式一点。

#### 边界判据：包只处理单数

决定一个能力该不该进包，只看它作用在**一份文档**还是**一批文档**上：

| 能力                                         | 归属                            | 理由                                                         |
| -------------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `loadDocument(id)` / `saveDocument(id, doc)` | 包（adapter）                   | 作用于当前这一份；编辑在包内发生，必须有一条把变更交出去的路 |
| `makeEmptyDraft()`                           | 包（导出纯函数）                | 「空文档长什么样」是 schema 知识；但**存到哪里由宿主决定**   |
| `createInitialDraft()`                       | 包（经 adapter 取素材）         | 「新建出来的默认场景长什么样」同属包的知识，避免各宿主分叉   |
| 列表 / 新建 / 删除 / 重命名 / 权限 / 回收站  | 宿主，包完全不感知              | 集合操作，包永远用不到                                       |
| 草稿列表 UI、草稿切换下拉                    | 宿主                            | 同上，属集合操作的表现层                                     |
| 素材库内容（角色 / 道具 / 动作）             | 宿主，经 adapter `searchAssets` / `listAssetFacets` | 包不得内置任何具体资产 key                       |
| 资产 key 工具（前缀判定、归一化）            | 包可导出为**可选 helper**       | 见下                                                         |

倒数第二行是同一条原则的延伸：**包不得硬编码任何具体资产**。三类素材必须对称——
`searchAssets` 与 `listAssetFacets` 都按 kind 工作，不能只给某一类提供接口，否则「添加角色」
就会重新绑死在某个特定 glb 上，换个宿主就是死链。

#### 哪些知识属于包：看它跟着包走还是跟着项目走

包导出一些帮宿主实现 adapter 的工具是合理的，能降低接入成本。判断某个符号该内置还是外置，用的是**语义判据**——这份知识跟着包走，还是跟着项目走？

官方素材的 key 前缀 `3d-builder/library/` 跟着包走（engine 与 host 共用
`LIBRARY_ASSET_PREFIX`）。私有 bucket 布局、签名方式跟着项目走，由宿主实现
`resolveAssetUrl`。包内没有公共 CDN 兜底。

曾经存在的两个默认人物 key 常量属于第三类——既不跟包走也不跟项目走，它们是**两个具体的模型文件**。被"添加角色"当默认模型用时，包就只能加载这两个模型，因此已清除；现在角色一律来自 `adapter.searchAssets({ kind: 'character', ... })`。

一个容易用反的机械判据是"包内是否零使用"：它只能回答"移走会不会坏"，不能回答"应该放哪"。按它推理会把 `assetKeys` 整体判成可外移，从而让每个宿主重新实现同一套前缀判断。

因此包内**不得**保存任何"有哪些文档"的表。包只认宿主给的 `documentId`，不关心它背后是文件、对象存储还是数据库行；载入只有 `adapter.loadDocument(documentId)` 一条路，不允许包内维护第二份映射再择一使用——双源必然漂移，而且未知 id 会静默回落到某份默认文档，宿主传错 id 时不报错反而打开了别的内容。

新建文档因此不是包的一个功能：宿主调 `createInitialDraft()`（或要纯空稿时 `makeEmptyDraft()`）拿到文档 → 自己存 → 得到新 id → 挂载 `<DirectorStudio documentId={newId}>`。对包而言这只是又一次普通载入。默认角色同样不是硬编码资产：`createInitialDraft` 走 `adapter.searchAssets({ kind: 'character' })` 取库里的条目，取不到就只留相机。

```ts
export interface HostAdapter {
  // —— 文档：只有单数，没有任何集合操作 ——
  loadDocument(documentId: string): Promise<DirectorDocument>;
  /** fcurve 与文档分离存储时实现；宿主把两者存在一起则省略 */
  loadFCurves?(documentId: string): Promise<unknown | null>;
  /** 保存当前文档。只读宿主可不实现，包相应禁用保存入口而不是报错 */
  saveDocument?(documentId: string, doc: DirectorDocument): Promise<void>;

  /** 保存用户关键帧，与 loadFCurves 对称 */
  saveFCurves?(documentId: string, data: unknown): Promise<void>;

  // —— 资源解析：素材一律需宿主签名，包内无公共 CDN 兜底 ——
  /** 素材 key → 可拉取 URL；省略则 resolveAssetUrl() 抛错 */
  resolveAssetUrl?(key: string): ResolvedUrl;
  /** 按 MediaRef 整段覆盖；省略则走 resolveMediaKey + resolveAssetUrl */
  resolveMediaUrl?(ref: MediaRef): ResolvedUrl;

  // —— 素材库：服务端分页与 facets，三类必须对称 ——
  searchAssets(query: AssetQuery): Promise<AssetPage<LibEntry>>;
  listAssetFacets(kind: AssetQuery['kind']): Promise<AssetFacets>;

  // —— 产物去处：可能是画布节点，也可能是下载 ——
  onExport?(blob: Blob, meta: ExportMeta): Promise<void>;
}
```

三条设计约束。**所有可选能力都要有包内默认行为**——`saveDocument` 缺省即禁用保存入口，`onExport` 缺省即走浏览器下载，否则第二个宿主为了跑起来要被迫实现一堆它不关心的东西。**不要把宿主概念漏进接口**——没有 `nodeId`、没有 `canvasId`，只有 `documentId`，宿主自己做映射。**`onClose` 不进 adapter**，它是 props，因为它是 UI 生命周期而非宿主能力。

#### 资源解析：key 约定内置，URL 一律宿主签名

`3d-builder/library/` 是官方素材库的 S3 key 前缀，跟着包走
（`contract/assetKeyPrefixes.ts`）。用户私有素材（`canvas/`、`3d-builder/user/`）
同样只存 key。取 URL 必须由宿主签名，包内没有公共 CDN、也没有 `publicAssetBase`。

```
官方素材 key 前缀           → 包内置 LIBRARY_ASSET_PREFIX
用户级 / 私有资源           → 同样只存 key，由宿主 resolveAssetUrl 签名
签名、鉴权、私有 bucket      → 宿主实现，包无从推断
```

最小可用宿主必须实现 `searchAssets` / `listAssetFacets` **以及** `resolveAssetUrl`。
本仓的 `apps/studio` 是纯本地宿主：`resolveAssetUrl` 把 key 映射到本机素材清单里的文件，不签名、不联网（见 [`studio-host.md`](./studio-host.md)）。
`resolveMediaKey` 遇到 http(s)、相对路径、裸文件名会显式抛错，不猜测。

尚未落地、但接口预留了演进空间的三项：`saveDocument` 现在是整份覆盖，将来宿主需要乐观并发时可加 `commit(documentId, tx)` 事务式提交（§5.7）；`t` / `toast` / `track` 目前用包内实现，宿主有自己的一套时再开放；资产库上传（`assets.upload`）等宿主真有资产中心时再加。三者都是**新增可选方法**，不破坏现有实现。

---

## 4. 目录结构

### 4.1 目标目录树

```
packages/builder/src/
├── index.ts                      # 唯一出口，导出面见 §8.2
├── DirectorStudio.tsx            # 唯一 UI 入口，填满宿主给的容器
│
├── contract/                     # ★ 零依赖底座
│   ├── types.ts                  #   节点 / clip / fcurve / transform 类型
│   ├── serialize.ts              #   parse / serialize
│   ├── validate.ts               #   zod schema
│   ├── migrate/                  #   版本迁移
│   └── emptyScene.ts             #   空白模板
│
├── evaluate/                     # ★ 零 three 纯函数
│   ├── evaluateFrame.ts          #   帧求值管线总入口（§3.2 八步）
│   ├── FrameSnapshot.ts          #   快照类型 + 预分配工厂
│   ├── curves/
│   │   ├── FCurveSet.ts          #   compact-v1 解析 + 三次贝塞尔 + 牛顿反解
│   │   ├── KeyframeTrack.ts      #   用户关键帧，8 种插值
│   │   └── BakedCurve.ts         #   毫秒域烘焙曲线采样
│   ├── camera/
│   │   ├── bakeMotion.ts         #   运镜预设参数 → 7 条曲线
│   │   └── targetPolicy.ts       #   前置条件门控
│   ├── path/
│   │   └── samplePath.ts         #   折线 timeRatio 插值
│   └── retarget/
│       ├── RetargetMap.ts        #   骨骼名映射表
│       └── solveRetarget.ts      #   世界系增量 FK 矩阵运算
│
├── engine/                       # ★ Three 运行时，零 React、零状态库
│   ├── index.ts                  #   DirectorEngine 门面（§3.3）
│   ├── core/
│   │   ├── Stage.ts              #   场景图 + reconcile
│   │   ├── Renderer.ts           #   WebGLRenderer 封装 + context lost 恢复
│   │   ├── Viewport.ts           #   一个视口 = camera + controls + scissor 区域
│   │   ├── RenderLoop.ts         #   invalidate 去重、按需渲染
│   │   ├── Clock.ts              #   帧时钟 + 节流发布
│   │   ├── Layers.ts             #   EDITOR_LAYER 隔离辅助对象
│   │   └── EventBus.ts
│   ├── objects/                  #   Three 实例，与 contract 节点一一对应
│   │   ├── ObjectFactory.ts
│   │   ├── CharacterObject.ts    #   含 AnimationMixer
│   │   ├── CameraObject.ts
│   │   ├── PropObject.ts
│   │   ├── PrimitiveObject.ts
│   │   ├── GroupObject.ts
│   │   └── PathObject.ts
│   ├── rig/                      #   碰 Bone 的部分（纯计算在 evaluate/retarget）
│   │   ├── HumanoidRig.ts        #   骨骼槽位抽象
│   │   ├── RigDetector.ts        #   mixamorig / ccBase / generic / unknown
│   │   ├── RigCompatibility.ts   #   missingBones / invalidChains
│   │   ├── applyPose.ts          #   语义旋钮求值结果 → 骨骼旋转
│   │   └── applyRetarget.ts      #   求值矩阵 → 目标骨架
│   ├── interact/
│   │   ├── OrbitController.ts
│   │   ├── Picker.ts
│   │   ├── BoxSelect.ts
│   │   ├── FreeWalk.ts           #   WASD + QE
│   │   ├── ViewHelper.ts         #   坐标轴导航球
│   │   └── Snapping.ts
│   ├── io/
│   │   ├── AssetLoader.ts        #   GLTF/FBX + DRACO/KTX2/Meshopt
│   │   ├── LoaderPool.ts         #   并发控制 + 模板缓存 + SkeletonUtils.clone
│   │   ├── normalize.ts          #   ★ 坐标系与单位归一化，见 §5.5
│   │   ├── Screenshot.ts         #   离屏 renderer + toBlob
│   │   └── VideoRecorder.ts      #   离线逐帧导出；Mediabunny + WebCodecs，见 §5.8
│   ├── gizmo/
│   │   └── CameraGizmo.ts        #   机身线框 + 视锥 + 吊线
│   └── debug/
│       └── PerfOverlay.ts        #   fps / frame / cpuMs
│
├── document/                     # ★ observable 文档模型
│   ├── DirectorDocument.ts       #   根模型 + revision + toContract()
│   ├── model/                    #   数据模型，非 Three 对象
│   │   ├── SceneNode.ts          #   基类
│   │   ├── CharacterNode.ts  CameraNode.ts  PropNode.ts
│   │   ├── PrimitiveNode.ts  GroupNode.ts   PathNode.ts
│   │   └── Environment.ts
│   ├── timeline/
│   │   ├── TimelineModel.ts
│   │   ├── CameraMotionClip.ts  MotionClip.ts  PathMotionClip.ts
│   ├── commands/
│   │   ├── types.ts              #   Command 接口 + 联合类型
│   │   ├── nodeCommands.ts       #   add/delete/move/rotate/scale/reparent
│   │   ├── timelineCommands.ts   #   关键帧增删改、clip 拖拽
│   │   └── registry.ts
│   ├── Transaction.ts            #   baseRevision 乐观并发（未落地，见 §4.4）
│   ├── History.ts                #   undo / redo，分级快照 + 栈长上限（见下）
│   └── devGuard.ts               #   开发期直写检测
│
├── stores/                       # ★ 编辑器意图，不持有文档数据
│   ├── RootStore.ts
│   ├── setup.ts                  #   enableStaticRendering
│   ├── SelectionStore.ts
│   ├── PlaybackStore.ts          #   isPlaying / 方向 / 循环（不含 currentFrame）
│   ├── ViewportStore.ts          #   viewMode / transformMode / 吸附 / 画幅
│   ├── PanelStore.ts
│   ├── AssetStore.ts
│   └── PersistStore.ts
│
├── sync/
│   └── DocumentSync.ts           #   唯一绑定点（§3.4）
│
├── bridge/                       #   React ↔ Engine，很薄
│   ├── EngineProvider.tsx        #   引擎实例化 + dispose
│   ├── StoreProvider.tsx         #   每实例一份 store，绝不模块级单例
│   ├── HostProvider.tsx
│   ├── useEngine.ts
│   ├── useEngineEvent.ts         #   订阅引擎事件，自动解绑
│   ├── useFrameDisplay.ts        #   节流帧号
│   └── useViewportAttach.ts      #   canvas ref → 引擎挂载
│
├── components/                   #   observer 组件，组织规则见 §6
│   ├── Layout.tsx                #   面板栅格，不读业务 observable
│   ├── utils.ts                  #   跨面板工具函数
│   ├── topbar/                   #   每个面板一个目录，即使当前只有一个文件
│   ├── leftrail/
│   ├── viewport/                 #   含 CameraPreview
│   ├── timeline/                 #   Ruler / TrackRow / ClipBlock / Playhead
│   ├── inspector/                #   含 PosePanel
│   ├── library/                  #   资产库面板
│   ├── dialogs/                  #   Export / NewDraft
│   ├── common/                   #   表单控件从第一天就放这里，其余出现 3 次再抽
│   └── overlay/                  #   容器外壳、引导、HUD toast 默认实现
│
├── host/
│   ├── types.ts                  #   HostAdapter 接口（§3.5）
│   └── defaults.ts               #   可选能力的包内默认实现
│
├── data/                         #   静态预设库
│   ├── cameraPresets.ts          #   15 机位
│   ├── cameraMotions.ts          #   30 运镜
│   └── posePresets.ts            #   20 姿势
│
└── styles/                       #   按面板拆，tsup 合并输出单个 styles.css（§6.6）
    ├── tokens.css                #   全部 --t3d-* 变量默认值，必须自带 fallback
    ├── base.css
    ├── timeline.css
    ├── inspector.css
    └── library.css
```

### 4.2 命名约定

`document/model/CameraNode.ts` 是**数据**，`engine/objects/CameraObject.ts` 是**Three 实例**，两者一一对应但绝不混用。**`Node` 后缀 = 数据，`Object` 后缀 = 渲染实例。** 契约层的类型用 `Contract` 后缀（`NodeContract`），与 observable 模型区分。

CSS 变量与**类名**都统一 `t3d-` 前缀，与任何宿主的命名脱钩。类名格式
`t3d-<面板>-<元素>`，理由与迁移方式见 §6.6——裸类名（`.panel` / `.viewport`）
在可嵌入包里是硬伤，不是风格问题。`tokens.css` 必须自带全部变量默认值——引用
宿主变量却不写 fallback，搬到新宿主会直接失色。

### 4.3 与小云雀观测特征的对应

逆向时观测到的运行时标识与本设计的落点对照，便于逐项验证复刻完整度：

| 小云雀观测特征                                                                     | 本设计落点                                                              |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 引擎主模块（193 KB，零状态库依赖）                                                 | `engine/DirectorEngine.ts`（门面接口）+ `engine/core/Stage.ts`（实现）  |
| `runtimeStore.invalidate()`                                                        | `engine/core/RenderLoop.ts`                                             |
| `xyq-scene3d-canvas`                                                               | `engine/core/Viewport.ts`（主视口实例）                                 |
| `xyq-scene3d-camera-preview-canvas`                                                | `engine/core/Viewport.ts`（预览视口实例）                               |
| `xyq-scene3d-performance-overlay`                                                  | `engine/debug/PerfOverlay.ts`                                           |
| `controlGestureCoordinator`                                                        | ~~`engine/interact/GestureCoordinator.ts`~~ 已取消（无 gizmo 即无争抢） |
| `characterPoseV2Editor`（25 语义控件 + 20 预设）                                   | `engine/rig/applyPose.ts` + `data/posePresets.ts`                       |
| `_chains` / `_polePositions` / `_targetQuaternions` / `_spine`                     | ~~`engine/rig/IKSolver.ts`~~ 已取消，不复刻                             |
| `invalidChains` / `missingBones` / `status: compatible`                            | `engine/rig/RigCompatibility.ts`                                        |
| 节点类型 `biz/scene3d-director`                                                    | 宿主侧节点，包不感知                                                    |
| 文档类型 `biz/scene3d-director-document`                                           | `contract/types.ts` + `contract/validate.ts`                            |
| `/api/.../list_assets`                                                             | `HostAdapter` 的三个 `load*Library` 方法                                |
| `/api/.../upload_file`                                                             | 不进包：上传属于宿主（§3.5）                                            |
| `DRAFT_ID_MISMATCH` / `STALE_REVISION` / `EMPTY_TRANSACTION` / `REVISION_CONFLICT` | `document/Transaction.ts`                                               |
| EffectComposer → Render → Outline → Output                                         | ~~`engine/postfx/Composer.ts`~~ 已取消，直接 render                     |

### 4.4 目标态与当前实现的差异

§4.1 的目录树是**设计基准**，不是现状快照。当前实现与它有若干处出入，都是"体量未到、合并更简单"或"该能力尚无需求"，不涉及正确性。列在这里，避免读者对照代码时以为文档已失效。

| §4.1 目标态                                                                          | 当前实现                                                                    | 性质                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contract/serialize.ts`                                                              | 无                                                                          | 未落地：没有 `parseScene` / `serializeScene`。载入靠 `validate.ts`（zod）+ 直接读字段；`contract/parser.ts` **是另一回事**——它是 `findNode` / `nodesOfType` / `findMotionClipAt` 这类草稿查询 helper，不是序列化层 |
| `contract/emptyScene.ts`                                                             | `contract/emptyDraft.ts`                                                    | 命名（全仓统一用 draft）                                                                                                                                                                                           |
| `contract/migrate/`                                                                  | 无                                                                          | 未落地：尚无历史版本需要迁移。`migrateToLatest` 不存在，也没导出                                                                                                                                                   |
| `engine/index.ts`（门面）                                                            | `engine/DirectorEngine.ts`（接口）+ `engine/core/Stage.ts`（`implements`）  | 命名：门面是接口而非类，`Stage` 是唯一实现                                                                                                                                                                         |
| `evaluate/retarget/solveRetarget.ts`                                                 | `engine/rig/applyRetarget.ts` 的 `Ual1Retargeter`                           | 移位：重定向要碰 `Bone`，放不进零 three 的 `evaluate/`。`evaluate/retarget/` 只留纯映射表 `RetargetMap.ts`                                                                                                         |
| `evaluate/camera/targetPolicy.ts`                                                    | 门控内联在 `evaluate/camera/bakeMotion.ts`                                  | 未拆：单一判断，独立文件收益未显现                                                                                                                                                                                 |
| `engine/io/normalize.ts`                                                             | 无                                                                          | 未落地                                                                                                                                                                                                             |
| `host/defaults.ts`                                                                   | 无                                                                          | 未落地：默认解析在 `host/resolve.ts`，无默认 toast / track 实现                                                                                                                                                    |
| `document/DirectorDocument.ts`                                                       | `document/DirectorDoc.ts`                                                   | 命名：类叫 `DirectorDoc`，避免与 wire 类型 `DirectorDocument` 撞名                                                                                                                                                 |
| `stores/RootStore.ts`                                                                | `stores/EditorStore.ts`                                                     | 见下一行                                                                                                                                                                                                           |
| `bridge/` 下 `EngineProvider` / `StoreProvider` / `HostProvider` / `useFrameDisplay` | `bridge/DirectorContext.tsx` 的 `DirectorProvider` + `OverlayCloseProvider` | 合并：一个 Provider 装齐，未按依赖拆四份                                                                                                                                                                           |
| `components/leftrail/`                                                               | 无该目录                                                                    | 未落地                                                                                                                                                                                                             |
| `document/model/` + `document/timeline/`                                             | `document/DirectorDoc.ts` 单文件                                            | 未拆：体量未到 §6.4 阈值                                                                                                                                                                                           |
| `document/Transaction.ts`                                                            | 无                                                                          | 未落地：当前 `saveDocument` 整份覆盖，无乐观并发需求                                                                                                                                                               |
| `document/devGuard.ts`                                                               | 无                                                                          | 未落地                                                                                                                                                                                                             |
| `stores/` 下 7 个 Store                                                              | `stores/EditorStore.ts` 单店                                                | 合并：拆分收益未显现，拆前需先确认 observer 粒度（§6.2）                                                                                                                                                           |
| `sync/` 只有 `DocumentSync.ts`                                                       | 另有 `StudioSession.ts`、`libraryActions.ts`                                | 多出两个，职责仍属 sync 层（会话编排、素材操作）                                                                                                                                                                   |
| `data/cameraPresets.ts` + `cameraMotions.ts` + `posePresets.ts`                      | `data/cameraLibrary.ts` + `poseControls.ts`                                 | 合并                                                                                                                                                                                                               |

一处**不是分叉而是设计选择**，需要说明：`History` 采用**分级快照**而非纯命令式（存逆操作）。高频路径（拖拽、关键帧）只快照 `userKeys`，低频路径（节点增删）快照完整 `content`；配合 `beginInteraction` / `endInteraction` 事务，一次拖拽在释放时只入栈一条。纯命令式内存更省，但每个操作都要手写正确的逆操作，出错时表现为"撤销后状态悄悄不对"，代价高于收益。快照的内存风险由 `MAX_HISTORY = 50` 的栈长上限兜住。

---

## 5. 运行时设计

### 5.1 按需渲染

不要无条件 RAF。空闲时 GPU 占用应降到接近零——多个导演台实例共存时尤其重要。

```ts
requestRender() {
  if (this.disposed || this.webGLContextLost || this.renderFrameId !== undefined) return
  this.renderFrameId = requestAnimationFrame(() => {
    this.renderFrameId = undefined
    this.forceRender()
  })
}
```

门卫里除了 `disposed` 还必须有 `webGLContextLost`，见 §5.4。

### 5.2 生命周期与 dispose

开发模式下 `useEffect` 执行两次。引擎是重资源（WebGL context 上限 8–16 个），`dispose()` 必须彻底，且**顺序不能错**：

```ts
dispose(): void {
  this.documentSync.dispose()        // 先断 reaction，否则下面的清理会触发回调
  this.renderLoop.stop()
  this.scene.traverse(o => {
    o.geometry?.dispose()
    materials(o).forEach(m => { m.map?.dispose(); m.dispose() })
  })
  this.renderers.forEach(r => { r.dispose(); r.forceContextLoss() })
}
```

三条与宿主形态无关的硬约束：每个导演台实例占 2 个 context（主视口 + 相机预览），宿主允许多开时超过 4 个就要把非激活实例降级为静态缩略图；未激活实例必须完全停掉渲染循环，否则多个 rAF 互相拖累；引擎实例必须可多开、可销毁、销毁后无残留监听。

### 5.3 指针仲裁

OrbitControls、TransformGizmo、框选、自由走位会争抢同一个 `pointerdown`。不做仲裁的典型表现是拖 gizmo 的同时相机也在转。

做法是在捕获阶段（`addEventListener('pointerdown', fn, true)`）先跑一轮 `test()`，让各控件声明是否要接管，胜出者 `claim()` 之后其余控件在本次手势内让位。这个问题拖到后期再补会很痛，应在交互能力落地的第一天就建立仲裁层。

### 5.4 WebGL context lost

长时间会话、切后台、显卡驱动重置都会丢 context。必须监听 `webglcontextlost` / `webglcontextrestored`，lost 期间让所有渲染请求短路返回，restored 后重建 renderer 与 composer。

漏了这个的症状是：用户切出去开会，回来画布全黑且再也不恢复。

多视口时若要做九宫格，改用**单 renderer + scissor 多视口**，不要开 N 个 context。

### 5.5 坐标系与单位归一化

**内部统一 Y-up、米、右手系。** 所有外部资产在 `engine/io/normalize.ts` 入口处一次性归一化，之后的任何层都不再做坐标转换：

- FBX 动作：厘米 → 米，缩放 ×0.01
- Z-up 来源资产：绕 X 轴 −90° 转成 Y-up
- 骨骼重定向的 pelvis 位移：按 rest hip-height 比值缩放

这条是架构级约束。一旦允许"某些层自己转一下"，坐标错误会变成永远查不完的幽灵 bug。转换规则的权威定义在 [`draft-format.md`](./draft-format.md)。

### 5.6 实测参数

参考产品运行时观测到的 renderer / gizmo 配置、枚举取值与 pose 控件字段名，已移到
[`observation-notes.md`](./observation-notes.md) §1。

### 5.7 文档存储：宿主侧的决策项

包本身不关心文档存在哪，只要宿主实现 `HostAdapter` 上那两对文档方法
（`loadDocument` / `saveDocument`、`loadFCurves` / `saveFCurves`）。但宿主侧必须选一个落点，而且这个选择有硬约束。

**约束来自体量。** 导演台文档一旦有了时间轴，体量会跳一个量级：静态摆位（3 角色 + 5 基础体 + 10 机位）约 4.6 KB，带完整 65 骨骼姿态约 13.9 KB；加上 fcurve 之后，一条 2000 帧曲线按 compact 编码也要数 KB，几十条轨道就是几百 KB。若宿主的单行存储有上限（例如某些 DO SQLite 实现是 1.9 MB 且超限会被静默替换），把 fcurve 直接塞进节点 data 走不通。叠加两个放大器：自动保存走全量 payload，撤销栈存全量快照。

三个选项都能实现同一组文档方法，因此**不阻塞包的开发**：

| 选项                      | 做法                                                                             | 优点                                           | 代价                               |
| ------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| **后端独立表 + 事务提交** | 节点只存 `{ documentRef, revision }`，文档在后端表，`commit` 校验 `baseRevision` | 与小云雀模型一致；第二宿主实现同一接口即可复用 | 需要后端建表                       |
| **对象存储 blob + ref**   | 文档整体存 R2 / S3                                                               | 后端改动最小                                   | 冲突处理最弱，只能整份覆盖         |
| **宿主协同节点**          | 存进宿主的协同房                                                                 | 能拿到实时协同                                 | 第二宿主没有同款设施，接口无法对齐 |

**倾向后端独立表**：现有编辑器本来就没有实时协同（打开时读一次初始值），选事务模型不构成能力退化；小云雀本身也不是 CRDT，它的 `DRAFT_ID_MISMATCH` / `STALE_REVISION` / `REVISION_CONFLICT` 错误码说明是事务式；只有这个方案能让两个宿主共用同一套 adapter 实现。

### 5.8 离线视频导出（Mediabunny + WebCodecs）

> 成片入口与文件名等**剪辑契约**在 [`film-editorial.md`](./film-editorial.md) §9.2。
> 本节只定**编码栈**：用哪个库、时间戳怎么写、包与宿主各管什么。

#### 心智模型

预览是实时时钟（`rAF` / `Clock`）。导出是离线帧序列：第 `i` 帧的呈现时间必须是 `i / fps`，和画这一帧花了多久无关。

`MediaRecorder` + `canvas.captureStream` 是**直播 API**。它按墙钟打点，画得慢文件就变慢、变卡。实测：664 帧、`timeline.fps = 30` 应是 22.1s 恒定 30fps；墙钟录成约 44.7s、平均 14.8fps、帧间隔 35–149ms。这不是成片剪坏了，是录制器选错了。

#### 库：Mediabunny

| 项 | 口径 |
| --- | --- |
| 包名 | [`mediabunny`](https://mediabunny.dev/) |
| 作者 | Vanilagy；`mp4-muxer` / `webm-muxer` 的继任。那两套已弃用，禁止再引入 |
| 许可证 | MPL-2.0（文件级 copyleft）。只当 npm 依赖使用，不要把库源码拷进本仓 |
| 落点 | 只允许 `engine/io/` 引用。`contract/` / `evaluate/` 继续零 runtime 依赖 |
| 打包 | `tsup` 不把 `mediabunny` 标 `external`，打进 `dist`。宿主不必再装一份 |
| 我们用 | `Output`、`Mp4OutputFormat`、`CanvasSource`、`canEncodeVideo`、短片 `BufferTarget`、长片 `StreamTarget` |
| 我们不用 | 它的 demux、转码、播放、UI。禁止把它变成第二套媒体框架 |

Mediabunny 包的是 WebCodecs：**硬件编码 + 按调用方时间戳封装 + 编码器背压**。`CanvasSource.add(timestamp, duration)` 就是离线导出该有的接口。自己接 `VideoEncoder` 再手写 muxer，最后会重做关键帧、`moov` 位置、队列溢出、色彩空间——这些正是这个库的存在理由。

#### 责任划分

```text
evaluate + renderExportFrame     求值、选镜头、画到离屏 canvas（已有，不改语义）
engine/io 导出循环               第 i 帧 → add(i / fps, 1 / fps)；取消、进度、文件名
mediabunny                       编码、封装、背压、把时间戳吸附到 frameRate
浏览器 WebCodecs                 H.264 / VP9 硬件编码
HostAdapter.onExport             收 Blob；缺省浏览器下载。不参与编码
```

门面签名保持 `recordRange` / `recordSequence`。UI（`FilmExportDialog`、`useExportDialog`）继续只传 `fps / width / height / signal / onProgress`。

#### 格式与参数

- **主路径**：H.264（`avc`）+ MP4 + `fastStart`（`moov` 在文件头，才能立刻播、能 seek）。
- **时间**：`timestamp = i / fps`，`duration = 1 / fps`，`addVideoTrack(..., { frameRate: fps })`。🚫 禁止 `sleep(1000 / fps)` 充当时钟；能画多快画多快。
- **码率**：`clamp(4e6, width * height * fps * 0.12, 20e6)`。`2520×1080@30` ≈ 10 Mbps。禁止再靠浏览器默认（实测约 1.3 Mbps，21:9 会糊）。
- **尺寸**：宽高必须偶数；奇数向下取整。H.264 硬件编码器会拒奇数。
- **探测**：先 `canEncodeVideo('avc', { width, height })`。都不支持再试 VP9 + WebM，UI 必须说清格式。两边都不行就抛错。
- **内存**：成片默认高度 1080、时长通常几十秒 → `BufferTarget`。单文件明显超过约 100 MB 或帧数很大时改 `StreamTarget`，避免整文件堆内存。
- **文件名 / MIME**：`${label}_${sequenceId}_${width}x${height}.mp4`，`video/mp4`。Scene `recordRange` 同样改 `.mp4`。
- **取消**：`AbortSignal` 中断循环后 `output.cancel()`（或等价），不调用 `onExport`。半成品禁止交付。
- **GPU**：离屏 renderer 已 `preserveDrawingBuffer: true`。若偶发抓到上一帧，在 `add` 前 `gl.finish()`。

#### 落地步骤（按这个做，不要加范围）

1. `packages/builder` 加依赖 `mediabunny`。只改 `engine/io/VideoRecorder.ts`（或改名为 `VideoExporter.ts` 并改 `Stage` import）。`exportShared.renderExportFrame` / `makeOffscreenRenderer` / `deliverBlob` 不动。
2. 抽 `withEncoder` 替换 `withRecorder`：探测 codec → `CanvasSource` → 逐帧 `renderExportFrame` + `await source.add(i / fps, 1 / fps)` → `finalize` → `deliverBlob`。`exportVideoWebm` / `exportSequenceWebm` 可改名为 `exportVideo` / `exportSequence`，门面不改。
3. locale 里「WebM」改为「视频 / MP4」（`export.video`、`film.exportSubtitle` 及各语言）。
4. 更新本节达成度、[`film-editorial.md`](./film-editorial.md) §9.2 文件名。
5. 验收：导出一组成片；`ffprobe` 要求 `nb_frames == 导出帧数`、`duration ≈ frames/fps`（允许 1 帧误差）、平均帧率等于 `timeline.fps`、能 seek。取消不落文件。Chrome 必测；有 Safari 再测 AVC 探测与降级文案。

本期不做：音轨、后端转码、`ffmpeg.wasm`、PNG 序列。以后要加音轨，仍走 Mediabunny 的 audio source，不另开一条封装栈。

#### 禁止

- 🚫 离线导出再走 `MediaRecorder` / `captureStream` / `requestFrame`（含「探测失败就静默回退」）
- 🚫 引入 `mp4-muxer`、`webm-muxer`、`ffmpeg.wasm`、WebAV、Remotion
- 🚫 在 `evaluate/` 或 `components/` 里 import `mediabunny`
- 🚫 为导出另写一套求值（违反 §1.3「导出与预览必须同源」）
- 🚫 把远端转码 URL 写进包内（包内零 `fetch`）

---

## 6. UI 层组织

§2 到 §5 管的是"引擎侧"。这一节管 `components/` 内部——面板是本项目里增长最快的
代码，规则不提前定，后期每个面板都会长成上千行的巨石。

### 6.1 面板即目录

**一个面板一个目录，即使当前只有一个文件。** 文件变目录时所有 import 都要改，
一开始就建目录可以完全避免这次批量改动。

```
components/timeline/
├── index.tsx          # 编排：布局与数据传递，不含业务计算
├── types.ts           # 面板内共享类型
├── constants.ts       # 轨道高度、吸附阈值等
├── hooks/             # 面板私有逻辑（拖拽、缩放、选区）
├── Ruler.tsx
├── TrackRow.tsx
├── ClipBlock.tsx
└── Playhead.tsx       # 高频，见 §6.3
```

以上不是 `timeline/` 特例。**每个** `components/<panel>/` 必须按这个落点，日常改动以
[`AGENTS.md`](../AGENTS.md) §8 为强制口径：

- 属于该面板的 `useXxx.ts` 进 `hooks/`，禁止和组件文件平铺
- 纯函数进 `utils.ts`（变多再拆 `utils/`）
- 跨面板 hook 进 `components/hooks/`
- 不要从其它宿主工程抄 `data/` / `store/` / `helpers/` / 组件内 `locale/`

`index.tsx` 是编排层，职责只有布局与把数据传给子组件。一旦它开始出现业务计算、
数据转换或超过三个 `useEffect`，说明该往 `hooks/` 拆了。存量平铺不整目录搬家，
改到哪个面板再归位。

### 6.2 observer 粒度决定 MobX 是收益还是负担

这是 UI 层最关键的一条，**打错位置会让 MobX 比 zustand 还慢**。

规则：**`observer` 打在最小的读取单元上，容器只做布局、不读 observable。**

反例很具体——如果 `timeline/index.tsx` 整体是 `observer` 并在里面读了
`selection.nodeIds`，那么用户每点一次选中，整个时间轴（含几百个 `ClipBlock`）
全部重渲染。正确做法是 `index.tsx` 不读选中态，由每个 `ClipBlock` 自己
`observer` 自己那一条的选中态——选中变化只重渲染两个 block（旧的和新的）。

配套的三条：

- 列表项必须自己 `observer`，不要在父层 `map` 时读子项字段
- 容器给子组件传 **id**，不传已解引用的 observable 对象——传对象等于在父层建立了依赖
- `useLocalObservable` 只用于纯面板内的临时状态（展开/折叠、hover），不放业务数据

### 6.3 高频组件不进 React 渲染

播放头位置、帧号数字、时间轴刻度跟随——这些每帧都变。让它们走 React 渲染，
播放时就是 60fps 重渲染。

规则：这类组件订阅引擎的高频事件后**用 ref 直改 DOM**，组件本身不因帧号重渲染。

```tsx
// components/timeline/Playhead.tsx
export function Playhead() {
  const ref = useRef<HTMLDivElement>(null);
  useEngineEvent('frame', (frame) => {
    if (ref.current)
      ref.current.style.transform = `translateX(${frame * pxPerFrame}px)`;
  });
  return (
    <div
      ref={ref}
      className="t3d-timeline-playhead"
    />
  );
}
```

需要展示帧号的地方走 §2.6 的节流通道（100ms），不走每帧通道。

验收判据可量化：播放一整条时间轴，React commit 次数应当 ≈ 节流事件数（约每秒 10 次），
而不是帧数（每秒 30 次）。

### 6.4 拆分阈值与拆法

| 行数    | 动作                                   |
| ------- | -------------------------------------- |
| < 300   | 正常                                   |
| 300–500 | 预警，评估拆分点                       |
| > 500   | **必须拆**，不接受"这个面板天生就复杂" |

拆的顺序固定，从成本最低的开始：

1. **常量外提**到 `constants.ts`——几乎零风险
2. **纯计算外提**到 `utils.ts`——可单独测试
3. **副作用外提**到 `hooks/`——`useEffect` 超过 3 个就该拆
4. **子组件外提**——按"能否独立 observer"划边界，这条同时优化了 §6.2 的粒度

第 4 步的划分判据值得强调：**不是按视觉区块拆，是按"读哪些 observable"拆。**
读同一批字段的 UI 归一个组件，这样 observer 边界与重渲染边界重合。

### 6.5 什么时候抽公共组件

务实判据：**同一 UI 模式出现 3 次以上才抽到 `common/`。** 出现 2 次就地复制，
等第 3 次再抽——过早抽象产生的 props 透传和配置项，维护成本高于重复本身。

例外：**表单控件类**（数值输入、滑块、颜色选择）从一开始就放 `common/`。它们
必然被 Inspector、PosePanel、Timeline 多处使用，且行为要完全一致（步进、
精度、失焦提交时机），分叉的代价远大于抽象成本。

### 6.6 类名前缀是可嵌入包的硬约束

**所有类名必须 `t3d-` 前缀。** 这不是风格偏好——包会被挂进宿主页面，`.panel`
`.preview` `.viewport` 这类裸类名与宿主样式几乎必然互相污染，而且症状是"在 A
宿主里好好的，挂到 B 宿主就错位"，排查成本极高。

命名格式 `t3d-<面板>-<元素>`，例如 `t3d-timeline-ruler`、`t3d-inspector-row`。
条件类名用 `components/common/cx.ts` 的 `cx()` 合并，不手拼字符串——包内自带这个
十几行的 helper，不引 `clsx`，少一个 runtime 依赖。

样式跟着面板走，不要单文件：

```
styles/
├── tokens.css              # 全部 --t3d-* 变量默认值，必须自带 fallback
├── base.css                # 容器与重置
├── timeline.css
├── film.css
├── inspector.css
└── library.css
```

由 tsup 合并输出单个 `styles.css`。单文件在面板补全后会到几千行，改一个面板
要在其中翻找。

**禁止** CSS Modules（`.module.css`）——包的样式要能被宿主用同名变量覆盖主题，
Modules 的 hash 类名破坏了这个能力。**禁止**用内联 `style` 设置可主题化的属性
（颜色、圆角、间距），这类值一律走 CSS 变量；内联 `style` 只用于运行时计算的
几何量（播放头位移、轨道宽度）。

### 6.7 入口、布局与面板的职责

三者必须分开，否则入口会变成杂物间：

| 文件                           | 只做                                | 不做              |
| ------------------------------ | ----------------------------------- | ----------------- |
| `DirectorStudio.tsx`           | Provider 组装、容器 div、props 契约 | 任何业务逻辑      |
| `components/Layout.tsx`        | 面板栅格、分栏尺寸、显隐编排        | 读业务 observable |
| `components/<panel>/index.tsx` | 该面板的编排                        | 跨面板协调        |

跨面板协调（例如"选中节点后 Inspector 切到对应标签"）走 `stores/`，
**不要**在 `Layout` 里用 `useEffect` 串联——那会让布局层变成隐式的状态机，
且无法在拆分面板时安全移动。

工具函数（如 `downloadJson`）不放组件文件，进 `components/utils.ts` 或按归属
下沉到对应面板目录。

### 6.8 浮层、层级与快捷键

§6.1–6.7 管的是面板**内部**怎么组织。这一节管面板**之间**和面板**之上**——
工作台补全后会同时存在下拉、右键菜单、弹窗、拖拽预览、全屏预览、提示，
这几件事的共同特点是：单面板阶段完全不痛，面板一多就是一团乱麻，
而且到那时要同时改几十个组件才能收拾。**这些必须在铺开面板之前定死。**

#### 6.8.1 根容器必须创建独立层叠上下文

```css
.t3d-root {
  isolation: isolate;
}
```

一行，但它解决的是根本问题：**包内所有 `z-index` 被封进自己的层叠上下文，
不可能穿透出去压住宿主的弹窗。** 没有它，包内一个 `z-index: 9999`
就会盖住宿主的导航和对话框，而且这种 bug 只在特定宿主页面才复现。

代价是包内浮层无法覆盖宿主 UI，只能在容器范围内。**对可嵌入包这是正确行为**，
不是限制——挂在宿主里的工具不该遮挡宿主自己的界面。确有全屏需求（全屏预览）
时，走 §3.5 `HostAdapter` 由宿主授权，而不是靠提高 z-index 硬顶。

#### 6.8.2 z-index 全部 token 化

**禁止在任何组件或 CSS 里写 `z-index` 字面量**，一律引用变量：

| 变量                 | 值  | 用途                               |
| -------------------- | --- | ---------------------------------- |
| `--t3d-z-panel`      | 1   | 面板与常规内容                     |
| `--t3d-z-sticky`     | 10  | 面板内吸顶吸边（时间轴标尺、表头） |
| `--t3d-z-drag`       | 100 | 拖拽预览、选区框、变换手柄         |
| `--t3d-z-dropdown`   | 200 | 下拉、右键菜单、自动完成           |
| `--t3d-z-dialog`     | 300 | 模态弹窗与其遮罩                   |
| `--t3d-z-fullscreen` | 400 | 全屏预览                           |
| `--t3d-z-tooltip`    | 500 | 提示                               |
| `--t3d-z-toast`      | 600 | 全局通知                           |

两条容易搞反的规则，写明理由：

- **tooltip 必须高于 dialog**。弹窗里的按钮同样需要提示，反过来就被遮住。
  直觉上"弹窗最重要所以最高"是错的。
- **层间留 100 的间隔**。同层内的局部微调（`calc(var(--t3d-z-dropdown) + 1)`）
  不必新增 token，但跨层一定要用对应变量。

#### 6.8.3 Portal 必须挂在包内，不是 document.body

所有浮层通过 `createPortal` 挂到包自己的 portal root：

```tsx
<div className="t3d-root">
  {/* 面板… */}
  <div className="t3d-portal-root" />
</div>
```

**挂 `document.body` 是被嵌入包的经典陷阱**：浮层逃出根容器后
`--t3d-*` 变量的继承链直接断掉，症状是「面板里配色正常，一弹出菜单就变默认色」，
而且只在宿主环境复现，本地调试台一切正常。

配套两条：

- `tokens.css` 的变量定义选择器必须同时覆盖两者：
  `:where(.t3d-root, .t3d-portal-root) { --t3d-…: …; }`。
  这样即便将来某个浮层不得不挂到 body，变量仍然成立。
- 根容器**不要**设 `overflow: hidden`，也**不要**在祖先链上加 `transform`——
  两者都会裁剪或改变内部 `position: fixed` 的参照系。宿主强制裁剪时，
  由 `HostAdapter` 提供替代挂载点，而不是在组件里各自 `document.body` 兜底。

portal 节点通过 context 下发，组件不自己找 DOM：

```tsx
const portalRoot = usePortalRoot(); // 而不是 document.querySelector
```

#### 6.8.4 快捷键必须作用域化

工作台会有大量快捷键（空格播放、Delete 删除、`Ctrl+Z` 撤销、G/R/S 变换）。

**禁止 `window.addEventListener('keydown', …)`。** 包挂进宿主页面后，
宿主自己也有 `Ctrl+Z`——裸监听等于劫持宿主的撤销栈，这属于挂载即事故。

规则：

- 监听挂在根容器上（容器 `tabIndex={-1}` 使其可聚焦），**只在焦点位于容器内时生效**
- 输入类元素聚焦时（`input` / `textarea` / `contentEditable`）整体旁路，
  否则在属性面板里打字会触发删除节点
- 键位表集中在一处声明，不散落在各面板的 `useEffect` 里
- **所有快捷键走命令系统**（§7 / 阶段五第 5 项），不直接调业务函数。
  这样快捷键、菜单项、宿主 API、脚本调用四个入口共用一套命令与撤销语义，
  不会出现「菜单删除能撤销、快捷键删除不能撤销」这类分叉

#### 6.8.5 浮层基元与组件库取舍

工作台需要的浮层基元固定就那几个：`Modal`、`Popover`、`Tooltip`、`ContextMenu`、
`DropdownMenu`。它们统一放 `components/common/`，对外契约与实现解耦——
**实现可以是自写，也可以将来换成 Radix，接口不变。**

选型结论：

- **不用 shadcn/ui**。它绑定 Tailwind，而本包的样式契约是纯 CSS + `--t3d-*`
  变量（§6.6）。引入 Tailwind 意味着产物携带 preflight，会重置宿主的
  `button` / `h1` / `ul` 等全局元素样式，属于包污染宿主。
- **Radix 按需单组件引入，不预先整套引**。它是 headless 的，不产出样式，
  与 §6.6 的前缀加变量体系天然兼容，**任何时候引入都没有迁移成本**——
  所以不必提前引。触发条件：需要带碰撞翻转的定位（Popover / ContextMenu）、
  或出现嵌套弹窗。这两类自实现的焦点管理极易出错，届时引对应单包即可。
- **自写的浮层必须满足可访问性底线**，否则不如直接用 Radix：
  焦点陷阱（含 `Shift+Tab` 回环）、`Escape` 关闭、点击外部关闭、
  打开时锁背景滚动、关闭后焦点回到触发元素、`role` 与 `aria-modal`。
  专业工具里 `Escape` 关弹窗是肌肉记忆级预期，缺失属于功能缺陷而非风格问题。
- **不使用原生 `<dialog>` 元素**（连带排除任何依赖它的库）。它的
  `showModal()` 把内容提升到 **top layer**，而 top layer 不受层叠上下文约束，
  会直接穿透 §6.8.1 的 `isolation: isolate` 覆盖到宿主全屏之上——
  这与"包的浮层不得逃出宿主给的层叠位置"直接冲突。原生 `<dialog>` 自带的
  焦点陷阱与 `::backdrop` 因此用不上，焦点陷阱需自己实现。
- **焦点陷阱的 `keydown` 挂根容器，不挂 dialog、也不挂 `document`**。
  挂 dialog 时焦点一旦被移到弹窗外（宿主主动 `focus()`、用户点包内其他面板、
  从浏览器 UI `Tab` 回页面）就再也夺不回来，`aria-modal` 的语义随之失效；
  挂 `document` 能兜住所有情况但会劫持宿主按键，违反 §6.8.4。

#### 6.8.6 不使用 Shadow DOM（已评估）

记录结论以免反复讨论。

Shadow DOM 的真实收益是**反向隔离**——`t3d-` 前缀只能防止包污染宿主，
防不住宿主的 `* { box-sizing }`、`button { … }` 等全局规则渗进包里。

但对 3D 工作台收益与代价不匹配：主体是 `<canvas>`，宿主样式本就影响不到它；
而代价包括第三方 headless 库在 shadow 边界内的定位与焦点问题（直接影响
6.8.5 的 Radix 退路）、事件 retarget 带来的调试成本、以及 SSR 复杂度。

**结论：不用。** 反向污染通过两条兜底：包内样式对关键属性显式声明
（不依赖继承），以及根容器上重置 `box-sizing` 与字体。
若将来出现真实且反复的宿主污染案例，再重新评估。

### 6.9 UI 文案语言：当前中文硬编码是有意识的选择

包内 UI 文案直接写中文，不走 i18n。这是决策，不是欠账。

这个包交付的是**完整工作台**，不是通用组件库。工作台的界面语言属于产品决策，而当前没有第二语言的宿主；提前抽 i18n 是在为假想需求付成本，还会把每处文案变成一个 key 查找，降低可读性。代码注释用中文更没有争议，那是团队语言。

将来真出现多语言宿主时的路径已经预留好，不会陷入"当初没想过、现在改不动"：文案统一提取到 `locale/`，通过 `HostAdapter.t?()`（§3.5 预留的可选方法）交给宿主；宿主不实现就回落到内置中文。**在那之前不要做半套 i18n**——只把一部分文案抽成 key、另一部分留在 JSX 里，是最糟的状态，两边都要维护且无法批量提取。

---

## 7. 状态库选型

**MobX。** 在导演台这个具体场景下有四个实质优势：

**文档模型可以直接当状态用。** 导演台文档是深层嵌套结构——`nodes[].transform.position[0]`、`timeline.fcurves` 里上千条关键帧。不可变方案要求 Inspector 每个数值框走 dispatch → 不可变 patch → 快照回读；MobX 的 observable class 让 UI 直接读、就地改，细粒度依赖追踪保证只有读到该值的组件重渲染。

**引擎层能直接订阅状态。** MobX 不依赖 React，`sync/` 可以直接用 `reaction()`。React-only 的方案（Recoil）拿不到，只能在 React 层用 `useEffect` 链转发，那是一层纯粹的胶水。

**class 模型贴合命令式引擎。** 场景图、时间轴、骨架本身就是对象树，`makeObservable` 的 class 与之同构，不需要在不可变 plain object 和 Three 实例之间做两次形状转换。

**与宿主状态库正交。** 这条在"做可嵌入包"的前提下权重最高。包内状态库若与宿主同款，挂载后会出现嵌套 Provider，能跑但是隐患。MobX 与 Recoil / zustand 都是独立系统，冲突面为零。


代价只有一个：就地改值没有天然撤销能力，需要自己维护命令与历史（§2.5）。但这部分小云雀也要做——它的文档协议里有 `commands` 数组和 `revision` 乐观并发，说明写入本来就是命令式的。

两条 SSR 防护必须由包自己保证，不能指望宿主：**`enableStaticRendering(typeof window === 'undefined')` 在模块顶层调用**（服务端没有卸载时机，`observer` 订阅不会清理，会内存泄漏）；**store 绝不能是模块级单例**（Node 进程跨请求复用模块，单例会让 A 用户看到 B 用户的数据），每次挂载用 `useState` 惰性初始化新建。

MobX **不用装饰器语法**，统一走 `makeObservable(this, {...})`。装饰器要开 `experimentalDecorators`，而宿主的 SWC / Babel 配置不在我们控制范围内——一个需要宿主改 tsconfig 才能跑的包不叫可嵌入。

---

## 8. 构建与产物

### 8.1 构建配置

```ts
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  treeshake: true,
  external: ['react', 'react-dom', 'three', /^three\//],
  banner: { js: '"use client";' }
});
```

样式**不走 `injectStyle`**，单独产出 `styles.css` 由宿主显式 import。理由是刻意的：导演台样式体量大，注入 JS 会拖慢首屏解析；且导演台是全屏 overlay，宿主需要能控制它与自身样式的层叠顺序。CSS 由 `packages/builder/scripts/finalize-dist.cjs` 在构建末尾把各面板样式拼成一份。

`three` 与 `three/addons` 都必须 external，产物里保留原 import，由宿主打包器解析。

上面是 `pnpm build` 的**发布形态**（单 bundle）。`pnpm dev` 走的是另一套：`bundle: false`
输出与 `src` 一一对应的多文件树，让 webpack 看到细粒度模块边界从而支持 Fast Refresh，
代价是 watch 期间不重出 `.d.ts`。两种形态的解析入口一致，细节见 [`README.md`](../README.md)「开发模式」。

### 8.2 导出面

以 `packages/builder/src/index.ts` 为准（本节与它同步，不要照抄成别的形状）：

```ts
export { DirectorStudio } from './DirectorStudio';
export type { DirectorStudioProps, DirectorApi } from './DirectorStudio';

export type {
  HostAdapter,
  ExportMeta,
  CharacterLibEntry,
  PropLibEntry,
  MotionLibEntry,
  ResolvedUrl
} from './host/types';

export { makeEmptyDraft } from './contract/emptyDraft';
export type { EmptyDraftCamera } from './contract/emptyDraft';

// 可选 helper：素材 key 约定的参考实现，宿主可不用（§3.5）
export {
  isResolvableAssetKey,
  normalizeAssetKey,
  assetBasename,
  resolveMediaKey
} from './host/assetKeys';
export { LIBRARY_ASSET_PREFIX } from './contract/assetKeyPrefixes';

export { CAMERA_PRESETS } from './data/cameraLibrary';
export type { CameraPreset } from './data/cameraLibrary';

export type { DirectorDocument, MediaRef } from './contract/types';
```

**没有** `migrateToLatest`（`contract/migrate.ts` 不存在，迁移尚未落地）。
`SceneContract` 是 `contract/` 与 `evaluate/` 的内部求值类型，**不从包入口导出**；
对外的文档类型是 `DirectorDocument`。

导出面要窄。每多导出一个符号，就多一份不能随意重构的承诺。

### 8.3 three 版本

对齐小云雀 **r184**。目标是复刻，参考实现用什么版本就用什么版本——逆向观测到的渲染参数与 addon 行为都能直接照搬，不需要在"文档里写的"和"当前版本实际的"之间做二次翻译。（`TransformControls` / `EffectComposer` / `OutlinePass` 这几个 addon 随第 6 项一起取消，本仓不用。）

```jsonc
{
  "peerDependencies": { "three": ">=0.184.0" },
  "devDependencies": { "three": "^0.184.0", "@types/three": "^0.184.0" }
}
```

peer 下限写 `>=0.184.0` 而不是更宽松的范围是刻意的：宽 range 看着友好，实际上把"包到底依赖哪些 API"这个问题推给集成时才发现。明确下限，让不兼容在 `pnpm install` 阶段就报出来。

`three` 声明为 peerDependency 同时解决了实例共享——宿主与包解析到同一份 `node_modules/three`，静态 import 拿到的就是同一个实例，`instanceof` 不会失效。因此**不需要**运行时注入 three。将来若出现宿主锁死其它大版本、必须双实例共存的情况，再引入注入层。

### 8.4 何时必须 peer，何时可以 bundled

判断标准只有一条：**宿主会不会直接操作包内那个运行时对象，并依赖跨包身份（`instanceof`、同一单例、同一 observable 树）。**

| 依赖                       | 产物策略                      | 原因                                                                                                                                                          |
| -------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react` / `react-dom`      | **external + peer**           | 必须与宿主共享同一份 React，否则 hooks / context 失效                                                                                                         |
| `three` / `three/addons`   | **external + peer**           | `instanceof THREE.Object3D` 跨实例失效；addon 也必须来自同一份 three                                                                                          |
| `mobx` / `mobx-react-lite` | **dependencies，打进 `dist`** | `index.ts` 只导出 `DirectorStudio`、类型与 `assetKeys` 纯函数，**不导出任何 observable 类**。宿主不需要与包共享 MobX 实例，也不应去 `makeObservable` 包内对象 |

不要因为 three 是 peer，就把 mobx 也改成 peer。那样只增加宿主接入成本（多装一个它用不到的包），没有换来任何实例共享收益。反过来，也不要把 three 打进包——那会立刻让 `instanceof` 和 addon 对不上。

---

## 9. 复刻覆盖度与优先级

### P0 — 骨架可跑

| 能力                                         | 落点                                                 |
| -------------------------------------------- | ---------------------------------------------------- |
| 契约类型 + zod 校验 + 序列化                 | `contract/`                                          |
| observable 文档模型                          | `document/`                                          |
| GLTF/FBX 加载、模板缓存、SkeletonUtils.clone | `engine/io/AssetLoader.ts`                           |
| 场景图对账                                   | `sync/` + `engine/core/Stage.ts`                     |
| 主视口 + OrbitControls + 网格 + 辅助层隔离   | `engine/core/`                                       |
| 机位预览（第二视口 + 画幅 letterbox）        | `engine/core/Viewport.ts`                            |
| 帧求值管线 + 30fps 时钟                      | `evaluate/evaluateFrame.ts` + `engine/core/Clock.ts` |
| 包骨架 + tsup 产物 + SSR 防护                | `packages/builder` + `stores/setup.ts`               |
| LocalHostAdapter + 工作台首页（overlay 挂载）| `apps/studio`                                        |

### P1 — 成为编辑器

| 能力                           | 落点                                                        | 备注                        |
| ------------------------------ | ----------------------------------------------------------- | --------------------------- |
| Raycaster 拾取 + 框选          | `engine/interact/Picker.ts` `BoxSelect.ts`                  | pointer / single / multiple |
| ViewHelper 坐标轴球 + 重置视角 | `engine/interact/ViewHelper.ts`                             | 视口右上角                  |
| 命令 + 撤销 / 重做             | `document/History.ts`                                       | 拖拽只入栈一条              |
| 用户关键帧轨道 + 时间轴 UI     | `evaluate/curves/KeyframeTrack.ts` + `components/timeline/` | 8 种插值                    |
| 网格 / 地面吸附                | `engine/interact/Snapping.ts`                               |                             |
| 自由走位 WASD + QE             | `engine/interact/FreeWalk.ts`                               |                             |
| 截图 + 离线 MP4 导出           | `engine/io/`                                                | Mediabunny，见 §5.8         |
| WebGL context lost 恢复        | `engine/core/Renderer.ts`                                   | 长时会话必需                |
| 按需渲染 invalidate            | `engine/core/RenderLoop.ts`                                 |                             |

### 已取消（不要实现）

以下能力曾在计划内，现已明确**取消**。文档保留条目只为解释"为什么代码里没有"，
不代表待办。要重新捡起来先跟维护者确认：

| 取消的能力                                | 曾计划落点                              | 现状                                                                        |
| ----------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| 指针仲裁                                  | `engine/interact/GestureCoordinator.ts` | 无独立仲裁器：`UnifiedGizmo` 在 capture 阶段吃掉 `pointerdown`，导航让位      |
| `OutlinePass` 选中描边                    | `engine/postfx/Composer.ts`             | 无后处理链，直接 render                                                      |
| IK 求解器（4 链三段 + pole + spine 跟随） | `engine/rig/IKSolver.ts`                | 完整求解器仍取消；落地的是单肢 two-bone IK（`interact/joints/twoBoneIk.ts`） |

§5.3（指针仲裁）与 §5.6 里的 `OutlinePass` 参数属于**小云雀观测记录**，留作参考，
不是本仓要复刻的目标。

### P2 — 专业能力

| 能力                                       | 落点                                                      | 难度                                                             |
| ------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------- |
| 语义 Pose 控制（25 旋钮）                  | `engine/rig/applyPose.ts`                                 | 中。按局部欧拉角近似；视口拖关节另走 `interact/joints/` 的两骨解算 |
| 姿势预设库（20 个）                        | `data/posePresets.ts`                                     | 低                                                               |
| 骨架兼容性校验                             | `engine/rig/RigCompatibility.ts`                          | 低。输出 `missingBones` / `invalidChains`                        |
| 骨架重定向（mixamorig / ccBase / generic） | `evaluate/retarget/` + `engine/rig/applyRetarget.ts`      | 高。世界系增量 FK：`W_dst = (W_src · W_src_rest⁻¹) · W_dst_rest` |
| 运镜预设库（30 个，3 分类）                | `data/cameraMotions.ts` + `evaluate/camera/bakeMotion.ts` | 中。orbit / tracking / path 三类生成器                           |
| 运镜前置条件门控                           | `evaluate/camera/targetPolicy.ts`                         | 低                                                               |
| DRACO / KTX2 / Meshopt                     | `engine/io/AssetLoader.ts`                                | 低。挂 decoder 即可                                              |
| 事务 + revision 并发                       | `document/Transaction.ts`                                 | 中                                                               |
| SMPL-X 动捕导入                            | `engine/io/`                                              | 中。非核心，可延后                                               |

### P3 — 生态

图生 3D 场景、资产库后台、AI 识图、多人协同、Blender 导入通道。

---

## 10. 容易踩的坑

**状态库 SSR 泄漏。** `enableStaticRendering` 必须在模块顶层调，store 绝不能是模块级单例。这是 Next.js + MobX 最常见的生产事故。

**StrictMode 双挂载。** 开发模式 `useEffect` 执行两次，`dispose()` 不彻底就会耗尽 WebGL context。顺序是先断 reaction 再清理场景（§5.2）。

**不要在 evaluate 里写 observable。** 这是最危险的一条——一行 `runInAction` 写进每帧求值，整个 UI 就会以 60fps 重渲染，症状是全局卡顿且很难定位到具体某行。§2.4 让求值层禁状态库，从结构上杜绝了这条；再在 `evaluate` 入口加开发期断言兜底。

**导出时的 aspect 竞态。** 导出用离屏 renderer，但相机对象与主视口共享。导出循环每帧必须自己重设 `camera.aspect` 并 `updateProjectionMatrix()`，否则主 UI 的 render 会把它改回屏幕宽高比，导出画面变形。

**导出不要用 MediaRecorder。** 它按墙钟打点，画得慢就变成 VFR 慢放。离线导出必须自己写 `i / fps`，走 §5.8 的 Mediabunny。

**两套曲线不要混。** 插值规则不同，混用会导致运镜节奏错乱：

| 数据                                | 时间域 | bezier 手柄            | 处理                      |
| ----------------------------------- | ------ | ---------------------- | ------------------------- |
| `cameraMotionClips[].motion.curves` | 毫秒   | **无**（只是缓动标记） | smoothstep 近似           |
| `fcurves` 资产（compact-v1）        | 帧     | **有**                 | 三次贝塞尔，牛顿反解 x(t) |

**帧快照不要每帧重新分配。** 60fps 下持续 new 对象会产生周期性 GC 掉帧。用预分配缓冲（§3.2）。

**求值顺序不能改。** §3.2 的八步顺序决定叠加优先级，改动会直接产生逐帧位姿偏差，而且症状细微到肉眼难辨，只有逐帧对账才能发现。

---

## 11. 依赖清单

版本选择有两条不同的对齐基准，不要混：**渲染相关对齐小云雀**（复刻保真），**宿主环境相关对齐首个宿主**（集成零意外）。

```jsonc
// packages/builder —— 发布物，依赖面要窄
{
  "peerDependencies": {
    "three": ">=0.184.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "dependencies": {
    "mobx": "^6.13",
    "mobx-react-lite": "^4.1", // 4.x 才支持 React 18
    "zod": "^3.x", // 仅 contract/validate.ts
    "mediabunny": "^1" // 仅 engine/io 离线导出，见 §5.8；打进 dist
  },
  "devDependencies": {
    "three": "^0.184.0",
    "@types/three": "^0.184.0",
    "tsup": "^8.0.1",
    "typescript": "^5.3.3"
  }
}
```

刻意不引入的：

- **React Three Fiber / drei** — 与命令式引擎冲突，逐帧驱动上百属性时要过 React 调和
- **mobx-state-tree** — 自带快照与时间旅行很诱人，但对大文档快照开销过大，且强制的 tree 结构会限制引擎侧的引用方式
- **物理引擎** — 小云雀也没有，吸附是自研几何逻辑
- **GSAP 等动画库** — 时间轴自己管曲线
- **clsx** — `components/common/cx.ts` 十几行够用，不值得一个 runtime 依赖
- **mp4-muxer / webm-muxer** — 已被 Mediabunny 取代
- **ffmpeg.wasm** — 体积大、软编慢，浏览器离线导出不划算
- **MediaRecorder 当离线导出** — 直播时间模型，见 §5.8

`contract/` 与 `evaluate/` 两层应当**零 runtime 依赖**（zod 只在 `contract/validate.ts`，可按需拆成独立入口）。这两层是唯一打算长期维护的资产，任何依赖都会在若干年后变成迁移阻力。

---

## 12. 达成度矩阵

本文档与实际代码的唯一对账表。**每阶段完成后必须更新。**

依赖方向那部分不靠手工维护——直接跑：

```bash
pnpm lint                        # 默认即目标态，必须零违规
LAYER_RULES=target pnpm lint     # 与默认档相同（阶段 4.5 已合并）
```

> 截至 2026-09-11（阶段 5A 第 5.5 项）：默认档即目标态，**0** 违规。`eslint-disable` 包内零命中。`engine/core/Stage.ts` 306 行（拆前 `Stage.ts` 1074）。

状态含义：`—` 未开始 / `部分` 有实现但未达目标形态 / `✓` 达成目标形态

| 模块                | 目标形态                                                 | 当前状态                                                                                                                                                                                                                    | 收敛于                          |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `contract/`         | 零依赖：类型 + 序列化 + zod + 迁移                       | 部分：`types`（wire `SceneContract` + `DirectorDocument` + `MediaRef`）+ `parser.ts`（草稿查询 helper，非序列化）+ `emptyDraft`（相机预设由调用方传入）+ `validate.ts`（zod，已接 `Stage.load`）；无 serialize / 无 migrate | 5 补序列化与迁移                |
| `evaluate/`         | 零 three 纯函数 + FrameSnapshot                          | ✓ `evaluateFrame` + 8 步管线 + golden；已按 §4.1 分 `curves/` `camera/` `path/`（旧路径薄 re-export）。`retarget/` 只有映射表 `RetargetMap.ts`，求解在 `engine/rig/applyRetarget.ts`（要碰 Bone，无法零 three）             | 5A-1 / 5.5                      |
| `engine/`           | 门面只吃 contract / 标量；`Stage` 只做场景图 + reconcile | 部分：目录已按 §4.1 落 `core/` `objects/` `rig/` `interact/` `io/` `gizmo/`。门面是 `DirectorEngine.ts`（接口）+ `core/Stage.ts`（实现）。GestureCoordinator / Composer 已取消；gumball 与两骨 IK 落在 `interact/`                                 | 5.5                             |
| `document/`         | observable 模型 + command + history                      | 部分：`DirectorDoc` + `History` + `SnapshotCommand`；无完整节点 class 树 / `Transaction`                                                                                                                                    | 5                               |
| `stores/`           | 只装编辑器意图                                           | ✓ `EditorStore` 只装选中 / 播放 / 面板；文档在 `DirectorDoc`；`currentFrame` 不是 observable                                                                                                                                | 5                               |
| `sync/`             | 唯一绑定点                                               | ✓ `DocumentSync` `reaction()`；`StudioSession` 是 UI 门面                                                                                                                                                                   | 5                               |
| `bridge/`           | 门面 hooks，UI 看不到实现类                              | 部分：`useEngine()` 返回 `DirectorEngine`；实例在 effect 内创建/销毁。`DirectorApi` 另暴露 `session`                                                                                                                        | 5                               |
| `components/`       | 只经门面访问引擎能力                                     | 部分：`rg "Stage" components/` 零命中；FCurveSet/TrackProp 直接 import `evaluate/`，POSE_CONTROLS 走 `data/`，导出走门面 `captureFrame` / `recordRange`。面板已目录化（§6.1）                                               | 5                               |
| `host/`             | HostAdapter + 默认实现                                   | ✓ 阶段 3 完成，包内零 `fetch`（已由 ESLint 强制）                                                                                                                                                                           | —                               |
| `data/`             | 机位 / 运镜 / 姿势预设                                   | 部分：机位与运镜已有；`poseControls.ts` 已从 engine 迁出。姿势预设库仍无                                                                                                                                                    | P2                              |
| `styles/`           | 按面板拆 + tokens 自带 fallback                          | ✓ tokens / base / layout / viewport / inspector / library / timeline / film / dialog；hex 只在 `tokens.css`                                                                                                                  | 5-4                             |
| Film editorial      | Scene / Film 隔离 + 单轨硬切 + 显式 sequence 播放/导出 | ✓ `content.editorial` 读写操作、Film 会话时钟、Program Monitor、`recordSequence`；不读 `evaluateFrame`                                                                                                                       | —                               |
| 离线视频导出        | Mediabunny + WebCodecs，CFR MP4，时间戳 `i/fps`（§5.8） | ✓ `VideoRecorder` 已换 `CanvasSource.add(i/fps)`；AVC 探测失败降 VP9 并改后缀，禁止回退 MediaRecorder。浏览器 ffprobe 对账仍要以真实导出文件确认 | 本分支                          |
| UI 面板目录化       | 面板即目录 + 目录内 hook/util 落点（§6.1 / AGENTS.md §8） | 部分：目录已建（含 `film/`）；`leftrail/hooks/` 已按落点，其余面板仍有 `useXxx` / 纯函数与组件平铺，改到哪个面板再归位                                                                                                       | 5-4                             |
| 层叠上下文隔离      | 根容器 `isolation: isolate`（§6.8.1）                    | ✓ `.t3d-root { isolation: isolate }`；宿主 z=9999 浮层可压过包内 dialog（已验证）                                                                                                                                           | 5-4                             |
| z-index token 化    | 全部走 `--t3d-z-*`（§6.8.2）                             | ✓ `z-index:\s*\d` 零命中                                                                                                                                                                                                    | 5-4                             |
| Portal root         | 挂包内而非 `document.body`（§6.8.3）                     | ✓ `.t3d-portal-root`；`document.body` 零命中                                                                                                                                                                                | 5-4                             |
| 快捷键作用域        | 容器内聚焦才生效 + 走命令（§6.8.4）                      | 部分：监听挂根容器；Ctrl/Cmd+Z 走 `History`；未做成完整命令面板                                                                                                                                                             | 5-4 / 5-5                       |
| 浮层 a11y 底线      | 焦点陷阱 / Escape / 滚动锁（§6.8.5）                     | ✓ 自写 `common/Modal`：Tab 回环 / Escape / 点 overlay / noscroll / 焦点恢复 / `role` + `aria-modal`                                                                                                                         | 5-4                             |
| 类名 `t3d-` 前缀    | 全部带前缀（§6.6）                                       | ✓ 裸类名 grep 零命中                                                                                                                                                                                                        | 5-4                             |
| observer 粒度       | 打在最小读取单元（§6.2）                                 | 部分：`createStoreHook` 按 selector + `autorun` 订阅；未给每个叶子包 `observer()`                                                                                                                                           | 5                               |
| 高频组件不进 React  | ref 直改 DOM（§6.3）                                     | 部分：播放头 / 帧输入订 `frame` 后 ref 直改 DOM；`session.frame` 读 `engine.currentFrame`，不是 observable                                                                                                                  | 5                               |
| 三条红线可断言      | Node 内跑 evaluate 断言红线                              | ✓ `pnpm test:evaluate`（node:test，无新依赖）；smoothstep 逐点比对、路径边界精确、运镜不拼接                                                                                                                                | 5A-1                            |
| 逐帧回归基线        | 改动引入偏差即红灯                                       | ✓ 补充 B：`docs/samples/golden/` 6 份全帧 sha1 + 边界采样；锁定现状不是正确性。正确性仍由红线 + 8 检查点 + 浏览器实测负责                                                                                                   | —                               |
| 按需渲染 invalidate | `RenderLoop` 去重                                        | ✓ `engine/core/RenderLoop.ts`（根路径 re-export）；空闲无 rAF；仅播放时 `core/Clock.ts` 跑时钟                                                                                                                              | 5.5                             |
| 命令 + 撤销         | 命令式历史                                               | 部分：`History` + `SnapshotCommand`；`MAX_HISTORY=50` 从栈底丢弃；拖拽松手入一条；无 `Transaction` / revision                                                                                                               | 5.5                             |
| 旋转 / 缩放 gizmo   | TransformGizmo                                           | ✓ `interact/UnifiedGizmo.ts` + `interact/gumball/`：移动 / 旋转 / 缩放三种 handle，支持多选与 Alt 拖拽复制                                                                                                                  | 已落地                          |
| 指针仲裁            | GestureCoordinator                                       | — 无独立仲裁器；`UnifiedGizmo` capture 阶段拦 `pointerdown`，`ViewportNavigation` 让位                                                                                                                                       | **已取消**                      |
| OutlinePass 描边    | Composer                                                 | —                                                                                                                                                                                                                           | **已取消**                      |
| IK 求解             | IKSolver                                                 | 部分：`interact/joints/twoBoneIk.ts` 单肢两骨解算供视口摆姿；4 链 + pole + spine 求解器仍取消                                                                                                                               | 已落地（缩范围）                |
| 事务 + revision     | Transaction                                              | —                                                                                                                                                                                                                           | 宿主接入时                      |

「阶段」列表示计划做的时机：`5` 在基础版本范围内、`5+` 在之后、`宿主接入时` 表示等真实宿主提出需求再做。

**已取消** 的四项不是待办，不要去实现，理由见 §9「已取消」。

### 12.1 bridge 转发（5A-3 已消化）

四处 re-export 已按原计划消除：`FCurveSet` / `TrackProp` 由组件直引 `evaluate/`；
`POSE_CONTROLS` 在 `data/poseControls.ts`；导出收进门面 `captureFrame` / `recordRange`。
`useEngine()` 返回 `DirectorEngine` 接口。

---

## 附录：分层依赖的 ESLint 约束

把 §2.2 的依赖规则与 §3.5 的可嵌入约束固化。这套规则是本架构唯一的强制项——只要它不被绕过，`contract/` 与 `evaluate/` 就能在换状态库、换构建工具、换宿主、甚至换渲染框架时原封不动。

> 下面是**规则意图**，不是可直接复制的配置。实际生效的以仓库根 `.eslintrc.cjs` 为准：
> 那里的 `files` 用 `packages/builder/src/**` 前缀（monorepo 根），另有
> `no-restricted-globals` 拦 `fetch` / `localStorage` / `sessionStorage`，
> 且分层规则可通过 `LAYER_RULES=off` 临时关闭。改规则改那个文件，别改这里。

```js
// contract：零依赖底座
{ files: ['src/contract/**'],
  rules: { 'no-restricted-imports': ['error', { patterns: ['../*'] }] } },

// evaluate：禁 three（最强的一条）
{ files: ['src/evaluate/**'],
  rules: { 'no-restricted-imports': ['error', {
    paths: ['three', 'react', 'react-dom', 'mobx', 'zustand'],
    patterns: ['three/*', '../engine/*', '../document/*', '../stores/*', '../components/*'],
  }] } },

// engine：禁 react / 状态库 / document / stores
{ files: ['src/engine/**'],
  rules: { 'no-restricted-imports': ['error', {
    paths: ['react', 'react-dom', 'mobx', 'mobx-react-lite', 'zustand'],
    patterns: ['../document/*', '../stores/*', '../components/*', '../bridge/*', '../host/*'],
  }] } },

// document / stores：禁 react / three / engine
{ files: ['src/document/**', 'src/stores/**'],
  rules: { 'no-restricted-imports': ['error', {
    paths: ['react', 'react-dom', 'three'],
    patterns: ['three/*', '../engine/*', '../components/*'],
  }] } },

// sync：唯一允许同时引用 mobx 与 engine 的地方
{ files: ['src/sync/**'],
  rules: { 'no-restricted-imports': ['error', {
    paths: ['react', 'react-dom'], patterns: ['../components/*'],
  }] } },

// components：只能经 bridge 访问引擎
{ files: ['src/components/**'],
  rules: { 'no-restricted-imports': ['error', {
    paths: ['three'], patterns: ['three/*', '../engine/*', '../sync/*'],
  }] } },

// data：纯数据
{ files: ['src/data/**'],
  rules: { 'no-restricted-imports': ['error', {
    patterns: ['../engine/*', '../evaluate/*', '../document/*', '../stores/*',
               '../components/*', '../host/*', '../sync/*', '../bridge/*'],
  }] } },

// ★ 可嵌入底线：包内不得直连网络或宿主存储，一律经 HostAdapter
{ files: ['src/**'],
  rules: { 'no-restricted-globals': ['error',
    { name: 'fetch',          message: '走 HostAdapter' },
    { name: 'localStorage',   message: '走 HostAdapter' },
    { name: 'sessionStorage', message: '走 HostAdapter' },
  ] } },
```

`bridge/` 是唯一同时用 react 和 engine 的地方，因此它不受 `components` 那条约束。`host/` 目前只有纯函数（`assetKeys.ts` / `resolve.ts`）与类型；将来若要在那里实现需要 react 的默认 toast，按目录归入 `bridge/` 或单开例外。
