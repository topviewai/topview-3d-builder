# director CLI

`@topview/3d-director-cli` is the Node runtime behind Scene3D evaluation and
headless rendering. It is a package in the `editor/` pnpm workspace and depends
on the workspace `@topview/3d-builder` source (`workspace:*`); there is no
prebuilt builder tarball.

```bash
cd editor
pnpm install
pnpm --filter @topview/3d-builder build   # dist/ is what cli.mjs and static/headless.html load
pnpm --filter @topview/3d-director-cli test
node packages/director-cli/cli.mjs <subcommand> <payload.json>
```

Rebuild the builder after changing `packages/builder/src`; the CLI imports
`@topview/3d-builder/dist/**` directly.

## 子命令与调用方

| 子命令 | `director_runtime.CLI` 键 | 谁在用 | 说明 |
|---|---|---|---|
| `apply-intent` | `apply_director_intent` | `batch_director_nodes`（`director_batch.py`） | 在 staged 文档上执行 add-primitive / add-prop / add-character / add-camera / update / delete，走 `staticIntent.mjs` 纯静态求值，返回 `document` + `createdIds` + `measurements` |
| `apply-library-pose` | `apply_director_pose` | `batch_director_poses`（`director_pose.py`） | 把官方库静态 pose payload 编译到角色节点（`static/pose.mjs`） |
| `inspect-nodes` | `inspect_director_nodes` | `inspect_director_nodes` 工具 | 世界尺寸 / 包围盒 / 支撑面 / 角色 landmark（`static/measure.mjs`） |
| `evaluate-plan` | `evaluate_director_plan` | `evaluate_director_plan` 工具 | 不落库的 dry-run：对 `changes` 套用后按帧算穿地 / 视锥 / scale 标志 |
| `evaluate` | `evaluate_director_frames` | `inspect_director_views`（`director_views.py`） | 多机位数值检查的底层求值 |
| `render-frames` | `render_director_frames` | `render_director_frames` / `inspect_director_views` | Playwright 截帧 + contact sheet，见下文持久化 |
| `bake` | `bake_camera_motion` | 目前无 MCP 工具 | 相机运动预设烘焙成 clip，保留给 `apply_director_operations` 之外的后续工具 |
| `edit-sequence` | `apply_director_editorial` | 目前无 MCP 工具 | editorial 时间线编辑，同上 |
| `list-camera-presets` | `list_director_camera_presets` | 目前无 MCP 工具 | 相机运动预设枚举 |
| `validate` | — | 本地脚本 | 校验一份 director 文档 |

`static/` 下的 `measure.mjs` / `pose.mjs` 和 `staticIntent.mjs` 在 Node 里直接用
`@topview/3d-builder` 的求值器，不起浏览器；只有 `render-frames` 需要 Playwright。

## Browser setup across platforms

After installing this package's Node dependencies, prepare and verify the matching
Playwright Chromium with:

```bash
node cli.mjs browser ensure
```

Playwright chooses the browser build for the current OS and architecture and
stores it in its platform cache. `PLAYWRIGHT_BROWSERS_PATH` can point to a shared
or pre-provisioned cache; the Linux sandbox image uses `/opt/ms-playwright`.
On Linux hosts that are missing shared libraries, install those OS packages too:

```bash
node cli.mjs browser ensure --with-deps
```

`--with-deps` uses Playwright's Linux package installer and may require root or
sudo. macOS and Windows use `browser ensure` without that option.

## render-frames 输出

`render-frames` payload 必须带 `outputDir`：绝对路径 `<…>/renders/<runId>`，不含 `.` / `..`
段，`runId` 为 `[A-Za-z0-9_-]{1,128}`（见 `render.mjs` 的 `resolveOutputDir`，POSIX 与 Windows
路径都接受）。目录里写 `frame-<n>.png`、`contact-sheet.png` 和 `render.json`；payload 的
`metadata` 对象原样写进 `render.json`。stdout 只回 `path` / `sizeBytes` / `sha256`，不带 base64。

素材离线解析：

- `localAssets`：素材 key → 本机绝对路径。只有这里列出的文件会经本地静态服务提供。
- `publicAssetBase`（或 `TOPVIEW3D_DIRECTOR_PUBLIC_ASSET_BASE`）默认空；设置后本地缺的
  `3d-builder/public/...` key 从它加载，它的 origin 也是 Chromium 唯一可访问的外部 origin。
- 其余请求一律拦截，记录在结果和 `render.json` 的 `blockedRequests` 里。
- 本地找不到的人物 / 道具报 `ASSET_NOT_AVAILABLE:<key>`；缺失的动作解析为空，角色保持姿势。
