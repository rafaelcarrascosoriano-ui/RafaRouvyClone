import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Desactiva el modo estricto de errores por avisos de módulos
      onwarn(warning, defaultHandler) {
        return;
      },
    },
  },
});
