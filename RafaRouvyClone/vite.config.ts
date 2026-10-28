import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Evita que los avisos de módulos externos paren la compilación
      external: [],
      onwarn(warning, warn) {
        return;
      },
    },
  },
});
