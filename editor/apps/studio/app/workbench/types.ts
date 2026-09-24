export interface DraftRow {
  id: string
  name: string
  fps?: number
  frameEnd?: number
  nodeCount?: number
}

export interface DraftsResponse {
  user: DraftRow[]
}

export interface ProjectRow extends DraftRow {
  root: string
}
