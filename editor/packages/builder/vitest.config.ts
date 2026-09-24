import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 30_000,
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      'three/addons': 'three/examples/jsm',
    },
  },
})
