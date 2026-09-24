import { Box3, Vector3 } from 'three'

const point = v => ({ x: v.x, y: v.y, z: v.z })

// Geometric candidates only: a chair's seat, armrest and back top can all be
// horizontal. Consumers must identify the seat from annotations and the image.
export function supportSurfaces(object) {
  const groups = new Map()
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  const ab = new Vector3(), ac = new Vector3(), normal = new Vector3()
  object.traverse(mesh => {
    const geometry = mesh.geometry
    if (!mesh.isMesh || mesh.isSkinnedMesh || !geometry?.attributes.position) return
    const indices = geometry.index
    const count = indices?.count ?? geometry.attributes.position.count
    for (let i = 0; i + 2 < count; i += 3) {
      for (const [offset, v] of [[0, a], [1, b], [2, c]]) {
        mesh.getVertexPosition(indices ? indices.getX(i + offset) : i + offset, v)
        v.applyMatrix4(mesh.matrixWorld)
      }
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a))
      const area = normal.length() / 2
      if (area < 1e-8 || normal.y / (2 * area) < 0.97) continue
      const height = (a.y + b.y + c.y) / 3
      const bucket = Math.round(height / 0.02)
      const group = groups.get(bucket) || { area: 0, weightedHeight: 0, bounds: new Box3() }
      group.area += area
      group.weightedHeight += area * height
      group.bounds.expandByPoint(a).expandByPoint(b).expandByPoint(c)
      groups.set(bucket, group)
    }
  })
  return [...groups.values()].filter(g => g.area > 0.005)
    .sort((a, b) => b.area - a.area).slice(0, 6).map(g => ({
      height: g.weightedHeight / g.area, area: g.area,
      worldWidth: g.bounds.max.x - g.bounds.min.x,
      worldDepth: g.bounds.max.z - g.bounds.min.z,
      bounds: { min: point(g.bounds.min), max: point(g.bounds.max) },
    }))
}

export function characterLandmarks(root) {
  const names = {
    hips: ['mixamorighips', 'hips', 'pelvis'],
    leftKnee: ['mixamorigleftleg', 'leftleg', 'calfl'],
    rightKnee: ['mixamorigrightleg', 'rightleg', 'calfr'],
    leftAnkle: ['mixamorigleftfoot', 'leftfoot', 'footl'],
    rightAnkle: ['mixamorigrightfoot', 'rightfoot', 'footr'],
    leftHip: ['mixamorigleftupleg', 'leftupleg', 'thighl'],
    rightHip: ['mixamorigrightupleg', 'rightupleg', 'thighr'],
  }
  const result = {}
  root.traverse(obj => {
    if (!obj.isBone) return
    const name = obj.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (const [key, aliases] of Object.entries(names)) {
      if (aliases.includes(name)) result[key] = point(obj.getWorldPosition(new Vector3()))
    }
  })
  return result
}
