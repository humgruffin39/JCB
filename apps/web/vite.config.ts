import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  envDir: '../..',
  plugins: [react()],
  server: {
    allowedHosts: ['.ngrok-free.app', '.ngrok.app'],
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/edge': 'http://127.0.0.1:3000',
    },
  },
  build: {
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes('/three/') || id.includes('\\three\\') ? 'three' : undefined;
        },
      },
    },
  },
});
