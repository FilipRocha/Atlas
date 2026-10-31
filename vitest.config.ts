import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Verbose locally, but in CI it streams ~370KB / 2200 lines through the
    // runner's stdout pipe. Windows runs have been dying mid-stream with a bare
    // "exit code 1" and no summary, so keep CI output small and also write the
    // results to a file — a file survives whatever is eating stdout.
    reporters: process.env.CI
      ? ['dot', ['junit', { outputFile: 'test-results/junit.xml' }]]
      : ['verbose'],
    // CI machines often expose hundreds of logical cores. One worker per
    // test file causes avoidable CPU and memory spikes on developer PCs.
    maxWorkers: 4,
    pool: 'threads'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
