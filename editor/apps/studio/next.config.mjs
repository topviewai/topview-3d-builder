import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // 以下两项经阶段 0 验收实测「当前并不必需」：three 0.184 的 package.json 带
  // "./addons/*" exports 映射，webpack 5 能直接解析 three/addons/**/*.js，
  // 删掉这两项后 next build 仍然通过。保留为防御性配置，因为阶段 0 只做了
  // 顶层 import + typeof 探测，尚未跑真实的 GLTF/FBX 加载与 SkeletonUtils.clone。
  // 阶段 1 搬入真实引擎后复核：若届时仍不必需，直接删除。
  // 把包纳入 Next 的编译管线，使其产物能被注入 react-refresh runtime。
  // 实测：加入本项后删除 packages/builder/dist，studio 构建仍报
  // Can't resolve '@topview/3d-builder' —— transpilePackages 只扩大编译范围，
  // 不改变模块解析，解析仍经 package.json exports 指向 dist。
  transpilePackages: ['three', '@topview/3d-builder'],
  webpack: (config, { dev }) => {
    if (dev) {
      config.resolve.extensionAlias = {
        '.js': ['.js', '.ts', '.tsx'],
      }
      // webpack 默认假定 node_modules 内容不变，而本包经 pnpm workspace symlink
      // 指向持续 watch 重建的 packages/builder/dist。不声明为 unmanaged，
      // tsup 写了新产物页面也不会重编。
      config.snapshot = {
        ...(config.snapshot ?? {}),
        unmanagedPaths: [/[\\/]packages[\\/]builder[\\/]/],
      }
    }
    return config
  },
}

// dev 与 build/start 不共享产物，避免构建覆盖正在运行的 webpack runtime/chunks。
// 第二份开发服务（例如 mock 与 ms 并存）仍可用 NEXT_DIST_DIR 单独指定目录。
export default (phase) => ({
  ...nextConfig,
  distDir: process.env.NEXT_DIST_DIR || (phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next'),
})
