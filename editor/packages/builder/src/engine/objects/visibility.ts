import type { StageGraph } from './graph'

export function applyNodeVisibility(graph: StageGraph): void {
  const nodes = graph.doc?.content.nodes ?? [...graph.nodeById.values()]
  for (const n of nodes) {
    const visible = n.visible !== false
    const character = graph.characters.get(n.id)
    if (character) character.root.visible = visible
    const prop = graph.props.get(n.id)
    if (prop) prop.visible = visible
    const prim = graph.primitives.get(n.id)
    if (prim) prim.visible = visible
    const group = graph.groups.get(n.id)
    if (group) group.visible = visible
    const cam = graph.cameras.get(n.id)
    if (cam) cam.gizmo.group.visible = visible
  }
}
