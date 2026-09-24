# 来源观测记录

> 这里收的是契约形成过程中对参考产品（小云雀 Scene3D Editor）的抓包与运行时观测，
> 以及对应的去壳 / 抓取方法。它们解释了字段与参数为什么长这样，但**不是规范**：
> 规范以 [`draft-format.md`](./draft-format.md) 与 [`architecture.md`](./architecture.md) 为准，
> 本仓的 Studio 与 CLI 全程离线，不访问这些接口。

## 1. 渲染与交互参数（原 architecture.md §5.6）

运行时观测到的确切配置，属于事实性参数，可直接照抄：

```ts
// 主视口 renderer
new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: false
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = 'srgb'; // 未设 toneMapping

// 截图用离屏 renderer
new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true
});
renderer.setPixelRatio(1);

// ↓ OutlinePass 已取消（§9「已取消」），本仓不实现；TransformControls 已落地，
//   见 engine/interact/UnifiedGizmo.ts
// OutlinePass 选中描边
outlinePass.edgeStrength = 4.2;
outlinePass.edgeGlow = 0;
outlinePass.edgeThickness = 1.35;
outlinePass.pulsePeriod = 0; // 不做呼吸动画

// TransformControls
transformControls.setSpace('local');
transformControls.setSize(0.2);
// 监听 'dragging-changed'（拖拽起止）与 'objectChange'（值变化）
```

枚举取值：

| 字段            | 取值                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `transformMode` | `select` / `translate` / `rotate` / `scale` / `path`（UI 上 select 与 translate 合并为一个按钮） |
| `selectionMode` | `pointer` / `single` / `multiple`                                                                |
| 关键帧插值      | `linear` / `bezier` / `hold` / `step` / `constant` / `easeIn` / `easeOut` / `easeInOut`          |
| 运镜分类        | `basic` / `character` / `space`                                                                  |
| 运镜门控        | `requiresCharacter` / `requiresFocusTarget` / `requiresOccluder` / `requiresPath`                |
| Pose 分组       | `body` / `arms` / `legs`                                                                         |

25 个 pose 控件的完整字段名：

```
body:  bodyBend  bodyTilt  bodyTurn  torsoBend  torsoTilt  torsoTurn  headNod  headTilt  headTurn
arms:  lArmRaise lArmStraddle lArmTurn lElbowBend  rArmRaise rArmStraddle rArmTurn rElbowBend
legs:  lLegRaise lLegStraddle lLegTurn lKneeBend   rLegRaise rLegStraddle rLegTurn rKneeBend
```

30 个运镜预设（分类以 `data/cameraLibrary.ts` 的 `categoryId` 为准，20 / 6 / 4）：

```
basic (20):     static_shot  tilt_up  tilt_down  pan_left  pan_right
                crane_up  crane_down  truck_left  truck_right
                dolly_in  dolly_out  zoom_in  zoom_out  crash_zoom
                handheld_shot  whip_pan  rack_focus
                slider_reveal  foreground_wipe  push_through
character (6):  follow_tracking  leading_tracking  profile_tracking
                orbit_180  ascending_orbit  descending_orbit
space (4):      aerial_establishing  fpv_flythrough  drone_dive  pull_away
```

注意 `rack_focus`（焦点转移）、`slider_reveal` / `foreground_wipe` / `push_through`
（三种遮挡关系运镜）都归在 **basic** 而非按语义直觉归入 character / space。

## 2. 状态库佐证（原 architecture.md §2 状态库选型）

实测佐证：小云雀站点内 MobX 被 **160 个模块**引用，是其主状态方案。但要注意——**它的 3D 引擎本身一个状态库都不用**，这条区分正是 §2.2 里 `engine/` 禁状态库那条规则的来源。

## 3. 拆接口包装（原 draft-format.md §1）

本节只在「又从小云雀抓了一份新草稿」时有用。日常开发不需要——仓库里的
`docs/samples/*.json` 都已经是去壳且改好 key 的成品。

```text
xiaoyunque.json                          # 小云雀接口响应，不在本仓
├── ret / errmsg / svr_time / log_id     # 接口状态，草稿不需要
└── data.Assets[]                        # 通常 1 条
    ├── PippitAssetID / version / uid
    ├── Image / Video / Audio / FileInfo # 本样本全空
    └── TextInfo.content                 # JSON 字符串 → 导演文档
```

先读外层，再 `json.loads(TextInfo.content)`。日常对照请直接打开已经去壳的
[`samples/xiaoyunque-draft.json`](./samples/xiaoyunque-draft.json)：

```json
{
  "type": "biz/scene3d-director-document",
  "pippitAssetId": "6643694107148",
  "extra": { "sourceNodeId": "6643694106892" },
  "content": { "...导演草稿..." }
}
```

| 字段 | 含义 |
|---|---|
| `type` | 固定 `biz/scene3d-director-document` |
| `pippitAssetId` | 这份草稿的资产 ID |
| `extra.sourceNodeId` | 来源节点 / 会话节点 |
| `content` | 可编辑的场景草稿本体 |

## 4. 抓草稿的接口形态（原 draft-format.md §13.5）

草稿正文走 `POST /api/biz/v1/asset/query`，响应壳
`data.Assets[].TextInfo.content`（JSON 字符串）。请求体格式未逆向成功
（`PippitAssetIDs` 字段会静默回退到画布文档），可靠的拿法是在页面里打开对应
导演台节点时抓 `asset/query` 的响应：打开瞬间的那一次批量 query 会在一个响应里
返回项目**全部**资产（导演文档 + fcurves + 画布 + 历史，实测 38 条），按
`PippitAssetID` 拆开取即可。`docs/samples/` 下两份草稿和两份 fcurves 都是这样抓的。

## 5. 运行时实测语义（原 draft-format.md §14）

在小云雀导演台页面（xyq.jianying.com）注入 JS 截获 three.js 场景，按帧 seek 后
逐节点 dump 世界位姿，与本包 `evaluateFrame` 同帧求值结果逐帧对比。
以下语义经 64 帧 × 37 节点实测验证：

1. **相机运动不链接**。每条 `cameraMotionClips` 的烘焙曲线是**绝对值**，播放时
   直接求值，不做段间偏移衔接。曲线连续性来自创作时按当前机位烘焙。clip 选择
   规则：数组序首个 `frameStart <= frame <= frameEnd`（共享边界帧归前一段）。
2. **片段之外回落节点静态 transform**。末段结束之后不保持末段终点，而是回到
   `nodes[].transform` + `camera.lookAt`（实测 camera_7 f430+ 位姿 = 草稿静态值）。
3. **fcurve bezier 缺手柄 → 水平自动切线**。出/入手柄缺失时在段 1/3 处补水平
   切线（y=端点值）；两端都缺时等价 smoothstep `t²(3−2t)`。不是 linear 回退。
   三个无手柄段（32–65 / 159–177 / 177–199）拟合误差 < 1e-3。
4. **路径 clip 末帧不生效**（`[frameStart, frameEnd)`）。末帧位置/朝向回落
   fcurve / 静态值（实测 character_1 f199 yaw=0，而非 path-tangent 的 90°）。
5. 相机朝向由 `camera.lookAt` 点经 three.js `lookAt()` 派生；静态机位间存在
   ≤0.14° 的 roll 约定差异，可忽略。

对比前修掉的复刻侧偏差：链式衔接默认值（原为开）、fcurve 无手柄段的 linear
回退、路径 clip 末帧边界。修复后全部 37 节点位置误差 ≤0.7 mm。

### 5.1 第二轮：荷兰角导演台 · 8 条运镜操作级对比（2026-09-11）

空白导演台加「荷兰角」机位（camera_5），再连点 8 条运镜：tilt_up/down、
truck_right/left、crane_down/up、pan_right/left（均 2 关键帧 bezier、
durationMs 2000、60 帧一段，帧区间 0–480）。复刻侧做同样操作后三层对比全部通过
（当时的一次性探测脚本已删除；现在这两份草稿由
`evaluate/__tests__/golden.test.ts` + `docs/samples/golden/dutch-*.json` 持续看守）：

- **播放 vs 播放**（xyq 曲线原样加载）：10 帧 × 37 节点 0 差异，camera_5
  最大位置误差 0.6 mm。
- **操作 vs 操作**（复刻侧重新烘焙）：同样 0 差异。
- **曲线级**：8 clip × 7 曲线的端点值与线上草稿一致到 1e-15（浮点恒等）。

新增实测语义：

6. **运动播放期间朝向 = 纯 lookAt（up=+Y），静态 roll 不参与**。荷兰角机位
   静态 rot z=−7.52°，但 clip 播放时四元数分解出的 roll 只是 lookAt 倾斜的
   欧拉分解副产物（f150 欧拉 (7.6, 33.5, −4.2) 与 pos→la 的 lookAt 矩阵逐项
   吻合）。片段外回落时静态 rot 与 lookAt 冗余一致（rot 由 lookAt 派生存储）。
7. **烘焙基准 = 点击瞬间的节点静态 transform，且添加运镜会把运动结束态写回
   静态 transform**。实测加完 tilt_up 后 camera_5 静态 lookAt 被写成曲线末值
   (0.00352, 2.26042, 0.00528)，后续 7 次点击共用该基准。复刻侧模拟同样操作
   时必须手动写回一次（`sync/libraryActions.ts` 的 `applyCameraMotion` 本身不写回，
   经 `StudioSession.applyCameraMotion` 暴露给 UI）。
8. 8 个基础运镜的烘焙参数实测（基准 pos(2.8,1.7,4.2) la(0,1.2,0) fov50）：
   tilt = lookAt 绕 pos 转 12°（la.y 1.2→2.26042）；truck = pos+la 沿相机
   右向平移 3.2 m；crane = pos+la 竖直平移 ±3.2 m（可出地面以下，不 clamp）；
   pan = lookAt 绕 pos 水平转 12°。pos/la 同向同步平移时距离保持 5.072 m 不变。

## 6. 去壳草稿（原 draft-format.md 附录 A）

完整文件是 [`samples/xiaoyunque-draft.json`](./samples/xiaoyunque-draft.json)。根结构如下，正文在 `content`，不再包 `ret` / `data.Assets` / `TextInfo`。

```json
{
  "type": "biz/scene3d-director-document",
  "pippitAssetId": "6643694107148",
  "extra": { "sourceNodeId": "6643694106892" },
  "content": {
    "version": 1,
    "aspectRatio": "21:9",
    "activeShotCameraNodeId": "camera_2",
    "nodes": ["…camera / character / prop / path…"],
    "asset": { "motionPath": ["…19 条动作库…"] },
    "timeline": { "fps": 30, "frameStart": 0, "frameEnd": 1996, "animation": {} },
    "generate": "{…scene_plan 仍是字符串…}",
    "environment": {},
    "settings": {},
    "scenePlan": {},
    "physicalConstraints": []
  }
}
```
