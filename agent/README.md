# topview-3d-cli

`topview-3d-cli` builds and renders 3D director scenes on your machine. Projects are plain files in a
`.topview-3d/` directory; rendering uses a local headless Chromium and makes no network requests.

Requirements: Python 3.11+ and Node.js 20.6+ (with npm).

```bash
uvx --python 3.12 topview-3d-cli doctor        # or: pipx run topview-3d-cli doctor
topview-3d-cli browser ensure                           # one-time: Playwright + Chromium into the user cache
topview-3d-cli project init my-scene
topview-3d-cli asset search man --kind character
topview-3d-cli node batch my-scene changes.json
topview-3d-cli inspect views my-scene
topview-3d-cli renders show my-scene
```

Built in: four characters, 121 poses and five primitives. Command reference and error codes:
`docs/topview-3d-cli.md` in the source repository.

Licence: code Apache-2.0; the built-in assets (characters, poses, covers) CC-BY-4.0,
"Scene3D built-in assets © Topview, CC BY 4.0". The asset licence and notice are installed with them
under `topview_3d_cli/_runtime/builtin-assets/`.
