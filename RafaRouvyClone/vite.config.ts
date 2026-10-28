import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Externzalizamos las librerías 3D para que Rolldown no intente empaquetarlas de forma estricta
      external: ['three', '@react-three/fiber', '@react-three/drei'],
    },
  },
});
