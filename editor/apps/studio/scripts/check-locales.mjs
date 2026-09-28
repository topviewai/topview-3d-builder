#!/usr/bin/env node
// Studio's catalog keys are the Simplified Chinese source text. This fails when
//   - a locale file does not have exactly the keys of en.json,
//   - a string literal with Chinese text in src/ or app/ is not a catalog key (hardcoded UI text),
//   - a catalog key is used nowhere.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCALES = path.join(APP, 'src', 'locale')
const HAN = /\p{Script=Han}/u
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g

const problems = []
const load = (file) => JSON.parse(readFileSync(path.join(LOCALES, file), 'utf8'))
const english = load('en.json')
const keys = new Set(Object.keys(english))

for (const file of readdirSync(LOCALES).filter((name) => name.endsWith('.json'))) {
  const dict = load(file)
  const missing = [...keys].filter((key) => !(key in dict))
  const extra = Object.keys(dict).filter((key) => !keys.has(key))
  const empty = Object.entries(dict).filter(([, value]) => typeof value !== 'string' || !value.trim()).map(([key]) => key)
  for (const key of missing) problems.push(`${file}: missing ${JSON.stringify(key)}`)
  for (const key of extra) problems.push(`${file}: not in en.json ${JSON.stringify(key)}`)
  for (const key of empty) problems.push(`${file}: empty ${JSON.stringify(key)}`)
}

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const entry = path.join(dir, name)
    if (statSync(entry).isDirectory()) return name === 'locale' || name === 'node_modules' ? [] : sources(entry)
    return /\.(ts|tsx)$/.test(name) ? [entry] : []
  })
}

const used = new Set()

function scan(code, where) {
  for (const match of code.matchAll(LITERAL)) {
    let text = match[1] ?? match[2] ?? match[3] ?? ''
    if (match[3] !== undefined && text.includes('${')) {
      for (const expression of text.matchAll(/\$\{([^}]*)\}/g)) scan(expression[1], where)
      text = text.replace(/\$\{[^}]*\}/g, '')
      if (HAN.test(text)) problems.push(`${where}: Chinese text in a template literal ${JSON.stringify(match[0])}`)
      continue
    }
    if (!HAN.test(text)) continue
    if (keys.has(text)) used.add(text)
    else problems.push(`${where}: not a catalog key ${JSON.stringify(text)}`)
  }
}

for (const file of [...sources(path.join(APP, 'src')), ...sources(path.join(APP, 'app'))]) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    const code = line.replace(/^\s*(\/\/|\*|\/\*|\{\/\*).*$/, '').replace(/\s\/\/\s.*$/, '')
    scan(code, `${path.relative(APP, file)}:${index + 1}`)
  })
}
for (const key of keys) {
  if (!used.has(key) && HAN.test(key)) problems.push(`en.json: unused ${JSON.stringify(key)}`)
}

if (problems.length) {
  process.stderr.write(`${problems.join('\n')}\n${problems.length} locale problem(s)\n`)
  process.exit(1)
}
process.stdout.write(`studio locales ok: ${keys.size} keys\n`)
