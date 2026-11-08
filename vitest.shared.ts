import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packagesDir = fileURLToPath(new URL('./packages/', import.meta.url));

/** Resolves every workspace package to its sources, so tests never depend on a previous build. */
const workspaceAliases = readdirSync(packagesDir).map((dir) => ({
  find: dir === 'polycanal' ? /^polycanal$/ : new RegExp(`^@polycanal/${dir}$`),
  replacement: `${packagesDir}${dir}/src/index.ts`,
}));

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    include: ['src/**/*.test.ts'],
    typecheck: { enabled: true, include: ['src/**/*.test-d.ts'] },
  },
});
