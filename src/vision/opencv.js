// Carregamento do OpenCV.js e rastreamento do objeto colorido.
//
// Pipeline de cada quadro (320×240):
//   RGBA → RGB → suavização → HSV → [equalização de V] → inRange (limiarização)
//   → abertura e fechamento (morfologia) → contornos → maior contorno
//   → momentos → centróide
//
// Gestão de memória: toda cv.Mat usada por quadro é criada uma vez no
// construtor e reaproveitada; liberar() chama delete() em todas. Nada é
// alocado no heap do OpenCV dentro do loop, então a memória não cresce.
import { ALTURA_PROC, LARGURA_PROC } from '../capture.js'
import { faixasDeMatiz, kernelImpar, mediaHSV, H_MAX } from './hsv.js'

/**
 * O OpenCV.js tem ~10 MB: o import dinâmico faz o Vite gerar um arquivo
 * separado e a página aparece antes dele terminar de baixar.
 * Só se pode chamar o OpenCV depois que o runtime WebAssembly inicializa.
 * Devolve { cv } (e não cv direto) porque o objeto do Emscripten pode ter um
 * método then, e um await nele ficaria esperando para sempre.
 */
export async function carregarOpenCV() {
  const modulo = await import('@techstark/opencv-js')
  let cv = modulo.default ?? modulo
  if (cv instanceof Promise) {
    cv = await cv
  } else if (!cv.Mat) {
    await new Promise((resolve) => {
      cv.onRuntimeInitialized = resolve
    })
  }
  return { cv }
}

const COR_CONTORNO = [56, 225, 255, 255] // ciano, como a raquete do jogador
const COR_CENTRO = [255, 211, 77, 255] // amarelo, como a bola

export class RastreadorDeCor {
  constructor(cv, largura = LARGURA_PROC, altura = ALTURA_PROC) {
    this.cv = cv
    this.largura = largura
    this.altura = altura
    const nova = (tipo) => new cv.Mat(altura, largura, tipo)

    this.rgba = nova(cv.CV_8UC4)
    this.rgb = nova(cv.CV_8UC3)
    this.suave = nova(cv.CV_8UC3)
    this.hsv = nova(cv.CV_8UC3)
    this.canais = new cv.MatVector()
    this.mascara = nova(cv.CV_8UC1)
    this.mascaraAux = nova(cv.CV_8UC1)
    this.aberta = nova(cv.CV_8UC1)
    this.final = nova(cv.CV_8UC1)
    this.vista = nova(cv.CV_8UC3)
    this.gesto = nova(cv.CV_8UC3)
    this.mascaraDilatada = nova(cv.CV_8UC1)
    // limites do inRange: [mínimo, máximo] de cada uma das (até) duas faixas
    this.limites = [nova(cv.CV_8UC3), nova(cv.CV_8UC3), nova(cv.CV_8UC3), nova(cv.CV_8UC3)]
    this.assinaturaLimites = ''
    this.contornos = new cv.MatVector()
    this.hierarquia = new cv.Mat()
    this.kernels = new Map()
  }

  /**
   * Processa um quadro e devolve onde está o objeto.
   * @param {ImageData} imagem quadro 320×240 vindo da captura
   * @param {typeof import('./hsv.js').PDI_PADRAO} p parâmetros do painel
   */
  processar(imagem, p) {
    const cv = this.cv
    const inicio = performance.now()
    this.rgba.data.set(imagem.data)
    cv.cvtColor(this.rgba, this.rgb, cv.COLOR_RGBA2RGB)

    // 1) Suavização: tira o ruído do sensor antes de limiarizar.
    const k = kernelImpar(p.kernelSuavizacao)
    if (p.suavizacao === 'gaussiano' && k > 1) {
      cv.GaussianBlur(this.rgb, this.suave, new cv.Size(k, k), 0, 0, cv.BORDER_DEFAULT)
    } else if (p.suavizacao === 'mediana' && k > 1) {
      cv.medianBlur(this.rgb, this.suave, k)
    } else {
      this.rgb.copyTo(this.suave)
    }

    // 2) Espaço de cor: em HSV a cor (H) fica separada do brilho (V), então
    //    o objeto continua com a mesma matiz quando a luz muda.
    cv.cvtColor(this.suave, this.hsv, cv.COLOR_RGB2HSV)

    // 3) Equalização do histograma do canal V (opcional): espalha os níveis
    //    de brilho, ajuda em ambiente escuro ou com pouco contraste.
    if (p.equalizar) {
      cv.split(this.hsv, this.canais)
      const v = this.canais.get(2)
      cv.equalizeHist(v, v)
      this.canais.set(2, v)
      cv.merge(this.canais, this.hsv)
      v.delete()
    }

    // 4) Limiarização por faixa: pixel branco se H, S e V estão dentro da faixa.
    const faixas = faixasDeMatiz(p.hMin, p.hMax)
    this.#atualizarLimites(faixas, p)
    cv.inRange(this.hsv, this.limites[0], this.limites[1], this.mascara)
    if (faixas.length === 2) {
      cv.inRange(this.hsv, this.limites[2], this.limites[3], this.mascaraAux)
      cv.bitwise_or(this.mascara, this.mascaraAux, this.mascara)
    }

    // 5) Morfologia: a abertura (erosão + dilatação) apaga pontinhos soltos;
    //    o fechamento (dilatação + erosão) tapa buracos dentro do objeto.
    this.#morfologia(this.mascara, this.aberta, cv.MORPH_OPEN, p.abertura)
    this.#morfologia(this.aberta, this.final, cv.MORPH_CLOSE, p.fechamento)

    // 6) Contornos: o maior contorno é o objeto; o resto é ruído.
    cv.findContours(this.final, this.contornos, this.hierarquia, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    let indiceMaior = -1
    let areaMaior = 0
    for (let i = 0; i < this.contornos.size(); i++) {
      const contorno = this.contornos.get(i)
      const area = cv.contourArea(contorno)
      contorno.delete()
      if (area > areaMaior) {
        areaMaior = area
        indiceMaior = i
      }
    }

    // 7) Momentos: centróide = (m10/m00, m01/m00), o "centro de massa" da forma.
    const resultado = { encontrado: false, x: 0, y: 0, u: 0.5, v: 0.5, area: areaMaior, raio: 0, contornos: this.contornos.size() }
    this.rgb.copyTo(this.vista)
    if (indiceMaior >= 0 && areaMaior >= p.areaMinima) {
      const contorno = this.contornos.get(indiceMaior)
      const m = cv.moments(contorno, false)
      const circulo = cv.minEnclosingCircle(contorno)
      contorno.delete()
      if (m.m00 > 0) {
        resultado.encontrado = true
        resultado.x = m.m10 / m.m00
        resultado.y = m.m01 / m.m00
        resultado.u = resultado.x / this.largura
        resultado.v = resultado.y / this.altura
        resultado.raio = circulo.radius
        const centro = new cv.Point(Math.round(resultado.x), Math.round(resultado.y))
        cv.drawContours(this.vista, this.contornos, indiceMaior, new cv.Scalar(...COR_CONTORNO), 2, cv.LINE_8)
        cv.circle(this.vista, centro, Math.round(circulo.radius), new cv.Scalar(...COR_CENTRO), 1, cv.LINE_AA)
        cv.circle(this.vista, centro, 4, new cv.Scalar(...COR_CENTRO), -1, cv.LINE_AA)
      }
    }

    resultado.tempoMs = performance.now() - inicio
    return resultado
  }

  /**
   * Prepara a entrada do classificador de gestos (integração PDI → IA):
   * recorta a zona do gesto e, dentro dela, pinta de cinza o objeto colorido
   * usando a máscara do rastreamento (dilatada para cobrir a borda), para a
   * posição do objeto não confundir o classificador.
   * @param {HTMLCanvasElement} canvas destino (vira a entrada da MobileNet)
   * @param {{x:number,y:number,w:number,h:number}} zona
   * @param {boolean} apagarObjeto
   */
  prepararEntradaGesto(canvas, zona, apagarObjeto) {
    const cv = this.cv
    this.rgb.copyTo(this.gesto)
    if (apagarObjeto) {
      cv.dilate(this.final, this.mascaraDilatada, this.#kernel(15), new cv.Point(-1, -1), 1)
      this.gesto.setTo(new cv.Scalar(128, 128, 128, 255), this.mascaraDilatada)
    }
    const recorte = this.gesto.roi(new cv.Rect(zona.x, zona.y, zona.w, zona.h))
    cv.imshow(canvas, recorte)
    recorte.delete()
  }

  /** Desenha o retângulo da zona do gesto na imagem de visualização. */
  marcarZona(zona) {
    const cv = this.cv
    cv.rectangle(
      this.vista,
      new cv.Point(zona.x, zona.y),
      new cv.Point(zona.x + zona.w - 1, zona.y + zona.h - 1),
      new cv.Scalar(255, 255, 255, 255),
      1,
      cv.LINE_8,
    )
  }

  /** Imagem da câmera com o contorno e o centróide desenhados. */
  desenharVista(canvas) {
    this.cv.imshow(canvas, this.vista)
  }

  /** Máscara binária depois da morfologia. */
  desenharMascara(canvas) {
    this.cv.imshow(canvas, this.final)
  }

  /**
   * Cor média (em HSV, já suavizada e equalizada como no pipeline) de uma
   * janela 5×5 em volta do ponto clicado.
   */
  amostrarHSV(x, y) {
    const amostras = []
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = Math.min(this.largura - 1, Math.max(0, Math.round(x) + dx))
        const py = Math.min(this.altura - 1, Math.max(0, Math.round(y) + dy))
        const p = this.hsv.ucharPtr(py, px)
        amostras.push([p[0], p[1], p[2]])
      }
    }
    return mediaHSV(amostras)
  }

  liberar() {
    const mats = [
      this.rgba, this.rgb, this.suave, this.hsv, this.mascara, this.mascaraAux,
      this.aberta, this.final, this.vista, this.gesto, this.mascaraDilatada,
      this.hierarquia, ...this.limites,
      ...this.kernels.values(),
    ]
    for (const m of mats) m.delete()
    this.canais.delete()
    this.contornos.delete()
    this.kernels.clear()
  }

  // O setTo preenche as matrizes de limite; só é refeito quando a faixa muda.
  #atualizarLimites(faixas, p) {
    const assinatura = JSON.stringify([faixas, p.sMin, p.sMax, p.vMin, p.vMax])
    if (assinatura === this.assinaturaLimites) return
    this.assinaturaLimites = assinatura
    const cv = this.cv
    faixas.forEach(([hMin, hMax], i) => {
      this.limites[i * 2].setTo(new cv.Scalar(hMin, p.sMin, p.vMin, 0))
      this.limites[i * 2 + 1].setTo(new cv.Scalar(Math.min(hMax, H_MAX), p.sMax, p.vMax, 0))
    })
  }

  #morfologia(origem, destino, operacao, tamanho) {
    if (tamanho <= 1) {
      origem.copyTo(destino)
      return
    }
    const cv = this.cv
    cv.morphologyEx(origem, destino, operacao, this.#kernel(tamanho), new cv.Point(-1, -1), 1)
  }

  // Elemento estruturante elíptico, guardado por tamanho para não recriar.
  #kernel(tamanho) {
    const k = kernelImpar(tamanho)
    if (!this.kernels.has(k)) {
      this.kernels.set(k, this.cv.getStructuringElement(this.cv.MORPH_ELLIPSE, new this.cv.Size(k, k)))
    }
    return this.kernels.get(k)
  }
}
