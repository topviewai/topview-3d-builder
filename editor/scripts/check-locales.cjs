const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const strings = path.join(root, 'packages/builder/src/locale/strings')
const studio = path.join(root, 'apps/studio/src/locale')

function readDictionary(file) {
  const source = fs.readFileSync(file, 'utf8')
  return file.endsWith('.json') ? JSON.parse(source) : JSON.parse(source.slice(source.indexOf('= ') + 2).trim().replace(/;$/, ''))
}

function flatten(value, prefix = '') {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => (
    typeof item === 'string' ? [[prefix + key, item]] : Object.entries(flatten(item, `${prefix}${key}.`))
  )))
}

function placeholders(value) {
  return (value.match(/\{\{\w+\}\}/g) ?? []).sort()
}

function checkCatalog(dir, extension, reference, nested) {
  const base = nested ? flatten(readDictionary(path.join(dir, reference))) : readDictionary(path.join(dir, reference))
  for (const name of fs.readdirSync(dir).filter((name) => name.endsWith(extension))) {
    const dict = nested ? flatten(readDictionary(path.join(dir, name))) : readDictionary(path.join(dir, name))
    const missing = Object.keys(base).filter((key) => !(key in dict))
    const extra = Object.keys(dict).filter((key) => !(key in base))
    assert.ok(!missing.length && !extra.length, `${name}: missing [${missing}], extra [${extra}]`)
    for (const [key, value] of Object.entries(dict)) {
      assert.ok(value.trim(), `${name}: empty ${key}`)
      assert.deepEqual(placeholders(value), placeholders(base[key]), `${name}: interpolation differs for ${key}`)
      assert.ok(!/ZXQ\d+QXZ|[【［\[]\d{3}[】］\]]/i.test(value), `${name}: translation marker in ${key}`)
    }
  }
  return base
}

const base = checkCatalog(strings, '.ts', 'en.ts', true)
// apps/studio is the debug host, not the published locale pack.
// Only require the language switcher to list the same locales as the builder.
const studioFiles = fs.readdirSync(studio).filter((name) => name.endsWith('.json'))
assert.deepEqual(
  studioFiles.map((name) => name.slice(0, -5)).sort(),
  fs.readdirSync(strings).map((name) => name.slice(0, -3)).sort(),
  'Studio language switcher must list the same languages as the builder pack',
)
const technicalTerms = ['3d-builder/library', 'characters/*.glb', 'props/*.glb', 'props/covers/*.png', 'motions/*.fbx', 'motions/previews/*.gif', 'topview-frontend + aigc', '__exportDraft()', '__store.getState().exportDraft()', 'exportDraft()', 'canvasId', 'bindingId', 'AIGC_BASE_URL', '/bindings/']
for (const name of studioFiles) {
  for (const [key, value] of Object.entries(readDictionary(path.join(studio, name)))) {
    for (const term of technicalTerms) {
      if (key.includes(term)) assert.ok(value.includes(term), `${name}: translated technical term ${term} in ${key}`)
    }
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? (entry.name === '__tests__' ? [] : walk(file)) : /\.tsx?$/.test(file) ? [file] : []
  })
}

// Check literal translation calls too: key parity alone cannot catch a typo at the call site.
const sources = [
  ...walk(path.join(root, 'packages/builder/src/components')).map((file) => [file, base]),
]
for (const [file, dictionary] of sources) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  function visit(node) {
    if (ts.isCallExpression(node) && /^(?:t|\w+\.t)$/.test(node.expression.getText(source))) {
      const key = node.arguments[0]
      if (key && ts.isStringLiteral(key)) assert.ok(dictionary[key.text] !== undefined, `${file}: unknown key ${key.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
// Load only these pure TypeScript modules; no browser or application state is needed.
const loaded = new Map()
function loadLocaleModule(file) {
  if (loaded.has(file)) return loaded.get(file)
  const result = { exports: {} }
  loaded.set(file, result.exports)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  require('node:vm').runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    (name) => loadLocaleModule(path.resolve(path.dirname(file), `${name}.ts`)), result, result.exports,
  )
  return result.exports
}
const localeDir = path.dirname(strings)
const { resolveLocale, getLocaleDict, registerLocale } = loadLocaleModule(path.join(localeDir, 'catalog.ts'))
const { translate } = loadLocaleModule(path.join(localeDir, 't.ts'))
const { localizeMessage } = loadLocaleModule(path.join(localeDir, 'messages.ts'))
const { cameraMotionLabel } = loadLocaleModule(path.join(localeDir, 'labels.ts'))
const { assetCategoryLabel, assetNameLabel, assetSearchKeyword } = loadLocaleModule(path.join(localeDir, 'assetLabels.ts'))
for (const language of fs.readdirSync(strings).map((name) => name.slice(0, -3))) {
  const dictionary = getLocaleDict(language)
  const localT = (key, params) => translate(dictionary, getLocaleDict('en'), key, params)
  for (const category of ['Emotion', 'Film', 'Idle', 'Office', 'Run', 'Sit', 'Social', 'Talk', 'Walk']) {
    assert.equal(assetCategoryLabel(localT, category), localT(`library.motion${category}`))
  }
  assert.equal(assetCategoryLabel(localT, 'Animals'), localT('assetCategory.animals'))
  assert.equal(assetCategoryLabel(localT, 'People & Characters'), localT('assetCategory.peopleCharacters'))
  assert.equal(assetCategoryLabel(localT, 'Custom category'), 'Custom category')
  assert.equal(assetNameLabel(localT, 'Female Walk', 'motion'), localT('assetName.motion.female_walk'))
  assert.equal(assetNameLabel(localT, 'Female_Walk', 'motion'), 'Female_Walk')
  assert.equal(assetNameLabel(localT, 'Female Walk custom', 'motion'), 'Female Walk custom')
  assert.equal(assetNameLabel(localT, 'Scout', 'character'), 'Scout')
  assert.equal(assetNameLabel(localT, 'Camaro', 'prop'), 'Camaro')
  assert.equal(assetNameLabel(localT, 'Female', 'character'), localT('assetName.character.female'))
  assert.equal(assetNameLabel(localT, 'Chair', 'prop'), localT('assetName.prop.chair'))
  assert.equal(assetSearchKeyword(localT, localT('assetName.prop.chair')), 'Chair')
  assert.equal(assetSearchKeyword(localT, 'My custom asset'), 'My custom asset')
  if (language !== 'en') {
    assert.notEqual(localT('library.collapseContent'), 'Collapse panel')
    assert.notEqual(localT('library.expandContent'), 'Expand panel')
    assert.ok(!/No character selected|selected\. Click a motion/.test(localT('library.hintMotionNone')))
    assert.ok(!/selected\. Click a motion/.test(localT('library.hintMotionSelected')))
  }
}
for (const [input, expected] of [['EN_us', 'en'], ['de-AT', 'de'], ['PT_br', 'pt'], ['zh-Hant-HK', 'zh-TW'], ['ZH_hk', 'zh-TW'], ['zh-Hans-CN', 'zh-CN'], ['unknown', 'en'], [undefined, 'en']]) {
  assert.equal(resolveLocale(input), expected)
}
registerLocale('custom', { common: { loading: 'Custom loading' } })
assert.equal(resolveLocale('custom'), 'custom')
const english = getLocaleDict('en')
const t = (key, params) => translate(english, english, key, params)
assert.equal(localizeMessage(t, '加载草稿…'), t('errors.loadingDraft'))
assert.equal(localizeMessage(t, '加载失败: 模型加载失败'), t('errors.loadingFailed', { detail: t('errors.modelLoad') }))
assert.equal(localizeMessage(t, '用户自定义场景'), '用户自定义场景')
assert.equal(cameraMotionLabel(t, 'static_shot', '固定镜头'), t('cameraMotion.static_shot.name'))
assert.equal(cameraMotionLabel(t, 'static_shot', 'My custom shot'), 'My custom shot')
console.log(`Locale checks passed: ${Object.keys(base).length} builder messages across ${studioFiles.length} languages; studio workbench copy is out of pack.`)
