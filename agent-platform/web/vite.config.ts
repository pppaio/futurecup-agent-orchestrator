import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发代理：/api → 后端 http://localhost:3000，免跨域。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
