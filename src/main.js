// Inicialização e loop principal.
//
// Pipeline de cada quadro:
//   captura (webcam/vídeo) → OpenCV.js (rastreia o objeto colorido)
//     → centróide move a raquete do jogo
//     → máscara apaga o objeto da zona do gesto → TensorFlow.js (gestos)
//         → gesto confirmado saca ou pausa a partida
//   → física do jogo → Three.js desenha a cena (com a câmera no telão)
import './style.css'
import * as THREE from 'three'
import { ARENA, ESTADO, Jogo, Z_RAQUETE_JOGADOR } from './game/game.js'
import { alvoDoObjeto, suavizar } from './game/controle.js'
import { ALTURA_PROC, Captura, LARGURA_PROC } from './capture.js'
import { criarControleDeGestos } from './controleGestos.js'
import { criarCena } from './scene/scene.js'
import { criarObjetos } from './scene/objects.js'
import { concordanciaDasMascaras, criarFiltroHSVNaGPU, medirFiltroNaGPU } from './scene/gpuFiltro.js'
import { criarPainel, criarStats, painelCaptura, painelCena, painelComparacao, painelJogo, painelPDI } from './ui.js'
import { retanguloDaZona } from './vision/gestos.js'
import { calibrarPorAmostra, PDI_PADRAO } from './vision/hsv.js'

const app = document.querySelector('#app')
const elMensagem = document.querySelector('#mensagem')
const elAviso = document.querySelector('#aviso')
const elStatusCaptura = document.querySelector('#status-captura')
const elStatusVisao = document.querySelector('#status-visao')
const canvasCamera = document.querySelector('#canvas-camera')
const canvasMascara = document.querySelector('#canvas-mascara')
const canvasGesto = document.querySelector('#canvas-gesto')
const ctxCamera = canvasCamera.getContext('2d')
const inputVideo = document.querySelector('#arquivo-video')

const cena = criarCena(app)
const objetos = criarObjetos(cena.scene)
const jogo = new Jogo()
const stats = criarStats()
const painel = criarPainel()

let temporizadorAviso = 0
function mostrarAviso(texto, duracaoMs = 1200) {
  elAviso.textContent = texto
  elAviso.hidden = false
  clearTimeout(temporizadorAviso)
  temporizadorAviso = setTimeout(() => (elAviso.hidden = true), duracaoMs)
}

// como a raquete do jogador é controlada
const controle = { modo: 'objeto', sensibilidade: 1.3, suavizacao: 0.35 }

// ---- captura (webcam ou arquivo de vídeo) ----
const captura = new Captura(document.querySelector('#video'))
const estadoCaptura = { fonte: 'webcam', espelhar: true }

async function ligarWebcam() {
  elStatusCaptura.textContent = 'Pedindo permissão para usar a câmera…'
  try {
    await captura.iniciarWebcam()
    estadoCaptura.fonte = 'webcam'
    estadoCaptura.espelhar = captura.espelhar
    controle.modo = 'objeto'
    elStatusCaptura.textContent = 'Câmera ligada.'
  } catch (erro) {
    estadoCaptura.fonte = 'nenhuma'
    controle.modo = 'mouse'
    elStatusCaptura.textContent =
      `Câmera indisponível (${erro.message || erro.name}).\n` +
      'A raquete passou a seguir o mouse. Abra um vídeo no painel para usar a visão.'
  }
}

// diálogo de arquivo fechado sem escolher nada: o seletor volta à fonte atual
inputVideo.addEventListener('cancel', () => (estadoCaptura.fonte = captura.fonte))

inputVideo.addEventListener('change', async () => {
  const arquivo = inputVideo.files?.[0]
  inputVideo.value = ''
  if (!arquivo) return
  try {
    await captura.abrirArquivo(arquivo)
    estadoCaptura.fonte = 'arquivo'
    estadoCaptura.espelhar = captura.espelhar
    controle.modo = 'objeto'
    elStatusCaptura.textContent = `Vídeo: ${arquivo.name}`
  } catch (erro) {
    elStatusCaptura.textContent = `Não foi possível abrir o vídeo (${erro.message}).`
  }
})

painelCaptura(painel, estadoCaptura, {
  trocarFonte: (fonte) => (fonte === 'webcam' ? ligarWebcam() : inputVideo.click()),
  abrirVideo: () => inputVideo.click(),
  espelhar: (valor) => (captura.espelhar = valor),
})

ligarWebcam()

// ---- processamento de imagem (OpenCV.js) ----
const pdi = { ...PDI_PADRAO }
let rastreador = null
let resultado = null

painelPDI(painel, pdi, { restaurar: () => Object.assign(pdi, PDI_PADRAO) })

// Calibração: clicar no objeto na imagem da câmera ajusta a faixa HSV para a
// cor dele (média 5×5 em volta do clique, no HSV do último quadro processado).
canvasCamera.addEventListener('pointerdown', (e) => {
  if (!rastreador || !resultado) return
  const r = canvasCamera.getBoundingClientRect()
  const x = ((e.clientX - r.left) / r.width) * canvasCamera.width
  const y = ((e.clientY - r.top) / r.height) * canvasCamera.height
  const amostra = rastreador.amostrarHSV(x, y)
  Object.assign(pdi, calibrarPorAmostra(amostra))
  elStatusCaptura.textContent = `Cor calibrada: H ${amostra.h}, S ${amostra.s}, V ${amostra.v}.`
})

elStatusVisao.textContent = 'Carregando OpenCV.js…'
import('./vision/opencv.js')
  .then(async ({ carregarOpenCV, RastreadorDeCor }) => {
    const { cv } = await carregarOpenCV()
    rastreador = new RastreadorDeCor(cv)
    elStatusVisao.textContent = 'OpenCV.js pronto.'
  })
  .catch((erro) => {
    elStatusVisao.textContent = `Falha ao carregar o OpenCV.js (${erro.message}).`
  })

// libera as matrizes do OpenCV ao sair da página
window.addEventListener('pagehide', () => rastreador?.liberar())

let proximaAtualizacaoStatus = 0
function atualizarStatusVisao(agora) {
  if (agora < proximaAtualizacaoStatus || !resultado) return
  proximaAtualizacaoStatus = agora + 250
  const r = resultado
  elStatusVisao.textContent =
    `OpenCV: ${r.tempoMs.toFixed(1)} ms por quadro\n` +
    (r.encontrado
      ? `Objeto em (${r.x.toFixed(0)}, ${r.y.toFixed(0)}), área ${r.area.toFixed(0)} px`
      : `Objeto não encontrado (${r.contornos} contornos)`)
}

// ---- gestos (TensorFlow.js) ----
const gestos = criarControleDeGestos({
  painel,
  canvasEntrada: canvasGesto,
  inputArquivo: document.querySelector('#arquivo-gestos'),
  elStatus: document.querySelector('#status-ia'),
  avisar: mostrarAviso,
  aoConfirmar: (gesto) => (gesto === 'sacar' ? jogo.sacar() : jogo.pausar()),
})

// ---- controle pelo mouse: o raio da câmera até o plano da raquete ----
const raycaster = new THREE.Raycaster()
const planoRaquete = new THREE.Plane(new THREE.Vector3(0, 0, 1), -Z_RAQUETE_JOGADOR)
const ponteiro = new THREE.Vector2()
const pontoNoPlano = new THREE.Vector3()
let alvoMouse = null

cena.renderer.domElement.addEventListener('pointermove', (e) => {
  const r = cena.renderer.domElement.getBoundingClientRect()
  ponteiro.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(ponteiro, cena.camera)
  if (raycaster.ray.intersectPlane(planoRaquete, pontoNoPlano)) {
    alvoMouse = { x: pontoNoPlano.x, y: pontoNoPlano.y }
  }
})

// ---- teclado: reserva para quando a câmera ou os gestos não estão prontos ----
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  if (e.code === 'Space') {
    e.preventDefault()
    jogo.sacar()
  } else if (e.code === 'KeyP') jogo.pausar()
  else if (e.code === 'KeyR') jogo.reiniciar()
})

painelJogo(painel, controle, { reiniciar: () => jogo.reiniciar() }, jogo.config)

// ---- telão no fundo do túnel: texturas dinâmicas com a saída do OpenCV ----
function texturaDoCanvas(canvas) {
  const textura = new THREE.CanvasTexture(canvas)
  textura.colorSpace = THREE.SRGBColorSpace
  return textura
}
const texturas = { camera: texturaDoCanvas(canvasCamera), mascara: texturaDoCanvas(canvasMascara) }
const opcoesCena = { telao: 'camera' }

// Bônus: o mesmo filtro HSV feito por um shader na GPU.
const filtroGPU = criarFiltroHSVNaGPU(captura.canvas)

function trocarTelao(modo) {
  if (modo === 'gpu') objetos.mostrarNoTelao(null, filtroGPU.material)
  else objetos.mostrarNoTelao(texturas[modo] ?? null)
}
trocarTelao(opcoesCena.telao)

painelCena(painel, opcoesCena, {
  trocarTelao,
  recentralizarCamera: () => cena.recentralizarCamera(),
})

// ---- comparação de desempenho: filtro HSV na CPU (OpenCV.js) × GPU (shader) ----
const resultadosComparacao = { cpu: '—', gpuComLeitura: '—', gpuShader: '—', concordancia: '—' }
const REPETICOES = 100

function compararCpuGpu() {
  if (!rastreador || !resultado) {
    mostrarAviso('Espere a câmera e o OpenCV.js ficarem prontos')
    return
  }
  filtroGPU.atualizarParametros(pdi)
  const cpu = rastreador.medirLimiarizacaoCPU(REPETICOES, pdi)
  const gpu = medirFiltroNaGPU(cena.renderer, filtroGPU, REPETICOES)
  const ms = (t) => `${t.toFixed(2)} ms`
  resultadosComparacao.cpu = ms(cpu.tempo)
  resultadosComparacao.gpuComLeitura = ms(gpu.comLeitura)
  resultadosComparacao.gpuShader = ms(gpu.soShader)
  resultadosComparacao.concordancia = `${(concordanciaDasMascaras(cpu.mascara, gpu.pixels) * 100).toFixed(2)}% dos pixels`
}

painelComparacao(painel, resultadosComparacao, { comparar: compararCpuGpu })

// ---- integração: centróide do objeto → posição da raquete ----
let alvoBruto = null // último centróide convertido para coordenadas do túnel
let alvoObjeto = null // o mesmo, suavizado no tempo

function alvoDaRaquete(dt) {
  if (controle.modo === 'mouse') return alvoMouse
  if (!alvoBruto) return null
  alvoObjeto = suavizar(alvoObjeto, alvoBruto, controle.suavizacao, dt)
  return alvoObjeto
}

/** Processa um quadro novo da câmera: OpenCV, entrada dos gestos e texturas. */
function processarImagem(imagem) {
  resultado = rastreador.processar(imagem, pdi)
  // objeto perdido: a raquete fica onde estava
  if (resultado.encontrado) alvoBruto = alvoDoObjeto(resultado.u, resultado.v, controle.sensibilidade)

  // entrada do classificador de gestos: zona da mão livre, sem o objeto
  const zona = retanguloDaZona(gestos.opcoes.zona, LARGURA_PROC, ALTURA_PROC)
  rastreador.prepararEntradaGesto(canvasGesto, zona, gestos.opcoes.apagarObjeto)
  rastreador.marcarZona(zona)

  rastreador.desenharVista(canvasCamera)
  rastreador.desenharMascara(canvasMascara)
  texturas.camera.needsUpdate = true
  texturas.mascara.needsUpdate = true
  if (opcoesCena.telao === 'gpu') {
    filtroGPU.atualizarParametros(pdi)
    filtroGPU.textura.needsUpdate = true
  }
}

function textoDoEstado(agora) {
  const gravando = gestos.mensagemDeGravacao(agora)
  if (gravando) return gravando
  switch (jogo.estado) {
    case ESTADO.SAQUE:
      return gestos.treinado
        ? 'Faça o gesto SACAR (ou aperte Espaço)'
        : 'Aperte Espaço para sacar — ou grave os gestos no painel'
    case ESTADO.PAUSADO:
      return 'Pausado — gesto SACAR continua'
    case ESTADO.FIM:
      return `${jogo.vencedor === 'jogador' ? 'Você venceu!' : 'A CPU venceu.'} Gesto SACAR para jogar de novo`
    default:
      return ''
  }
}

const relogio = new THREE.Timer()
relogio.connect(document) // evita um dt enorme quando a aba volta a ficar visível

function quadro(timestamp) {
  stats.begin()
  relogio.update(timestamp)
  const dt = relogio.getDelta()
  const tempo = relogio.getElapsed()

  const imagem = captura.capturar()
  if (imagem && rastreador) {
    processarImagem(imagem)
    gestos.processar(timestamp)
  } else if (imagem) {
    // OpenCV.js ainda carregando: mostra a câmera crua
    ctxCamera.drawImage(captura.canvas, 0, 0)
    texturas.camera.needsUpdate = true
  }
  atualizarStatusVisao(timestamp)
  gestos.atualizarStatus(timestamp)

  jogo.atualizar(dt, alvoDaRaquete(dt))
  objetos.aplicarEventos(jogo.consumirEventos())
  objetos.sincronizar(jogo, dt, tempo)

  const mensagem = textoDoEstado(timestamp)
  if (elMensagem.textContent !== mensagem) elMensagem.textContent = mensagem
  elMensagem.hidden = mensagem === ''

  cena.controls.update()
  cena.renderer.render(cena.scene, cena.camera)
  stats.end()
}

cena.renderer.setAnimationLoop(quadro)

// para inspeção e testes pelo console do navegador
window.rebote = {
  jogo, cena, captura, pdi, controle, gestos, ARENA,
  get resultado() { return resultado },
  get classificador() { return gestos.classificador },
  get predicao() { return gestos.predicao },
  get gravacao() { return gestos.gravacao },
}
