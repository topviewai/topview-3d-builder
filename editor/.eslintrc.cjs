/**
 * 分层依赖规则。目标分层、依赖规则表与设计理由见 docs/architecture.md §2。
 *
 * 默认即目标态。LAYER_RULES=off 可全关。
 *
 * 目标分层：
 *   contract/ ─┬─→ evaluate/ ─────────────┐
 *    （底座）   ├─→ data/                  ├─→ engine/ ─→ bridge/ ─→ components/
 *              ├─→ document/ ─┬─→ sync/ ──┘                            ↑
 *              ├─→ stores/ ───┘                                        │
 *              └─→ host/ ──────────────────────────────────────────────┘
 */
const LAYER_RULES = process.env.LAYER_RULES || 'target'

const SRC = 'packages/builder/src'

/** 静态数据与宿主契约：禁止依赖除 contract 外的任何层 */
const leafLayerRules = [
  {
    files: [`${SRC}/data/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/engine', '**/engine/**',
                '**/evaluate', '**/evaluate/**',
                '**/document', '**/document/**',
                '**/stores', '**/stores/**',
                '**/sync', '**/sync/**',
                '**/bridge', '**/bridge/**',
                '**/components', '**/components/**',
                '**/host', '**/host/**',
              ],
              message: 'data 是纯数据，只能依赖 contract 的类型',
            },
          ],
        },
      ],
    },
  },
  {
    files: [`${SRC}/host/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/engine', '**/engine/**',
                '**/evaluate', '**/evaluate/**',
                '**/document', '**/document/**',
                '**/stores', '**/stores/**',
                '**/sync', '**/sync/**',
                '**/bridge', '**/bridge/**',
                '**/components', '**/components/**',
                '**/data', '**/data/**',
              ],
              message: 'host 只定接口，禁止依赖其它层（contract 除外）',
            },
          ],
        },
      ],
    },
  },
  {
    // ★ 可嵌入底线：包内不得直连网络或宿主存储，一律经 HostAdapter
    files: [`${SRC}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: '包内禁止直连网络，走 HostAdapter' },
        { name: 'localStorage', message: '包内禁止访问宿主存储，走 HostAdapter' },
        { name: 'sessionStorage', message: '包内禁止访问宿主存储，走 HostAdapter' },
      ],
    },
  },
]

/** 目标态（docs/architecture.md §2.2 全量）。阶段 4.5 起作为默认档。 */
const targetRules = [
  {
    files: [`${SRC}/contract/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['../*'], message: 'contract 是零依赖底座，不得依赖任何其它层' }] },
      ],
    },
  },
  {
    files: [`${SRC}/evaluate/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'three', message: 'evaluate 必须零 three：求值是纯数学，Three 只是消费者' },
            { name: 'react', message: 'evaluate 禁止导入 react' },
            { name: 'react-dom', message: 'evaluate 禁止导入 react-dom' },
            { name: 'mobx', message: 'evaluate 禁止导入状态库' },
            { name: 'zustand', message: 'evaluate 禁止导入状态库' },
          ],
          patterns: [
            { group: ['three/*', 'three/**'], message: 'evaluate 必须零 three' },
            { group: ['**/engine', '**/engine/**'], message: 'evaluate 禁止导入 engine' },
            { group: ['**/document', '**/document/**'], message: 'evaluate 禁止导入 document' },
            { group: ['**/stores', '**/stores/**'], message: 'evaluate 禁止导入 stores' },
            { group: ['**/components', '**/components/**'], message: 'evaluate 禁止导入 components' },
          ],
        },
      ],
    },
  },
  {
    files: [`${SRC}/engine/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'engine 禁止导入 react' },
            { name: 'react-dom', message: 'engine 禁止导入 react-dom' },
            { name: 'zustand', message: 'engine 禁止导入状态库' },
            { name: 'mobx', message: 'engine 禁止导入状态库' },
            { name: 'mobx-react-lite', message: 'engine 禁止导入状态库' },
          ],
          patterns: [
            { group: ['**/document', '**/document/**'], message: 'engine 禁止依赖 observable 文档模型，只吃 contract 快照' },
            { group: ['**/stores', '**/stores/**'], message: 'engine 禁止导入 stores，入参一律标量或 contract 类型' },
            { group: ['**/host', '**/host/**'], message: 'engine 禁止导入 host' },
            { group: ['**/components', '**/components/**'], message: 'engine 禁止导入 components' },
            { group: ['**/bridge', '**/bridge/**'], message: 'engine 禁止导入 bridge' },
            { group: ['**/sync', '**/sync/**'], message: 'engine 禁止导入 sync' },
          ],
        },
      ],
    },
  },
  {
    files: [`${SRC}/document/**/*.{ts,tsx}`, `${SRC}/stores/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'document / stores 禁止导入 react' },
            { name: 'react-dom', message: 'document / stores 禁止导入 react-dom' },
            { name: 'three', message: 'document / stores 禁止导入 three' },
          ],
          patterns: [
            { group: ['three/*', 'three/**'], message: 'document / stores 禁止导入 three' },
            { group: ['**/engine', '**/engine/**'], message: 'document / stores 禁止导入 engine' },
            { group: ['**/components', '**/components/**'], message: 'document / stores 禁止导入 components' },
          ],
        },
      ],
    },
  },
  {
    files: [`${SRC}/sync/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'sync 禁止导入 react' },
            { name: 'react-dom', message: 'sync 禁止导入 react-dom' },
          ],
          patterns: [{ group: ['**/components', '**/components/**'], message: 'sync 禁止导入 components' }],
        },
      ],
    },
  },
  {
    files: [`${SRC}/components/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'three', message: 'components 禁止直接操作 three 对象' }],
          patterns: [
            { group: ['three/*', 'three/**'], message: 'components 禁止导入 three' },
            { group: ['**/engine', '**/engine/**'], message: 'components 必须经 bridge 访问引擎' },
            { group: ['**/sync', '**/sync/**'], message: 'components 禁止导入 sync' },
          ],
        },
      ],
    },
  },
  ...leafLayerRules,
]

const layerOverrides = LAYER_RULES === 'off' ? [] : targetRules

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  // *-test-out 是 tsc 编译测试用例的产物目录（evaluate-test-out / document-test-out /
  // 将来新增的）。用通配符而非逐个列举：漏加一个，跑完测试后 lint 就会红。
  ignorePatterns: ['**/dist/**', '**/*-test-out/**', '**/test-out/**', '**/.next/**', '**/.next-dev/**', '**/node_modules/**', 'docs/**', 'apps/studio/public/draco/**'],
  settings: {
    next: {
      rootDir: 'apps/studio',
    },
  },
  overrides: [
    {
      files: ['apps/studio/**/*.{js,jsx,ts,tsx}'],
      extends: ['next/core-web-vitals'],
      rules: {
        '@next/next/no-html-link-for-pages': 'off',
      },
    },
    {
      files: [`${SRC}/**/*.{ts,tsx}`],
      parser: require.resolve('@typescript-eslint/parser', {
        paths: [require.resolve('eslint-config-next')],
      }),
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    ...layerOverrides,
  ],
}
