import { defineConfig } from 'vite';

export default defineConfig({
  base: '/edu-fasikul/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/firestore', 'firebase/auth'],
          pdf: ['pdfjs-dist/legacy/build/pdf'],
          fabric: ['fabric'],
          chart: ['chart.js'],
        }
      }
    }
  },
  optimizeDeps: {
    include: ['fabric', 'chart.js', 'pdfjs-dist/legacy/build/pdf']
  }
});
