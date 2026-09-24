# Plugin images

`.codex-plugin/plugin.json` references two images in this folder:

| Field | File | Use |
| --- | --- | --- |
| `interface.logo` | `logo.png` | Plugin directory listing and detail page |
| `interface.composerIcon` | `icon.png` | Small icon in the composer |

Both are currently the same 512×512 Scene3D symbol. `.cursor-plugin/plugin.json` also uses
`logo.png`.

Requirements, enforced by `node scripts/package-codex-plugin.mjs`:

- PNG, square, 48–4096 px on each side (512 px or 1024 px recommended);
- at most 5 MiB per file;
- committed to git (the archive is built from `HEAD`), not a symlink.

When a file is missing, not a PNG, not square or out of range, the packaging script names the
field, the file and the rule, and writes no archive. `brandColor` in the manifest (`#3341FF`) is
the dominant blue sampled from the symbol.
