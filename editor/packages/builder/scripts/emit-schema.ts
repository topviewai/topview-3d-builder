import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { directorDocumentSchema, fcurvesCompactV1Schema } from '../src/contract/validate'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema')
mkdirSync(outDir, { recursive: true })

const documentSchema = zodToJsonSchema(directorDocumentSchema, {
  name: 'DirectorDocument',
  $refStrategy: 'none',
})
const fcurvesSchema = zodToJsonSchema(fcurvesCompactV1Schema, {
  name: 'FCurvesCompactV1',
  $refStrategy: 'none',
})

writeFileSync(
  join(outDir, 'director-document.schema.json'),
  `${JSON.stringify(documentSchema, null, 2)}\n`,
)
writeFileSync(
  join(outDir, 'fcurves-compact-v1.schema.json'),
  `${JSON.stringify(fcurvesSchema, null, 2)}\n`,
)
console.log(`wrote ${outDir}`)
