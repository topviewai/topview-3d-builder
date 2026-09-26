export const runtime = 'nodejs'

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Topview</title></head>
<body style="font-family:system-ui,sans-serif;padding:40px;color:#222">
<p>已登录 TopView。回到 Studio 的导出窗口即可发送到 Topview Canvas。</p>
<script>window.close()</script>
</body>
</html>`

export function GET(): Response {
  return new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}
