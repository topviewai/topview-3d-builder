import type { DirectorDocument } from '../../contract/types'
import { parseDirectorDocument } from '../../contract/validate'
import { propMediaRef, resolvedMediaUrl } from '../io/mediaRefs'
import type { AssetLoader } from '../io/AssetLoader'
import { buildCameraInstance } from './CameraObject'
import { buildCharacterInstance } from './CharacterObject'
import { attachGroupLabel, buildGroupInstance } from './GroupObject'
import { buildPathInstance, type PathViewHost } from './PathObject'
import { buildPrimitiveInstance } from './PrimitiveObject'
import { attachProp } from './PropObject'
import { addEnvironment } from './environment'
import type { StageGraph } from './graph'

export async function loadDocument(
  graph: StageGraph,
  loader: AssetLoader,
  doc: DirectorDocument,
  onProgress?: (msg: string) => void,
  isStale?: () => boolean,
): Promise<void> {
  const stale = () => isStale?.() === true
  parseDirectorDocument(doc)
  graph.doc = doc
  for (const n of doc.content.nodes) graph.nodeById.set(n.id, n)
  addEnvironment(graph.scene, doc)

  for (const n of doc.content.nodes.filter((node) => node.type === 'camera')) {
    buildCameraInstance(graph, n)
  }

  const charNodes = doc.content.nodes.filter((node) => node.type === 'character')
  if (charNodes.length > 0) {
    const urlByNode = new Map<string, string>()
    await Promise.all(charNodes.map(async (n) => {
      urlByNode.set(n.id, await loader.characterUrl(n))
    }))
    const urls = [...new Set(urlByNode.values())]
    if (stale()) return
    await Promise.all(urls.map((url) => loader.loadCharacterTemplate(url, onProgress)))
    if (stale()) return
    const mixamorigTpl = loader.mixamorigTemplate()
    if (mixamorigTpl) graph.motionPlayer.setMixamorigTemplate(mixamorigTpl)
    const labelsVisible = doc.content.environment.display?.characterLabelsVisible !== false
    for (const n of charNodes) {
      if (stale()) return
      const url = urlByNode.get(n.id)
      if (!url) continue
      const template = loader.lookupCharacterTemplate(url)
      if (!template) {
        console.warn(`[Stage] 角色模型缺失: ${n.id} → ${url}`)
        continue
      }
      buildCharacterInstance(graph, n, template, labelsVisible)
    }
  }

  await Promise.all(
    doc.content.nodes
      .filter((n) => n.type === 'prop')
      .map(async (n) => {
        if (stale()) return
        const ref = propMediaRef(n)
        const url = ref ? await resolvedMediaUrl(graph.resolveMediaUrl, ref) : null
        if (!url || stale()) return
        try {
          attachProp(graph, n, await loader.loadPropTemplate(url))
        } catch (e) {
          console.warn(`[Stage] 道具加载失败 ${url}`, e)
        }
      }),
  )
  if (stale()) return

  for (const n of doc.content.nodes.filter((g) => g.type === 'group')) buildGroupInstance(graph, n)
  for (const n of doc.content.nodes.filter((p) => p.type === 'primitive')) buildPrimitiveInstance(graph, n)
  for (const n of doc.content.nodes.filter((g) => g.type === 'group')) attachGroupLabel(graph, n)
  for (const n of doc.content.nodes.filter((p) => p.type === 'path')) {
    buildPathInstance(graph as PathViewHost, n)
  }

  await loader.preloadMotions(doc, (id, url) => graph.motionPlayer.load(id, url), onProgress)
  if (stale()) return
  pruneOrphanCharacterRoots(graph)
}

function pruneOrphanCharacterRoots(graph: StageGraph): void {
  for (const child of [...graph.scene.children]) {
    const mapped = graph.characters.get(child.name)
    if (!mapped) continue
    if (mapped.root === child) continue
    graph.scene.remove(child)
  }
}

export function clearGraph(graph: StageGraph): void {
  graph.doc = null
  graph.nodeById.clear()
  graph.characters.clear()
  graph.cameras.clear()
  graph.props.clear()
  graph.groups.clear()
  graph.primitives.clear()
  graph.pathNodes.clear()
  const host = graph as PathViewHost
  host.pathViews?.clear()
  host.pathPickTargets?.clear()
  host.pathMaterials?.clear()
  graph.snapshot.clear()
}
