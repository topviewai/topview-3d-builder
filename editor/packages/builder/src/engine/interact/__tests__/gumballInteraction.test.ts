import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  Euler,
  Group,
  Object3D,
  Raycaster,
  Vector3,
} from 'three'
import { EDITOR_LAYER } from '../../core/Layers'
import { buildGumball, GumballHandleType, setGumballScaleVisible, type GumballHandleUserData } from '../gumball/buildGumball'
import {
  applyGumballMultiDelta,
  beginDrag,
  pickHandle,
  updateDrag,
} from '../gumball/gumballInteraction'

const snap = (value: number) => value

function handle(type: GumballHandleType, axis: GumballHandleUserData['axis']): GumballHandleUserData {
  return {
    gumballHandle: true,
    handleType: type,
    axis,
    key: `${type}:${axis}`,
    highlightMaterials: [],
  }
}

function rayToward(origin: Vector3, target: Vector3): Raycaster {
  const direction = target.clone().sub(origin).normalize()
  const ray = new Raycaster(origin, direction)
  ray.layers.enableAll()
  return ray
}

describe('pickHandle', () => {
  it('相机隐藏缩放后不能命中，重新显示后恢复', () => {
    const build = buildGumball()
    build.group.updateMatrixWorld(true)
    const proxy = build.interactiveMeshes.find((mesh) => mesh.userData.gumball.key === 'scale:x')!
    const target = proxy.getWorldPosition(new Vector3())
    const ray = new Raycaster(target.clone().add(new Vector3(0, 0, 3)), new Vector3(0, 0, -1))
    ray.layers.set(EDITOR_LAYER)
    assert.equal(pickHandle(ray, [proxy])?.key, 'scale:x')
    setGumballScaleVisible(build, false)
    assert.equal(pickHandle(ray, [proxy]), null)
    setGumballScaleVisible(build, true)
    assert.equal(pickHandle(ray, [proxy])?.key, 'scale:x')
  })

  it('平面格栅正反面靠近边缘都能命中', () => {
    const build = buildGumball()
    build.group.updateMatrixWorld(true)
    for (const axis of ['xy', 'yz', 'xz'] as const) {
      const proxy = build.interactiveMeshes.find((mesh) => mesh.userData.gumball.key === `plane:${axis}`)!
      const target = proxy.localToWorld(new Vector3(0.12, 0.12, 0))
      const normal = new Vector3(0, 0, 1).transformDirection(proxy.matrixWorld)
      for (const side of [-1, 1] as const) {
        const ray = new Raycaster(target.clone().addScaledVector(normal, side * 3), normal.clone().multiplyScalar(-side))
        ray.layers.set(EDITOR_LAYER)
        assert.equal(pickHandle(ray, [proxy])?.key, `plane:${axis}`)
      }
    }
  })
})

describe('updateDrag', () => {
  it('沿世界 X 平移，只改 position.x', () => {
    const mesh = new Object3D()
    const origin = new Vector3(0, 0, 0)
    const start = beginDrag(handle(GumballHandleType.TRANSLATE, 'x'), mesh, rayToward(new Vector3(0, 0, 5), origin), origin)
    assert.ok(start)
    updateDrag(start!, mesh, rayToward(new Vector3(2, 0, 5), new Vector3(2, 0, 0)), snap)
    assert.ok(Math.abs(mesh.position.x - 2) < 1e-6)
    assert.ok(Math.abs(mesh.position.y) < 1e-6)
    assert.ok(Math.abs(mesh.position.z) < 1e-6)
  })

  it('绕包围盒中心旋转，脚底做位移补偿而不是绕原点甩', () => {
    const mesh = new Object3D()
    mesh.position.set(1, 0, 0)
    const pivot = new Vector3(0, 1, 0)
    const startRay = rayToward(new Vector3(1, 5, 0), new Vector3(1, 1, 0))
    const session = beginDrag(handle(GumballHandleType.ROTATE, 'y'), mesh, startRay, pivot)
    assert.ok(session)
    const nowRay = rayToward(new Vector3(0, 5, 1), new Vector3(0, 1, 1))
    updateDrag(session!, mesh, nowRay, snap)
    assert.ok(Math.abs(mesh.position.x) < 1e-4)
    assert.ok(Math.abs(mesh.position.z - 1) < 1e-4)
    assert.ok(Math.abs(mesh.position.y) < 1e-4)
    assert.ok(Math.abs(mesh.position.distanceTo(pivot) - Math.hypot(1, 1)) < 1e-4)
  })

  it('整体缩放三轴同步增大', () => {
    const mesh = new Object3D()
    const origin = new Vector3(0, 0, 0)
    const dir = new Vector3(-1, -1, -1).normalize()
    const startHit = dir.clone().multiplyScalar(1.15 * 1.2)
    const session = beginDrag(
      handle(GumballHandleType.SCALE, 'uniform'),
      mesh,
      rayToward(startHit.clone().add(new Vector3(0, 0, 5)), startHit),
      origin,
    )
    assert.ok(session)
    const later = dir.clone().multiplyScalar(1.15 * 1.2 + 0.4)
    updateDrag(session!, mesh, rayToward(later.clone().add(new Vector3(0, 0, 5)), later), snap)
    assert.ok(mesh.scale.x > 1.3)
    assert.ok(Math.abs(mesh.scale.x - mesh.scale.y) < 1e-6)
    assert.ok(Math.abs(mesh.scale.y - mesh.scale.z) < 1e-6)
  })

  it('物体已绕 Y 转 90° 时，世界 X 缩放落到局部 Z', () => {
    const mesh = new Object3D()
    mesh.quaternion.setFromEuler(new Euler(0, Math.PI / 2, 0))
    const origin = new Vector3(0, 0, 0)
    const start = beginDrag(
      handle(GumballHandleType.SCALE, 'x'),
      mesh,
      rayToward(new Vector3(-1.15, 0, 5), new Vector3(-1.15, 0, 0)),
      origin,
    )
    assert.ok(start)
    updateDrag(start!, mesh, rayToward(new Vector3(-2.15, 0, 5), new Vector3(-2.15, 0, 0)), snap)
    assert.ok(Math.abs(mesh.scale.x - 1) < 1e-4)
    assert.ok(mesh.scale.z > 1.5)
  })
})

describe('applyGumballMultiDelta', () => {
  it('平移虚拟枢轴时整组跟着平移', () => {
    const a = new Object3D()
    a.position.set(-1, 0, 0)
    const b = new Object3D()
    b.position.set(1, 0, 0)
    const meshes = new Map<string, Object3D>([['a', a], ['b', b]])
    const starts = new Map([
      ['a', { position: a.position.clone(), quaternion: a.quaternion.clone(), scale: a.scale.clone() }],
      ['b', { position: b.position.clone(), quaternion: b.quaternion.clone(), scale: b.scale.clone() }],
    ])
    const pivot = new Group()
    pivot.position.set(0, 0, 0)
    const session = beginDrag(
      handle(GumballHandleType.TRANSLATE, 'x'),
      pivot,
      rayToward(new Vector3(0, 0, 5), new Vector3(0, 0, 0)),
      new Vector3(0, 0, 0),
    )
    assert.ok(session)
    updateDrag(session!, pivot, rayToward(new Vector3(3, 0, 5), new Vector3(3, 0, 0)), snap)
    applyGumballMultiDelta(session!, pivot, starts, (id) => meshes.get(id))
    assert.ok(Math.abs(a.position.x - 2) < 1e-6)
    assert.ok(Math.abs(b.position.x - 4) < 1e-6)
  })
})
