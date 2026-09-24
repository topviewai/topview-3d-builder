# @topview/3d-builder

可挂载的 3D 导演台 npm 包，以及独立调试台 `apps/studio`。

**先读 [`AGENTS.md`](./AGENTS.md)**——协作、分支与门禁的唯一权威源。
第一次把项目跑起来：`pnpm install` → `pnpm dev` → `http://localhost:3002`。

其余文档：目标架构 [`docs/architecture.md`](docs/architecture.md)、数据契约
[`docs/draft-format.md`](docs/draft-format.md)、素材清单
[`docs/assets-manifest.md`](docs/assets-manifest.md)、宿主接入
[`docs/workbench.md`](docs/workbench.md)、本地宿主 [`docs/studio-host.md`](docs/studio-host.md)。

## 结构

```
packages/builder    # @topview/3d-builder，tsup 出 cjs + esm + dts
apps/studio         # Next.js 15 调试台，只消费包的 dist
apps/studio/drafts  # 本地草稿（gitignore）
docs/samples        # 内置示例草稿（只读）+ golden 逐帧基线
```

`apps/studio` **禁止**用 tsconfig paths / webpack alias 指向包的 `src`：开发与构建都只消费 `dist`。

## 开发模式

`pnpm dev` 先完整构建一次，再让 tsup 以 `bundle: false` 持续 watch。此时 `dist` 是与 `src`
一一对应的多文件树（不是发布用的单 bundle），webpack 得以看到细粒度模块边界，
配合 `next.config.mjs` 的 `transpilePackages` 注入 react-refresh，改包内组件走 Fast Refresh，
不会重建引擎与 WebGL 上下文。发布形态仍由 `pnpm build` 产出单 bundle，两者解析路径一致。

两点已知差异：

- watch 期间不重新生成 `.d.ts`（`bundle: false` 下逐文件生成要 12.5s，单 bundle 只需 2.8s），
  沿用启动那次完整构建的快照。**改了导出类型签名要重跑 `pnpm typecheck` 或重启 dev。**
- tsup 在 `bundle: false` 下输出的相对 import 不带扩展名，webpack 按默认顺序解析到 `.js`(CJS)，
  因此开发期跑的是 CJS 产物、构建后是 ESM 单 bundle。

## 环境

- pnpm >= 8
- Node >= 18
- React 18.2
- TypeScript 5.3.3（`strict: true`）
- Next.js 15.1.9
- three 0.184

## 命令

```bash
pnpm install
pnpm dev            # 构建包 → 包 watch + studio（http://localhost:3002，改包代码热更新）

# 提交前四连全绿，见 AGENTS.md §4
pnpm typecheck
pnpm lint
pnpm test:evaluate
pnpm build
```

`pnpm generate:golden` 会重写 `docs/samples/golden/` 逐帧基线。**不要默默跑**——基线逐字节相同
是行为等价的唯一证明，只有语义变更且经评审同意才允许重生成，并在 commit message 里说明原因。

打开 `http://localhost:3002` 后点草稿卡片，导演台以 **overlay** 形式在当前页打开
（不是独立路由）。Studio 全程离线：素材来自本地素材清单，不需要账号或密钥，
见 [`docs/studio-host.md`](docs/studio-host.md)。

## 宿主挂载

```tsx
import '@topview/3d-builder/styles.css'

const DirectorStudio = dynamic(
  () => import('@topview/3d-builder').then((m) => m.DirectorStudio),
  { ssr: false },
)

// adapter 必须是稳定引用，内联字面量会让引擎与 WebGL 上下文随渲染重建
const adapter = useMemo(() => new MyHostAdapter(), [])

<DirectorStudio
  adapter={adapter}
  documentId={draftId}   // 包只认单份文档，列表 / 新建归宿主
  onClose={close}        // 可选；传了才渲染 header 右侧退出
/>
```

`HostAdapter` 要实现哪些方法见 [`docs/workbench.md`](docs/workbench.md) §5，
接口以 `packages/builder/src/host/types.ts` 为准。
