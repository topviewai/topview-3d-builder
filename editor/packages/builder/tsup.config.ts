import { defineConfig } from 'tsup'

// watch（开发）与 build（发布）产出两种形态，差异仅在模块粒度：
// build 出单 bundle，是真实发布形态；watch 出一对一的多文件树，
// 让 webpack 看到细粒度模块边界，React Fast Refresh 才能按组件热替换，
// 否则改任意一个组件都会整包失效，连带重建引擎与 WebGL 上下文。
// 解析路径两者一致（都经 package.json exports 指向 dist），
// 因此 "studio 只消费 dist" 这条约束在开发期同样成立。
export default defineConfig((options) => ({
  entry: options.watch
    ? ['src/**/*.ts', 'src/**/*.tsx', '!src/**/__tests__/**']
    : ['src/index.ts', 'src/evaluate/index.ts', 'src/engine/index.ts', 'src/headless/index.ts'],
  // format 必须与 build 一致：package.json 的 main / require 指向 index.js，
  // 缺 cjs 产物 webpack 会 Can't resolve。
  format: ['cjs', 'esm'],
  bundle: !options.watch,
  // bundle:false 下逐文件生成 dts 要 12.5s（单 bundle 只需 2.8s），每次改动
  // 重跑不可接受。watch 沿用 dev 启动时那次完整 build 留下的 index.d.ts，
  // 靠 clean:false 保住；类型正确性由 pnpm typecheck 与完整 build 把关。
  dts: !options.watch,
  // 发布产物不带 sourcemap：tsup 的 .map 会把 src/*.ts 原文内嵌进 sourcesContent，
  // 随 dist 一起进 tgz / CDN / Agent 沙箱，等于把源码发出去。压缩后的 dist 本身
  // 是浏览器必须下载的公开产物，不需要也无法隐藏；要守的只有源码。
  // watch 产物只在本机 dist 里、不进 pack，保留 sourcemap 便于调试。
  sourcemap: Boolean(options.watch),
  clean: !options.watch,
  splitting: false,
  treeshake: !options.watch,
  external: ['react', 'react-dom', 'three', /^three\//],
  // mediabunny 是依赖，但必须打进 dist：宿主只装本包，导出路径不能再解析一份。
  noExternal: ['mediabunny'],
  define: {
    __T3D_DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
  // "use client" 只给主入口：由 finalize-dist.cjs 写到 dist/index.*。
  // evaluate / engine / headless 供 Node 与无头 Chrome 用，不能带该 banner。
  // styles.css 由脚本拼接，不在 index.ts 的 import 图里，
  // 必须每次重建后重新生成，否则改 CSS 不会反映到 dist。
  onSuccess: options.watch
    ? 'node ./scripts/finalize-dist.cjs --styles-only --prune'
    : undefined,
}))
