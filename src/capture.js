// Fontes de imagem: webcam ou arquivo de vídeo. Cada quadro é desenhado num
// canvas pequeno (320×240), que é a entrada do OpenCV.js e do TensorFlow.js.
// Processar em resolução reduzida é o que mantém o jogo acima de 15 FPS.

export const LARGURA_PROC = 320
export const ALTURA_PROC = 240

export class Captura {
  /** @param {HTMLVideoElement} video */
  constructor(video) {
    this.video = video
    this.canvas = document.createElement('canvas')
    this.canvas.width = LARGURA_PROC
    this.canvas.height = ALTURA_PROC
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    this.fonte = 'nenhuma'
    this.espelhar = true
    this.stream = null
    this.urlArquivo = null
    this.quadroNovo = false
    this.#observarQuadros()
  }

  async iniciarWebcam() {
    this.parar()
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('o navegador só libera a câmera em localhost ou HTTPS')
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    })
    this.video.srcObject = this.stream
    await this.video.play()
    this.fonte = 'webcam'
    this.espelhar = true // como num espelho: mexer para a direita move para a direita
  }

  /** @param {File} arquivo */
  async abrirArquivo(arquivo) {
    this.parar()
    this.urlArquivo = URL.createObjectURL(arquivo)
    this.video.src = this.urlArquivo
    this.video.loop = true
    await this.video.play()
    this.fonte = 'arquivo'
    this.espelhar = false
  }

  parar() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.pause()
    this.video.srcObject = null
    this.video.removeAttribute('src')
    if (this.urlArquivo) URL.revokeObjectURL(this.urlArquivo)
    this.urlArquivo = null
    this.fonte = 'nenhuma'
  }

  get pronta() {
    return this.video.readyState >= 2 && this.video.videoWidth > 0
  }

  /**
   * Desenha o quadro atual no canvas de processamento e devolve os pixels.
   * Recorta o centro do vídeo na proporção 4:3 (sem distorcer) e espelha a
   * imagem da webcam. Devolve null se não houver quadro novo desde a última
   * chamada, para não processar a mesma imagem duas vezes.
   * @returns {ImageData|null}
   */
  capturar() {
    if (!this.pronta || !this.quadroNovo) return null
    this.quadroNovo = !('requestVideoFrameCallback' in HTMLVideoElement.prototype)

    const { videoWidth: vw, videoHeight: vh } = this.video
    const proporcao = LARGURA_PROC / ALTURA_PROC
    let sx = 0
    let sy = 0
    let sw = vw
    let sh = vh
    if (vw / vh > proporcao) {
      sw = vh * proporcao
      sx = (vw - sw) / 2
    } else {
      sh = vw / proporcao
      sy = (vh - sh) / 2
    }

    const { ctx } = this
    ctx.save()
    if (this.espelhar) {
      ctx.translate(LARGURA_PROC, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, LARGURA_PROC, ALTURA_PROC)
    ctx.restore()
    return ctx.getImageData(0, 0, LARGURA_PROC, ALTURA_PROC)
  }

  // requestVideoFrameCallback avisa exatamente quando chega um quadro novo do
  // vídeo; sem ele, processamos a cada quadro da renderização.
  #observarQuadros() {
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
      this.quadroNovo = true
      return
    }
    const aoChegarQuadro = () => {
      this.quadroNovo = true
      this.video.requestVideoFrameCallback(aoChegarQuadro)
    }
    this.video.requestVideoFrameCallback(aoChegarQuadro)
  }
}
