// Serve the builder's Draco decoder at /draco/ (the builder's default decoder path).
const fs = require('fs')
const path = require('path')

const source = path.join(__dirname, '..', 'node_modules', '@topview', '3d-builder', 'dist', 'draco')
const target = path.join(__dirname, '..', 'public', 'draco')

if (!fs.existsSync(source)) {
  console.error(`copy-draco: ${source} is missing; build @topview/3d-builder first`)
  process.exit(1)
}
fs.mkdirSync(target, { recursive: true })
for (const file of fs.readdirSync(source)) {
  fs.copyFileSync(path.join(source, file), path.join(target, file))
}
