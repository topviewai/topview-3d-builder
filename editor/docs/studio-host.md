# Studio 本地宿主

> 调试台 `apps/studio` 是纯本地宿主：没有登录、没有密钥，也不访问任何外部服务。
> 包只认 `documentId`；草稿存储、素材检索和文件读取都在 Studio 服务端完成。
> 工作台形态与 adapter 细节见 [`workbench.md`](./workbench.md)。

---

## 1. 启动

```bash
pnpm install
pnpm dev                                    # http://localhost:3002
# 或者构建后启动
pnpm build && pnpm --filter @topview/3d-studio start
```

可选配置写在 `apps/studio/.env.local`（从 `.env.example` 复制，不要提交）：

| 变量 | 作用 | 缺省 |
|---|---|---|
| `TOPVIEW3D_BUILTIN_ASSETS` | 内置素材库目录（含 `manifest.json`） | 仓库根 `builtin-assets/` |
| `TOPVIEW3D_PROJECTS` | 要只读打开的 CLI 项目目录，多个用系统路径分隔符隔开 | 空 |

改了变量要重启服务。

---

## 2. 素材从哪来

`LocalHostAdapter`（`apps/studio/src/LocalHostAdapter.ts`）只打同源的 `/api/local-assets/*`，
服务端（`apps/studio/src/localAssets.ts`）读取与 CLI 相同的素材清单（`scene3d-asset-manifest` v1）：

1. 内置库 `builtin-assets/manifest.json`；
2. `TOPVIEW3D_PROJECTS` 里每个项目的 `.topview3d/assets/manifest.json`，同 id 时项目覆盖内置。

| 路由 | 用途 |
|---|---|
| `GET /api/local-assets/search?kind=&keyword=&category=&tags=&pageNo=&pageSize=` | 角色 / 道具 / 姿势检索，返回 builder 的目录条目 |
| `GET /api/local-assets/facets?kind=` | 分类与标签计数 |
| `GET /api/local-assets/asset/{assetId}` | 按素材 id 取模型或姿势文件 |
| `GET /api/local-assets/cover/{assetId}` | 封面 |
| `GET /api/local-assets/file/{key}` | 草稿里记录的素材 key（如 `metadata.modelUrl`）→ 清单中的文件 |

只有清单里列出的文件能被读到，清单外的 key 一律 404。图元（box / sphere 等）由 builder 自己生成，
不走素材库。

**动作（motion）**：素材清单目前没有动作类型，adapter 对 `kind: 'motion'` 直接返回空列表，
动作面板显示「未安装动作」。已有草稿里的动作片段仍可编辑，渲染时角色保持姿势。

---

## 3. 文档从哪来

| 来源 | 列在工作台 | 读 | 写 |
|---|---|---|---|
| 本地草稿 | 「我的草稿」 | `GET /api/drafts/{id}`（+ `/fcurves`） | `PUT /api/drafts/{id}`（+ `/fcurves`），文件在 `apps/studio/drafts/`（已 gitignore） |
| CLI 项目 | 「CLI 项目（只读）」，来自 `TOPVIEW3D_PROJECTS` | `GET /api/projects/{id}`（+ `/fcurves`），读 `.topview3d/document.json` 与 `fcurves.json` | 不写 |

CLI 项目只读：`document.json` / `fcurves.json` 是 CLI 从 `entities.json` 派生的视图，Studio 直接覆写会被
下一次 CLI 写入冲掉，也绕过了 CLI 的单写者版本号。所以 Studio 以 `readOnly` 打开（写锁开启、不自动保存），
修改请用 `topview-3d-cli` CLI。要让 Studio 可写回 CLI 项目，需要把整份文档的差异翻译成 CLI 操作，
这不在当前范围内。

---

## 4. 离线验收

```bash
pnpm --filter @topview/3d-studio build
pnpm --filter @topview/3d-studio test:offline
```

`scripts/offline-smoke.mjs` 启动 `next start`，用 Playwright 打开工作台，只放行 `localhost`：
新建草稿 → 检索姿势 → 放一个角色 → 套一个姿势 → 保存 → 回读草稿。出现登录界面、任何外部请求或
HTTP 错误都会失败；结束时删除这份临时草稿。已有服务时用 `STUDIO_URL=http://localhost:3002` 跳过启动。

---

## 5. 排障

| 现象 | 原因 |
|---|---|
| 角色 / 姿势面板为空 | `TOPVIEW3D_BUILTIN_ASSETS` 指错目录，或 `manifest.json` 格式不是 `scene3d-asset-manifest` v1（服务端日志有提示） |
| 草稿里的模型加载 404 | 草稿引用的 key 不在任何清单里；用 CLI `topview-3d-cli assets import` 导入，或把项目加进 `TOPVIEW3D_PROJECTS` |
| 看不到「CLI 项目」 | `TOPVIEW3D_PROJECTS` 没配，或目录下没有 `.topview3d/document.json` |
| 改了 `.env.local` 没生效 | 没重启服务 |
