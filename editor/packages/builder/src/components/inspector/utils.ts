import type { TranslateFn } from '../../locale'

export function nodeTypeLabel(t: TranslateFn, type: string): string {
  if (type === 'character') return t('library.tabCharacter')
  if (type === 'camera') return t('library.tabCamera')
  if (type === 'prop') return t('library.tabProp')
  if (type === 'path') return t('viewport.path')
  if (type === 'primitive') return t('library.categoryPrimitives')
  if (type === 'group') return t('inspector.typeGroup')
  return type
}
