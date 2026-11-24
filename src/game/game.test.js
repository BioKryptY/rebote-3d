import { describe, expect, it } from 'vitest'
import { ARENA, ESTADO, Jogo, Z_RAQUETE_CPU, Z_RAQUETE_JOGADOR } from './game.js'

const DT = 1 / 60

/** Coloca a bola em jogo numa posição e velocidade conhecidas. */
function emJogo(jogo, pos, vel) {
  jogo.estado = ESTADO.JOGANDO
  jogo.bola.pos = { ...pos }
  jogo.bola.vel = { ...vel }
}

function rodar(jogo, segundos, alvo = null) {
  for (let t = 0; t < segundos; t += DT) jogo.atualizar(DT, alvo)
}

describe('saque', () => {
  it('começa esperando o saque, com a bola presa à raquete do jogador', () => {
    const jogo = new Jogo()
    expect(jogo.estado).toBe(ESTADO.SAQUE)
    jogo.atualizar(DT, { x: 1.5, y: -0.5 })
    expect(jogo.bola.pos.x).toBeCloseTo(1.5)
    expect(jogo.bola.pos.y).toBeCloseTo(-0.5)
    expect(jogo.bola.pos.z).toBeLessThan(Z_RAQUETE_JOGADOR)
  })

  it('sacar lança a bola em direção à CPU', () => {
    const jogo = new Jogo()
    jogo.sacar()
    expect(jogo.estado).toBe(ESTADO.JOGANDO)
    expect(jogo.bola.vel.z).toBeLessThan(0)
    const z0 = jogo.bola.pos.z
    jogo.atualizar(DT, null)
    expect(jogo.bola.pos.z).toBeLessThan(z0)
  })
})

describe('colisões com o túnel', () => {
  it('a bola reflete na parede direita e continua dentro do túnel', () => {
    const jogo = new Jogo()
    const maxX = ARENA.largura / 2 - ARENA.raioBola
    emJogo(jogo, { x: maxX - 0.05, y: 0, z: 0 }, { x: 6, y: 0, z: -2 })
    jogo.atualizar(DT, null)
    expect(jogo.bola.vel.x).toBeLessThan(0)
    expect(jogo.bola.pos.x).toBeLessThanOrEqual(maxX)
    expect(jogo.consumirEventos().some((e) => e.tipo === 'parede')).toBe(true)
  })

  it('a bola reflete no chão', () => {
    const jogo = new Jogo()
    const maxY = ARENA.altura / 2 - ARENA.raioBola
    emJogo(jogo, { x: 0, y: -maxY + 0.05, z: 0 }, { x: 0, y: -6, z: -2 })
    jogo.atualizar(DT, null)
    expect(jogo.bola.vel.y).toBeGreaterThan(0)
    expect(jogo.bola.pos.y).toBeGreaterThanOrEqual(-maxY)
  })
})

describe('rebatida', () => {
  it('a raquete do jogador devolve a bola e acelera', () => {
    const jogo = new Jogo()
    jogo.atualizar(DT, { x: 0, y: 0 })
    emJogo(jogo, { x: 0, y: 0, z: Z_RAQUETE_JOGADOR - 1 }, { x: 0, y: 0, z: 10 })
    rodar(jogo, 0.2, { x: 0, y: 0 })
    expect(jogo.bola.vel.z).toBeCloseTo(-10 * jogo.config.aceleracaoPorRebatida)
    expect(jogo.consumirEventos()).toContainEqual({ tipo: 'rebatida', quem: 'jogador' })
  })

  it('bater com a borda direita da raquete joga a bola para a direita', () => {
    const jogo = new Jogo()
    jogo.atualizar(DT, { x: 0, y: 0 })
    const borda = ARENA.raqueteLargura / 2 - 0.05
    emJogo(jogo, { x: borda, y: 0, z: Z_RAQUETE_JOGADOR - 1 }, { x: 0, y: 0, z: 10 })
    rodar(jogo, 0.15, { x: 0, y: 0 })
    expect(jogo.bola.vel.z).toBeLessThan(0)
    expect(jogo.bola.vel.x).toBeGreaterThan(0)
  })

  it('não atravessa a raquete mesmo na velocidade máxima', () => {
    const jogo = new Jogo()
    jogo.atualizar(DT, { x: 0, y: 0 })
    const v = jogo.config.velocidadeMaxima
    emJogo(jogo, { x: 0, y: 0, z: Z_RAQUETE_JOGADOR - 1 }, { x: 0, y: 0, z: v })
    // passo grande de propósito: 1/20 s a 24 u/s anda 1,2 u, mais que a bola
    jogo.atualizar(1 / 20, { x: 0, y: 0 })
    expect(jogo.bola.vel.z).toBeLessThan(0)
    expect(jogo.placar.cpu).toBe(0)
  })
})

describe('pontuação', () => {
  it('se o jogador erra, a CPU marca e volta para o saque', () => {
    const jogo = new Jogo()
    jogo.atualizar(DT, { x: -3, y: 0 }) // raquete longe da bola
    emJogo(jogo, { x: 3, y: 0, z: Z_RAQUETE_JOGADOR - 1 }, { x: 0, y: 0, z: 10 })
    rodar(jogo, 0.5, { x: -3, y: 0 })
    expect(jogo.placar).toEqual({ jogador: 0, cpu: 1 })
    expect(jogo.estado).toBe(ESTADO.SAQUE)
  })

  it('se a CPU não alcança a bola, o jogador marca', () => {
    const jogo = new Jogo({ velocidadeCpu: 0 })
    jogo.cpu = { x: -3, y: 0 }
    emJogo(jogo, { x: 3, y: 1.5, z: Z_RAQUETE_CPU + 1 }, { x: 0, y: 0, z: -10 })
    rodar(jogo, 0.5)
    expect(jogo.placar).toEqual({ jogador: 1, cpu: 0 })
  })

  it('a partida termina ao atingir os pontos para vencer e sacar recomeça', () => {
    const jogo = new Jogo({ pontosParaVencer: 1, velocidadeCpu: 0 })
    jogo.cpu = { x: -3, y: 0 }
    emJogo(jogo, { x: 3, y: 0, z: Z_RAQUETE_CPU + 1 }, { x: 0, y: 0, z: -10 })
    rodar(jogo, 0.5)
    expect(jogo.estado).toBe(ESTADO.FIM)
    expect(jogo.vencedor).toBe('jogador')
    jogo.sacar()
    expect(jogo.estado).toBe(ESTADO.SAQUE)
    expect(jogo.placar).toEqual({ jogador: 0, cpu: 0 })
  })
})

describe('pausa e limites', () => {
  it('pausar congela a bola e sacar retoma', () => {
    const jogo = new Jogo()
    jogo.sacar()
    jogo.atualizar(DT, null)
    jogo.pausar()
    expect(jogo.estado).toBe(ESTADO.PAUSADO)
    const z = jogo.bola.pos.z
    rodar(jogo, 0.5)
    expect(jogo.bola.pos.z).toBe(z)
    jogo.sacar()
    expect(jogo.estado).toBe(ESTADO.JOGANDO)
  })

  it('pausar durante o saque não faz nada', () => {
    const jogo = new Jogo()
    jogo.pausar()
    expect(jogo.estado).toBe(ESTADO.SAQUE)
  })

  it('a raquete do jogador não sai do túnel', () => {
    const jogo = new Jogo()
    jogo.atualizar(DT, { x: 100, y: -100 })
    expect(jogo.jogador.x).toBeCloseTo(ARENA.largura / 2 - ARENA.raqueteLargura / 2)
    expect(jogo.jogador.y).toBeCloseTo(-(ARENA.altura / 2 - ARENA.raqueteAltura / 2))
  })
})
