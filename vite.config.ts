import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // react-player empaqueta en chunks separados (y cargados bajo demanda)
    // los proveedores opcionales de streaming remoto (HLS/DASH), que esta
    // suite no usa: el reproductor solo sirve archivos locales del HDD vía
    // el protocolo `hddmedia://`. Se sube el límite para evitar la
    // advertencia de tamaño sobre esos chunks, que no afectan la carga
    // inicial de la app.
    chunkSizeWarningLimit: 900,
  },
});
