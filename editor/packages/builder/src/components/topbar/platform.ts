export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
}

export function modifierSymbol(apple: boolean): string {
  return apple ? '⌘' : 'Ctrl'
}
