import { describe, expect, it } from 'vitest'
import { calibrarPorAmostra, faixasDeMatiz, kernelImpar, mediaHSV } from './hsv.js'

describe('faixasDeMatiz', () => {
  it('faixa normal vira uma faixa só', () => {
    expect(faixasDeMatiz(35, 85)).toEqual([[35, 85]])
  })

  it('faixa do vermelho dá a volta no círculo e vira duas', () => {
    expect(faixasDeMatiz(170, 10)).toEqual([
      [0, 10],
      [170, 179],
    ])
  })
})

describe('kernelImpar', () => {
  it('arredonda para o ímpar seguinte e nunca fica abaixo de 1', () => {
    expect(kernelImpar(4)).toBe(5)
    expect(kernelImpar(5)).toBe(5)
    expect(kernelImpar(0)).toBe(1)
    expect(kernelImpar(6.4)).toBe(7)
  })
})

describe('mediaHSV', () => {
  it('média circular da matiz: 175 e 5 dão vermelho (0), não verde', () => {
    const { h } = mediaHSV([
      [175, 200, 200],
      [5, 200, 200],
    ])
    expect(h === 0 || h === 179).toBe(true)
  })

  it('média comum de saturação e brilho', () => {
    expect(
      mediaHSV([
        [60, 100, 50],
        [60, 200, 150],
      ]),
    ).toEqual({ h: 60, s: 150, v: 100 })
  })
})

describe('calibrarPorAmostra', () => {
  it('cria uma faixa em torno da cor clicada', () => {
    const f = calibrarPorAmostra({ h: 60, s: 220, v: 200 })
    expect(f.hMin).toBe(48)
    expect(f.hMax).toBe(72)
    expect(f.sMin).toBe(150)
    expect(f.vMin).toBe(120)
    expect(f.sMax).toBe(255)
  })

  it('perto do vermelho a faixa dá a volta', () => {
    const f = calibrarPorAmostra({ h: 3, s: 220, v: 200 })
    expect(f.hMin).toBe(171)
    expect(f.hMax).toBe(15)
    expect(faixasDeMatiz(f.hMin, f.hMax)).toHaveLength(2)
  })

  it('objeto claro: o piso impede aceitar pixels quase pretos', () => {
    const f = calibrarPorAmostra({ h: 100, s: 90, v: 100 })
    expect(f.sMin).toBe(40)
    expect(f.vMin).toBe(30)
  })

  it('objeto escuro continua dentro da própria faixa', () => {
    const f = calibrarPorAmostra({ h: 65, s: 214, v: 4 })
    expect(f.vMin).toBeLessThanOrEqual(4)
    const g = calibrarPorAmostra({ h: 100, s: 60, v: 50 })
    expect(g.sMin).toBeLessThanOrEqual(60)
    expect(g.vMin).toBeLessThanOrEqual(50)
  })
})
