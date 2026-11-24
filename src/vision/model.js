// Classificador de gestos com TensorFlow.js: transfer learning com MobileNet + KNN.
//
// A MobileNet (pré-treinada no ImageNet) não classifica gestos; ela é usada
// como extratora de características: para cada imagem devolve um vetor de 512
// números (a "embedding", saída da penúltima camada). O classificador KNN
// guarda as embeddings dos exemplos que o jogador grava e classifica uma
// imagem nova pela classe dos k exemplos mais parecidos (similaridade do
// cosseno). Treinar é só guardar exemplos, por isso acontece no navegador,
// em segundos, sem servidor.
//
// Gestão de memória: tf.tidy() descarta os tensores intermediários de cada
// inferência e a embedding da classificação é liberada com dispose().
import * as tf from '@tensorflow/tfjs'
import * as mobilenet from '@tensorflow-models/mobilenet'
import * as knnClassifier from '@tensorflow-models/knn-classifier'
import { GESTOS } from './gestos.js'

// Pesos da MobileNet v1 (largura 0,5, entrada 224×224) servidos pelo próprio
// site, em public/models: o jogo funciona sem acesso à internet.
const CAMINHO_MODELO = 'models/mobilenet_v1_050_224/model.json'

export class ClassificadorDeGestos {
  constructor() {
    this.rede = null
    this.knn = null
    this.backend = ''
  }

  /** @param {string} urlBase import.meta.env.BASE_URL */
  async carregar(urlBase) {
    // WebGL roda a rede na GPU; se não houver, cai para a CPU (bem mais lento).
    const ok = await tf.setBackend('webgl').catch(() => false)
    if (!ok) await tf.setBackend('cpu')
    await tf.ready()
    this.backend = tf.getBackend()
    this.rede = await mobilenet.load({
      version: 1,
      alpha: 0.5,
      modelUrl: urlBase + CAMINHO_MODELO,
      inputRange: [0, 1],
    })
    this.knn = knnClassifier.create()
  }

  get pronto() {
    return this.rede !== null
  }

  /** Grava um exemplo do gesto a partir da imagem atual da câmera. */
  adicionarExemplo(fonte, gesto) {
    tf.tidy(() => {
      const embedding = this.rede.infer(fonte, true)
      this.knn.addExample(embedding, gesto) // o KNN guarda a própria cópia
    })
  }

  /** Precisa de exemplos de pelo menos dois gestos para comparar. */
  get treinado() {
    return this.pronto && this.knn.getNumClasses() >= 2
  }

  /**
   * @param {HTMLCanvasElement} fonte imagem 320×240 da captura
   * @param {number} k quantos vizinhos votam
   * @returns {Promise<{gesto: string, confianca: number, confiancas: Object}|null>}
   */
  async classificar(fonte, k) {
    if (!this.treinado) return null
    const embedding = this.rede.infer(fonte, true)
    try {
      const r = await this.knn.predictClass(embedding, k)
      return { gesto: r.label, confianca: r.confidences[r.label] ?? 0, confiancas: r.confidences }
    } finally {
      embedding.dispose()
    }
  }

  /** Quantidade de exemplos gravados por gesto. */
  contagem() {
    const c = this.knn ? this.knn.getClassExampleCount() : {}
    return Object.fromEntries(GESTOS.map((g) => [g, c[g] ?? 0]))
  }

  limpar() {
    this.knn?.clearAllClasses()
  }

  /** Tensores vivos na memória do TensorFlow.js (para conferir vazamento). */
  tensores() {
    return tf.memory().numTensors
  }
}
