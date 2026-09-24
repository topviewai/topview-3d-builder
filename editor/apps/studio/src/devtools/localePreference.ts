'use client'

import { useSyncExternalStore } from 'react'
import { resolveLocale } from '@topview/3d-builder'

/** 调试台默认中文，与历史硬编码一致；包内缺省仍是 en。 */
export const STUDIO_DEFAULT_LOCALE = 'zh-CN'

const STORAGE_KEY = 't3d-studio-locale'

type Listener = () => void
const listeners = new Set<Listener>()

function readStored(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function getStudioLocale(): string {
  return resolveLocale(readStored() ?? STUDIO_DEFAULT_LOCALE)
}

export function setStudioLocale(locale: string): void {
  const next = resolveLocale(locale)
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* private mode / quota */
  }
  listeners.forEach((fn) => fn())
}

export function subscribeStudioLocale(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useStudioLocale(): string {
  return useSyncExternalStore(subscribeStudioLocale, getStudioLocale, () => STUDIO_DEFAULT_LOCALE)
}
