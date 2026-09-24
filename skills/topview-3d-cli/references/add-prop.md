# Add a prop

Props describe the space and support character actions for downstream video generation. An
abstract shape should be close enough to recognize; proportions, placement and contact matter more
than detail. Default to one basic shape, adding parts only for a necessary silhouette, opening or
support surface. Listed materials and decorations are visual cues, not parts to model. Represent
requested small props with simple markers; do not omit story-critical cues. Do not refine labels,
buttons, seams, textures or hardware.

The built-in library contains characters and poses but **no prop models**. Props are primitives
unless the user supplies model files (see step 3).

1. **Choose primitives.** Plan the prop's role and real dimensions. Almost every object has a
   clear construction from **1–4 basic shapes**: a round table is a vertical cylinder pedestal plus
   a wide thin cylinder top; a cabinet, phone or tower is a box with suitable proportions. A
   tabletop needs thickness: a thin cylinder, never a zero-thickness disc. When flattening via
   scale use `0.001` on the thin axis, never `0`; geometry dimensions stay positive.
2. **Build it.** Use `topview-3d-cli node batch <dir> changes.json` with `add_primitive` changes (contract
   below), 1–4 parts per object, and clear part names ("Round table · top", "Round table ·
   pedestal"). Parts are separate nodes; moving one does not move the others. Rotate or resize an
   assembly around a common pivot and update all parts. Make touching parts align, supports reach
   the floor and surfaces have sensible thickness. Record object → part ids in BOM `constraints`.
3. **User-supplied models.** When the user provides a `.glb` / `.gltf` file for a specific
   object, import it into the project and add it by id:

   ```bash
   topview-3d-cli asset import --project <dir> model.glb --kind prop --id sofa-01 --name "Sofa"
   topview-3d-cli asset show sofa-01 --project <dir>
   ```

   `asset show` returns a ready `usage.change` (`add_library`, `kind: "props"`). Measure it
   (step 4) before placing anything on it; imported models carry no dimension annotations. Never
   download models yourself. If neither primitives nor a supplied model serve the purpose, report
   the gap instead of inventing an asset.
4. **Measure.** In the `node batch` result, each primitive row of `state.nodes` has `primitive.size`
   (local width/height/depth with scale applied, before rotation) next to its `kind` and
   `parameters`; the `geometry` check only lists problems. For imported
   models, rotated or scaled parts run `topview-3d-cli inspect nodes <dir> <id>...`, which returns world
   `size`, `bounds`, `origin` and support surfaces. Compare the size with the intended real size:
   if the ratio on the relevant axis is off by more than roughly 15 %, add an `update` with a
   uniform `scale` (or a single axis when the proportion itself is wrong) before placing anything
   on or against it. Verify the assembled object's total size and usable support surfaces, not
   each part alone.
5. **Plan and place.** Follow `layout.md` and the BOM relations in both NEW and EDIT. Place large
   and supporting objects first. Allow for the mesh origin and the actual bound minimum when
   grounding. Dry-run transforms with `topview-3d-cli evaluate <dir> plan.json`, revise, then write them
   with `update` changes. Confirm the semantic front visually, not from +Z alone. Finish through
   the check loop in `checks.md`.

## Primitive contract

`node batch` needs the current `expectedSceneSequence`, unused node ids and explicit geometry
dimensions; no operation ids or versions. Each change accepts an optional `name` and partial
`position` / `rotation` / `scale`; omitted axes are position and rotation 0 and scale 1. Combine
related parts in one call.

`primitive.kind` uses the exact constructor names. `doctor` counts five built-in primitive entries;
the fifth, `primitive_plane` (`PlaneGeometry`), is only for the Studio. `node batch` accepts the four
below, so model floors, walls and panels as a thin `BoxGeometry`. A schema error names the kind and
the offending field, for example `changes.0.primitive.parameters: 'depth' is a required property`.

| kind | parameters |
| --- | --- |
| `BoxGeometry` | `width`, `height`, `depth` |
| `CylinderGeometry` | `radiusTop`, `radiusBottom`, `height`, optional `radialSegments` (3–128) |
| `SphereGeometry` | `radius` |
| `ConeGeometry` | `radius`, `height`, optional `radialSegments` |

Dimensions and scales must be finite and positive; one cylinder radius may be zero for a taper.
Boxes and cylinders are centred on their origin; an upright cylinder's height runs along Y.

Example: a round table 1.5 m across and 0.75 m high (the pedestal ends at Y = 0.69, the tabletop
bottom). Replace the sequence and ids with current values.

```json
{"expectedSceneSequence": 2, "changes": [
  {"action": "add_primitive", "nodeId": "round_table_pedestal", "name": "Round table · pedestal",
   "primitive": {"kind": "CylinderGeometry", "parameters": {"radiusTop": 0.12, "radiusBottom": 0.12, "height": 0.69}},
   "position": {"y": 0.345}},
  {"action": "add_primitive", "nodeId": "round_table_top", "name": "Round table · top",
   "primitive": {"kind": "CylinderGeometry", "parameters": {"radiusTop": 0.75, "radiusBottom": 0.75, "height": 0.06}},
   "position": {"y": 0.72}}
]}
```

`createdIds` echoes the supplied ids and `state` lists the new transforms. Later changes use
`update` / `delete`; do not recreate existing parts. `topview-3d-cli document apply` stays a low-level
route for what the batch cannot express; prefer the typed batch. See `edit.md` for batch details.
