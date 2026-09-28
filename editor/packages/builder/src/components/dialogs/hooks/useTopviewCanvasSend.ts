import { useRef, useState } from 'react'
import type { TopviewCanvasSummary } from '../../../host/types'

export interface TopviewCanvasSent {
  canvasUrl: string
}

/** 发送结果为 null 表示取消或失败，原因由导出流程自己显示。 */
export function useTopviewCanvasSend(
  send: (canvas: TopviewCanvasSummary) => Promise<TopviewCanvasSent | null>,
  options?: { openWhenSent?: boolean; onOpened?: () => void },
) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<TopviewCanvasSent | null>(null)
  const sendRef = useRef(send)
  const optionsRef = useRef(options)
  sendRef.current = send
  optionsRef.current = options

  return {
    sending,
    sent,
    start: async (canvas: TopviewCanvasSummary) => {
      setSending(true)
      try {
        const result = await sendRef.current(canvas)
        const options = optionsRef.current
        if (options?.openWhenSent) {
          if (result?.canvasUrl) window.open(result.canvasUrl, '_blank', 'noopener')
          if (result) options.onOpened?.()
          return
        }
        setSent(result)
      } finally {
        setSending(false)
      }
    },
  }
}
