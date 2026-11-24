import { describe, expect, it } from 'vitest'
import { concordanciaDasMascaras } from './gpuFiltro.js'

/** Máscara 1 canal (de cima para baixo) e a mesma imagem em RGBA de baixo para cima. */
function par(largura, altura, ligado) {
  const cpu = new Uint8Array(largura * altura)
  const gpu = new Uint8Array(largura * altura * 4)
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const v = ligado(x, y) ? 255 : 0
      cpu[y * largura + x] = v
      gpu.fill(v, ((altura - 1 - y) * largura + x) * 4, ((altura - 1 - y) * largura + x) * 4 + 4)
    }
  }
  return { cpu, gpu }
}

describe('concordanciaDasMascaras', () => {
  it('máscaras iguais concordam 100%, mesmo com a GPU de cabeça para baixo', () => {
    const { cpu, gpu } = par(8, 6, (x, y) => y < 2) // só as linhas de cima ligadas
    expect(concordanciaDasMascaras(cpu, gpu, 8, 6)).toBe(1)
  })

  it('um pixel diferente baixa a concordância na proporção certa', () => {
    const { cpu, gpu } = par(10, 10, () => false)
    cpu[0] = 255
    expect(concordanciaDasMascaras(cpu, gpu, 10, 10)).toBeCloseTo(0.99)
  })
})
