import { build, context } from 'esbuild'

const opts = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
}

if (process.argv.includes('--watch')) {
  const ctx = await context(opts)
  await ctx.watch()
} else {
  await build(opts)
}
