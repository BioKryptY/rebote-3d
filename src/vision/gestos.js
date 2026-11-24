// Gestos reconhecidos pelo classificador (ver model.js) e a zona da imagem
// que ele olha. Fica num arquivo separado e leve para a interface poder usar
// os nomes antes de o TensorFlow.js terminar de carregar.

export const GESTOS = ['neutro', 'sacar', 'pausar']

export const NOMES_GESTOS = { neutro: 'Neutro', sacar: 'Sacar', pausar: 'Pausar' }

// O classificador não olha a imagem inteira: o objeto colorido anda pela
// tela o tempo todo e, se entrasse na comparação, a posição dele pesaria mais
// que o gesto. Por isso ele olha só a zona da mão livre. Com a imagem
// espelhada, quem segura o objeto com a mão direita faz o gesto com a
// esquerda, que aparece no lado esquerdo da imagem.
export const ZONAS = {
  'Lado esquerdo da imagem': 'esquerda',
  'Lado direito da imagem': 'direita',
  'Imagem inteira': 'inteira',
}

/** Retângulo da zona do gesto, em pixels da imagem processada. */
export function retanguloDaZona(zona, largura, altura) {
  if (zona === 'inteira') return { x: 0, y: 0, w: largura, h: altura }
  const w = Math.round(largura * 0.45)
  const h = Math.round(altura * 0.85)
  return { x: zona === 'direita' ? largura - w : 0, y: 0, w, h }
}
