import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '../..', '');
  const discordClientId = [environment.VITE_DISCORD_CLIENT_ID, environment.DISCORD_CLIENT_ID].find(
    (value) => typeof value === 'string' && value.trim() !== '',
  );
  return {
    envDir: '../..',
    define: {
      // Discord application IDs are public. Reusing the server variable keeps
      // local Activity development from requiring a duplicate value.
      'import.meta.env.VITE_DISCORD_CLIENT_ID': JSON.stringify(discordClientId ?? ''),
    },
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
  };
});
