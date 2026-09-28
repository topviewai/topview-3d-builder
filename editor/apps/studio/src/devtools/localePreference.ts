'use client'

import { createContext, createElement, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { DEFAULT_LOCALE, pickLocale, resolveLocale, STUDIO_LOCALE_COOKIE } from '../locale/catalog'

const STORAGE_KEY = 't3d-studio-locale'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

type Listener = () => void
const listeners = new Set<Listener>()

/** The language the server negotiated for this page; the snapshot React hydrates with. */
const ServerLocaleContext = createContext(DEFAULT_LOCALE)

function readStored(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored && resolveLocale(stored) === stored ? stored : null
  } catch {
    return null
  }
}

function browserLocale(): string {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE
  return pickLocale(navigator.languages?.length ? navigator.languages : [navigator.language])
}

/** The user's own pick when there is one, else the browser language (English when unsupported). */
export function getStudioLocale(): string {
  return readStored() ?? browserLocale()
}

export function setStudioLocale(locale: string): void {
  const next = resolveLocale(locale)
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* private mode / quota */
  }
  document.cookie = `${STUDIO_LOCALE_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
  listeners.forEach((fn) => fn())
}

export function subscribeStudioLocale(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useStudioLocale(): string {
  const serverLocale = useContext(ServerLocaleContext)
  return useSyncExternalStore(subscribeStudioLocale, getStudioLocale, () => serverLocale)
}

function DocumentLanguage() {
  const locale = useStudioLocale()
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return null
}

export function StudioLocaleRoot({ serverLocale, children }: { serverLocale: string; children: ReactNode }) {
  return createElement(ServerLocaleContext.Provider, { value: serverLocale }, createElement(DocumentLanguage), children)
}
