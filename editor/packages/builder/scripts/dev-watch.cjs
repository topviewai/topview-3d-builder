const { spawn } = require('child_process')
const path = require('path')
const chokidar = require('chokidar')

const root = path.join(__dirname, '..')
const finalize = path.join(__dirname, 'finalize-dist.cjs')

let tsup = null
let restartTimer = null
let stopping = false

function startTsup() {
  const proc = spawn('pnpm', ['exec', 'tsup', '--watch'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
  tsup = proc
  proc.on('exit', (code) => {
    // 旧进程的 exit 晚于新进程的 spawn 到达。无条件清空会把新引用抹掉，
    // 之后的 restart 既 kill 不到旧进程也不再替换，watcher 会逐次堆积并争抢 dist。
    if (tsup === proc) tsup = null
    if (!stopping && code && code !== 0) {
      console.error(`[dev-watch] tsup exited with ${code}`)
    }
  })
}

function restartTsup() {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (tsup) {
      tsup.kill('SIGTERM')
      tsup = null
    }
    startTsup()
  }, 200)
}

function finalizeStyles() {
  spawn('node', [finalize, '--styles-only'], {
    cwd: root,
    stdio: 'inherit',
  })
}

startTsup()

chokidar
  .watch(path.join(root, 'src/styles'), { ignoreInitial: true })
  .on('all', (event, file) => {
    if (!file.endsWith('.css')) return
    console.log(`[dev-watch] styles ${event}: ${path.relative(root, file)}`)
    finalizeStyles()
  })

chokidar
  .watch(path.join(root, 'src'), {
    ignoreInitial: true,
    ignored: (file) => file.includes(`${path.sep}__tests__${path.sep}`) || file.includes(`${path.sep}styles${path.sep}`),
  })
  .on('add', (file) => {
    if (!/\.tsx?$/.test(file)) return
    console.log(`[dev-watch] add ${path.relative(root, file)}, restart tsup`)
    restartTsup()
  })
  .on('unlink', (file) => {
    if (!/\.tsx?$/.test(file)) return
    console.log(`[dev-watch] unlink ${path.relative(root, file)}, restart tsup`)
    restartTsup()
  })

function shutdown() {
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  if (tsup) tsup.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
