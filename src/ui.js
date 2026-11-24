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
