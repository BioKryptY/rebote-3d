import { describe, expect, it } from 'vitest'
import { ARENA } from './game.js'
import { alvoDoObjeto, suavizar } from './controle.js'

describe('alvoDoObjeto', () => {
  it('centro da imagem é o centro do túnel', () => {
    const a = alvoDoObjeto(0.5, 0.5)
    expect(a.x).toBeCloseTo(0)
    expect(a.y).toBeCloseTo(0)
  })

  it('canto superior direito da imagem vai para o canto superior direito do túnel', () => {
    const a = alvoDoObjeto(1, 0)
    expect(a.x).toBeCloseTo(ARENA.largura / 2)
    expect(a.y).toBeCloseTo(ARENA.altura / 2)
  })

  it('sensibilidade maior alcança a borda com menos movimento', () => {
    expect(alvoDoObjeto(0.8, 0.5, 2).x).toBeGreaterThan(alvoDoObjeto(0.8, 0.5, 1).x)
  })
})

describe('suavizar', () => {
  it('sem valor anterior, adota o novo', () => {
    expect(suavizar(null, { x: 1, y: 2 }, 0.3, 1 / 60)).toEqual({ x: 1, y: 2 })
  })

  it('fator 1 não suaviza', () => {
    expect(suavizar({ x: 0, y: 0 }, { x: 1, y: 1 }, 1, 1 / 60)).toEqual({ x: 1, y: 1 })
  })

  it('anda só uma fração do caminho a cada quadro', () => {
    const s = suavizar({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.3, 1 / 60)
    expect(s.x).toBeCloseTo(0.3)
  })

  it('o resultado depois de 1 segundo não depende do FPS', () => {
    let a = { x: 0, y: 0 }
    let b = { x: 0, y: 0 }
    for (let i = 0; i < 30; i++) a = suavizar(a, { x: 1, y: 0 }, 0.1, 1 / 30)
    for (let i = 0; i < 120; i++) b = suavizar(b, { x: 1, y: 0 }, 0.1, 1 / 120)
    expect(a.x).toBeCloseTo(b.x, 5)
  })
})
