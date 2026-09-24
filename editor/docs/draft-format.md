# 导演草稿数据契约

本仓持久化 JSON（`biz/scene3d-director-document`）的字段、语义与求值规则。

> **代码权威源**：类型在 `packages/builder/src/contract/types.ts`，运行时校验在
> `contract/validate.ts`（注释与本文逐节对应）。字段有出入时以代码为准，并回来改本文。
>
> 分支、合入方向与门禁见仓库根 [`AGENTS.md`](../AGENTS.md)。

字段形状最初是从小云雀 Scene3D Editor 的草稿反推出来的。本文只写契约本身；
当时的抓包、去壳方法和逐帧对比记录已移到 [`observation-notes.md`](./observation-notes.md)。
**本仓已不做逆向分析**：契约已定稿，样例草稿也已改成本仓的素材 key 形态。

参考样本 `xiaoyunque.json` 是 **资产查询接口的包装**，不是干净的导演文档
（它不在本仓；拆壳方法见 [`observation-notes.md`](./observation-notes.md) §3）。去壳并改成本仓 key 后的完整草稿是
[`samples/xiaoyunque-draft.json`](./samples/xiaoyunque-draft.json)。

样本：asset `6643694107148`，`content.version = 1`，资产 `version = 153`，画幅 `21:9`，时间线 `30 fps` / `0–1996` 帧。27 个节点：15 相机 + 5 角色 + 5 道具 + 2 路径。其它草稿可能多字段，但下面这些是这份文件里实际出现过的完整结构。

相对上一版（资产 version 137 / 1126 帧）新增：`type=prop` 道具节点、两个后加角色、19 条官方动作库、镜头预设 `drone_dive` / `pull_away`，以及时间线里的 `motionTransitions`。

## 1. 接口包装

从参考产品接口响应拆出草稿的方法已移到 [`observation-notes.md`](./observation-notes.md) §3。
日常开发不需要：仓库里的样本已经是去壳后的文档。

## 2. `content` 总览

```json
{
  "version": 1,
  "aspectRatio": "21:9",
  "activeShotCameraNodeId": "camera_2",
  "generate_run_id": "scene3d_conversation_…",
  "applied_generate_run_id": "scene3d_conversation_…",
  "generate": "{...scene_plan JSON 字符串...}",
  "scenePlan": {
    "revision": 1,
    "appliedExecutionKeys": ["scene3d_conversation_…"]
  },
  "settings": { "...编辑器 UI..." },
  "environment": { "...背景 / 地面 / 环境球..." },
  "asset": { "motionPath": [ "...动作库条目..." ] },
  "nodes": [ "...camera / character / prop / path..." ],
  "physicalConstraints": [],
  "timeline": { "...fps + 动画片段..." },
  "editorial": {
    "version": 1,
    "activeSequenceId": "sequence_1",
    "sequences": [{ "id": "sequence_1", "clips": [] }]
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | int | 文档 schema，本样本为 `1` |
| `aspectRatio` | string | 画幅，本样本 `21:9` |
| `activeShotCameraNodeId` | string | 当前选中 / 主预览相机，指向 `nodes[].id` |
| `generate` | string | 生成器写出的 `scene_plan`，**还是一段 JSON 字符串** |
| `generate_run_id` / `applied_generate_run_id` | string | 同一次对话生成的 run |
| `scenePlan` | object | 已应用到节点上的生成修订 |
| `settings` | object | 导演视图 UI 状态，不影响几何 |
| `environment` | object | 背景、地面、环境球 |
| `asset.motionPath` | array | 本草稿引用过的官方动作库（本样本 19 条） |
| `nodes` | array | 场景图：相机、角色、道具、路径 |
| `physicalConstraints` | array | 物理约束；本样本空 |
| `timeline` | object | 帧范围 + 镜头 / 角色动作 / 路径片段（**源世界时间**） |
| `editorial` | object | 剪辑域：可包含多个共享同一源场景的成片版本。旧草稿可缺省；详见 §7.1 |

权威状态是 `nodes` + `timeline`（源世界）+ 可选的 `editorial`（成片剪辑）。`generate` 是生成当时的意图，之后手改节点不会回写进去。

## 3. 坐标系与通用类型

小云雀是 **右手、Y 向上、单位米、旋转欧拉角度**：

| 轴 | 含义 |
|---|---|
| `x` | 左右 |
| `y` | 高度（上为正） |
| `z` | 前后 |

本项目同为右手、Y 向上、单位米、欧拉角度，坐标与旋转**直接沿用，无需转换**。
（导出到 Z-up 管线时的换算见附录 B。）

通用对象：

```json
{ "x": 0, "y": 1.2, "z": 0 }

{
  "position": { "x": 0, "y": 0, "z": 0 },
  "rotation": { "x": 0, "y": 0, "z": 0 },
  "scale":    { "x": 1, "y": 1, "z": 1 }
}
```

时间线用 **帧**；相机运动曲线用 **毫秒**。本样本 `fps = 30`，所以 `durationMs = 2000` 对应 60 帧。

节点引用一律：

```json
{ "type": "node", "nodeId": "camera_2" }
```

## 4. `settings` / `environment` / `asset`

### 4.1 settings

```json
{
  "viewMode": "director",
  "transformMode": "translate",
  "selectionMode": "pointer",
  "compositionGuide": "none",
  "gridVisible": true,
  "helpersVisible": true
}
```

只描述编辑器，不进渲染几何。

### 4.2 environment

```json
{
  "background": { "mode": "color", "skyColor": "#060608" },
  "display": {
    "characterLabelsVisible": true,
    "gridSnapEnabled": false,
    "groundSnapEnabled": false,
    "groundVisible": false,
    "groundHeight": 0,
    "groundOpacity": 1
  },
  "sphere": {
    "orientationVersion": 1,
    "radius": 180,
    "rotationX": 0,
    "rotationY": 90
  },
  "transform": { "position": { "x": 0, "y": 0, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 1 } }
}
```

### 4.3 asset.motionPath

角色片段里的 `motion.assetId` 必须能在这里（或官方库）对上：

```json
{
  "id": "asset_library_motion_dying",
  "path": "3d-builder/public/motions/dying.fbx"
}
```

本样本 19 条，全部 `sourceRig=mixamorig`；`path` 必须是完整 S3 key（`3d-builder/public/motions/...`），不再使用剪映绝对 URL 或 `motions/sources/` 相对路径。

| id | 中文名 | 源时长 s | 路径 |
|---|---|---:|---|
| `asset_library_motion_dying` | 死亡 | 4.40 | `3d-builder/public/motions/dying.fbx` |
| `asset_library_motion_loser` | 失败者 | 3.23 | `3d-builder/public/motions/loser.fbx` |
| `asset_library_motion_kip_up` | 鲤鱼打挺 | 2.03 | `3d-builder/public/motions/kip_up.fbx` |
| `asset_library_motion_silly_dancing` | 搞怪卷心菜舞 | 3.83 | `3d-builder/public/motions/silly_dancing.fbx` |
| `asset_library_motion_praying` | 祈祷 | 6.83 | `3d-builder/public/motions/praying.fbx` |
| `asset_library_motion_zombie_biting` | 丧尸撕咬 | 6.60 | `3d-builder/public/motions/zombie_biting.fbx` |
| `asset_library_motion_walk_with_rifle` | 持步枪行走 | 1.43 | `3d-builder/public/motions/walk_with_rifle.fbx` |
| `asset_library_motion_sword_and_shield_death` | 阵亡 | 2.30 | `3d-builder/public/motions/sword_and_shield_death.fbx` |
| `asset_library_motion_shooting_arrow` | 射箭 | 5.00 | `3d-builder/public/motions/shooting_arrow.fbx` |
| `asset_library_motion_punching` | 挥拳 | 1.23 | `3d-builder/public/motions/punching.fbx` |
| `asset_library_motion_mma_kick` | 综合格斗踢腿 | 1.57 | `3d-builder/public/motions/mma_kick.fbx` |
| `asset_library_motion_jump_attack` | 跳跃攻击 | 3.80 | `3d-builder/public/motions/jump_attack.fbx` |
| `asset_library_motion_hurricane_kick` | 旋风踢 | 1.83 | `3d-builder/public/motions/hurricane_kick.fbx` |
| `asset_library_motion_great_sword_slash` | 巨剑劈砍 | 3.53 | `3d-builder/public/motions/great_sword_slash.fbx` |
| `asset_library_motion_grabbing_ammo` | 拾取弹药 | 4.07 | `3d-builder/public/motions/grabbing_ammo.fbx` |
| `asset_library_motion_flying_kick` | 腾空单脚飞踢 | 1.50 | `3d-builder/public/motions/flying_kick.fbx` |
| `asset_library_motion_drop_kick` | 飞身双脚踢 | 2.90 | `3d-builder/public/motions/drop_kick.fbx` |
| `asset_library_motion_throw_grenade` | 投掷手雷 | 3.50 | `3d-builder/public/motions/throw_grenade.fbx` |
| `asset_library_motion_catwalk_walk_forward_highknees` | 猫步向前行走 | 1.23 | `3d-builder/public/motions/catwalk_walk_forward_highknees.fbx` |

源时长来自对应 `motionClips[].sourceDuration`。时间线上的占位帧 ≈ `sourceDuration * fps`，再按 `playback.loop=true` 铺满该段。

## 5. 节点

每个节点都有：

```json
{
  "id": "camera_2",
  "type": "camera",
  "name": "荷兰角_1",
  "visible": true,
  "locked": false,
  "transform": { "position": {}, "rotation": {}, "scale": {} }
}
```

本样本四种 `type`：`camera` / `character` / `prop` / `path`。节点 ID 规则：

| type | id 形态 | 例子 |
|---|---|---|
| camera | `camera_<n>` | `camera_2` |
| character | `character_<n>` | `character_16` |
| prop | `{assetId}_{timestampMs}` | `asset_library_prop_computer_screen_01_1789042041640` |
| path | `path_derived_<rand>` | `path_derived_qxb689` |

### 5.1 camera

```json
{
  "id": "camera_1",
  "type": "camera",
  "name": "正面全景_1",
  "visible": true,
  "locked": false,
  "transform": {
    "position": { "x": -0.402, "y": 2.39, "z": 7.502 },
    "rotation": { "x": -9.834, "y": 0, "z": 0 },
    "scale": { "x": 1, "y": 1, "z": 1 }
  },
  "camera": {
    "projection": "perspective",
    "fov": 70,
    "fovAxis": "vertical",
    "near": 0.1,
    "far": 100000,
    "isPrimary": false,
    "lookAt": { "x": -0.402, "y": 1.09, "z": 0.002 }
  }
}
```

| 字段 | 说明 |
|---|---|
| `camera.projection` | 本样本只有 `perspective` |
| `camera.fov` | 垂直视角，度 |
| `camera.fovAxis` | 固定 `vertical` |
| `camera.lookAt` | 看点；定向以它为准，`transform.rotation` 是派生值 |
| `camera.lookAtTarget` | 可选。看点绑到目标：`{ nodeId, offset? }`，求值时 lookAt = 目标位置 + offset（缺省胸口 1.2m）。手动旋转改变视线方向时解除，纯视线轴倾斜保留；移动机位、调整距离保留，显式编辑看点 XYZ 调整 offset。解除看向不关闭已有的 `subject.follow`；界面分别显示自由看点与位置跟随目标。 |
| `camera.isPrimary` | 主相机。本样本只有 `camera_2` 为 true |
| `near` / `far` | `0.1` / `100000` |

静态机位库（本样本 15 个）可以当成镜头模板。主体大致在原点，`lookAt.y` 是构图高度：地面 `0`、胸口 `1.1`、对话 `1.2`、脸 `1.35`、头顶 `1.7`。

| 名称 | FOV | 距离 m | 机位高 m | 俯仰 | 看点高 | 用法 |
|---|---:|---:|---:|---:|---:|---|
| 正面特写 | 35 | 2.6 | 1.6 | -5° | 1.35 | 脸 |
| 过肩 | 45 | 3.3 | 1.6 | -4° | 1.35 | 偏轴约 33°，roll 2°–4° |
| 当前视角 | 45 | 3.8 | 1.6 | -4° | 1.35 | 过肩变体 |
| 低角度仰拍 | 45 | 3.4 | 0.55 | +20° | 1.70 | 贴地看头 |
| 荷兰角 | 50 | 1.8–5.1 | 1.4–1.7 | -6° | 1.20 | roll 约 2°–4° |
| 正面 / 背面中景 | 50 | 5.0 | 1.8 | -7° | 1.20 | 默认对话机位 |
| 侧面跟拍 | 50 | 4.9 | 1.8 | -7° | 1.20 | 从 +X 侧看 |
| 45° 俯拍 | 50 | 6.8 | 4.6 | -30° | 1.20 | 斜上方，yaw ≈ -135° |
| 正面全景 | 70 | 7.6 | 2.4 | -10° | 1.10 | 全身 + 场地 |
| 俯拍全景 | 70 | 6.9 | 6.5 | -53° | 1.00 | 高机位看场面 |
| 鸟瞰 | 80 | 8.0 | 8.0 | -89° | 0.00 | 几乎顶视 |

`camera_6`「过肩镜头_1」距离 16.5 m，是坏样本；过肩以右侧 3.3 m 那条为准。45° 俯拍上约 26° 的 roll 是 look-at 万向节结果，不是故意荷兰角。

`nodes[].transform` 是**当前机位**，主相机播完时间线后会停在最后一镜。本样本 `camera_2` 已漂到 `(-0.43, 3.90, -7.82)` 看 `(0.42, 2.41, -2.46)`，不再等于上表「荷兰角」模板；模板仍以 `camera_9` / 未播过的机位为准。

### 5.2 character

```json
{
  "id": "character_2",
  "type": "character",
  "name": "中间人物",
  "visible": true,
  "locked": false,
  "orientationIntent": { "mode": "camera" },
  "metadata": {
    "assetCategory": "base-model",
    "assetId": "a3d_char_30ec53c93eae4173946b38639691ebe0",
    "assetSource": "base",
    "modelUrl": "3d-builder/library/characters/a3d_char_30ec53c93eae4173946b38639691ebe0-d4ce3fb1.glb"
  },
  "transform": {
    "position": { "x": 0, "y": 0, "z": 0 },
    "rotation": { "x": 0, "y": 135, "z": 0 },
    "scale": { "x": 1, "y": 1, "z": 1 }
  },
  "character": {
    "placeholder": true,
    "gender": "unknown",
    "motionId": "asset_library_motion_catwalk_walk_forward_highknees",
    "appearance": { "color": "#F6C1C7" },
    "label": { "showLabel": true, "scale": 0.8, "yOffset": 0.04 },
    "animation": {
      "mode": "pose",
      "baseAction": "idle",
      "posePresetId": "stand",
      "sourcePosePresetId": "stand",
      "speed": 1,
      "additiveWeights": {},
      "boneRotations": {},
      "rootPositionOffset": { "x": 0, "y": 0, "z": 0 },
      "controlValues": {
        "bodyBend": 0, "bodyTilt": 0, "bodyTurn": 0,
        "torsoBend": 2, "torsoTilt": 0, "torsoTurn": 0,
        "headNod": -10, "headTilt": 0, "headTurn": 0,
        "lArmRaise": -5, "lArmStraddle": 12, "lArmTurn": 0, "lElbowBend": 15,
        "rArmRaise": -5, "rArmStraddle": 14, "rArmTurn": 0, "rElbowBend": 15,
        "lLegRaise": 0, "lLegStraddle": 0, "lLegTurn": 0, "lKneeBend": 0,
        "rLegRaise": 0, "rLegStraddle": 0, "rLegTurn": 0, "rKneeBend": 0
      }
    }
  }
}
```

| 字段 | 说明 |
|---|---|
| `orientationIntent` | 可选。生成出来的三人是 `{ "mode": "camera" }`；后来手动加的角色可以没有这个字段 |
| `metadata.defaultCharacterIndex` | 后加角色才有。本样本 `角色1=1`、`角色2=2` |
| `character.placeholder` | 占位人模 |
| `character.motionId` | 当前绑定的动作库 ID，可空（`character_3` 就是空） |
| `character.animation.mode` | 本样本 `pose`：用 `controlValues` 摆静态姿势 |
| `posePresetId` | 本样本 `stand` |
| `controlValues` | 躯干 / 头 / 四肢的姿态旋钮，单位是编辑器内部度数 |

`orientationIntent` 在生成草稿里还可以带 `target_scene_object_id`、`direction`、`yaw_offset`，节点落地后本样本只保留了 `mode`。

本样本 5 个角色都用同一个内置人物模型，颜色不同：

| id | 名称 | 颜色 | 来源 | 绑定动作 |
|---|---|---|---|---|
| `character_1` | 左侧人物 | `#A7C7E7` | generate | `drop_kick` |
| `character_2` | 中间人物 | `#F6C1C7` | generate | `catwalk_walk_forward_highknees` |
| `character_3` | 右侧人物 | `#B8E0B8` | generate | 无 |
| `character_16` | 角色1 | `#4F8EF7` | 后加 | `loser` |
| `character_17` | 角色2 | `#4F8EF7` | 后加 | `dying` |

`character_16` / `character_17` 都在原点、无 `orientationIntent`，同一默认蓝，用来铺动作库时间线。

### 5.3 path

路径节点由角色位移关键帧派生，编辑器里通常隐藏且锁定。

```json
{
  "id": "path_derived_qxb689",
  "type": "path",
  "name": "Transform keyframes",
  "visible": false,
  "locked": true,
  "metadata": {
    "sourceType": "transform-keyframes",
    "derivedPathMotionSourceSignature": "md7psf"
  },
  "path": {
    "source": "transform-keyframes",
    "curve": "polyline",
    "closed": false,
    "groundSnap": false,
    "parameterization": "time-ratio",
    "smoothing": 0,
    "points": [
      { "id": "path_point_…", "position": { "x": 0, "y": 0, "z": 0 }, "timeRatio": 0 },
      { "id": "path_point_…", "position": { "x": 1.79, "y": -0.61, "z": -1.66 }, "timeRatio": 1 }
    ]
  },
  "transform": { "position": { "x": 0, "y": 0, "z": 0 }, "rotation": { "x": 0, "y": 0, "z": 0 }, "scale": { "x": 1, "y": 1, "z": 1 } }
}
```

`timeRatio` 从 `0` 到 `1`。`metadata.derivedPathMotionSourceSignature` 和 `timeline.animation.pathMotionClips[].derivedSource.sourceSignature` 对齐。

### 5.4 prop

官方道具库白模。几何以 `metadata.bounds` / `targetRealSizeMeters` 为准，单位米，Y 是高度。

```json
{
  "id": "asset_library_prop_computer_screen_01_1789042041640",
  "type": "prop",
  "name": "显示器",
  "visible": true,
  "locked": false,
  "prop": { "category": "electronics" },
  "metadata": {
    "sourceType": "asset-library-prop",
    "assetSource": "official",
    "assetId": "asset_library_prop_computer_screen_01",
    "assetCategory": "electronics",
    "assetUnit": "meter",
    "assetUnitScale": 1,
    "description": "显示器",
    "displayNameKey": "Pippit_scene3d_asset_name_computerscreen01",
    "modelUrl": "3d-builder/public/props/computer_screen_01.glb",
    "previewUrl": "3d-builder/public/props/covers/computer_screen_01.png",
    "bounds": { "size": { "x": 0.54, "y": 0.42, "z": 0.20 } },
    "targetRealSizeMeters": { "width": 0.54, "height": 0.42, "depth": 0.20 },
    "targetScaleFit": "height",
    "targetSizeBasis": "24-inch monitor with stand"
  },
  "transform": {
    "position": { "x": 0.259, "y": 1.469, "z": 2.335 },
    "rotation": { "x": 0, "y": 0, "z": 0 },
    "scale": { "x": 1, "y": 1, "z": 1 }
  }
}
```

| 字段 | 说明 |
|---|---|
| `prop.category` | 和 `metadata.assetCategory` 相同：本样本 `storage` / `wearable` / `electronics` |
| `metadata.assetId` | 库内稳定 ID；节点 `id` 是 `assetId + '_' + 添加时间戳` |
| `bounds.size` | AABB，`x=宽, y=高, z=深`，和 `targetRealSizeMeters` 对齐 |
| `targetScaleFit` | 本样本都是 `height`：按真实高度套进米制 |
| `targetSizeBasis` | 英文的真实物体参照，给缩放用 |
| `modelUrl` / `previewUrl` | 白模 GLB + 封面 PNG。本样本是搬运期形态，key 为已下线的 `3d-builder/public/props/*.glb` 与 `props/covers/*.png`；现行素材一律 `3d-builder/library/props/{assetId}-{sha8}`，见 [`assets-manifest.md`](assets-manifest.md) §6 |

本样本 5 个道具：

| 名称 | assetId | category | 宽×高×深 m | 位置 |
|---|---|---|---|---|
| 置物架 | `…_storage_shelving_01` | storage | 0.90×1.80×0.35 | (0.30, 0, 1.92) |
| 衣架 | `…_clothes_hanger_01` | wearable | 0.42×0.22×0.02 | (0.30, 0, 1.92) |
| 头戴耳机 | `…_computer_headphones_01` | electronics | 0.18×0.20×0.09 | (0.30, 0, 1.92) |
| 键盘 | `…_computer_keyboard_01` | electronics | 0.44×0.03×0.14 | (-1.14, -1.28, 1.79) |
| 显示器 | `…_computer_screen_01` | electronics | 0.54×0.42×0.20 | (0.26, 1.47, 2.34) |

置物架、衣架、耳机叠在同一点，只是拖进场景还没摆开。道具没有动画片段。键盘 `y=-1.276` 在地面以下，属于未校正摆放。

## 6. 生成草稿 `generate` → `scene_plan`

`content.generate` 是字符串，解析后：

```json
{
  "scene_plan": { "...协议 1.0..." },
  "clarification": null,
  "generated_meshes": []
}
```

### 6.1 scene_plan

```json
{
  "protocol_version": "1.0",
  "objects": [ "...create 角色..." ],
  "physical_constraints": [],
  "camera_intent": { "...构图意图..." }
}
```

角色 object：

```json
{
  "scene_object_id": "character_1",
  "op": "create",
  "object_type": "character",
  "name": "左侧人物",
  "asset_id": null,
  "generated_mesh_id": null,
  "transform": {
    "position": [1.5, 0, 0],
    "rotation": [0, 180, 0],
    "scale": [1, 1, 1]
  },
  "appearance": { "body_type": null, "color": "#A7C7E7" },
  "pose": {
    "base_pose": "stand",
    "torso": { "action": "upright", "strength": "normal" },
    "gaze": { "mode": "forward", "direction": null, "target_scene_object_id": null },
    "gestures": []
  },
  "orientation_intent": {
    "mode": "camera",
    "target_scene_object_id": null,
    "direction": null,
    "yaw_offset": null
  }
}
```

这里的 transform 是 **数组**，不是 `{x,y,z}`。`scene_object_id` 落地后变成 `nodes[].id`。

相机意图：

```json
{
  "subject_scene_object_ids": ["character_1", "character_2", "character_3"],
  "shot_size": "medium",
  "lens_style": "normal",
  "explicit": false,
  "orbit_rotation": { "x": 15, "y": 45, "z": 0 },
  "screen_anchor": { "x": 0.5, "y": 0.5 }
}
```

| 字段 | 本样本值 | 含义 |
|---|---|---|
| `shot_size` | `medium` | 景别意图，不是最终 FOV |
| `lens_style` | `normal` | 镜头风格 |
| `explicit` | `false` | 用户没有手写死机位 |
| `orbit_rotation` | `(15, 45, 0)` | 相对主体的轨道角 |
| `screen_anchor` | `(0.5, 0.5)` | 主体落在画面中心 |

生成器只写出 3 个站立角色 + 一条中景意图。15 个命名相机、后加的 `character_16` / `character_17`、5 个道具、动作库和全部镜头运动都是之后在导演里加的，不在 `scene_plan` 里。

`scenePlan.appliedExecutionKeys` 记录哪一次 generate run 已经铺到节点上；`revision` 从 1 起算。

## 7. 时间线

```json
{
  "version": 1,
  "fps": 30,
  "frameStart": 0,
  "frameEnd": 1996,
  "usePreviewRange": false,
  "animation": {
    "fcurves": [],
    "fcurvesRef": {
      "kind": "pippit-asset",
      "pippitAssetId": "6643694107404",
      "schemaVersion": 1
    },
    "cameraMotionClips": [ "...镜头运动..." ],
    "motionTransitions": [],
    "motionClips": [ "...角色动作..." ],
    "pathMotionClips": [ "...角色路径..." ]
  }
}
```

| 字段 | 说明 |
|---|---|
| `fcurves` | 内联 F-Curve；本样本空 |
| `fcurvesRef` | 角色位移等曲线存在另一份资产里（本样本 `6643694107404`） |
| `motionTransitions` | 角色动作转场；本样本空。旧导出里出现过 `cameraMotionTransitions`，这份没有 |
| `cameraMotionClips` | 相机运动预设实例（本样本 24 条） |
| `motionClips` | 角色 FBX / 动作库片段（本样本 23 条） |
| `pathMotionClips` | 角色沿路径走（本样本 2 条，仍只绑 `character_2`） |

`frameEnd` 是时间线长度。本样本对齐到最后一条角色动作 `1996`，比镜头主动轨结束帧 `1354` 更长。

编辑器中的 `frameEnd` 由用户设置，不随添加动作、添加运镜、调整运镜时长或移动片段自动扩展。
用户可以把结束帧设在现有片段或关键帧之前（仍须大于 `frameStart`）；范围外的数据保留，
重新延长时间线后仍可使用。片段自身的 `frameEnd` 与时间线的 `frameEnd` 是独立的值。

### 7.1 剪辑域 `editorial`

> 本节是字段速查。不变量、纯函数 API、事务 / 播放 / 导出契约与扩展流程见
> [`film-editorial.md`](film-editorial.md)，那份是成片剪辑的权威维护文档。

`timeline` 与 `editorial` 使用两套不同的时间坐标：

- `timeline` 是唯一的**源世界时间轴**，描述同一时刻角色、相机和路径的并行动画。
- `editorial.sequences[]` 是并列的**成片版本**。每一版按自己的 `clips[]` 顺序，从源世界取不同机位和帧范围。

多个 Sequence 共享同一份 `nodes`、`environment` 和 `timeline`。导演版、预告版、15 秒版等平行剪法只复制剪辑决定，不复制整个场景。若某一版需要修改角色动作或相机运动本身，应复制整份草稿。禁止复用 `timeline.animation.cameraMotionClips` 表达成片顺序。

```json
{
  "version": 1,
  "activeSequenceId": "sequence_main",
  "sequences": [
    {
      "id": "sequence_main",
      "name": "Director Cut",
      "clips": [
        {
          "id": "edit_clip_mx8f2a_q3k9",
          "cameraNodeId": "user_cam_1789376711353",
          "sourceFrameStart": 0,
          "sourceFrameEnd": 59
        }
      ]
    },
    {
      "id": "sequence_trailer",
      "name": "15s Trailer",
      "clips": []
    }
  ]
}
```

#### 7.1.1 `editorial` 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `version` | int | 是 | 剪辑域 schema 版本，当前固定为 `1`。它不是成片修订号，也不等同于 `content.version` |
| `activeSequenceId` | string | 是 | 重新打开草稿时默认编辑的 Sequence，必须指向 `sequences[].id`。只表示编辑焦点，不表示主交付版本 |
| `sequences` | array | 是 | 同一源场景下的平行成片版本，至少一条。数组顺序仅用于版本列表展示，不决定播放结果 |

`makeEmptyDraft()` 初始化一条空 Sequence：

```json
{
  "version": 1,
  "activeSequenceId": "sequence_1",
  "sequences": [{ "id": "sequence_1", "clips": [] }]
}
```

旧草稿可以没有 `editorial`。读取侧会提供同形状的默认空 Sequence 供界面使用，但不会仅因读取而回写草稿。第一次实际剪辑操作才通过正常文档变更写入。

#### 7.1.2 `EditSequence` 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `id` | string | 是 | Sequence 稳定 ID，在 `editorial.sequences` 内唯一；重命名和换序不得改变 |
| `name` | string | 否 | 用户可见名称；若存在则不能是纯空白。缺省时 UI 使用本地化名称，不把本地化默认文案写进草稿 |
| `clips` | array | 是 | 该版成片的剪辑实例。数组顺序是成片播放顺序，也是唯一权威排序；空数组表示尚未剪辑 |

复制成片版本时必须生成新的 Sequence ID，并为复制出的每个 Clip 生成新 ID；复制品仍引用同一批相机节点和源帧。删除当前激活版本时，必须在同一文档事务中把 `activeSequenceId` 切换到仍存在的相邻版本。最后一条 Sequence 不允许删除，只允许清空 `clips`。

`activeSequenceId` 不能被播放或导出底层 API 当作隐式输入；这些 API 必须显式接收 `sequenceId`。未来若产品需要“默认发布版”，应新增语义独立的 `primarySequenceId`，不得复用 active。

#### 7.1.3 `EditSequenceClip` 字段

| 字段 | 类型 | 必填 | 约束与语义 |
|---|---|---|---|
| `id` | string | 是 | 剪辑实例稳定 ID，在整个 `editorial` 内唯一。同一源段重复插入时必须生成不同 ID |
| `cameraNodeId` | string | 是 | 指向 `content.nodes[].id` 且该节点 `type === "camera"`；不复制相机名称或镜头参数 |
| `sourceFrameStart` | int | 是 | Clip 在源世界时间上的首帧，闭区间起点 |
| `sourceFrameEnd` | int | 是 | Clip 在源世界时间上的末帧，闭区间终点，必须 `>= sourceFrameStart` |

源范围必须落在闭区间 `timeline.frameStart..timeline.frameEnd`。Clip 时长为：

```text
durationFrames = sourceFrameEnd - sourceFrameStart + 1
```

同一机位、同一源范围允许在同一版或不同版中重复使用；它们是不同 Clip 实例。`Clip` 是剪辑数据模型术语，UI 可继续把它显示为“镜头”。

#### 7.1.4 持久化与派生字段

草稿只持久化不能可靠派生的剪辑决定：

- 持久化：Sequence / Clip ID、可选名称、相机引用、源帧 In / Out、Clip 数组顺序。
- 不持久化：秒数、相机名称、Clip 成片起点、成片排序号、Clip 时长、Sequence 总时长、播放头、选区、缩放和拖拽预览。

`sequenceFrame` 从 `0` 起算。成片内每个 Clip 的累计区间使用半开区间 `[cursor, cursor + durationFrames)`；切点属于后一条 Clip，不重复源帧。`resolveEditSequenceFrame()` 把成片帧映射成 `clipId + cameraNodeId + sourceFrame`，播放与导出必须共用该映射。

#### 7.1.5 校验、失效引用与历史

- Zod 负责结构校验：剪辑域版本、非空 ID、非空白可选名称、整数帧、`sourceFrameEnd >= sourceFrameStart`，以及 `sequences` 至少一条。
- `validateEditorial()` 负责领域校验：Sequence / Clip ID 唯一、active 指针有效、相机存在且类型正确、源帧不越界。它只报告结构化 issue，**不静默修复草稿**。
- 删除相机后，引用它的 Clip 必须保留为 dangling `cameraNodeId`，以便撤销删除或替换机位；该 Clip 在 UI 中标记失效，并阻止相关 Sequence 播放和导出。
- Undo / redo 必须把一次添加、裁剪、换序、复制、删除或 active 切换作为单个文档事务。
- 平行 Sequence 是可同时存在和导出的成片版本；Undo、自动备份和历史修订属于宿主文档版本系统，禁止把 `revisions[]` 快照堆进 `editorial`。

#### 7.1.6 当前版本边界

schema v1 只支持每条 Sequence 的单个顺序 Clip 列表和硬切，不包含 Track、Gap、Transition、变速、音频或嵌套 Sequence。只有出现真实的多轨、重叠、转场或变速需求时，才升级 `editorial.version` 并增加对应结构；不要提前写空壳字段。

#### 7.1.7 操作、播放与导出

- 第一次实际剪辑操作才把 `editorial` 写入草稿；只读旧草稿不会回写。
- 版本 CRUD、clip 插入 / 更新 / 换序 / 复制 / 删除、以及 `activeSequenceId` 切换都是单条文档事务。
- 播放与导出底层 API（`previewProgramFrame` / `recordSequence`）必须显式接收 `sequenceId`，不得隐式使用 `activeSequenceId`。
- Program Monitor 求值指定源帧并临时跟随指定相机，不得改写 Scene 的 `currentFrame` 或 `activeCameraId`。
- 失效相机、越界区间和坏 active 指针只报告，不自动删除、裁剪或修复。

## 8. 相机运动 `cameraMotionClips`

一条 clip 绑到一个相机节点，占一段时间，并带一套已烘焙曲线。

```json
{
  "id": "camera_motion_clip_mtvf98ur_ivay34",
  "target": { "type": "node", "nodeId": "camera_1" },
  "focusTarget": { "type": "center" },
  "frameStart": 0,
  "frameEnd": 60,
  "trimStartMs": 0,
  "trimEndMs": 2600,
  "playback": {
    "version": 1,
    "speed": 1,
    "loop": false,
    "loopMode": "ping-pong",
    "baseDurationFrames": 78
  },
  "motion": {
    "id": "camera_motion_clip_1",
    "version": 1,
    "presetId": "descending_orbit",
    "label": "盘旋下降",
    "timeUnit": "millisecond",
    "durationMs": 2600,
    "metadata": { "cameraNodeId": "camera_1", "generatedAt": 1789040531715 },
    "source": { "type": "orbit", "...预设参数..." },
    "warnings": null,
    "curves": [ "...7 条..." ]
  }
}
```

| 字段 | 说明 |
|---|---|
| `target.nodeId` | 要写动画的相机 |
| `focusTarget` | 本样本都是 `{ "type": "center" }` |
| `frameStart` / `frameEnd` | 时间线占位，帧 |
| `trimStartMs` / `trimEndMs` | 从预设里切哪一段；本样本都是 `0 … durationMs` |
| `playback.baseDurationFrames` | `round(durationMs / 1000 * fps)` |
| `playback.loop` | 本样本相机运动都是 `false`；`loopMode` 仍写着 `ping-pong` |
| `motion.presetId` / `label` | 预设英文 ID + 中文名 |
| `motion.source` | 生成参数。推拉 / 摇 / 变焦可以没有 |
| `motion.warnings` | 例如 `["advanced-motion-approximated"]` |
| `motion.curves` | 已烘焙、可直接播的曲线 |

同一相机上多条 clip 按 `frameStart` 衔接；不同相机可以时间重叠（本样本 `camera_1` 和 `camera_2` 在开头并行）。

### 8.1 曲线

每条运动固定 **7 条曲线**：

| group | dataPath | arrayIndex | 含义 |
|---|---|---|---|
| `position` | `camera.position` | 0/1/2 | 机位 x/y/z |
| `lookAt` | `camera.lookAt` | 0/1/2 | 看点 x/y/z |
| `lens` | `camera.lens.fov` | 0 | 垂直 FOV |

```json
{
  "id": "descending_orbit:position-x",
  "group": "position",
  "dataPath": "camera.position",
  "arrayIndex": 0,
  "extrapolation": "constant",
  "keyframes": [
    { "id": "descending_orbit:position-x:0", "time": 0, "value": 0, "interpolation": "linear" },
    { "id": "descending_orbit:position-x:1", "time": 2600, "value": 3.75, "interpolation": "linear" }
  ]
}
```

| 约定 | 本样本 |
|---|---|
| `time` | 毫秒，从 0 到 `durationMs` |
| `interpolation` | `linear` 或 `bezier`。bezier **没有** 手柄字段，只是标记 |
| `extrapolation` | 一律 `constant` |
| 简单动作采样 | 2 个关键帧（推拉 / 摇 / 变焦 / 升降 / 焦点） |
| 环绕 / 跟拍采样 | 96 个线性点，缓动已烤进去 |
| 路径采样 | 64 个线性点 |

播的时候以 `curves` 为准。`source.startPosition` 和曲线第 0 帧偶尔对不齐。

### 8.2 `source` 三种生成器

**orbit**（盘旋下降 / 盘旋抬升 / 环绕 180°）：

```json
{
  "type": "orbit",
  "axis": { "x": 0, "y": 1, "z": 0 },
  "pivot": { "x": 0, "y": 0, "z": 0 },
  "lookAtTarget": { "x": 0, "y": 0, "z": 0 },
  "startPosition": { "x": 4.269, "y": 2.4, "z": 5.035 },
  "startLookAt": { "x": 0, "y": 1.1, "z": 0 },
  "yawDeg": 150,
  "heightDelta": -5.51,
  "radiusDelta": 0,
  "easing": "ease-in-out",
  "fov": 70
}
```

绕世界 Y 转 `yawDeg`，高度加 `heightDelta`，半径加 `radiusDelta`。`pivot` 和 `lookAtTarget` 本样本相同。

**target-tracking**（迎面 / 跟随 / 侧面跟拍）：

```json
{
  "type": "target-tracking",
  "mode": "leading",
  "fov": 50,
  "target": { "type": "point", "point": { "x": 0, "y": 0, "z": 0 } },
  "offset": { "x": 0, "y": 1.385, "z": 4 },
  "lookAtOffset": { "x": 1.47, "y": 0.54, "z": -1.29 },
  "basisFallback": { "forward": { "x": 0, "y": 0, "z": 1 }, "up": { "x": 0, "y": 1, "z": 0 } },
  "targetFallback": {
    "position": { "x": 0, "y": 0, "z": 0 },
    "forward": { "x": 0, "y": 0, "z": 1 },
    "up": { "x": 0, "y": 1, "z": 0 }
  }
}
```

`mode`：`leading` 在前、`follow` 在后、`profile` 在侧。`offset` / `lookAtOffset` 相对目标。目标是静止点时，导出曲线是常值。

**path**（横滑揭示 / 穿越 / 俯冲下降 / 拉升离场）：

```json
{
  "type": "path",
  "easing": "ease-in-out",
  "fovStart": 50,
  "fovEnd": 50,
  "positionPath": {
    "curve": "line",
    "tension": 0.5,
    "points": [
      { "x": 5.48, "y": -1.27, "z": 2.92 },
      { "x": 8.00, "y": -1.27, "z": -0.18 }
    ]
  },
  "lookAt": {
    "type": "curve",
    "path": {
      "curve": "line",
      "tension": 0.5,
      "points": [
        { "x": 1.62, "y": 1.2, "z": -0.22 },
        { "x": 1.62, "y": 1.2, "z": -0.22 }
      ]
    }
  }
}
```

`lookAt.path.points` 可以首尾不同：俯冲 / 拉升会把看点从主体拽到世界原点。`fovStart` / `fovEnd` 也可以变（拉升本例 50° → 58°）。这四类都带 `warnings: ["advanced-motion-approximated"]`。

### 8.3 运动预设

同一预设可套到不同相机，数值按当前机位重算；角度、时长、锁定量稳定。

| presetId | 中文 | 时长 | 采样 | 缓动 | 锁定量 | 规则 | 本文件默认 |
|---|---|---:|---:|---|---|---|---|
| `descending_orbit` | 盘旋下降 | 2600 | 96 | ease-in-out | 看点、半径 | 绕 Y 转 150°，同时下降 | `yawDeg=150`, `heightDelta` ≈ -2.8～-5.5 m |
| `ascending_orbit` | 盘旋抬升 | 2600 | 96 | ease-in-out | 看点、半径 | 绕 Y 转 150°，同时上升 | `heightDelta=+2.8` |
| `orbit_180` | 环绕拍摄 | 2600 | 96 | ease-in-out | 看点、半径、高度 | 水平转 ±180° | `heightDelta=0` |
| `dolly_in` | 镜头前推 | 2000 | 2 | bezier | 看点、FOV、朝向 | 沿视线靠近 | 移 3.2 m，距离约缩 60% |
| `dolly_out` | 镜头后移 | 2000 | 2 | linear | 同上 | 前推的反向 | 移 3.2 m |
| `crane_down` | 镜头下降 | 2000 | 2 | linear | 水平位置、朝向、距离 | 机位和看点一起垂直下落 | 双方各降 3.2 m |
| `pan_left` | 镜头左摇 | 2000 | 2 | linear | 机位、距离、俯仰 | 只转 lookAt | Δyaw ≈ 12° |
| `tilt_down` | 镜头下摇 | 2000 | 2 | linear | 机位、距离、偏航 | 只转 lookAt | Δpitch ≈ -12° |
| `whip_pan` | 甩摇 | 700 | 2 | linear | 机位、距离、FOV | 短时大幅甩 lookAt | 本例约 52° |
| `zoom_in` | 变焦推进 | 2000 | 2 | linear | 机位和看点 | 只收 FOV | 46° → 34° |
| `zoom_out` | 变焦拉远 | 2000 | 2 | linear | 机位和看点 | 只放 FOV | 50° → 62° |
| `slider_reveal` | 横滑揭示 | 2000 | 64 | ease-in-out | 高度、看点 | 水平横移，侧面露出主体 | 横向 4 m |
| `push_through` | 穿越镜头 | 1200 | 64 | ease-in | 看点、FOV | 沿视线冲过 lookAt | 移 5.6 m，approach ≈ 0.99 |
| `drone_dive` | 俯冲下降 | 1800 | 64 | ease-in-out | 无 | 机位斜向下冲约 4 m，看点收到地面原点 | 距离 5.6→3.4 m，降 1.0 m |
| `pull_away` | 拉升离场 | 2600 | 64 | ease-in-out | 无 | 机位斜向后退升高约 4 m，看点收到原点，FOV 变宽 | 距离 5.6→10.1 m，FOV 50→58 |
| `rack_focus` | 焦点转移 | 2000 | 2 | linear / bezier | 机位、FOV | 无真实景深，用 lookAt 切点近似 | 看点跳到原点 |
| `leading_tracking` | 迎面跟拍 | 2400 | 96 | target-lock | 相对目标前方 | `mode=leading` | 前方约 4 m |
| `follow_tracking` | 跟随拍摄 | 2400 | 96 | target-lock | 相对目标后方 | `mode=follow` | 后方约 6.3 m |
| `profile_tracking` | 侧面跟拍 | 2400 | 96 | target-lock | 相对目标侧向 | `mode=profile` | 侧向约 6.3 m |

时长习惯：标准推拉 / 摇 / 变焦 / 升降 / 横滑 / 焦点 = 2000 ms；环绕 / 拉升 = 2600 ms；跟拍 = 2400 ms；俯冲 = 1800 ms；甩摇 = 700 ms；穿越 = 1200 ms。本样本一共 **19 个预设**（17 个旧的 + `drone_dive` + `pull_away`）。

## 9. 角色动作 `motionClips`

```json
{
  "id": "motion_clip_character_1_asset_library_motion_dying_…",
  "source": "semantic",
  "sourceDuration": 4.4,
  "frameStart": 0,
  "frameEnd": 132,
  "target": { "type": "node", "nodeId": "character_1" },
  "playback": {
    "version": 1,
    "speed": 1,
    "loop": true,
    "loopMode": "repeat"
  },
  "motion": {
    "assetId": "asset_library_motion_dying",
    "name": "死亡",
    "source": "official",
    "sourceRig": "mixamorig",
    "url": "3d-builder/public/motions/dying.fbx",
    "inPlace": true,
    "loop": true,
    "speed": 1,
    "time": 0
  }
}
```

| 字段 | 说明 |
|---|---|
| `source` | 本样本 `semantic`：按动作语义选库，不是手 K |
| `sourceDuration` | 源 FBX 秒数 |
| `motion.inPlace` | 原地播，位移另走 path / fcurves |
| `motion.sourceRig` | 本样本 `mixamorig` |
| `motion.time` | 从源动作第几秒起播 |

本样本 23 条。`character_1` / `character_2` 仍是开头那几段；`character_16` 从 208 帧起把动作库几乎逐条播完；`character_17` 只在 208–340 跟播一次死亡。`character_3` 没有 motion clip。同一角色的片段按帧衔接，中间可以空。

| 角色 | 动作 | 帧 |
|---|---|---|
| character_1 | 死亡 `dying` | 0–132 |
| character_1 | 飞身双脚踢 `drop_kick` | 132–219 |
| character_2 | 腾空单脚飞踢 `flying_kick` | 70–115 |
| character_2 | 猫步向前行走 `catwalk_walk_forward_highknees` | 115–152 |
| character_16 / 17 | 死亡 `dying` | 208–340 |
| character_16 | 失败者 `loser` | 340–437 |
| character_16 | 鲤鱼打挺 `kip_up` | 437–498 |
| character_16 | 搞怪卷心菜舞 `silly_dancing` | 498–613 |
| character_16 | 祈祷 `praying` | 613–818 |
| character_16 | 丧尸撕咬 `zombie_biting` | 818–1016 |
| character_16 | 持步枪行走 `walk_with_rifle` | 1016–1059 |
| character_16 | 阵亡 `sword_and_shield_death` | 1059–1128 |
| character_16 | 射箭 `shooting_arrow` | 1128–1278 |
| character_16 | 挥拳 `punching` | 1278–1315 |
| character_16 | 综合格斗踢腿 `mma_kick` | 1315–1362 |
| character_16 | 跳跃攻击 `jump_attack` | 1362–1476 |
| character_16 | 旋风踢 `hurricane_kick` | 1476–1531 |
| character_16 | 巨剑劈砍 `great_sword_slash` | 1531–1637 |
| character_16 | 拾取弹药 `grabbing_ammo` | 1637–1759 |
| character_16 | 腾空单脚飞踢 `flying_kick` | 1759–1804 |
| character_16 | 飞身双脚踢 `drop_kick` | 1804–1891 |
| character_16 | 投掷手雷 `throw_grenade` | 1891–1996 |

## 10. 路径运动 `pathMotionClips`

把角色绑到 `type=path` 节点上。本样本都是从位移关键帧派生，只读。

```json
{
  "id": "path_motion_clip_derived_qxb689",
  "status": "active",
  "locked": true,
  "lockedReason": "derived-from-keyframes",
  "source": "transform-keyframes",
  "target": { "type": "node", "nodeId": "character_2" },
  "pathNodeId": "path_derived_qxb689",
  "pathName": "Transform keyframes",
  "pathLength": 2.519,
  "pathStartPercent": 0,
  "pathEndPercent": 100,
  "direction": "forward",
  "facing": "path-tangent",
  "frameStart": 70,
  "frameEnd": 90,
  "playback": {
    "version": 1,
    "speed": 1,
    "loop": false,
    "loopMode": "ping-pong",
    "baseDurationFrames": 20
  },
  "derivedSource": {
    "sourceSignature": "md7psf",
    "curveIds": [
      "fc_node_character_2_transform_position_0",
      "fc_node_character_2_transform_position_1",
      "fc_node_character_2_transform_position_2"
    ],
    "keyframeFrames": [70, 90],
    "keyframeIds": ["kf_…", "kf_…"]
  }
}
```

| 字段 | 说明 |
|---|---|
| `facing` | `path-tangent`：身体沿切线 |
| `direction` | `forward`：从 `pathStartPercent` 走到 `pathEndPercent` |
| `derivedSource.curveIds` | 指向 `fcurvesRef` 那份资产里的位移曲线 |
| `sourceSignature` | 和 path 节点 `metadata.derivedPathMotionSourceSignature` 相同 |

角色动作（骨架）和路径（根位移）是分开的：`character_2` 在 70–115 播飞踢，70–90 同时沿第一条派生路径走。

## 11. 本样本时间线

主动轨是 `camera_2`（荷兰角_1，`isPrimary`）。`camera_1` 只在开头并行了盘旋下降和变焦推进。镜头在 1354 结束；`character_16` 的动作库演示拖到 1996。

| 帧 | 相机 | 动作 | 时长 | 备注 |
|---|---|---|---|---|
| 0–60 | camera_1 | 盘旋下降 | 2.0 s | 与 camera_2 前推并行 |
| 0–61 | camera_2 | 镜头前推 | 2.0 s | 主动轨起点 |
| 61–82 | camera_2 | 甩摇 | 0.7 s | 最短镜头 |
| 82–154 | camera_2 | 迎面跟拍 | 2.4 s | 目标静止，画面不动 |
| 120–180 | camera_1 | 变焦推进 | 2.0 s | 叠在跟拍上 |
| 154–232 | camera_2 | 环绕拍摄 | 2.6 s | 180° |
| 232–292 | camera_2 | 镜头左摇 | 2.0 s | 12° |
| 292–328 | camera_2 | 穿越镜头 | 1.2 s | 提前插入 |
| 328–388 | camera_2 | 焦点转移 | 2.0 s | |
| 388–442 | camera_2 | 俯冲下降 | 1.8 s | 新预设 `drone_dive` |
| 442–520 | camera_2 | 拉升离场 | 2.6 s | 新预设 `pull_away`，FOV +8° |
| 520–598 | camera_2 | 盘旋抬升 | 2.6 s | |
| 598–676 | camera_2 | 盘旋下降 | 2.6 s | |
| 676–754 | camera_2 | 环绕拍摄 | 2.6 s | |
| 754–814 | camera_2 | 镜头下摇 | 2.0 s | |
| 814–874 | camera_2 | 镜头下降 | 2.0 s | |
| 874–934 | camera_2 | 镜头前推 | 2.0 s | |
| 934–994 | camera_2 | 镜头后移 | 2.0 s | |
| 994–1054 | camera_2 | 变焦拉远 | 2.0 s | |
| 1054–1114 | camera_2 | 横滑揭示 | 2.0 s | |
| 1114–1150 | camera_2 | 穿越镜头 | 1.2 s | 第二次 |
| 1150–1210 | camera_2 | 焦点转移 | 2.0 s | 第二次 |
| 1210–1282 | camera_2 | 跟随拍摄 | 2.4 s | 目标静止 |
| 1282–1354 | camera_2 | 侧面跟拍 | 2.4 s | 镜头收尾 |

## 12. 本仓如何消费这个格式

本仓**原生消费这个格式**，不做字段改名、不做坐标转换。

类型定义在 `contract/types.ts`（wire 形态，`DirectorDocument`），载入时经
`contract/validate.ts` 的 zod 校验。`document/DirectorDoc.ts` 是在它之上的 observable
可编辑模型，不是 schema 本身。

| 格式字段 | 落到本仓 |
|---|---|
| 坐标 / 旋转 / 单位 | 原样沿用（同为 Y-up 右手米制） |
| `camera.position` + `lookAt` + `fov` | 直接构造 `THREE.PerspectiveCamera` |
| `cameraMotionClips[].motion.curves` | `FCurveSet` 直接采样（毫秒域，绝对值，见 §14.1） |
| `motionClips` 的 mixamo FBX | 同源按名绑定；UAL1 目标骨架经 `engine/rig/applyRetarget.ts` 的 `Ual1Retargeter` 重定向（52 项映射在 `evaluate/retarget/RetargetMap.ts`） |
| `pathMotionClips` | `evaluate/path/samplePath.ts` 的 `evaluatePathMotionInto` 按 `timeRatio` 插值，区间 `[frameStart, frameEnd)` |
| `character.appearance` / `name` | 原样读 |
| `prop.metadata.bounds.size` | 原样读（无需换轴） |
| `prop.metadata.modelUrl` | S3 key，经 `HostAdapter.resolveMediaUrl` / `resolveAssetUrl` 寻址（见 `assets-manifest.md`） |

**媒体字段必须已经是 key**：`3d-builder/library/**` 或私有前缀（`canvas/`、
`3d-builder/user/`）。`host/assetKeys.ts` 的 `resolveMediaKey` 不再把 `http(s)://`、
`motions/sources/`、裸文件名、`3d-builder/public/` 猜成可解析 key，遇到就抛错。
冻结夹具 `xiaoyunque-draft.json` 仍带历史 `public/` 前缀，只给 evaluate 当结构样本，
不进运行时加载。

三条实现约束，**违反任一条都会产生逐帧位姿偏差**（§14 实测已验证）：

- 相机路径用曲线里的 `position` + `lookAt`，**不要**用 `transform.rotation`。
- 运镜曲线是绝对值，**不做段间偏移衔接**（§14 第 1 条）。
- fcurve 缺手柄时补**水平自动切线**，不是 linear 回退（§14 第 3 条）。

还有一条格式层面的坑：跟拍必须跟着真正在动的目标。本样本里三段 tracking 的
目标是静止点，**不要把常值曲线当成位移**。

读本仓库去壳样本的最短路径：

```bash
python3 -c "
import json
from pathlib import Path
doc = json.loads(Path('docs/samples/xiaoyunque-draft.json').read_text())
scene = doc['content']
print(doc['type'], scene['aspectRatio'], 'nodes', len(scene['nodes']))
"
# biz/scene3d-director-document 21:9 nodes 27
```

从带壳的接口响应去壳（从小云雀抓到新草稿时用；`xiaoyunque.json` 指你自己抓下来的
那份响应，不在本仓）：

```bash
python3 -c "
import json
from pathlib import Path
raw = json.loads(Path('xiaoyunque.json').read_text())
doc = json.loads(raw['data']['Assets'][0]['TextInfo']['content'])
Path('out-draft.json').write_text(
    json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
)
"
```

去壳后还要把媒体字段的绝对 URL 改成 `3d-builder/library/**` key，否则
`resolveMediaKey` 会抛错（§12）。

## 13. 第二样本：沙滩日落草稿（group / primitive / 用户角色）

> 历史样本，仓库里的 `beach-draft.json` 已删除。下面 JSON 只说明 group / primitive
> / 用户角色字段，不再作为 golden 夹具。

资产 `6602986767372`，标题
「搭建3个女孩子在沙滩上看日落的场景」。0–553 帧，39 节点：5 角色 + 13 相机 +
5 道具 + 3 路径 + **2 group + 11 primitive**（第一样本没有的两种类型）。
11 条 motionClips、3 条 pathMotionClips、仅 1 条 cameraMotionClips
（camera_7 dolly_in 0–60）。

### 13.1 group 节点

成组的白模道具（沙滩地面 9 块沙面、遮阳伞 2 件）：

```json
{
  "id": "beach_ground",
  "type": "group",
  "children": ["beach_ground__沙面1", "..."],
  "group": {
    "appearance": { "color": "#F5E6C8" },
    "kind": "prop",
    "label": { "showLabel": true, "scale": 0.8, "yOffset": 0.04 },
    "layout": { "perColumn": 2, "perRow": 2, "spacingDepth": 120, "spacingWidth": 120 }
  },
  "metadata": {
    "assetSource": "generated",
    "generatedMeshId": "gm_beach_ground",
    "interactionAnchors": [ { "anchorId": "center", "capabilities": ["support"],
      "partId": "beach_ground__沙面5", "position": {}, "rotation": {} } ]
  },
  "transform": {}
}
```

`layout` 是编辑器排版参数（单位像素感，不是米），不进几何。
`interactionAnchors` 是交互挂点（support/contact），`partId` 指向子件。

### 13.2 primitive 节点

参数化几何体，配 `parentId` 挂到 group：

```json
{
  "id": "beach_ground__沙面1",
  "type": "primitive",
  "parentId": "beach_ground",
  "primitive": { "kind": "BoxGeometry", "parameters": { "width": 0.9, "height": 0.05, "depth": 0.9 } },
  "metadata": { "assetSource": "generated", "generatedPropId": "beach_ground", "sourceType": "scene-plan" },
  "transform": {}
}
```

`kind` 是 three.js 几何体类名，本样本有 `BoxGeometry` / `CylinderGeometry`
（伞杆 radiusTop 0.025 / radiusBottom 0.03 / height 2）/ `ConeGeometry`
（伞面 radius 1.25 / height 0.8）。`parameters` 直接对应构造参数，单位米。
颜色继承所属组的 `group.appearance.color`。

### 13.3 用户上传角色

```json
{
  "id": "user_character_6647035190796_1789043166180",
  "type": "character",
  "name": "Child",
  "metadata": {
    "assetCategory": "uploaded-model",
    "assetId": "6647035190796",
    "assetSource": "user",
    "modelUrl": "3d-builder/public/characters/user_child_6647035190796.glb"
  }
}
```

小云雀原始形态这两个字段是 7 天有效的 TOS 签名 URL（`modelUrl` + `downloadUrl`）。
本仓已把该 GLB 双写进官方库，字段改成上面的 key；`assetSource: 'user'` + `assetId`
这对组合历史上由 `userChildCharacterKey(assetId)` 推出同一个 public key；
该 helper 已删除，用户角色现在走 `3d-builder/user/` 或素材库条目。

实测这份 GLB **不是 mixamorig**，是 UAL1 命名（`pelvis` / `spine_01` /
`upperarm_l` / `hand_l`，连手指都有）。它仍绑 mixamorig 动作
（本样本 `center_block`），小云雀在运行时表示层做了重定向。本仓复刻见
`packages/builder/src/evaluate/retarget/`（52 项映射）+ `engine/rig/applyRetarget.ts`
（世界系增量 FK，实测髋部比例 = 目标 rest 髋高 / 源 rest 髋高 ≈ 0.409）。
签名 URL 过期后用 CDN 上的副本
`3d-builder/public/characters/user_child_6647035190796.glb`。

### 13.4 fcurves 外部资产（compact-v1 格式）

**修订：早前「拿不到」的结论作废。** 打开导演台时页面会发一次批量
`POST /api/biz/v1/asset/query`，响应里带**项目全部资产**（实测 38 条），
fcurves 资产就在其中，只是 `TextInfo.content` 不是带 `type` 的文档、而是一段
紧凑曲线 JSON。本地快照：
`docs/samples/beach-fcurves.json`（资产 `6640956440844`，16 条曲线）、
`docs/samples/xiaoyunque-fcurves.json`（资产 `6643694107404`，13 条曲线）。

格式（`version=1`，`encoding="compact-v1"`）：

```json
{
  "version": 1,
  "encoding": "compact-v1",
  "fcurves": [
    {
      "id": "fc_node_character_1_transform_position_0",
      "t": ["node", "character_1"],
      "p": "transform.position",
      "i": 0,
      "k": [
        [32, -1.24, "bezier", "kf_mtvd9d33_at0abb"],
        [105, -1.24, "bezier", "kf_mtvdapdv_ob1ecw", null, {"x": 105.333, "y": -1.24}],
        [106, -1.24, "bezier", "kf_mtveo4r7_y9t0ci", {"x": 105.667, "y": -1.24}, {"x": 123.667, "y": -1.24}]
      ]
    }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `t` | 目标：`["node", 节点id]` |
| `p` | 属性路径：`transform.position` / `transform.rotation` / `transform.scale` / `camera.lookAt` / `camera.fov` |
| `i` | 分量：x=0 / y=1 / z=2（fov 恒 0） |
| `k[n]` | `[帧号, 值, 插值, 关键帧id, 入手柄?, 出手柄?]`；帧号浮点（**帧域**，不是毫秒） |
| 手柄 | `{"x": 帧, "y": 值}`；index 4 = 入手柄（键左侧），index 5 = 出手柄（右侧）。双端手柄齐全 → 三次贝塞尔；缺手柄 → 补**水平自动切线**（**不是** linear 回退，见 §14.3）；范围外 constant |

单位与节点一致：position 米、rotation 度、scale 倍率、fov 度。

两个样本的曲线内容：

| 草稿 | 曲线 | 内容 |
|---|---|---|
| beach | `character_1` pos/rot/scale ×3 | keys@[32,65,105,106,159,177,199]；rotation 全 0、scale 全 1，105→106 是平台保持 |
| beach | `camera_2` pos/lookAt/fov | **逐帧烘焙 keys@60–120（61 键/条）**，无手柄；fov 50→62 |
| 原草稿 | `character_2` position | keys@[70,90,115,152]（90→115 平台，115→152 x 走到 10.34） |
| 原草稿 | `character_2` rotation/scale | keys@[90,115,152]；**-180° 在 rotation.x 和 rotation.z**，不是 y |
| 原草稿 | `camera_1` lookAt/fov | 单键@60，constant 外推全程 |

渲染时的叠加规则（本仓库实现）：

- fcurves 是被 K 属性的权威值，覆写节点静态 transform；未 K 分量保持静态值。
- 时间线「位移 / 旋转 / 缩放」钻石读的是 **userKeys 覆写层**（不是官方 walk 曲线）。
  保存时 `FCurveSet.persist` 把非空 `userKeys` 挂在 compact-v1 JSON 的 sidecar
  字段上（schema `additionalProperties: true`，不改官方 `fcurves` 数组），加载后再灌回覆写层。
  不要把用户键烘焙进 walk 曲线，否则删键无法撤回。
- userKeys **首键之前不外推**（回退 fcurves / 静态 transform），**末键之后钉住最后一键**
  （`sampleKeyframesInto(..., extrapolate=false)` 只关首端）。优先级 userKeys > fcurves > 静态。
- **拖拽 / 数值编辑不自动打关键帧**：当前帧（±0.5）已有 userKey 则更新该键的值，
  否则只写节点静态 transform；官方 fcurves 层不被这类编辑改写。新建关键帧的唯一入口是
  时间轴 / Inspector 的「添加关键帧」按钮（`addKeyframes`）。
- **删键落座**：删除关键帧使某条 userKeys 轨道变短时，节点静态 transform 落座到
  「剩余键的最早帧值」；键删光时回到「被删前最早键的值」——删除后节点回到关键帧
  开始位置，而不是停留在被删的结束位置。undo 由三合一快照整体恢复。
- **朝向跟随路径**：角色在派生走位 clip（`facing=path-tangent`）覆盖的帧上，朝向由
  路径切线 yaw 决定，该帧的旋转用户键让路（仅 character；prop 的旋转仍由静态/键决定）。
- `pathMotionClips` 若 `lockedReason=derived-from-keyframes`，它是关键帧的派生
  可视化：有效位移键 **userKeys 优先、无用户键时回退 fcurves**；目标有 position 键时
  **位置只由关键帧决定**（别双重叠加），派生 path clip 只贡献 `path-tangent` 的 yaw；
  rotation fcurves 有真实变化时朝向全归 fcurve。
- 相机先算 `cameraMotionClips`，再用 camera fcurves 覆写。原草稿 camera_1 的
  单键 fov=70 会因此压过「变焦推进」clip 的 fov 曲线（官方键优先，行为变化注意）。

### 13.5 抓草稿的接口形态

见 [`observation-notes.md`](./observation-notes.md) §4。

## 14. 运行时实测语义

逐帧位姿对比的验证过程与结论已移到 [`observation-notes.md`](./observation-notes.md) §5；
其中确立的求值规则已经写进上文各节（§8–§10）和 [`architecture.md`](./architecture.md)。

## 附录 A：去壳草稿

见 [`observation-notes.md`](./observation-notes.md) §6。

## 附录 B：导出到 Z-up 管线（留档，本项目不用）

本项目是 Y-up 原生消费，**不需要下表**。留档是为了将来把草稿导出到 Blender /
USD 侧管线（Z-up、`target_m` / `lens_mm` / UAL1 骨架）时有参照。

| 小云雀 | Z-up 管线 |
|---|---|
| Y-up `(x, y, z)` | Z-up `(x, z, y)` |
| `camera.lookAt` | `target_m` |
| `camera.fov`（垂直度） | `lens_mm`（按 sensor 高 24 mm 换） |
| `cameraMotionClips[].motion.curves` | `set_camera_animation` 的 `keyframes[]` |
| `character.appearance.color` | `display_color` |
| `character` 节点 `name` | `display_label` |
| `prop.metadata.bounds.size` | `world_dimensions_m`（先换成 Z-up：`(x, z, y)`） |
| `prop.metadata.modelUrl` | 官方白模，不是该管线的 `assets/` 库存 |
| `motionClips` 官方 mixamo FBX | 不要直接当 UAL1 clip 用 |
