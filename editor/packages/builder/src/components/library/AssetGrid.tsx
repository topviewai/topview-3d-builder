import { useEffect, useRef, useState } from 'react'
import type { HostAdapter } from '../../host/types'
import { isHttpAssetUrl, resolveAssetUrl } from '../../host/resolve'

type MediaStatus = 'loading' | 'ready' | 'error'

function resolveCatalogSrc(adapter: HostAdapter, assetKey: string): string | Promise<string> {
  const trimmed = assetKey.trim()
  if (isHttpAssetUrl(trimmed)) return trimmed
  return resolveAssetUrl(adapter, trimmed)
}

function isDecodedImage(el: HTMLImageElement): boolean {
  return el.complete && el.naturalWidth > 0
}

export function CatalogImage({ adapter, assetKey, alt }: { adapter: HostAdapter; assetKey: string; alt: string }) {
  const initial = resolveCatalogSrc(adapter, assetKey)
  const [src, setSrc] = useState(() => (typeof initial === 'string' ? initial : ''))
  const [status, setStatus] = useState<MediaStatus>('loading')
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setStatus('loading')
    const value = resolveCatalogSrc(adapter, assetKey)
    if (typeof value === 'string') {
      setSrc(value)
      return
    }
    setSrc('')
    let cancelled = false
    void value.then((next) => {
      if (cancelled) return
      setSrc(next)
    }).catch(() => {
      if (cancelled) return
      setStatus('error')
    })
    return () => {
      cancelled = true
    }
  }, [adapter, assetKey])

  useEffect(() => {
    const el = imgRef.current
    if (el && isDecodedImage(el)) setStatus('ready')
  }, [src])

  return (
    <span className="t3d-leftrail-media">
      {status === 'loading' ? <span className="t3d-leftrail-skel" aria-hidden /> : null}
      {src && status !== 'error' ? (
        <img
          ref={imgRef}
          className={status === 'ready' ? 't3d-leftrail-media-ready' : undefined}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
        />
      ) : null}
    </span>
  )
}
