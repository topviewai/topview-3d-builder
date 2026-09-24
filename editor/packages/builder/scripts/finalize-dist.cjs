const fs = require('fs')
const path = require('path')

const distDir = path.join(__dirname, '..', 'dist')
const banner = '"use client";\n'

// dev watch 产物是 bundle:false 的多文件树，没有 index.js/index.mjs 单产物，
// 且 studio 侧已在 Client Component 内动态导入，不需要包自带的 banner。
const stylesOnly = process.argv.includes('--styles-only')

if (!stylesOnly) {
  for (const file of ['index.js', 'index.mjs']) {
    const target = path.join(distDir, file)
    const source = fs.readFileSync(target, 'utf8')
    if (!source.startsWith('"use client"') && !source.startsWith("'use client'")) {
      fs.writeFileSync(target, banner + source)
    }
  }
  // 发布形态兜底：tsup.config 已关 sourcemap，这里再清一次，
  // 防止 watch 遗留的 .map（内嵌 src 原文）混进 pnpm pack。
  for (const file of listFiles(distDir, (name) => name.endsWith('.map'))) {
    fs.rmSync(file, { force: true })
  }
}

const styleDir = path.join(__dirname, '..', 'src', 'styles')
const styleFiles = [
  'tokens.css',
  'base.css',
  'layout.css',
  'viewport.css',
  'inspector.css',
  'library.css',
  'timeline.css',
  'film.css',
  'dialog.css',
  'tutorial.css',
  'dropdown.css',
  'tooltip.css',
]
const css = styleFiles.map((name) => fs.readFileSync(path.join(styleDir, name), 'utf8')).join('\n')
fs.writeFileSync(path.join(distDir, 'styles.css'), css)

// Draco decoder shipped with three, so hosts serve it same-origin instead of a CDN.
const dracoSource = path.join(__dirname, '..', 'node_modules/three/examples/jsm/libs/draco')
const dracoTarget = path.join(distDir, 'draco')
fs.mkdirSync(dracoTarget, { recursive: true })
for (const file of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
  fs.copyFileSync(path.join(dracoSource, file), path.join(dracoTarget, file))
}

// watch 模式 clean:false（为保住完整构建产出的 .d.ts），源文件删除或移动后旧产物会滞留。
// 若重构途中仍有代码 import 旧路径，webpack 会静默解析到过时实现且不报错。
if (process.argv.includes('--prune')) {
  pruneOrphanArtifacts()
}

function listFiles(dir, matches, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, matches, acc)
    else if (matches(entry.name)) acc.push(full)
  }
  return acc
}

function removeEmptyDirs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = path.join(dir, entry.name)
    removeEmptyDirs(full)
    if (fs.readdirSync(full).length === 0) fs.rmdirSync(full)
  }
}

function pruneOrphanArtifacts() {
  const srcDir = path.join(__dirname, '..', 'src')
  const expected = new Set()
  for (const file of listFiles(srcDir, (name) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts'))) {
    if (file.split(path.sep).includes('__tests__')) continue
    const stem = path.relative(srcDir, file).replace(/\.tsx?$/, '')
    for (const ext of ['.mjs', '.js', '.mjs.map', '.js.map']) expected.add(stem + ext)
  }

  // 只清 JS 产物：.d.ts / .d.mts 由完整构建提供，styles.css 由上面拼接。
  for (const file of listFiles(distDir, (name) => /\.(mjs|js)(\.map)?$/.test(name))) {
    if (path.relative(distDir, file).startsWith(`draco${path.sep}`)) continue
    if (!expected.has(path.relative(distDir, file))) fs.rmSync(file, { force: true })
  }
  removeEmptyDirs(distDir)
}
