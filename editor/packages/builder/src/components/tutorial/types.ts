export type TutorialAnchorId = 'leftrail' | 'viewport' | 'tools' | 'timeline' | 'filmMode' | 'inspector'

export type TutorialCardSide = 'top' | 'bottom' | 'left' | 'right'

export interface TutorialStep {
  id: TutorialAnchorId
  titleKey: string
  bodyKey: string
  side: TutorialCardSide
}

export interface BoxRect {
  left: number
  top: number
  width: number
  height: number
}

export interface CardSize {
  width: number
  height: number
}

export interface CardPlacement {
  left: number
  top: number
  side: TutorialCardSide
}
