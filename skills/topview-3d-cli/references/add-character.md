# Add a character

Character blocking is the central deliverable. Plan all people together: named identity, relative
left / right / front / back, spacing, facing and gaze, foreground or background layer, entrance
route and contact with essential props. Solve these relationships before polishing an individual
pose. The mannequins approximate clothing and appearance; do not search for costume fidelity. Keep
the same world positions across every view of one moment. Check positions in the overview and
readability and occlusion from story cameras; a pleasing individual pose cannot compensate for a
wrong relationship between people.

1. **List the complete character catalog, then choose.** `topview-3d-cli asset search --kind character`
   lists all built-in characters (Child, Youth, Female, Man) and any imported ones. Choose from
   names and tags for the requested identities and ages; covers are not needed. Reuse the same
   list for every person. If no model fits, explain the gap and the closest alternative.
2. **Add with identity.** In `topview-3d-cli node batch` use `add_library` with `kind: "characters"`,
   the full `libraryId` and a clear `name` from the prompt ("Lead · Ming", "Mother · Ms Li",
   "Defender"). Distinct people may share one model; keep identity → node id in BOM
   `constraints`.

   ```json
   {"expectedSceneSequence": 4, "changes": [
     {"action": "add_library", "kind": "characters", "nodeId": "mother",
      "libraryId": "a3d_char_30ec53c93eae4173946b38639691ebe0", "name": "Mother · Ms Li",
      "position": {"x": -0.6, "z": 0.4}, "rotation": {"y": 90}}
   ]}
   ```

3. **Place the character first.** Follow `layout.md` and the BOM support, facing and spacing
   relations. Measure with `topview-3d-cli inspect nodes <dir> <id>...` (bounds, landmarks, grounding);
   propose position, facing and (rarely) scale relative to already placed props; dry-run with
   `topview-3d-cli evaluate`, then write with `update` changes. Nobody stays at the origin by accident.
4. **Choose the static pose after placement.** Follow `pose.md`, then `checks.md` to verify.
