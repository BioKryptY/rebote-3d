import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const vazio = fileURLToPath(new URL('./src/vazio.js', import.meta.url))

// O GitHub Pages serve o site em https://<usuario>.github.io/rebote-3d/,
// então todos os caminhos gerados no build precisam desse prefixo.
export default defineConfig({
  base: '/rebote-3d/',
  resolve: {
    // O OpenCV.js tem require("fs") e require("crypto") dentro de um
    // if (ENVIRONMENT_IS_NODE), que nunca roda no navegador.
    alias: { fs: vazio, crypto: vazio },
  },
  build: {
    // O OpenCV.js tem ~15 MB e vira um arquivo separado (import dinâmico).
    // Sem este limite o Vite avisa sobre o tamanho a cada build.
    chunkSizeWarningLimit: 16000,
  },
  test: {
    environment: 'node',
  },
})
