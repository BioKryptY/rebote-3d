// Bônus: o mesmo filtro de PDI das etapas 2 e 4 do OpenCV (conversão RGB→HSV
// e limiarização por faixa) escrito como shader, rodando na GPU, um pixel
// por vez em paralelo. Serve para mostrar no telão e para comparar o tempo
// com o OpenCV.js, que roda na CPU (WebAssembly).
import * as THREE from 'three'
import { ALTURA_PROC, LARGURA_PROC } from '../capture.js'

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D mapa;
  uniform float hMin, hMax, sMin, sMax, vMin, vMax;
  uniform vec3 corDentro;
  uniform vec3 corFora;
  varying vec2 vUv;

  // Mesma convenção do cv.cvtColor(..., COLOR_RGB2HSV) para imagens de 8 bits:
  // H de 0 a 180 (graus / 2), S e V de 0 a 255.
  vec3 rgbParaHsv(vec3 c) {
    float v = max(c.r, max(c.g, c.b));
    float minimo = min(c.r, min(c.g, c.b));
    float delta = v - minimo;
    float s = v > 0.0 ? delta / v : 0.0;
    float h = 0.0;
    if (delta > 0.0) {
      if (v == c.r) h = 60.0 * (c.g - c.b) / delta;
      else if (v == c.g) h = 120.0 + 60.0 * (c.b - c.r) / delta;
      else h = 240.0 + 60.0 * (c.r - c.g) / delta;
      if (h < 0.0) h += 360.0;
    }
    return vec3(h / 2.0, s * 255.0, v * 255.0);
  }

  void main() {
    vec3 hsv = rgbParaHsv(texture2D(mapa, vUv).rgb);
    // faixa de matiz que "dá a volta" no vermelho, como no OpenCV
    bool matizOk = hMin <= hMax
      ? (hsv.x >= hMin && hsv.x <= hMax + 0.5)
      : (hsv.x >= hMin || hsv.x <= hMax + 0.5);
    bool dentro = matizOk
      && hsv.y >= sMin && hsv.y <= sMax + 0.5
      && hsv.z >= vMin && hsv.z <= vMax + 0.5;
    gl_FragColor = vec4(dentro ? corDentro : corFora, 1.0);
  }
`

/** @param {HTMLCanvasElement} canvasEntrada quadro 320×240 da captura */
export function criarFiltroHSVNaGPU(canvasEntrada) {
  const textura = new THREE.CanvasTexture(canvasEntrada)
  // Sem conversão de espaço de cor: o shader recebe os valores crus de 0 a
  // 255 (normalizados), exatamente o que o OpenCV recebe.
  textura.colorSpace = THREE.NoColorSpace
  textura.minFilter = THREE.NearestFilter
  textura.magFilter = THREE.NearestFilter
  textura.generateMipmaps = false

  const material = new THREE.ShaderMaterial({
    uniforms: {
      mapa: { value: textura },
      hMin: { value: 0 },
      hMax: { value: 0 },
      sMin: { value: 0 },
      sMax: { value: 0 },
      vMin: { value: 0 },
      vMax: { value: 0 },
      corDentro: { value: new THREE.Color(1, 1, 1) },
      corFora: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader,
    fragmentShader,
    toneMapped: false,
  })

  function atualizarParametros(pdi) {
    const u = material.uniforms
    u.hMin.value = pdi.hMin
    u.hMax.value = pdi.hMax
    u.sMin.value = pdi.sMin
    u.sMax.value = pdi.sMax
    u.vMin.value = pdi.vMin
    u.vMax.value = pdi.vMax
  }

  return { textura, material, atualizarParametros }
}

/**
 * Fração de pixels em que as máscaras da CPU e da GPU concordam.
 * @param {Uint8Array} mascaraCPU 1 canal, linhas de cima para baixo (OpenCV)
 * @param {Uint8Array} pixelsGPU RGBA, linhas de baixo para cima (readPixels)
 */
export function concordanciaDasMascaras(mascaraCPU, pixelsGPU, largura = LARGURA_PROC, altura = ALTURA_PROC) {
  let iguais = 0
  for (let y = 0; y < altura; y++) {
    const yGPU = altura - 1 - y
    for (let x = 0; x < largura; x++) {
      const cpu = mascaraCPU[y * largura + x] > 127
      const gpu = pixelsGPU[(yGPU * largura + x) * 4] > 127
      if (cpu === gpu) iguais++
    }
  }
  return iguais / (largura * altura)
}

/**
 * Mede o tempo médio do filtro na GPU desenhando num alvo fora da tela.
 * Devolve dois tempos:
 *  - comLeitura: envio do quadro + shader + leitura da máscara de volta para a
 *    CPU (é o que seria preciso para usar a máscara no findContours);
 *  - soShader: N desenhos seguidos e uma única leitura de 1 pixel no fim. A
 *    leitura obriga a GPU a terminar todos os desenhos antes de responder,
 *    então o tempo total dividido por N é o custo médio de cada desenho.
 * E a máscara lida (RGBA, linhas de baixo para cima, como o readPixels devolve).
 */
export function medirFiltroNaGPU(renderer, filtro, repeticoes) {
  const alvo = new THREE.WebGLRenderTarget(LARGURA_PROC, ALTURA_PROC)
  const cena = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), filtro.material)
  cena.add(quad)
  const pixels = new Uint8Array(LARGURA_PROC * ALTURA_PROC * 4)
  const umPixel = new Uint8Array(4)
  const alvoAnterior = renderer.getRenderTarget()

  const passo = (ler) => {
    renderer.setRenderTarget(alvo)
    renderer.render(cena, camera)
    if (ler) renderer.readRenderTargetPixels(alvo, 0, 0, LARGURA_PROC, ALTURA_PROC, pixels)
  }

  try {
    // aquecimento: compila o shader e aloca a textura antes de medir
    filtro.textura.needsUpdate = true
    passo(true)

    let inicio = performance.now()
    for (let i = 0; i < repeticoes; i++) {
      filtro.textura.needsUpdate = true
      passo(true)
    }
    const comLeitura = (performance.now() - inicio) / repeticoes

    inicio = performance.now()
    for (let i = 0; i < repeticoes; i++) passo(false)
    renderer.readRenderTargetPixels(alvo, 0, 0, 1, 1, umPixel)
    const soShader = (performance.now() - inicio) / repeticoes

    passo(true) // máscara final para a conferência com a CPU
    return { comLeitura, soShader, pixels }
  } finally {
    renderer.setRenderTarget(alvoAnterior)
    alvo.dispose()
    quad.geometry.dispose()
  }
}
