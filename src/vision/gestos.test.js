import { describe, expect, it } from 'vitest'
import { retanguloDaZona } from './gestos.js'

describe('retanguloDaZona', () => {
  it('zona esquerda começa na borda esquerda e fica dentro da imagem', () => {
    const r = retanguloDaZona('esquerda', 320, 240)
    expect(r.x).toBe(0)
    expect(r.x + r.w).toBeLessThan(320 / 2)
    expect(r.y + r.h).toBeLessThanOrEqual(240)
  })

  it('zona direita termina na borda direita', () => {
    const r = retanguloDaZona('direita', 320, 240)
    expect(r.x + r.w).toBe(320)
    expect(r.x).toBeGreaterThan(320 / 2)
  })

  it('imagem inteira cobre tudo', () => {
    expect(retanguloDaZona('inteira', 320, 240)).toEqual({ x: 0, y: 0, w: 320, h: 240 })
  })
})
