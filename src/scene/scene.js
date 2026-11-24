// Cena, câmera, luzes, renderer e controles de navegação.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ARENA } from '../game/game.js'

// Câmera atrás da raquete do jogador, um pouco acima, olhando para o fundo.
const POSICAO_INICIAL = new THREE.Vector3(0, 1.2, ARENA.profundidade / 2 + 7.5)
const ALVO_INICIAL = new THREE.Vector3(0, 0, 0)

export function criarCena(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x070b16)
  scene.fog = new THREE.Fog(0x070b16, 28, 60)

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    0.1,
    200,
  )
  camera.position.copy(POSICAO_INICIAL)

  // Controles de navegação: arrastar gira, roda do mouse aproxima,
  // botão direito desloca. O jogo continua funcionando de qualquer ângulo.
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(ALVO_INICIAL)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 4
  controls.maxDistance = 45
  controls.update()

  // Luz 1: hemisférica, ilumina tudo com um tom azulado de cima e arroxeado
  // de baixo, para nenhuma face ficar totalmente preta.
  const luzAmbiente = new THREE.HemisphereLight(0xa8c0ff, 0x3a2060, 1.6)
  scene.add(luzAmbiente)

  // Luz 2: direcional, de cima, projeta a sombra da bola e das raquetes
  // no chão do túnel, o que ajuda a perceber a profundidade.
  const luzPrincipal = new THREE.DirectionalLight(0xffffff, 1.8)
  luzPrincipal.position.set(2, 12, 4)
  luzPrincipal.castShadow = true
  luzPrincipal.shadow.mapSize.set(1024, 1024)
  const sombra = luzPrincipal.shadow.camera
  sombra.left = -ARENA.largura / 2 - 1
  sombra.right = ARENA.largura / 2 + 1
  sombra.top = ARENA.profundidade / 2 + 2
  sombra.bottom = -ARENA.profundidade / 2 - 2
  sombra.near = 1
  sombra.far = 30
  luzPrincipal.shadow.bias = -0.0005
  scene.add(luzPrincipal)
  scene.add(luzPrincipal.target)
  // (a terceira luz, pontual, anda junto com a bola: ver objects.js)

  function redimensionar() {
    const w = container.clientWidth
    const h = container.clientHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  window.addEventListener('resize', redimensionar)

  function recentralizarCamera() {
    camera.position.copy(POSICAO_INICIAL)
    controls.target.copy(ALVO_INICIAL)
    controls.update()
  }

  return { renderer, scene, camera, controls, luzAmbiente, luzPrincipal, recentralizarCamera }
}
