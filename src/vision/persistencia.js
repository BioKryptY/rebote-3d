// Salvar e carregar os exemplos do classificador de gestos.
// Formato JSON: as embeddings (Float32Array) vão em base64, o que ocupa
// ~4 vezes menos que uma lista de números em texto.
import { GESTOS } from './gestos.js'

export const VERSAO = 1
export const DIMENSAO_EMBEDDING = 512 // saída da MobileNet v1 com largura 0,5

export function float32ParaBase64(valores) {
  const bytes = new Uint8Array(valores.buffer, valores.byteOffset, valores.byteLength)
  let binario = ''
  const bloco = 0x8000 // evita estourar a pilha do String.fromCharCode
  for (let i = 0; i < bytes.length; i += bloco) {
    binario += String.fromCharCode(...bytes.subarray(i, i + bloco))
  }
  return btoa(binario)
}

export function base64ParaFloat32(texto) {
  const binario = atob(texto)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

/**
 * @param {Record<string, {linhas: number, valores: Float32Array}>} classes
 * @param {{zona: string, apagarObjeto: boolean}} opcoes zona em que os exemplos foram gravados
 */
export function serializar(classes, opcoes) {
  return {
    versao: VERSAO,
    dimensao: DIMENSAO_EMBEDDING,
    zona: opcoes.zona,
    apagarObjeto: opcoes.apagarObjeto,
    classes: Object.fromEntries(
      Object.entries(classes).map(([gesto, { linhas, valores }]) => [
        gesto,
        { linhas, dados: float32ParaBase64(valores) },
      ]),
    ),
  }
}

/**
 * Lê e valida um arquivo de exemplos. O arquivo pode vir de qualquer lugar
 * (importação pelo usuário), então tudo é conferido antes de virar tensor.
 * @returns {{zona: string, apagarObjeto: boolean, classes: Record<string, {linhas: number, valores: Float32Array}>}}
 */
export function desserializar(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('arquivo vazio ou inválido')
  if (obj.versao !== VERSAO) throw new Error(`versão ${obj.versao} não suportada`)
  if (obj.dimensao !== DIMENSAO_EMBEDDING) throw new Error('exemplos de outro modelo')
  if (!['esquerda', 'direita', 'inteira'].includes(obj.zona)) throw new Error('zona do gesto inválida')
  if (!obj.classes || typeof obj.classes !== 'object') throw new Error('sem exemplos')

  const classes = {}
  for (const [gesto, c] of Object.entries(obj.classes)) {
    if (!GESTOS.includes(gesto)) throw new Error(`gesto desconhecido: ${gesto}`)
    if (!Number.isInteger(c?.linhas) || c.linhas < 1 || c.linhas > 5000) {
      throw new Error(`quantidade de exemplos inválida em ${gesto}`)
    }
    if (typeof c.dados !== 'string') throw new Error(`dados inválidos em ${gesto}`)
    const valores = base64ParaFloat32(c.dados)
    if (valores.length !== c.linhas * DIMENSAO_EMBEDDING) throw new Error(`tamanho errado em ${gesto}`)
    if (!valores.every(Number.isFinite)) throw new Error(`valores inválidos em ${gesto}`)
    classes[gesto] = { linhas: c.linhas, valores }
  }
  return { zona: obj.zona, apagarObjeto: obj.apagarObjeto !== false, classes }
}
