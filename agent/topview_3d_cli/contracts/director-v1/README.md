# Scene3D director-document v1

Wire contract for `runtime_profile=director-document-v1`.

The HTTP envelope for live operations still uses `schemaVersion: 2` (same
batch / bootstrap root) so existing gateways can fail-closed on unknown
kinds.

## Kinds

| kind | entityType | entityId | payload |
|---|---|---|---|
| `director.scene.set` | `DIRECTOR_SCENE` | `director` | `{ "scene": { type, pippitAssetId, extra?, content } }` — content has no `nodes` and no clip arrays |
| `director.node.upsert` | `DIRECTOR_NODE` | `DraftNode.id` | `{ "node": <DraftNode> }` and `node.id == entityId` |
| `director.node.delete` | `DIRECTOR_NODE` | node id | `{}` |
| `director.clip.upsert` | `DIRECTOR_CLIP` | clip id | `{ "clipKind": "cameraMotion"\|"motion"\|"pathMotion", "clip": <clip> }` and `clip.id == entityId` |
| `director.clip.delete` | `DIRECTOR_CLIP` | clip id | `{}` |
| `director.fcurves.set` | `DIRECTOR_FCURVES` | `fcurves__<nodeId>` | `{ "version": 1, "encoding": "compact-v1", "fcurves": [] }` |
| `director.fcurves.delete` | `DIRECTOR_FCURVES` | `fcurves__<nodeId>` | `{}` |

`entityId` is `[A-Za-z0-9_-]{1,128}`. Use `fcurves__` (two underscores), never `:`.

## Profile mutual exclusion

- `director-document-v1` accepts only `director.*` kinds.
- Path clips use half-open `[frameStart, frameEnd)`.
- Camera motion clips are baked in the millisecond domain; playback reads `curves`.

## Compatibility

Unknown kinds and unknown payload fields fail closed. The three fixture files
are golden documents; their hashes are pinned in `test_contract.py`.
`fixtures/document.json` differs from the upstream services' copy only in the
character asset id and model key, which point at a built-in character.
