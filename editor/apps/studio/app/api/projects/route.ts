import { projectSummaries } from '../../../src/localProjects'

export const runtime = 'nodejs'

export function GET(): Response {
  return Response.json({ projects: projectSummaries() }, { headers: { 'Cache-Control': 'no-store' } })
}
