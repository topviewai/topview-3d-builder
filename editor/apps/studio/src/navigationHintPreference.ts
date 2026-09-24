const STORAGE_KEY = 'topview.3d-builder.navigation-hint-dismissed.v1'
let dismissed = false

export const navigationHintPreference = {
  read(): boolean {
    try {
      return dismissed || window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return dismissed
    }
  },
  dismiss(): void {
    dismissed = true
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // Retain the preference in memory if browser storage is unavailable.
    }
  },
}
