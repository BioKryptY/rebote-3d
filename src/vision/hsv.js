// Funções puras sobre o espaço de cor HSV, na convenção do OpenCV:
//   H (matiz) de 0 a 179 — o ângulo de 0° a 358° dividido por 2
//   S (saturação) e V (valor/brilho) de 0 a 255

export const H_MAX = 179

/** Parâmetros iniciais do processamento: calibrados para um objeto verde. */
export const PDI_PADRAO = Object.freeze({
  suavizacao: 'gaussiano', // 'nenhuma' | 'gaussiano' | 'mediana'
  kernelSuavizacao: 5,
  equalizar: false, // equalização do histograma do canal V
  hMin: 35,
  hMax: 85,
  sMin: 80,
  sMax: 255,
  vMin: 60,
  vMax: 255,
  abertura: 5, // tamanho do elemento estruturante da abertura (0 = desligada)
  fechamento: 7, // idem para o fechamento
  areaMinima: 150, // em pixels da imagem 320×240
})

/**
 * Faixas de matiz a testar. O vermelho fica nas duas pontas do círculo de
 * cores (perto de 0 e de 179); quando hMin > hMax a faixa "dá a volta" e vira
 * duas: [0, hMax] e [hMin, 179].
 */
export function faixasDeMatiz(hMin, hMax) {
  if (hMin <= hMax) return [[hMin, hMax]]
  return [
    [0, hMax],
    [hMin, H_MAX],
  ]
}

/** Tamanho de kernel válido para o OpenCV: ímpar e no mínimo 1. */
export function kernelImpar(n) {
  const k = Math.max(1, Math.round(n))
  return k % 2 === 1 ? k : k + 1
}

/**
 * Média de várias amostras HSV. A matiz é um ângulo, então a média é circular:
 * a média de 175 e 5 tem que dar 0 (vermelho), não 90 (verde).
 * @param {Array<[number, number, number]>} amostras
 */
export function mediaHSV(amostras) {
  let somaCos = 0
  let somaSen = 0
  let somaS = 0
  let somaV = 0
  for (const [h, s, v] of amostras) {
    const angulo = (h / (H_MAX + 1)) * 2 * Math.PI
    somaCos += Math.cos(angulo)
    somaSen += Math.sin(angulo)
    somaS += s
    somaV += v
  }
  const n = amostras.length
  let angulo = Math.atan2(somaSen, somaCos)
  if (angulo < 0) angulo += 2 * Math.PI
  const h = Math.round((angulo / (2 * Math.PI)) * (H_MAX + 1)) % (H_MAX + 1)
  return { h, s: Math.round(somaS / n), v: Math.round(somaV / n) }
}

/**
 * Limite inferior de S ou V: um pouco abaixo do valor amostrado, para aguentar
 * sombra e reflexo. Há um piso para não aceitar pixels quase cinzas/pretos,
 * mas o piso nunca passa da metade da própria amostra — senão um objeto
 * escuro (comum com a equalização ligada) ficaria fora da própria faixa.
 */
function limiteInferior(valor, folga, piso) {
  return Math.max(Math.min(piso, Math.floor(valor / 2)), Math.min(valor - folga, 200))
}

/**
 * Faixa de limiarização a partir da cor clicada pelo usuário: ±tolerância na
 * matiz (dando a volta se precisar) e saturação/brilho a partir de um pouco
 * abaixo do valor amostrado.
 */
export function calibrarPorAmostra({ h, s, v }, tolerancia = 12) {
  const volta = H_MAX + 1
  return {
    hMin: (h - tolerancia + volta) % volta,
    hMax: (h + tolerancia) % volta,
    sMin: limiteInferior(s, 70, 40),
    sMax: 255,
    vMin: limiteInferior(v, 80, 30),
    vMax: 255,
  }
}
