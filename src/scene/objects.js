// Objetos da cena controlados pelo estado do jogo (e, através dele, pelo
// processamento de imagem e pelos gestos).
import * as THREE from 'three'
import { ARENA, Z_RAQUETE_CPU, Z_RAQUETE_JOGADOR } from '../game/game.js'

const W = ARENA.largura
const H = ARENA.altura
const RECUO_FUNDO = 1.2 // distância entre a raquete da CPU e a parede do fundo
const Z_FUNDO = Z_RAQUETE_CPU - RECUO_FUNDO
const COMPRIMENTO = Z_RAQUETE_JOGADOR - Z_FUNDO

const COR_JOGADOR = 0x38e1ff
const COR_CPU = 0xff5a5f
const COR_BOLA = 0xffd34d

/** Textura procedural de grade: uma célula com borda clara, repetida. */
function criarTexturaGrade() {
  const tamanho = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = tamanho
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0d1430'
  ctx.fillRect(0, 0, tamanho, tamanho)
  ctx.strokeStyle = '#3b4f9a'
  ctx.lineWidth = 4
  ctx.strokeRect(0, 0, tamanho, tamanho)
  const textura = new THREE.CanvasTexture(canvas)
  textura.colorSpace = THREE.SRGBColorSpace
  textura.wrapS = textura.wrapT = THREE.RepeatWrapping
  textura.anisotropy = 8
  return textura
}

function criarParede(textura, largura, altura) {
  const mapa = textura.clone()
  mapa.repeat.set(largura, altura) // uma célula da grade por unidade
  mapa.needsUpdate = true
  const material = new THREE.MeshStandardMaterial({
    map: mapa,
    roughness: 0.85,
    metalness: 0.05,
  })
  const parede = new THREE.Mesh(new THREE.PlaneGeometry(largura, altura), material)
  parede.receiveShadow = true
  return parede
}

function criarRetangulo(cor, opacidade) {
  const pontos = [
    new THREE.Vector3(-W / 2, -H / 2, 0),
    new THREE.Vector3(W / 2, -H / 2, 0),
    new THREE.Vector3(W / 2, H / 2, 0),
    new THREE.Vector3(-W / 2, H / 2, 0),
  ]
  const geometria = new THREE.BufferGeometry().setFromPoints(pontos)
  const material = new THREE.LineBasicMaterial({ color: cor, transparent: true, opacity: opacidade })
  return new THREE.LineLoop(geometria, material)
}

function criarRaquete(cor, transparente) {
  const geometria = new THREE.BoxGeometry(ARENA.raqueteLargura, ARENA.raqueteAltura, 0.12)
  const material = transparente
    ? new THREE.MeshPhysicalMaterial({
        color: cor,
        emissive: cor,
        emissiveIntensity: 0.15,
        roughness: 0.15,
        metalness: 0,
        clearcoat: 1,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      })
    : new THREE.MeshStandardMaterial({
        color: cor,
        emissive: cor,
        emissiveIntensity: 0.15,
        roughness: 0.35,
        metalness: 0.3,
      })
  const raquete = new THREE.Mesh(geometria, material)
  raquete.castShadow = true
  const borda = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometria),
    new THREE.LineBasicMaterial({ color: cor }),
  )
  raquete.add(borda)
  return raquete
}

export function criarObjetos(scene) {
  const grupo = new THREE.Group()
  scene.add(grupo)

  // ---- túnel ----
  const grade = criarTexturaGrade()
  const zCentro = (Z_RAQUETE_JOGADOR + Z_FUNDO) / 2

  const chao = criarParede(grade, W, COMPRIMENTO)
  chao.rotation.x = -Math.PI / 2
  chao.position.set(0, -H / 2, zCentro)

  const teto = criarParede(grade, W, COMPRIMENTO)
  teto.rotation.x = Math.PI / 2
  teto.position.set(0, H / 2, zCentro)

  const esquerda = criarParede(grade, COMPRIMENTO, H)
  esquerda.rotation.y = Math.PI / 2
  esquerda.position.set(-W / 2, 0, zCentro)

  const direita = criarParede(grade, COMPRIMENTO, H)
  direita.rotation.y = -Math.PI / 2
  direita.position.set(W / 2, 0, zCentro)

  // Parede do fundo: depois recebe a imagem processada da webcam.
  const fundo = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ color: 0x0d1430, toneMapped: false }),
  )
  fundo.position.set(0, 0, Z_FUNDO)

  // Molduras fixas na boca e no fundo do túnel.
  const molduraBoca = criarRetangulo(COR_JOGADOR, 0.8)
  molduraBoca.position.z = Z_RAQUETE_JOGADOR
  const molduraFundo = criarRetangulo(COR_CPU, 0.8)
  molduraFundo.position.z = Z_RAQUETE_CPU

  grupo.add(chao, teto, esquerda, direita, fundo, molduraBoca, molduraFundo)

  // ---- bola ----
  const bola = new THREE.Mesh(
    new THREE.SphereGeometry(ARENA.raioBola, 32, 16),
    new THREE.MeshStandardMaterial({
      color: COR_BOLA,
      emissive: 0xffa000,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    }),
  )
  bola.castShadow = true
  // Luz 3: pontual, anda com a bola e ilumina as paredes por onde ela passa.
  const luzBola = new THREE.PointLight(0xffc04d, 6, 7, 2)
  bola.add(luzBola)
  grupo.add(bola)

  // Anel de profundidade: um contorno do túnel que acompanha o z da bola.
  // É o principal indício visual de onde a bola está no eixo da profundidade.
  const anel = criarRetangulo(COR_BOLA, 0.55)
  grupo.add(anel)

  // ---- raquetes ----
  const raqueteJogador = criarRaquete(COR_JOGADOR, true)
  raqueteJogador.position.z = Z_RAQUETE_JOGADOR
  const raqueteCpu = criarRaquete(COR_CPU, false)
  raqueteCpu.position.z = Z_RAQUETE_CPU
  grupo.add(raqueteJogador, raqueteCpu)

  // Mira: mostra, no plano da raquete do jogador, a posição x/y da bola.
  const mira = new THREE.Mesh(
    new THREE.RingGeometry(ARENA.raioBola * 0.8, ARENA.raioBola * 1.15, 32),
    new THREE.MeshBasicMaterial({ color: COR_BOLA, transparent: true, opacity: 0.75, depthWrite: false }),
  )
  mira.position.z = Z_RAQUETE_JOGADOR - 0.02
  grupo.add(mira)

  // ---- efeitos ----
  const brilho = { jogador: 0, cpu: 0, anel: 0 }

  function aplicarEventos(eventos) {
    for (const e of eventos) {
      if (e.tipo === 'rebatida') brilho[e.quem] = 1
      if (e.tipo === 'parede') brilho.anel = 1
    }
  }

  /** Copia o estado do jogo para os objetos 3D e anima os efeitos. */
  function sincronizar(jogo, dt, tempo) {
    const { pos } = jogo.bola
    bola.position.set(pos.x, pos.y, pos.z)
    bola.rotation.x += jogo.bola.vel.z * dt * 2
    bola.rotation.z -= jogo.bola.vel.x * dt * 2

    anel.position.z = pos.z
    mira.position.x = pos.x
    mira.position.y = pos.y
    mira.visible = jogo.bola.vel.z > 0

    raqueteJogador.position.x = jogo.jogador.x
    raqueteJogador.position.y = jogo.jogador.y
    raqueteCpu.position.x = jogo.cpu.x
    raqueteCpu.position.y = jogo.cpu.y

    // decaimento exponencial dos brilhos de impacto
    const decaimento = Math.exp(-dt * 6)
    brilho.jogador *= decaimento
    brilho.cpu *= decaimento
    brilho.anel *= decaimento
    raqueteJogador.material.emissiveIntensity = 0.15 + brilho.jogador * 1.5
    raqueteCpu.material.emissiveIntensity = 0.15 + brilho.cpu * 1.5
    anel.material.opacity = 0.45 + brilho.anel * 0.5

    // pulsação leve da bola e da luz que ela carrega
    const pulso = 0.5 + 0.5 * Math.sin(tempo * 6)
    bola.material.emissiveIntensity = 0.45 + pulso * 0.35
    luzBola.intensity = 5 + pulso * 2
  }

  return { grupo, fundo, bola, raqueteJogador, raqueteCpu, aplicarEventos, sincronizar }
}
