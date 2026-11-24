// Painel de FPS (stats.js) e painel de parâmetros (lil-gui).
import Stats from 'stats.js'
import GUI from 'lil-gui'

export function criarStats() {
  const stats = new Stats()
  stats.showPanel(0) // 0 = FPS
  stats.dom.classList.add('stats')
  document.body.appendChild(stats.dom)
  return stats
}

export function criarPainel() {
  return new GUI({ title: 'Parâmetros', width: 300 })
}

/**
 * @param {GUI} gui
 * @param {{fonte: string, espelhar: boolean}} estado
 * @param {{trocarFonte: Function, abrirVideo: Function, espelhar: Function}} acoes
 */
export function painelCaptura(gui, estado, acoes) {
  const pasta = gui.addFolder('Captura')
  pasta
    .add(estado, 'fonte', { Webcam: 'webcam', 'Arquivo de vídeo': 'arquivo' })
    .name('Fonte')
    .onChange(acoes.trocarFonte)
    .listen()
  pasta.add(estado, 'espelhar').name('Espelhar imagem').onChange(acoes.espelhar).listen()
  pasta.add(acoes, 'abrirVideo').name('Abrir arquivo de vídeo…')
  return pasta
}

/**
 * Parâmetros de cada etapa do processamento de imagem (OpenCV.js).
 * @param {GUI} gui
 * @param {typeof import('./vision/hsv.js').PDI_PADRAO} pdi objeto lido a cada quadro
 * @param {{restaurar: Function}} acoes
 */
export function painelPDI(gui, pdi, acoes) {
  const pasta = gui.addFolder('Processamento de imagem (OpenCV.js)')

  const suav = pasta.addFolder('1. Suavização')
  suav
    .add(pdi, 'suavizacao', { Nenhuma: 'nenhuma', Gaussiana: 'gaussiano', Mediana: 'mediana' })
    .name('Filtro')
    .listen()
  suav.add(pdi, 'kernelSuavizacao', 1, 15, 2).name('Tamanho do kernel').listen()

  const cor = pasta.addFolder('2. Espaço de cor HSV e limiarização')
  cor.add(pdi, 'equalizar').name('Equalizar histograma de V').listen()
  cor.add(pdi, 'hMin', 0, 179, 1).name('H mínimo').listen()
  cor.add(pdi, 'hMax', 0, 179, 1).name('H máximo').listen()
  cor.add(pdi, 'sMin', 0, 255, 1).name('S mínimo').listen()
  cor.add(pdi, 'sMax', 0, 255, 1).name('S máximo').listen()
  cor.add(pdi, 'vMin', 0, 255, 1).name('V mínimo').listen()
  cor.add(pdi, 'vMax', 0, 255, 1).name('V máximo').listen()

  const morf = pasta.addFolder('3. Morfologia')
  morf.add(pdi, 'abertura', 1, 15, 2).name('Abertura (1 = desligada)').listen()
  morf.add(pdi, 'fechamento', 1, 15, 2).name('Fechamento (1 = desligado)').listen()

  const cont = pasta.addFolder('4. Contornos')
  cont.add(pdi, 'areaMinima', 0, 3000, 10).name('Área mínima (px)').listen()

  pasta.add(acoes, 'restaurar').name('Restaurar padrão (objeto verde)')
  return pasta
}

/**
 * Treino e uso do classificador de gestos (TensorFlow.js).
 * @param {GUI} gui
 * @param {{exemplos: string}} info texto atualizado com a contagem de exemplos
 * @param {{inferirACada: number, k: number, zona: string, apagarObjeto: boolean,
 *   confiancaMinima: number, confirmacoes: number}} opcoes
 * @param {{gravar: (gesto: string) => void, apagar: Function}} acoes
 * @param {string[]} gestos
 * @param {Record<string, string>} nomes
 * @param {Record<string, string>} zonas
 */
export function painelGestos(gui, info, opcoes, acoes, gestos, nomes, zonas) {
  const pasta = gui.addFolder('Gestos (TensorFlow.js)')
  pasta.add(opcoes, 'zona', zonas).name('Zona do gesto (regrave ao trocar)')
  pasta.add(opcoes, 'apagarObjeto').name('Apagar o objeto colorido da zona')
  pasta.add(info, 'exemplos').name('Exemplos gravados').disable().listen()
  const botoes = {}
  for (const g of gestos) {
    botoes[g] = () => acoes.gravar(g)
    pasta.add(botoes, g).name(`Gravar "${nomes[g]}"`)
  }
  pasta.add(acoes, 'apagar').name('Apagar todos os exemplos')
  pasta.add(opcoes, 'confiancaMinima', 0.5, 1, 0.05).name('Confiança mínima')
  pasta.add(opcoes, 'confirmacoes', 1, 8, 1).name('Classificações seguidas p/ confirmar')
  pasta.add(opcoes, 'k', 1, 15, 1).name('k (vizinhos que votam)')
  pasta.add(opcoes, 'inferirACada', 1, 6, 1).name('Classificar a cada N quadros')
  return pasta
}

/**
 * @param {GUI} gui
 * @param {{modo: string, sensibilidade: number, suavizacao: number}} controle
 * @param {{reiniciar: Function, recentralizarCamera: Function}} acoes
 */
export function painelJogo(gui, controle, acoes) {
  const pasta = gui.addFolder('Jogo')
  pasta
    .add(controle, 'modo', { 'Objeto colorido na câmera': 'objeto', Mouse: 'mouse' })
    .name('Raquete segue')
    .listen()
  pasta.add(controle, 'sensibilidade', 0.8, 2.5, 0.05).name('Sensibilidade')
  pasta.add(controle, 'suavizacao', 0.05, 1, 0.05).name('Suavização temporal (1 = nenhuma)')
  pasta.add(acoes, 'reiniciar').name('Reiniciar partida (R)')
  return pasta
}

/**
 * @param {GUI} gui
 * @param {{telao: string}} opcoes
 * @param {{trocarTelao: Function, recentralizarCamera: Function}} acoes
 */
export function painelCena(gui, opcoes, acoes) {
  const pasta = gui.addFolder('Cena 3D (Three.js)')
  pasta
    .add(opcoes, 'telao', {
      'Câmera com contorno': 'camera',
      'Máscara do OpenCV': 'mascara',
      Nada: 'nada',
    })
    .name('Telão do fundo mostra')
    .onChange(acoes.trocarTelao)
  pasta.add(acoes, 'recentralizarCamera').name('Recentralizar câmera 3D')
  return pasta
}
