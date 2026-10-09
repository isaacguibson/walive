import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      '@editor': resolve(__dirname, 'src/editor')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup-renderer.ts'],
    include: ['tests/**/*.test.{ts,tsx}']
  }
});
