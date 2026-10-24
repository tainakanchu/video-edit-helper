import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// サーバーが起動ごとに書き出す API トークン(packages/server/src/config.ts の devTokenFile と同じ場所)
const devTokenFile =
  process.env.VEH_DEV_TOKEN_FILE ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', '.dev-token');

function readDevToken(): string | null {
  try {
    return fs.readFileSync(devTokenFile, 'utf8').trim();
  } catch {
    return null;
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api': {
        target: 'http://localhost:4810',
        // サーバーは Host を localhost:4810 / 127.0.0.1:4810 に限定している
        changeOrigin: true,
        configure: (proxy) => {
          // サーバーは tsx watch で再起動のたびにトークンが変わるので、毎回読み直す
          proxy.on('proxyReq', (proxyReq) => {
            const token = readDevToken();
            if (token) proxyReq.setHeader('X-VEH-Token', token);
          });
        },
      },
    },
  },
});
