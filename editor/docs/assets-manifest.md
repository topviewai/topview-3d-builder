# 3D 导演台运行时资产清单

用途：固定素材 key 布局与本地素材清单，说明骨架 / 重定向约束与仓库内的测试夹具。

> 分支、合入方向与门禁见仓库根 [`AGENTS.md`](../AGENTS.md)。

---

## 1. 现状

素材一律来自本地素材清单（`scene3d-asset-manifest` v1，CLI 与 Studio 共用）：

- 内置库：仓库根 `builtin-assets/manifest.json`（角色、姿势、图元），随 CLI wheel 分发；
- 项目素材：CLI 项目的 `.topview-3d/assets/manifest.json`，由 `topview-3d-cli assets import` 写入。

清单字段与校验规则以 `agent/topview_3d_cli/local_assets.py` 为准。现行规则：

- 草稿只存素材 key（如 `3d-builder/library/characters/<id>-<sha8>.glb`），清单把 key 映射到本地文件，详见 §5。
- 二进制不进 `editor/`。`.gitignore` 排除 `apps/studio/public/assets/**/*.{glb,fbx,gif,png}`
  与 `apps/studio/public/media`；`apps/studio/public/assets/` 也不放 catalog JSON。

---

## 2. 骨架与重定向

内置角色是 mixamorig 骨骼命名的白模。动作片段（FBX，`sourceRig=mixamorig`）按骨骼名直接绑定，
无需重定向；本仓目前不带任何动作素材。

包内找 FBX rest 对齐模板时是**按骨骼名前缀 `mixamorig` 遍历已加载模板**
（`AssetLoader.mixamorigTemplate()`），不绑定任何具体文件名——换一个 mixamorig 白模同样能用。

UAL1 骨架的角色走重定向链路：`evaluate/retarget/RetargetMap.ts` 的 mixamorig→UAL1 52 项
映射 + `engine/rig/applyRetarget.ts` 里 `Ual1Retargeter` 的世界系增量 FK，pelvis 位移按
rest 髋高比缩放，**按 rest 现算而非硬编码常量**。

单位换算不是统一的加载期缩放：mixamorig 同源靠 `MotionPlayer.retargetClip` 的 rest 对齐
吸收差异；只有 UAL1 重定向才对 pelvis 世界位移乘 `0.01`（`applyRetarget.ts`）。

---

## 3. 测试夹具

| 文件 | 说明 |
|---|---|
| `xiaoyunque-draft.json` | 冻结旧文档（无 `content.editorial`），evaluate 检查点 |
| `xiaoyunque-fcurves.json` | compact-v1 紧凑格式 |
| `qa-director-full-draft.json` | 素材库时代文档（`3d-builder/library/`，带 editorial） |
| `qa-director-full-fcurves.json` | compact-v1 |

这四份只给 golden / zod / drafts 测试当夹具，**不**出现在工作台。`xiaoyunque-*` 里的素材
key 仍是已下线的 `3d-builder/public/`；evaluate 层只算数值、不解析素材 key，所以不影响，
留着是因为它是唯一一份不带 `content.editorial` 的旧文档形态。

`docs/samples/golden/` 是逐帧求值基线，**禁止默默 regenerate**（见
[`AGENTS.md`](../AGENTS.md) §4）。

---

## 4. 目录结构

```
docs/samples/                               # 冻结测试夹具，不参与工作台
├── xiaoyunque-*.json
├── qa-director-full-*.json
└── golden/

apps/studio/drafts/                         # 本地草稿，已 gitignore

../builtin-assets/                          # 内置素材清单与文件（CLI 与 Studio 共用）
```

角色与姿势文件、封面只放在 `builtin-assets/`（或各 CLI 项目的 `.topview-3d/assets/`），不进 `editor/`。
`docs/samples/` 只给测试读，工作台只认 `apps/studio/drafts/`（外加只读的 CLI 项目）。

---

## 5. 路径解析

`packages/builder` 内不出现任何 `/assets/` 字面量。官方素材前缀
`3d-builder/library/` 属于包（`LIBRARY_ASSET_PREFIX`）。key 到可加载地址的解析一律由宿主
`resolveAssetUrl` 完成，包内没有公共 CDN、也没有 `publicAssetBase`。

`apps/studio` 的 `LocalHostAdapter` 把 key 交给 `/api/local-assets/file/{key}`，服务端在清单里找到
对应文件后返回；清单外的 key 一律 404。CLI 渲染时用同一份清单建 key → 文件映射
（`local_asset_map`），两边看到的素材完全一致。

---

## 6. 素材检索

`searchAssets` / `listAssetFacets` 由宿主实现。Studio 在服务端按 `kind` / 关键词 / 分类 / 标签过滤清单，
直接返回 builder 目录条目（`file` 为 key，`modelUrl` / `coverUrl` 为本地路由），同 URL 的在途请求合并，
避免 React Strict Mode 打两遍。清单里没有 `motion` 类型，动作检索返回空列表。

新增素材用 CLI：`topview-3d-cli assets import <file> --kind character|prop|pose --id <id>`，写入项目自己的
清单；不要往 `builtin-assets/` 里手工塞文件，内置库的每个条目都带 `sha256`、`bytes` 与许可信息。
