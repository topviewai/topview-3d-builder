import { TUTORIAL_CARD_GAP, TUTORIAL_VIEW_PAD } from './constants'
import type { BoxRect, CardPlacement, CardSize, TutorialCardSide, TutorialStep } from './types'

const SIDES: TutorialCardSide[] = ['top', 'bottom', 'left', 'right']

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

export function isUsableRect(rect: BoxRect | null | undefined): rect is BoxRect {
  return Boolean(rect && rect.width >= 8 && rect.height >= 8)
}

export function visibleTutorialSteps(
  steps: readonly TutorialStep[],
  resolveRect: (id: TutorialStep['id']) => BoxRect | null,
): TutorialStep[] {
  return steps.filter((step) => isUsableRect(resolveRect(step.id)))
}

export function stepIndexAfter(index: number, total: number, delta: number): number | null {
  const next = index + delta
  if (next < 0 || next >= total) return null
  return next
}

function candidate(target: BoxRect, card: CardSize, side: TutorialCardSide): { left: number; top: number } {
  const centerX = target.left + target.width / 2 - card.width / 2
  const centerY = target.top + target.height / 2 - card.height / 2
  if (side === 'right') return { left: target.left + target.width + TUTORIAL_CARD_GAP, top: centerY }
  if (side === 'left') return { left: target.left - card.width - TUTORIAL_CARD_GAP, top: centerY }
  if (side === 'bottom') return { left: centerX, top: target.top + target.height + TUTORIAL_CARD_GAP }
  return { left: centerX, top: target.top - card.height - TUTORIAL_CARD_GAP }
}

function fits(pos: { left: number; top: number }, card: CardSize, root: BoxRect): boolean {
  return (
    pos.left >= root.left + TUTORIAL_VIEW_PAD
    && pos.top >= root.top + TUTORIAL_VIEW_PAD
    && pos.left + card.width <= root.left + root.width - TUTORIAL_VIEW_PAD
    && pos.top + card.height <= root.top + root.height - TUTORIAL_VIEW_PAD
  )
}

function clampToRoot(pos: { left: number; top: number }, card: CardSize, root: BoxRect): { left: number; top: number } {
  return {
    left: clamp(pos.left, root.left + TUTORIAL_VIEW_PAD, root.left + root.width - card.width - TUTORIAL_VIEW_PAD),
    top: clamp(pos.top, root.top + TUTORIAL_VIEW_PAD, root.top + root.height - card.height - TUTORIAL_VIEW_PAD),
  }
}

/** 视口这类大区域把卡片放进高亮框内侧，避免压到时间轴。 */
export function placeCard(
  target: BoxRect,
  root: BoxRect,
  card: CardSize,
  preferred: TutorialCardSide,
): CardPlacement {
  const targetArea = target.width * target.height
  const rootArea = root.width * root.height
  if (rootArea > 0 && targetArea / rootArea > 0.32) {
    return {
      ...clampToRoot({
        left: target.left + (target.width - card.width) / 2,
        top: target.top + target.height - card.height - 72,
      }, card, root),
      side: preferred,
    }
  }

  const order: TutorialCardSide[] = [preferred, ...SIDES.filter((side) => side !== preferred)]
  for (const side of order) {
    const pos = candidate(target, card, side)
    if (fits(pos, card, root)) return { ...pos, side }
  }
  return { ...clampToRoot(candidate(target, card, preferred), card, root), side: preferred }
}

export function padRect(rect: BoxRect, padding: number): BoxRect {
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  }
}

export function clientRectOf(el: Element): BoxRect {
  const rect = el.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}
