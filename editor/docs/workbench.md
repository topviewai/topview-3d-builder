# 宿主实现：apps/studio

> `apps/studio` 是包的调试宿主，**不是包的一部分**。它只消费 `packages/builder` 的 `dist`，
> 承担一切集合操作（列表 / 新建 / 删除）与一切 IO（草稿文件、素材清单）。
> 包侧边界判据见 [`architecture.md`](./architecture.md) §3.5。
> 分支、合入方向与门禁见仓库根 [`AGENTS.md`](../AGENTS.md)。
> 本地素材、CLI 项目只读打开与离线验收：[`studio-host.md`](./studio-host.md)。

---

## 1. 职责划分

包只处理**单数**：给它一个 `documentId`，它负责载入、编辑、保存这一份文档。
「有哪些文档」「新建一份」「删掉一份」全部属于宿主。

| 能力 | 归属 | 位置 |
|---|---|---|
| 载入 / 保存单份文档 | 包 | `HostAdapter.loadDocument` / `saveDocument` |
| 空文档长什么样 | 包 | `makeEmptyDraft()`（schema 知识） |
| 新建时的默认场景 | 包 | `createInitialDraft()`（相机 + 原点默认角色） |
| 文档存到哪里 | 宿主 | `apps/studio/src/draftStore.ts` |
| 列表 / 新建 / 删除 | 宿主 | `app/api/drafts/**` + 工作台首页 |
| 素材从哪来 | 宿主 | `LocalHostAdapter.searchAssets` / `listAssetFacets` → 本地素材清单 |
| 素材 URL | 宿主 | `resolveAssetUrl` / `resolveMediaUrl`：key → `/api/local-assets/file/{key}`（包内无公共 CDN） |
| 素材 key 与目录约定 | 包 | `host/assetKeys.ts` + `LIBRARY_ASSET_PREFIX` |

「新建」对包而言不存在：宿主调 `createInitialDraft(adapter, ...)` 拿到默认场景（要纯空稿用
`makeEmptyDraft()`），自己存好得到 id，再挂 `<DirectorStudio documentId={newId}>`。包只看到又一次普通载入。

默认场景由包定义，避免每个宿主各写一份而彼此分叉：`createInitialDraft` 经
`adapter.searchAssets({ kind: 'character' })` 取库里的默认角色（当前按 `DEFAULT_CHARACTER.name`
认，库里有稳定标记后改按标记取），放在原点并套站姿；取不到就只留相机，不阻断新建。
只在新建时调用——打开既有文档再种，会把用户删掉的人加回来。

---

## 2. 草稿存储

工作台只认用户草稿；golden 夹具不进工作台：

```
apps/studio/drafts/                 # 用户草稿，可写，已 gitignore
├── <id>.json                       #   文档本体
└── <id>.fcurves.json               #   用户关键帧，与文档分开存

docs/samples/*.json                 # 冻结测试夹具，不参与工作台
docs/samples/golden/                # 逐帧求值基线
```

用户草稿走 `node:fs` 直接读写文件，只存在本机。`docs/samples/` 只给 `evaluate` 测试读，
`draftStore` 不再分流内置示例。

文档与关键帧分两个文件，对应 adapter 上对称的两对方法
（`loadDocument` / `saveDocument`、`loadFCurves` / `saveFCurves`）。

草稿名存在 `extra.customDraftName`——这是 `makeEmptyDraft` 的既有行为，
该文档格式里没有 `content.name` 字段，列表读取据此对齐。

### API

所有 route 都显式声明 `export const runtime = 'nodejs'`。Next.js 15 的默认值本就是
Node.js，但一旦有人改成 edge 就没有 `fs`，草稿落盘会整条失效——显式写出来是为了锁住这点。

| 路由 | 方法 |
|---|---|
| `/api/drafts` | `GET` 列表 · `POST` 新建 |
| `/api/drafts/[id]` | `GET` · `PUT` 保存 · `DELETE` |
| `/api/drafts/[id]/fcurves` | `GET` · `PUT` |
| `/api/projects` · `/api/projects/[id]` · `/api/projects/[id]/fcurves` | `GET`：`TOPVIEW3D_PROJECTS` 里的 CLI 项目，只读 |
| `/api/local-assets/*` | `GET`：素材检索、facets 与文件，见 [`studio-host.md`](./studio-host.md) §2 |

id 受 `/^[a-z0-9][a-z0-9_-]{0,63}$/i` 约束，删除时连带清掉 fcurves 文件。
`POST` 的重名检查走 `readDraft`。

---

## 3. 页面

只有一个页面路由：

| 路由 | 用途 |
|---|---|
| `/` | 工作台：列表 / 新建；点草稿在当前页 overlay 打开 `DirectorStudio`。打开后 URL 带 `?draft=<id>`（CLI 项目为 `?project=<id>`），刷新 / 复制链接可回到同一份 |

工作台文案属于宿主，固定中文，不要走 `t()` / studio locale json。
`check:locales` 不扫 `app/workbench`。右下角语言切换只作用于包内导演台，
不要再把工作台首页、建草稿包进多语言。

导演台**没有**独立路由。`app/page.tsx` 是三行薄壳，实现在 `app/workbench/`
（普通目录，不是路由段）：

```
apps/studio/app/
├── page.tsx                            # 薄壳：渲染 <WorkbenchClient />
└── workbench/
    ├── WorkbenchClient.tsx             #   工作台编排
    ├── components/StudioOverlay.tsx    #   overlay 挂 DirectorStudio，传 onClose / readOnly
    ├── components/DraftCard.tsx  CreateDialog.tsx  icons.tsx
    ├── hooks/useWorkbenchDrafts.ts     #   草稿列表 / 新建 / 删除 + CLI 项目列表
    └── constants.ts  types.ts  utils.ts  styles.css
```

多实例机制在包内：`documentId` prop、每实例独立 store、portal 归属隔离、
`claimAppKeyboard` 键盘作用域仲裁。工作台同一时间只 overlay 一份草稿。

---

## 4. LocalHostAdapter 实现要点

```ts
new LocalHostAdapter()            // 本地草稿，可写
new LocalHostAdapter('project')   // CLI 项目，只读：不实现 saveDocument / saveFCurves
```

- `searchAssets` / `listAssetFacets` 转发给 `/api/local-assets/search` 与 `/facets`，服务端直接返回
  builder 的目录条目（`file` 是素材 key，`modelUrl` / `coverUrl` 是本地路由）。
- `kind: 'motion'` 直接返回空列表，面板显示「未安装动作」。
- `resolveAssetUrl(key)` → `/api/local-assets/file/{key}`，服务端只提供清单里列出的文件。
- `loadPoseById` 先查姿势目录；内置预设（如 `stand`）不在清单里时返回 `null`，由 builder 用自带数据。
- 关键帧的 `encodeUserKeys` 编码在包内 `StudioSession.save` 完成，adapter 只负责把结果原样 PUT。

---

## 5. 接入新宿主的最小清单

接口以 `packages/builder/src/host/types.ts` 为准。必须实现：

```ts
loadDocument(documentId): Promise<TDocument>
searchAssets(query: AssetQuery): Promise<AssetPage<LibEntry>>
listAssetFacets(kind: AssetQuery['kind']): Promise<AssetFacets>
```

素材 URL：必须实现 `resolveAssetUrl`（把 key 解析成可加载地址；线上宿主可在这里签名）。
`resolveMediaUrl` 可省略，包会走 `resolveMediaKey` + `resolveAssetUrl`。

按需实现：`saveDocument`（不实现则包禁用保存入口，不报错）、`saveFCurves`、
`loadFCurves`、`resolveMediaUrl`、`onExport`。

`onClose` 不在 adapter 上，它是 `DirectorStudio` 的 prop：传了才渲染 header 右侧退出。

三类素材库**必须对称**。少实现一类，那一类就只能退回硬编码；服务端分页与 facets
是唯一运行时来源。

---

## 6. 包干净度门禁

包内不得出现宿主布局知识、具体资产、调试输出：

```bash
rg -n "\bfetch\(|/api/" packages/builder/src                   # 期望 0：包不直连网络、不知道宿主路由
rg -n "console\.log" packages/builder/src                      # 期望 0：错误路径用 warn/error
rg -n "PUBLIC_BUILDER_PREFIX|3d-builder/public/" packages/builder/src  # 期望 0（测试否定断言除外）
```

改动包或宿主后的门禁命令见 [`AGENTS.md`](../AGENTS.md) §4（那里是唯一权威源，
别在这里另写一套）。核心一条：**`docs/samples/golden/` 逐帧基线不得 regenerate**——
求值结果必须逐字节相同，这是行为等价的唯一证明。

功能回归至少覆盖：新建后 overlay 打开编辑并落盘；编辑后保存，刷新仍在；
overlay 关闭后列表仍在，再打开同一份草稿状态一致。
