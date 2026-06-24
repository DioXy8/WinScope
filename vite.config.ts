import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// IMPORTANT : remplace 'vgc-analyzer' par le nom EXACT de ton repo GitHub.
// Si tu déploies sur https://<user>.github.io/<repo>/, base DOIT être '/<repo>/'.
// Si tu déploies sur <user>.github.io (repo racine) ou un domaine perso, base = '/'.
export default defineConfig({
  plugins: [react()],
  base: '/vgc-analyzer/',
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    environment: 'node',
  },
});
