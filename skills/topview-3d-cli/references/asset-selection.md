# Asset selection

Decide the primitive constructions before searching; simple primitive props need no search. The
local library holds the four built-in characters and 121 poses, plus whatever the user imported
into the project (`.topview3d/assets`, found with `--project <dir>`).

| Need | Command |
| --- | --- |
| Characters (complete list) | `topview-3d-cli asset search --kind character` |
| Poses (complete list) | `topview-3d-cli pose catalog`, optionally `--category stand\|sit\|lie\|move\|action` |
| Keyword search | `topview-3d-cli asset search "<words>" --kind pose [--category C] [--tag T]` |
| One entry, cover image, usage | `topview-3d-cli asset show <id> [--project <dir>]` |
| Everything, including imports | `topview-3d-cli asset list <dir>` |

## Rules

- **Search input.** Every word of the query must match the name, id, category, tags or rig, so
  use one or two words per search and run independent searches separately. Refine with the exact
  `category` / `tag` values seen in `facets` of earlier results. Tags are not categories. Results
  are paged: follow `nextOffset` with `--offset` while `complete` is false.
- **Characters** are listed completely by one search without a query; choose from names and tags
  (Child, Youth, Female, Man). Covers are not needed.
- **Poses.** `pose catalog` returns every pose with its name, category and tags at once, so pose
  selection never depends on a keyword. Apply the default and contextual mappings in `pose.md`
  against the catalog before expanding to unusual poses. Mapped poses can be chosen from their
  textual intent and support conditions; look at a cover only for an unmapped or contradictory
  case. Category labels are not a naturalness or support-type ranking.
- **Covers.** `asset show` returns an absolute `coverPath`; open that image file to see it. A
  matching name or a missing cover is not visual approval.
- **Use ids verbatim.** Copy each `libraryId` exactly from `items[].id`. Pose ids may be given with
  or without the `a3d_pose_` prefix. On `ASSET_NOT_FOUND`, compare with the exact returned id and
  correct the argument; if the entry is gone, search again instead of guessing. Never invent an
  asset id.
- `kind` spelling differs by command: searches use `character` / `prop` / `pose`; `node batch`
  `add_library` uses `characters` / `props`.
- Once a candidate meets the shape, dimension and posture needs, move on to layout; only an
  identified gap justifies another search. Never download asset files yourself; topview-3d-cli resolves
  them from the local manifests.
