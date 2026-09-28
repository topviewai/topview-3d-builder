import { htmlPage, requestT } from '../../../../src/locale/server'

export const runtime = 'nodejs'

export function GET(request: Request): Response {
  const { locale, html } = requestT(request)
  return htmlPage(locale, `<p>${html('已登录 TopView。回到 Studio 的导出窗口即可发送到 Topview Canvas。')}</p>
<script>window.close()</script>`)
}
