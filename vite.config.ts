import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Déployé sur https://dioxy8.github.io/WinScope/
export default defineConfig({
  plugins: [react()],
  base: '/WinScope/',
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    environment: 'node',
  },
});
