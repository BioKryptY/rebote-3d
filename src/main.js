// Inicialização e loop principal.
import './style.css'
import * as THREE from 'three'
import { ARENA, ESTADO, Jogo, Z_RAQUETE_JOGADOR } from './game/game.js'
import { Captura } from './capture.js'
import { criarCena } from './scene/scene.js'
import { criarObjetos } from './scene/objects.js'
import { criarPainel, criarStats, painelCaptura } from './ui.js'

const app = document.querySelector('#app')
const elMensagem = document.querySelector('#mensagem')
const elStatusVisao = document.querySelector('#status-visao')
const canvasCamera = document.querySelector('#canvas-camera')
const ctxCamera = canvasCamera.getContext('2d')
const inputVideo = document.querySelector('#arquivo-video')

const cena = criarCena(app)
const objetos = criarObjetos(cena.scene)
const jogo = new Jogo()
const stats = criarStats()
const painel = criarPainel()

// ---- captura (webcam ou arquivo de vídeo) ----
const captura = new Captura(document.querySelector('#video'))
const estadoCaptura = { fonte: 'webcam', espelhar: true }

async function ligarWebcam() {
  elStatusVisao.textContent = 'Pedindo permissão para usar a câmera…'
  try {
    await captura.iniciarWebcam()
    estadoCaptura.fonte = 'webcam'
    estadoCaptura.espelhar = captura.espelhar
    elStatusVisao.textContent = 'Câmera ligada.'
  } catch (erro) {
    estadoCaptura.fonte = 'nenhuma'
    elStatusVisao.textContent =
      `Câmera indisponível (${erro.message || erro.name}).\n` +
      'Abra um arquivo de vídeo no painel ou jogue com o mouse.'
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
    elStatusVisao.textContent = `Vídeo: ${arquivo.name}`
  } catch (erro) {
    elStatusVisao.textContent = `Não foi possível abrir o vídeo (${erro.message}).`
  }
})

painelCaptura(painel, estadoCaptura, {
  trocarFonte: (fonte) => (fonte === 'webcam' ? ligarWebcam() : inputVideo.click()),
  abrirVideo: () => inputVideo.click(),
  espelhar: (valor) => (captura.espelhar = valor),
})

ligarWebcam()

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

function textoDoEstado() {
  switch (jogo.estado) {
    case ESTADO.SAQUE:
      return 'Faça o gesto SACAR (ou aperte Espaço)'
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

  if (captura.capturar()) ctxCamera.drawImage(captura.canvas, 0, 0)

  jogo.atualizar(dt, alvoMouse)
  objetos.aplicarEventos(jogo.consumirEventos())
  objetos.sincronizar(jogo, dt, tempo)

  const mensagem = textoDoEstado()
  if (elMensagem.textContent !== mensagem) elMensagem.textContent = mensagem
  elMensagem.hidden = mensagem === ''

  cena.controls.update()
  cena.renderer.render(cena.scene, cena.camera)
  stats.end()
}

cena.renderer.setAnimationLoop(quadro)

// usado nos testes manuais pelo console do navegador
window.rebote = { jogo, cena, captura, ARENA }
