// Painel de FPS (stats.js) e, mais adiante, o painel de parâmetros (lil-gui).
import Stats from 'stats.js'

export function criarStats() {
  const stats = new Stats()
  stats.showPanel(0) // 0 = FPS
  stats.dom.classList.add('stats')
  document.body.appendChild(stats.dom)
  return stats
}
