// Inicialização e loop principal.
import './style.css'
import * as THREE from 'three'
import { ARENA, ESTADO, Jogo, Z_RAQUETE_JOGADOR } from './game/game.js'
import { alvoDoObjeto, suavizar } from './game/controle.js'
import { ALTURA_PROC, Captura, LARGURA_PROC } from './capture.js'
import { criarCena } from './scene/scene.js'
import { criarObjetos } from './scene/objects.js'
import { concordanciaDasMascaras, criarFiltroHSVNaGPU, medirFiltroNaGPU } from './scene/gpuFiltro.js'
import {
  criarPainel,
  criarStats,
  painelCaptura,
  painelCena,
  painelComparacao,
  painelGestos,
  painelJogo,
  painelPDI,
} from './ui.js'
import { ConfirmadorDeGesto, GESTOS, NOMES_GESTOS, retanguloDaZona, ZONAS } from './vision/gestos.js'
import { calibrarPorAmostra, PDI_PADRAO } from './vision/hsv.js'
import { desserializar, serializar } from './vision/persistencia.js'
import { carregarOpenCV, RastreadorDeCor } from './vision/opencv.js'

const app = document.querySelector('#app')
const elMensagem = document.querySelector('#mensagem')
const elAviso = document.querySelector('#aviso')
const elStatusCaptura = document.querySelector('#status-captura')
const elStatusVisao = document.querySelector('#status-visao')
const elStatusIA = document.querySelector('#status-ia')
const canvasCamera = document.querySelector('#canvas-camera')
const canvasMascara = document.querySelector('#canvas-mascara')
const canvasGesto = document.querySelector('#canvas-gesto')
const ctxCamera = canvasCamera.getContext('2d')
const inputVideo = document.querySelector('#arquivo-video')
const inputGestos = document.querySelector('#arquivo-gestos')

const cena = criarCena(app)
const objetos = criarObjetos(cena.scene)
const jogo = new Jogo()
const stats = criarStats()
const painel = criarPainel()

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
carregarOpenCV()
  .then(({ cv }) => {
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

// ---- gestos (TensorFlow.js: MobileNet + KNN treinado no navegador) ----
const QUADROS_POR_GRAVACAO = 30
const ESPERA_ANTES_DE_GRAVAR_MS = 2000 // tempo para soltar o mouse e fazer o gesto
const opcoesGestos = {
  k: 5,
  inferirACada: 3,
  zona: 'esquerda',
  apagarObjeto: true,
  confiancaMinima: 0.8,
  confirmacoes: 3,
  intervaloMs: 800,
}
const infoGestos = { exemplos: 'carregando…' }
const confirmador = new ConfirmadorDeGesto()
let classificador = null
let predicao = null
let inferindo = false
let quadrosDesdeInferencia = 0
let tempoIA = 0
let gravacao = null // { gesto, comecaEm, restantes }

function atualizarContagem() {
  const c = classificador.contagem()
  infoGestos.exemplos = GESTOS.map((g) => `${NOMES_GESTOS[g]} ${c[g]}`).join(' · ')
}

// Os exemplos ficam salvos no navegador (localStorage): recarregar a página
// não obriga a treinar de novo. Exportar/importar leva o treino para outro
// computador. localStorage pode estar bloqueado (aba anônima, política do
// navegador), por isso tudo fica em try/catch e o jogo funciona sem ele.
const CHAVE_EXEMPLOS = 'rebote3d.gestos.v1'

function exemplosEmJSON() {
  return serializar(classificador.exemplos(), opcoesGestos)
}

function aplicarExemplos(dados) {
  classificador.carregarExemplos(dados.classes)
  opcoesGestos.zona = dados.zona
  opcoesGestos.apagarObjeto = dados.apagarObjeto
  predicao = null
  atualizarContagem()
}

function salvarNoNavegador() {
  try {
    localStorage.setItem(CHAVE_EXEMPLOS, JSON.stringify(exemplosEmJSON()))
  } catch {
    mostrarAviso('Não deu para salvar os exemplos neste navegador')
  }
}

function carregarDoNavegador() {
  try {
    const texto = localStorage.getItem(CHAVE_EXEMPLOS)
    if (!texto) return false
    aplicarExemplos(desserializar(JSON.parse(texto)))
    return true
  } catch {
    return false
  }
}

function exportarExemplos() {
  if (!classificador?.treinado) {
    mostrarAviso('Grave os gestos antes de exportar')
    return
  }
  const blob = new Blob([JSON.stringify(exemplosEmJSON())], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'rebote3d-gestos.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

inputGestos.addEventListener('change', async () => {
  const arquivo = inputGestos.files?.[0]
  inputGestos.value = ''
  if (!arquivo || !classificador) return
  try {
    if (arquivo.size > 20 * 1024 * 1024) throw new Error('arquivo grande demais')
    aplicarExemplos(desserializar(JSON.parse(await arquivo.text())))
    salvarNoNavegador()
    mostrarAviso('Exemplos importados')
  } catch (erro) {
    mostrarAviso(`Não foi possível importar: ${erro.message}`, 4000)
  }
})

painelGestos(
  painel,
  infoGestos,
  opcoesGestos,
  {
    gravar: (gesto) => {
      if (!classificador) return
      gravacao = { gesto, comecaEm: performance.now() + ESPERA_ANTES_DE_GRAVAR_MS, restantes: QUADROS_POR_GRAVACAO }
    },
    apagar: () => {
      if (!classificador) return
      classificador.limpar()
      predicao = null
      atualizarContagem()
      try {
        localStorage.removeItem(CHAVE_EXEMPLOS)
      } catch {
        // sem localStorage não há o que apagar
      }
    },
    exportar: exportarExemplos,
    importar: () => inputGestos.click(),
  },
  GESTOS,
  NOMES_GESTOS,
  ZONAS,
)

// O TensorFlow.js também é carregado à parte, para a cena aparecer antes.
elStatusIA.textContent = 'Carregando TensorFlow.js e MobileNet…'
import('./vision/model.js')
  .then(async ({ ClassificadorDeGestos }) => {
    const c = new ClassificadorDeGestos()
    await c.carregar(import.meta.env.BASE_URL)
    classificador = c
    const recuperou = carregarDoNavegador()
    atualizarContagem()
    elStatusIA.textContent = recuperou
      ? `MobileNet pronta (backend ${c.backend}). Exemplos recuperados do navegador.`
      : `MobileNet pronta (backend ${c.backend}). Grave os gestos no painel.`
  })
  .catch((erro) => {
    elStatusIA.textContent = `Falha ao carregar o TensorFlow.js (${erro.message}).`
  })

/** Grava exemplos (durante uma gravação) ou classifica o quadro atual. */
function processarGestos(quadroNovo, agora) {
  if (!classificador || !quadroNovo || !rastreador) return
  if (gravacao) {
    if (agora < gravacao.comecaEm) return
    classificador.adicionarExemplo(canvasGesto, gravacao.gesto)
    gravacao.restantes--
    if (gravacao.restantes === 0) {
      gravacao = null
      atualizarContagem()
      salvarNoNavegador()
    }
    return
  }
  // A inferência é assíncrona e roda só a cada N quadros novos: a renderização
  // não espera por ela e o FPS do jogo não cai.
  quadrosDesdeInferencia++
  if (inferindo || quadrosDesdeInferencia < opcoesGestos.inferirACada || !classificador.treinado) return
  quadrosDesdeInferencia = 0
  inferindo = true
  const inicio = performance.now()
  classificador
    .classificar(canvasGesto, opcoesGestos.k)
    .then((r) => {
      predicao = r
      tempoIA = performance.now() - inicio
      executarComando(confirmador.registrar(r, opcoesGestos, performance.now()))
    })
    .finally(() => (inferindo = false))
}

/** Gesto confirmado → comando do jogo. */
function executarComando(gesto) {
  if (gesto === 'sacar') jogo.sacar()
  else if (gesto === 'pausar') jogo.pausar()
  else return
  mostrarAviso(`Gesto ${NOMES_GESTOS[gesto].toUpperCase()} reconhecido`)
}

let temporizadorAviso = 0
function mostrarAviso(texto, duracaoMs = 1200) {
  elAviso.textContent = texto
  elAviso.hidden = false
  clearTimeout(temporizadorAviso)
  temporizadorAviso = setTimeout(() => (elAviso.hidden = true), duracaoMs)
}

let proximaAtualizacaoIA = 0
function atualizarStatusIA(agora) {
  if (!classificador || agora < proximaAtualizacaoIA) return
  proximaAtualizacaoIA = agora + 250
  const tensores = `${classificador.tensores()} tensores na memória`
  if (!classificador.treinado) {
    elStatusIA.textContent = `Grave exemplos de pelo menos dois gestos.\n${tensores}`
    return
  }
  const gesto = predicao ? `${NOMES_GESTOS[predicao.gesto]} (${Math.round(predicao.confianca * 100)}%)` : '—'
  elStatusIA.textContent = `Gesto: ${gesto}\nTensorFlow.js: ${tempoIA.toFixed(0)} ms · ${tensores}`
}

// ---- integração: centróide do objeto → posição da raquete ----
let alvoBruto = null // último centróide convertido para coordenadas do túnel
let alvoObjeto = null // o mesmo, suavizado no tempo

function alvoDaRaquete(dt) {
  if (controle.modo === 'mouse') return alvoMouse
  if (!alvoBruto) return null
  alvoObjeto = suavizar(alvoObjeto, alvoBruto, controle.suavizacao, dt)
  return alvoObjeto
}

function textoDoEstado(agora) {
  if (gravacao) {
    const nome = NOMES_GESTOS[gravacao.gesto].toUpperCase()
    if (agora < gravacao.comecaEm) {
      return `Prepare o gesto ${nome}: gravando em ${Math.ceil((gravacao.comecaEm - agora) / 1000)} s`
    }
    return `Gravando ${nome}: ${QUADROS_POR_GRAVACAO - gravacao.restantes}/${QUADROS_POR_GRAVACAO} — mexa um pouco a mão`
  }
  switch (jogo.estado) {
    case ESTADO.SAQUE:
      return classificador?.treinado
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
    resultado = rastreador.processar(imagem, pdi)
    // objeto perdido: a raquete fica onde estava
    if (resultado.encontrado) alvoBruto = alvoDoObjeto(resultado.u, resultado.v, controle.sensibilidade)
    // entrada do classificador de gestos: zona da mão livre, sem o objeto
    const zona = retanguloDaZona(opcoesGestos.zona, LARGURA_PROC, ALTURA_PROC)
    rastreador.prepararEntradaGesto(canvasGesto, zona, opcoesGestos.apagarObjeto)
    rastreador.marcarZona(zona)
    rastreador.desenharVista(canvasCamera)
    rastreador.desenharMascara(canvasMascara)
    texturas.camera.needsUpdate = true
    texturas.mascara.needsUpdate = true
    if (opcoesCena.telao === 'gpu') {
      filtroGPU.atualizarParametros(pdi)
      filtroGPU.textura.needsUpdate = true
    }
  } else if (imagem) {
    ctxCamera.drawImage(captura.canvas, 0, 0)
    texturas.camera.needsUpdate = true
  }
  atualizarStatusVisao(timestamp)
  processarGestos(imagem !== null, timestamp)
  atualizarStatusIA(timestamp)

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

// usado nos testes manuais pelo console do navegador
window.rebote = {
  jogo, cena, captura, pdi, controle, opcoesGestos, ARENA,
  get resultado() { return resultado },
  get classificador() { return classificador },
  get predicao() { return predicao },
  get gravacao() { return gravacao },
}
