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
  pasta.add(acoes, 'recentralizarCamera').name('Recentralizar câmera 3D')
  return pasta
}
