import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  base: './',
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
