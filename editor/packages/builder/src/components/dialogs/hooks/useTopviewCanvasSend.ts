import { useRef, useState } from 'react'
import type { TopviewCanvasSummary } from '../../../host/types'

export interface TopviewCanvasSent {
  canvasUrl: string
}

/** 发送结果为 null 表示取消或失败，原因由导出流程自己显示。 */
export function useTopviewCanvasSend(send: (canvas: TopviewCanvasSummary) => Promise<TopviewCanvasSent | null>) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<TopviewCanvasSent | null>(null)
  const sendRef = useRef(send)
  sendRef.current = send

  return {
    sending,
    sent,
    start: async (canvas: TopviewCanvasSummary) => {
      setSending(true)
      try {
        setSent(await sendRef.current(canvas))
      } finally {
        setSending(false)
      }
    },
  }
}
