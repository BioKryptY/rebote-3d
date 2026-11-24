import { describe, expect, it } from 'vitest'
import { ConfirmadorDeGesto, retanguloDaZona } from './gestos.js'

const OPCOES = { confiancaMinima: 0.8, confirmacoes: 3, intervaloMs: 500 }
const p = (gesto, confianca = 1) => ({ gesto, confianca })

/** Registra várias classificações, 100 ms entre elas, e devolve os comandos. */
function sequencia(confirmador, predicoes, inicio = 0) {
  return predicoes.map((pred, i) => confirmador.registrar(pred, OPCOES, inicio + i * 100)).filter(Boolean)
}

describe('ConfirmadorDeGesto', () => {
  it('só dispara depois de três classificações seguidas do mesmo gesto', () => {
    const c = new ConfirmadorDeGesto()
    expect(c.registrar(p('sacar'), OPCOES, 0)).toBeNull()
    expect(c.registrar(p('sacar'), OPCOES, 100)).toBeNull()
    expect(c.registrar(p('sacar'), OPCOES, 200)).toBe('sacar')
  })

  it('uma classificação de baixa confiança no meio zera a contagem', () => {
    const c = new ConfirmadorDeGesto()
    expect(sequencia(c, [p('sacar'), p('sacar'), p('sacar', 0.5), p('sacar'), p('sacar')])).toEqual([])
  })

  it('neutro nunca vira comando', () => {
    const c = new ConfirmadorDeGesto()
    expect(sequencia(c, Array(10).fill(p('neutro')))).toEqual([])
  })

  it('segurar o gesto dispara uma vez só', () => {
    const c = new ConfirmadorDeGesto()
    expect(sequencia(c, Array(30).fill(p('sacar')))).toEqual(['sacar'])
  })

  it('para repetir o comando é preciso voltar ao neutro', () => {
    const c = new ConfirmadorDeGesto()
    const predicoes = [...Array(4).fill(p('sacar')), ...Array(4).fill(p('neutro')), ...Array(4).fill(p('sacar'))]
    expect(sequencia(c, predicoes)).toEqual(['sacar', 'sacar'])
  })

  it('gestos diferentes em sequência disparam cada um', () => {
    const c = new ConfirmadorDeGesto()
    const predicoes = [...Array(3).fill(p('pausar')), ...Array(5).fill(p('sacar'))]
    expect(sequencia(c, predicoes)).toEqual(['pausar', 'sacar'])
  })

  it('respeita o intervalo mínimo entre comandos', () => {
    const c = new ConfirmadorDeGesto()
    expect(c.registrar(p('pausar'), { ...OPCOES, confirmacoes: 1 }, 0)).toBe('pausar')
    expect(c.registrar(p('sacar'), { ...OPCOES, confirmacoes: 1 }, 100)).toBeNull()
    expect(c.registrar(p('sacar'), { ...OPCOES, confirmacoes: 1 }, 600)).toBe('sacar')
  })
})

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
