// Lógica do jogo, sem nenhuma dependência de Three.js, OpenCV ou TensorFlow.
// Assim ela pode ser testada isoladamente (ver game.test.js) e a cena 3D só
// lê o estado daqui para posicionar os objetos.
//
// Sistema de coordenadas (o mesmo da cena):
//   x: esquerda (-) / direita (+)
//   y: baixo (-) / cima (+)
//   z: fundo do túnel, onde fica a CPU (-) / boca do túnel, onde fica o jogador (+)

export const ARENA = Object.freeze({
  largura: 8,
  altura: 5,
  profundidade: 18,
  raqueteLargura: 1.8,
  raqueteAltura: 1.3,
  raioBola: 0.28,
})

export const ESTADO = Object.freeze({
  SAQUE: 'saque',
  JOGANDO: 'jogando',
  PAUSADO: 'pausado',
  FIM: 'fim',
})

export const CONFIG_PADRAO = Object.freeze({
  pontosParaVencer: 5,
  velocidadeInicial: 9, // unidades por segundo, no eixo z
  aceleracaoPorRebatida: 1.06,
  velocidadeMaxima: 24,
  efeito: 5, // quanto o ponto de contato na raquete desvia a bola
  velocidadeCpu: 5.5, // velocidade máxima da raquete da CPU
  // distância além do plano da raquete em que a bola conta como perdida
  margemPonto: 0.8,
})

const Z_JOGADOR = ARENA.profundidade / 2
const Z_CPU = -ARENA.profundidade / 2

export function limitar(valor, min, max) {
  return Math.min(max, Math.max(min, valor))
}

export class Jogo {
  constructor(config = {}) {
    this.config = { ...CONFIG_PADRAO, ...config }
    this.jogador = { x: 0, y: 0 }
    this.cpu = { x: 0, y: 0 }
    this.bola = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } }
    this.placar = { jogador: 0, cpu: 0 }
    this.vencedor = null
    this.rebatidas = 0
    this.eventos = []
    this.estado = ESTADO.SAQUE
    this.#prenderBolaNoJogador()
  }

  // ---- comandos (gestos, teclado) ----

  /** Gesto "sacar": lança a bola, retoma a pausa ou começa uma nova partida. */
  sacar() {
    if (this.estado === ESTADO.SAQUE) {
      const v = this.config.velocidadeInicial
      // pequeno desvio aleatório para a bola não ir sempre reta
      this.bola.vel = {
        x: (Math.random() - 0.5) * 0.3 * v,
        y: (Math.random() - 0.5) * 0.2 * v,
        z: -v,
      }
      this.estado = ESTADO.JOGANDO
      this.eventos.push({ tipo: 'saque' })
    } else if (this.estado === ESTADO.PAUSADO) {
      this.estado = ESTADO.JOGANDO
      this.eventos.push({ tipo: 'retomar' })
    } else if (this.estado === ESTADO.FIM) {
      this.reiniciar()
    }
  }

  /** Gesto "pausar": só tem efeito com a bola em jogo. */
  pausar() {
    if (this.estado === ESTADO.JOGANDO) {
      this.estado = ESTADO.PAUSADO
      this.eventos.push({ tipo: 'pausa' })
    }
  }

  reiniciar() {
    this.placar = { jogador: 0, cpu: 0 }
    this.vencedor = null
    this.rebatidas = 0
    this.estado = ESTADO.SAQUE
    this.#prenderBolaNoJogador()
    this.eventos.push({ tipo: 'reinicio' })
  }

  /** Devolve e esvazia a fila de eventos (usada pela cena para efeitos). */
  consumirEventos() {
    const eventos = this.eventos
    this.eventos = []
    return eventos
  }

  // ---- simulação ----

  /**
   * Avança a simulação.
   * @param {number} dt segundos desde o último quadro
   * @param {{x:number,y:number}|null} alvo posição desejada da raquete do
   *   jogador, em coordenadas do mundo (vem do rastreamento ou do mouse)
   */
  atualizar(dt, alvo) {
    dt = limitar(dt, 0, 1 / 20) // evita saltos quando a aba perde o foco

    if (alvo) this.#moverJogador(alvo)

    if (this.estado === ESTADO.PAUSADO || this.estado === ESTADO.FIM) return

    this.#moverCpu(dt)

    if (this.estado === ESTADO.SAQUE) {
      this.#prenderBolaNoJogador()
      return
    }

    // Subpassos: a cada passo a bola anda no máximo meio raio, o que impede
    // que ela "atravesse" uma raquete quando está muito rápida.
    const vel = this.bola.vel
    const rapidez = Math.hypot(vel.x, vel.y, vel.z)
    const passos = Math.max(1, Math.ceil((rapidez * dt) / (ARENA.raioBola * 0.5)))
    const h = dt / passos
    for (let i = 0; i < passos && this.estado === ESTADO.JOGANDO; i++) {
      this.#passo(h)
    }
  }

  #moverJogador(alvo) {
    const maxX = ARENA.largura / 2 - ARENA.raqueteLargura / 2
    const maxY = ARENA.altura / 2 - ARENA.raqueteAltura / 2
    this.jogador.x = limitar(alvo.x, -maxX, maxX)
    this.jogador.y = limitar(alvo.y, -maxY, maxY)
  }

  #moverCpu(dt) {
    // A CPU persegue a bola quando ela vem na sua direção e volta devagar ao
    // centro quando a bola se afasta. A velocidade limitada é o que a faz errar.
    const vindo = this.estado === ESTADO.JOGANDO && this.bola.vel.z < 0
    const alvoX = vindo ? this.bola.pos.x : 0
    const alvoY = vindo ? this.bola.pos.y : 0
    const dx = alvoX - this.cpu.x
    const dy = alvoY - this.cpu.y
    const dist = Math.hypot(dx, dy)
    const passoMax = this.config.velocidadeCpu * dt * (vindo ? 1 : 0.4)
    if (dist > 1e-6) {
      const k = Math.min(1, passoMax / dist)
      this.cpu.x += dx * k
      this.cpu.y += dy * k
    }
    const maxX = ARENA.largura / 2 - ARENA.raqueteLargura / 2
    const maxY = ARENA.altura / 2 - ARENA.raqueteAltura / 2
    this.cpu.x = limitar(this.cpu.x, -maxX, maxX)
    this.cpu.y = limitar(this.cpu.y, -maxY, maxY)
  }

  #prenderBolaNoJogador() {
    this.bola.pos = {
      x: this.jogador.x,
      y: this.jogador.y,
      z: Z_JOGADOR - ARENA.raioBola - 0.15,
    }
    this.bola.vel = { x: 0, y: 0, z: 0 }
  }

  #passo(h) {
    const { pos, vel } = this.bola
    const r = ARENA.raioBola
    pos.x += vel.x * h
    pos.y += vel.y * h
    pos.z += vel.z * h

    // paredes laterais, chão e teto: reflexão especular
    const maxX = ARENA.largura / 2 - r
    const maxY = ARENA.altura / 2 - r
    if (pos.x > maxX || pos.x < -maxX) {
      pos.x = limitar(2 * Math.sign(pos.x) * maxX - pos.x, -maxX, maxX)
      vel.x = -vel.x
      this.eventos.push({ tipo: 'parede' })
    }
    if (pos.y > maxY || pos.y < -maxY) {
      pos.y = limitar(2 * Math.sign(pos.y) * maxY - pos.y, -maxY, maxY)
      vel.y = -vel.y
      this.eventos.push({ tipo: 'parede' })
    }

    // raquete do jogador (boca do túnel)
    if (vel.z > 0 && pos.z + r >= Z_JOGADOR && pos.z - r <= Z_JOGADOR) {
      if (this.#encostaNaRaquete(this.jogador)) {
        pos.z = Z_JOGADOR - r
        this.#rebater(this.jogador, -1)
        this.eventos.push({ tipo: 'rebatida', quem: 'jogador' })
      }
    }
    // raquete da CPU (fundo do túnel)
    if (vel.z < 0 && pos.z - r <= Z_CPU && pos.z + r >= Z_CPU) {
      if (this.#encostaNaRaquete(this.cpu)) {
        pos.z = Z_CPU + r
        this.#rebater(this.cpu, +1)
        this.eventos.push({ tipo: 'rebatida', quem: 'cpu' })
      }
    }

    // bola passou da raquete: ponto do adversário
    if (pos.z - r > Z_JOGADOR + this.config.margemPonto) this.#ponto('cpu')
    else if (pos.z + r < Z_CPU - this.config.margemPonto) this.#ponto('jogador')
  }

  #encostaNaRaquete(raquete) {
    const { pos } = this.bola
    const r = ARENA.raioBola
    return (
      Math.abs(pos.x - raquete.x) <= ARENA.raqueteLargura / 2 + r &&
      Math.abs(pos.y - raquete.y) <= ARENA.raqueteAltura / 2 + r
    )
  }

  /** Inverte o z, acelera e aplica efeito conforme o ponto de contato. */
  #rebater(raquete, sentidoZ) {
    const { pos, vel } = this.bola
    const c = this.config
    const rapidezZ = Math.min(Math.abs(vel.z) * c.aceleracaoPorRebatida, c.velocidadeMaxima)
    vel.z = sentidoZ * rapidezZ

    // -1 na borda esquerda/baixo da raquete, +1 na direita/cima
    const offX = limitar((pos.x - raquete.x) / (ARENA.raqueteLargura / 2), -1, 1)
    const offY = limitar((pos.y - raquete.y) / (ARENA.raqueteAltura / 2), -1, 1)
    vel.x += offX * c.efeito
    vel.y += offY * c.efeito

    // a bola nunca anda mais de lado do que para a frente
    const maxLateral = 0.8 * rapidezZ
    vel.x = limitar(vel.x, -maxLateral, maxLateral)
    vel.y = limitar(vel.y, -maxLateral, maxLateral)
    this.rebatidas++
  }

  #ponto(quem) {
    this.placar[quem]++
    this.eventos.push({ tipo: 'ponto', quem })
    if (this.placar[quem] >= this.config.pontosParaVencer) {
      this.vencedor = quem
      this.estado = ESTADO.FIM
      this.eventos.push({ tipo: 'vitoria', quem })
    } else {
      this.estado = ESTADO.SAQUE
    }
    this.#prenderBolaNoJogador()
  }
}

export const Z_RAQUETE_JOGADOR = Z_JOGADOR
export const Z_RAQUETE_CPU = Z_CPU
