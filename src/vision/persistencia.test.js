import { describe, expect, it } from 'vitest'
import {
  base64ParaFloat32,
  desserializar,
  DIMENSAO_EMBEDDING,
  float32ParaBase64,
  serializar,
} from './persistencia.js'

function aleatorio(n) {
  return Float32Array.from({ length: n }, () => Math.random() * 2 - 1)
}

describe('base64', () => {
  it('ida e volta preserva os valores exatamente', () => {
    const v = aleatorio(100_000) // maior que o bloco de conversão
    expect(base64ParaFloat32(float32ParaBase64(v))).toEqual(v)
  })
})

describe('serializar / desserializar', () => {
  const classes = {
    neutro: { linhas: 2, valores: aleatorio(2 * DIMENSAO_EMBEDDING) },
    sacar: { linhas: 3, valores: aleatorio(3 * DIMENSAO_EMBEDDING) },
  }

  it('ida e volta devolve os mesmos exemplos e a zona', () => {
    const json = JSON.parse(JSON.stringify(serializar(classes, { zona: 'direita', apagarObjeto: false })))
    const lido = desserializar(json)
    expect(lido.zona).toBe('direita')
    expect(lido.apagarObjeto).toBe(false)
    expect(lido.classes.sacar.linhas).toBe(3)
    expect(lido.classes.sacar.valores).toEqual(classes.sacar.valores)
  })

  it('recusa gesto desconhecido', () => {
    const json = serializar({ pular: classes.neutro }, { zona: 'esquerda', apagarObjeto: true })
    expect(() => desserializar(json)).toThrow(/desconhecido/)
  })

  it('recusa dados com tamanho diferente do declarado', () => {
    const json = serializar(classes, { zona: 'esquerda', apagarObjeto: true })
    json.classes.sacar.linhas = 4
    expect(() => desserializar(json)).toThrow(/tamanho/)
  })

  it('recusa outra versão, outro modelo e zona inválida', () => {
    const base = serializar(classes, { zona: 'esquerda', apagarObjeto: true })
    expect(() => desserializar({ ...base, versao: 2 })).toThrow(/versão/)
    expect(() => desserializar({ ...base, dimensao: 1024 })).toThrow(/modelo/)
    expect(() => desserializar({ ...base, zona: 'cima' })).toThrow(/zona/)
    expect(() => desserializar(null)).toThrow()
  })

  it('recusa valores não numéricos (NaN)', () => {
    const v = aleatorio(DIMENSAO_EMBEDDING)
    v[10] = NaN
    const json = serializar({ neutro: { linhas: 1, valores: v } }, { zona: 'esquerda', apagarObjeto: true })
    expect(() => desserializar(json)).toThrow(/inválidos/)
  })
})
