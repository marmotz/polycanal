import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.js';

export default mergeConfig(
  shared,
  defineConfig({
    test: { environment: 'jsdom', setupFiles: ['./src/__fixtures__/setup.ts'] },
  }),
);
