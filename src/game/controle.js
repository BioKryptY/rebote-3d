// Ponte entre o processamento de imagem e o jogo: transforma o centróide do
// objeto (coordenadas da imagem) em posição da raquete (coordenadas do túnel).
import { ARENA } from './game.js'

/**
 * @param {number} u posição horizontal do centróide, 0 (esquerda) a 1 (direita)
 * @param {number} v posição vertical do centróide, 0 (topo) a 1 (base)
 * @param {number} sensibilidade 1 = a imagem inteira cobre o túnel inteiro;
 *   valores maiores deixam alcançar as bordas sem levar o objeto até a borda
 *   da câmera, onde ele costuma sair do quadro.
 */
export function alvoDoObjeto(u, v, sensibilidade = 1) {
  return {
    x: (u - 0.5) * ARENA.largura * sensibilidade,
    // na imagem o y cresce para baixo; no túnel, para cima
    y: (0.5 - v) * ARENA.altura * sensibilidade,
  }
}

/**
 * Suavização temporal por média móvel exponencial. Tira o tremido do
 * centróide de um quadro para o outro, ao custo de um pequeno atraso.
 * O fator é corrigido pelo dt para o efeito ser o mesmo a 30 ou a 144 FPS.
 * @param {{x:number,y:number}|null} anterior
 * @param {{x:number,y:number}} novo
 * @param {number} fator 1 = sem suavização; perto de 0 = muito suave
 * @param {number} dt segundos desde o quadro anterior
 */
export function suavizar(anterior, novo, fator, dt) {
  if (!anterior) return { ...novo }
  const a = 1 - Math.pow(1 - Math.min(1, Math.max(0, fator)), dt * 60)
  return {
    x: anterior.x + (novo.x - anterior.x) * a,
    y: anterior.y + (novo.y - anterior.y) * a,
  }
}
