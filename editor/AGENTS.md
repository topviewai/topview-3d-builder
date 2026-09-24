# AGENTS.md — @topview/3d-builder 开发规范

> 本文件是协作与 AI 助手的**唯一权威源**。细则文档只解释「怎么实现」，不另定分支或门禁。
> 冲突时：本文件 > `docs/*` > README 里的操作说明。

技术文档索引（不重复写进本文件）：

| 文档 | 管什么 |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | **目标架构**——分层、依赖方向、设计约束；UI 细则在 §6，离线视频导出栈见 §5.8，文件落点硬规则以本文件 §8 为准 |
| [`docs/draft-format.md`](docs/draft-format.md) | 持久化 JSON 与求值语义 |
| [`docs/film-editorial.md`](docs/film-editorial.md) | **成片剪辑 `content.editorial`**——两条时间轴、不变量、纯函数 API、事务 / 播放 / 导出契约、脚本集成 |
| [`docs/assets-manifest.md`](docs/assets-manifest.md) | 素材 key 布局、骨架/重定向约束、二进制不进仓 |
| [`docs/workbench.md`](docs/workbench.md) | `apps/studio` 宿主实现 |
| [`docs/studio-host.md`](docs/studio-host.md) | Studio 本地宿主：素材清单、草稿、只读打开 CLI 项目、离线验收 |
| [`docs/observation-notes.md`](docs/observation-notes.md) | 契约来源的观测记录（不是规范） |

⚠️ `architecture.md` 描述的是**目标态**，它自己开头就声明「与当前代码现状无关」。
**当前**的导出面与接口一律以代码为准：

- 包导出面 → `packages/builder/src/index.ts`
- HostAdapter 接口 → `packages/builder/src/host/types.ts`
- 宿主参考实现 → `apps/studio/src/LocalHostAdapter.ts`

`architecture.md` §12 达成度矩阵里标 `—` 的项**不等于待办任务**。其中 outline 描边
已明确取消，不要去实现。要做哪一项先问维护者。

旋转 / 缩放 handle 与 IK **已解禁并落地**：gumball 的三种 handle 在
`engine/interact/UnifiedGizmo.ts` + `interact/gumball/`，视口关节摆姿的 two-bone IK
在 `interact/joints/`。注意落地范围小于原计划——IK 只解单肢两骨，没有 4 链 + pole +
spine 求解器。

---

## 1. 仓库定位

这是 **一个可挂载 npm 包** + **一个调试宿主**，不是产品站点。

```
packages/builder   # @topview/3d-builder，发布面
apps/studio        # 调试台，只消费包的 dist
docs/samples       # 内置示例草稿（只读）
apps/studio/drafts # 本地草稿（gitignore）
```

- 包只处理**单数**：给 `documentId`，载入 / 编辑 / 保存这一份文档。
- 列表 / 新建 / 删除、文件落盘、CDN、上传全部属于宿主。
- `apps/studio` **禁止**用 tsconfig paths / webpack alias 指向包的 `src`。

改分层前先读 `docs/architecture.md` 的设计约束；改接口前以 `index.ts` / `host/types.ts` 为准。

编辑器是**工作台首页上的 overlay**，不是独立路由。`onClose` 是 `DirectorStudio` 的
**prop**（不在 adapter 上）：传了才渲染 header 右侧退出，不传就不渲染。

`docs/samples/` 只给 golden / zod 测试当冻结夹具，**不**出现在工作台。
工作台只列 `apps/studio/drafts/` 里的用户草稿。

---

## 2. Git 分支

从 `main` 切分支开发，分支名用 `feature/` `fix/` `refactor/` 前缀加 kebab-case 简述。
合入前先同步 `main`，并跑绿 §4 的门禁。

---

## 3. 包与宿主边界

| 可以进 `packages/builder` | 必须留在 `apps/studio`（或真实宿主） |
|---|---|
| 单份文档的载入 / 编辑 / 保存接口 | 草稿列表、新建、删除 |
| `makeEmptyDraft()`（schema） | 文件路径、`drafts/` 落盘 |
| 素材 **key / 目录约定**（`host/assetKeys.ts`） | key → 文件 / URL 的解析（`resolveAssetUrl`） |
| 帧求值、引擎、UI 面板 | 素材清单读取、devtools |
| 三类库的 **类型** | 三类库的 **拉取实现** |

硬规则：

- 包内零 `fetch`、零 `/api/` 路径、零具体模型文件名绑定。
- 角色 / 道具 / 动作三类统一走 `searchAssets` + `listAssetFacets` 分页契约；缺一类就会退化成硬编码。
- 素材 key 一律由宿主 `resolveAssetUrl` / `resolveMediaUrl` 解析成可加载地址；包内没有公共 CDN 兜底。
- FBX rest 对齐按**骨骼名前缀**（`mixamorig`）找已加载模板，不按某个 glb 文件名。
- `pippitAssetId` 是持久化 wire 字段，禁止改名。

干净度自检：

```bash
rg -n "\\bfetch\\(|/api/" packages/builder/src
rg -n "console\\.log" packages/builder/src
rg -n "PUBLIC_BUILDER_PREFIX|3d-builder/public/" packages/builder/src
```

期望：前两条 0 命中；第三条只剩测试夹具 / 注释里对已删除前缀的否定断言。

`fetch` / `localStorage` 另有根 `.eslintrc.cjs` 的 `no-restricted-globals` 兜底，
`pnpm lint` 会拦；上面的 `rg` 只是快速自查。

### 3.1 导出面变更：加法优先

- 新增 API，不改旧 API 签名。旧 API 保留并用 `@deprecated` 注明替代者
  （现成写法见 `packages/builder/src/host/types.ts` 的 `@deprecated` 注释）。
- 契约层变更（`host/types.ts` 的 HostAdapter、`index.ts` 的导出面、draft JSON 字段、
  事件名）的运行时破坏 `pnpm typecheck` 抓不到，要在 Studio 里实跑验证。

---

## 4. 本地门禁

改动包或 studio 后，**全部**跑绿再提交：

```bash
pnpm typecheck
pnpm lint
pnpm test:evaluate
pnpm build
pnpm --filter @topview/3d-studio test:offline   # 离线验收，见 docs/studio-host.md
```

- `docs/samples/golden/` **禁止默默 regenerate**。求值结果必须与基线逐字节相同。只有语义变更且经评审同意，才允许显式 `pnpm generate:golden` 并在 commit message 里说明原因。
- golden 只覆盖 `evaluateFrame`（纯数据）。改了 three.js 加载 / 重定向（`AssetLoader` / `MotionPlayer` / `applyRetarget`）必须再开一份带 `motionClips` 的草稿（如 `beach`）做浏览器播放验证。
- `pnpm dev` 的 watch 会把 `dist` 变成多文件树。提交前确认没有把 watch 产物当发布 bundle 提交；`dist/` 已 gitignore。
- 改了包的导出类型签名：watch 不重出 `.d.ts`，要重跑 `pnpm typecheck` 或重启 `pnpm dev`。
- `pnpm check:locales`（含在 `pnpm lint` 里）**只校验** `packages/builder/src/locale/strings` 的 15 语 key / 占位符 / 调用点。`apps/studio` 是包外调试宿主，工作台文案固定写中文，禁止 `t()` / 语言包；右下角切换只给包内导演台做 15 语联调。不要求 studio json 与包、或各 studio json 之间 key 对齐。

---

## 5. 提交

Commit 前缀：`feat:` `fix:` `refactor:` `docs:` `chore:` `test:`，一句话说清**为什么**。
描述写明改的是包还是 studio、如何验证、有没有动 golden。

---

## 6. 密钥与仓库内文件

禁止提交：`.env` `.env.local`、任何密钥、素材二进制。

二进制的 `.gitignore` 规则覆盖 `apps/studio/public/assets/**/*.{glb,fbx,gif,png}`
和 `apps/studio/public/media`。**别绕开它**——glb / fbx / gif / png 不进 `editor/`，
也不要塞到 `docs/` 或 `packages/` 下躲过忽略规则。内置素材只在仓库根 `builtin-assets/`，
清单格式见 `docs/assets-manifest.md`。

允许提交：`docs/samples/*`（测试夹具，只读）。`apps/studio/drafts/` 是本地草稿，已 gitignore。

---

## 7. 日常开发

```bash
pnpm install
pnpm dev            # http://localhost:3002
```

`pnpm dev` 先完整构建包，再 `bundle: false` watch；studio 只解析 `dist`。改包内组件走 Fast Refresh，不重建 WebGL。发布形态仍是 `pnpm build` 的单 bundle。Studio 不需要账号、密钥或网络。

---

## 8. `components/` 文件落点（强制）

拆分阈值、observer 粒度、类名前缀等 UI 细则见 [`docs/architecture.md`](docs/architecture.md) §6。
**本条只定文件放哪**；新增或改到哪个面板，就必须按这个落。不要另起
`data/` / `store/` / `helpers/` / 组件内 `locale/` 这类别处工程的结构。包外工作台也不要往
`packages/builder/src/locale` 塞宿主文案。

一个面板一个目录，目录名 kebab-case（`leftrail/` `topbar/` `film/`）。目录内：

```
components/<panel>/
├── index.tsx        # 只编排：布局与把数据传给子组件
├── types.ts         # 面板内共享类型；没有就不建
├── constants.ts     # 静态常量
├── utils.ts         # 纯函数；变多再拆 utils/
├── hooks/           # 面板私有 hook
├── Foo.tsx
└── Bar.tsx
```

硬规则：

- 属于该面板的 `useXxx.ts` **必须**进该面板 `hooks/`，禁止和 `.tsx` 平铺
- 跨面板 hook 放 `components/hooks/`
- 纯函数放 `utils.ts` 或 `utils/`，不要另起 `helpers/`
- `index.tsx` 出现业务计算、数据转换，或超过 3 个 `useEffect` → 拆进 `hooks/`
- 行数：<300 正常；300–500 评估拆；>500 必须拆
- 同一 UI 模式出现 3 次以上才抽到 `common/`；表单控件类一开始就放 `common/`
- 存量平铺不搞整目录搬家；改到哪个面板，再把该面板的 hook / util 归位
