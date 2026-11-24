import { defineConfig } from 'vite'

// O GitHub Pages serve o site em https://<usuario>.github.io/rebote-3d/,
// então todos os caminhos gerados no build precisam desse prefixo.
export default defineConfig({
  base: '/rebote-3d/',
  build: {
    // O OpenCV.js tem ~10 MB e vira um chunk separado (import dinâmico).
    // Sem este limite o Vite avisa sobre o tamanho a cada build.
    chunkSizeWarningLimit: 12000,
  },
  test: {
    environment: 'node',
  },
})
