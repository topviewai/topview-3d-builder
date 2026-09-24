import { test } from 'vitest'
import { parseDirectorDocument } from '../../contract/validate'
import { loadDraft } from './helpers'

const DRAFTS = [
  'xiaoyunque-draft.json',
  'qa-director-full-draft.json',
] as const

for (const name of DRAFTS) {
  test(`zod 能解析冻结草稿 ${name}`, () => {
    parseDirectorDocument(loadDraft(name))
  })
}
