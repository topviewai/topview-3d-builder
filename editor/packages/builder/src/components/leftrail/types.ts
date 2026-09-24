export type HoverDiagramKind = 'cameraPreset' | 'cameraMotion' | 'primitive'

export interface HoverDiagram {
  kind: HoverDiagramKind
  id: string
}

export interface HoverTarget {
  assetKey?: string
  diagram?: HoverDiagram
  alt: string
  panelRight: number
  top: number
}

