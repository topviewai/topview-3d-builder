import type { TranslateFn } from './types'
import { en } from './strings/en'

type AssetKind = 'character' | 'prop' | 'motion'
const NAMES = en.assetName as Record<AssetKind, Record<string, string>>
const PROP_ALIASES: Record<string, string> = {
  refrigerator: 'fridge', refrigirator: 'fridge', truckk: 'truck',
  bookcase: 'bookshelf', lampara: 'lamp', stairs: 'stairs', staircase: 'stairs',
}

const CATEGORY_KEYS: Record<string, string> = {
  ...Object.fromEntries(['Emotion', 'Film', 'Idle', 'Office', 'Run', 'Sit', 'Social', 'Talk', 'Walk', 'Fight', 'Move', 'Dance', 'Daily', 'Zombie'].map((name) => [name, `library.motion${name}`])),
  Animals: 'assetCategory.animals',
  Architecture: 'assetCategory.architecture',
  Buildings: 'assetCategory.buildings',
  'Buildings (Architecture)': 'assetCategory.buildingsArchitecture',
  Clutter: 'assetCategory.clutter',
  'Food & Drink': 'assetCategory.foodDrink',
  'Furniture & Decor': 'assetCategory.furnitureDecor',
  Nature: 'assetCategory.nature',
  Objects: 'assetCategory.objects',
  Other: 'assetCategory.other',
  'People & Characters': 'assetCategory.peopleCharacters',
  'Scenes & Levels': 'assetCategory.scenesLevels',
  Transport: 'assetCategory.transport',
  Weapons: 'assetCategory.weapons',
  默认: 'assetCategory.default',
  Default: 'assetCategory.default',
}

/** Translate presentation only; raw category values remain host query/section identifiers. */
export function assetCategoryLabel(t: TranslateFn, category: string): string {
  const key = CATEGORY_KEYS[category.trim()]
  return key ? t(key) : category
}

/** Exact dictionary matches only: never translate arbitrary parts of a custom asset name. */
export function assetNameLabel(t: TranslateFn, name: string, kind: AssetKind): string {
  const normalized = name.trim().toLowerCase()
  const alias = kind === 'prop' ? PROP_ALIASES[normalized] : undefined
  const id = alias ?? Object.keys(NAMES[kind]).find((key) => NAMES[kind][key].toLowerCase() === normalized)
  if (!id) return name
  const key = `assetName.${kind}.${id}`
  const translated = t(key)
  return translated === key ? name : translated
}

/** The host searches original names. Resolve an exact translated label before querying it. */
export function assetSearchKeyword(t: TranslateFn, query: string): string {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return query
  const matches = Object.entries(NAMES.prop).filter(([id]) =>
    t(`assetName.prop.${id}`).toLocaleLowerCase() === normalized,
  )
  return matches.length === 1 ? matches[0][1] : query
}
