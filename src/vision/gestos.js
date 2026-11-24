// Gestos reconhecidos pelo classificador (ver model.js) e a zona da imagem
// que ele olha. Fica num arquivo separado e leve para a interface poder usar
// os nomes antes de o TensorFlow.js terminar de carregar.

export const GESTOS = ['neutro', 'sacar', 'pausar']

export const NOMES_GESTOS = { neutro: 'Neutro', sacar: 'Sacar', pausar: 'Pausar' }

// O classificador não olha a imagem inteira: o objeto colorido anda pela
// tela o tempo todo e, se entrasse na comparação, a posição dele pesaria mais
// que o gesto. Por isso ele olha só a zona da mão livre. Com a imagem
// espelhada, quem segura o objeto com a mão direita faz o gesto com a
// esquerda, que aparece no lado esquerdo da imagem.
export const ZONAS = {
  'Lado esquerdo da imagem': 'esquerda',
  'Lado direito da imagem': 'direita',
  'Imagem inteira': 'inteira',
}

/**
 * Transforma a sequência de classificações em comandos para o jogo.
 * Um gesto só vira comando quando:
 *  - a confiança passa do mínimo em várias classificações seguidas
 *    (uma classificação isolada errada não dispara nada);
 *  - o mesmo comando não foi o último disparado — para repetir, é preciso
 *    voltar ao neutro (ou fazer outro gesto). Sem isso, segurar "sacar"
 *    lançaria a bola de novo logo depois de cada ponto;
 *  - passou um intervalo mínimo desde o último comando.
 */
export class ConfirmadorDeGesto {
  constructor() {
    this.candidato = null
    this.seguidas = 0
    this.ultimoDisparado = null
    this.liberadoEm = 0
  }

  /**
   * @param {{gesto: string, confianca: number}|null} predicao
   * @param {{confiancaMinima: number, confirmacoes: number, intervaloMs: number}} opcoes
   * @param {number} agora tempo em ms
   * @returns {string|null} o gesto que virou comando, ou null
   */
  registrar(predicao, opcoes, agora) {
    const confiavel = predicao && predicao.confianca >= opcoes.confiancaMinima
    if (!confiavel) {
      this.candidato = null
      this.seguidas = 0
      return null
    }
    if (predicao.gesto === 'neutro') {
      this.candidato = null
      this.seguidas = 0
      this.ultimoDisparado = null
      return null
    }
    if (predicao.gesto !== this.candidato) {
      this.candidato = predicao.gesto
      this.seguidas = 0
    }
    this.seguidas++
    if (this.seguidas < opcoes.confirmacoes) return null
    if (this.ultimoDisparado === predicao.gesto || agora < this.liberadoEm) return null
    this.ultimoDisparado = predicao.gesto
    this.liberadoEm = agora + opcoes.intervaloMs
    return predicao.gesto
  }
}

/** Retângulo da zona do gesto, em pixels da imagem processada. */
export function retanguloDaZona(zona, largura, altura) {
  if (zona === 'inteira') return { x: 0, y: 0, w: largura, h: altura }
  const w = Math.round(largura * 0.45)
  const h = Math.round(altura * 0.85)
  return { x: zona === 'direita' ? largura - w : 0, y: 0, w, h }
}
