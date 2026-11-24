// Tudo o que envolve os gestos: carregar o TensorFlow.js, gravar exemplos,
// classificar a cada N quadros, transformar classificações em comandos e
// guardar/exportar o treino. O main.js só chama processar() a cada quadro.
import { painelGestos } from './ui.js'
import { ConfirmadorDeGesto, GESTOS, NOMES_GESTOS, ZONAS } from './vision/gestos.js'
import { desserializar, serializar } from './vision/persistencia.js'

const QUADROS_POR_GRAVACAO = 30
const ESPERA_ANTES_DE_GRAVAR_MS = 2000 // tempo para soltar o mouse e fazer o gesto
const CHAVE_EXEMPLOS = 'rebote3d.gestos.v1'
const TAMANHO_MAXIMO_IMPORTACAO = 20 * 1024 * 1024

/**
 * @param {object} p
 * @param {import('lil-gui').default} p.painel
 * @param {HTMLCanvasElement} p.canvasEntrada imagem que o classificador olha
 *   (zona do gesto já preparada pelo OpenCV a cada quadro)
 * @param {HTMLInputElement} p.inputArquivo seletor de arquivo para importar
 * @param {HTMLElement} p.elStatus linha de status da IA no painel lateral
 * @param {(texto: string, duracaoMs?: number) => void} p.avisar
 * @param {(gesto: string) => void} p.aoConfirmar chamado com 'sacar' ou 'pausar'
 */
export function criarControleDeGestos({ painel, canvasEntrada, inputArquivo, elStatus, avisar, aoConfirmar }) {
  const opcoes = {
    k: 5,
    inferirACada: 3,
    zona: 'esquerda',
    apagarObjeto: true,
    confiancaMinima: 0.8,
    confirmacoes: 3,
    intervaloMs: 800,
  }
  const info = { exemplos: 'carregando…' }
  const confirmador = new ConfirmadorDeGesto()
  let classificador = null
  let predicao = null
  let inferindo = false
  let quadrosDesdeInferencia = 0
  let tempoIA = 0
  let gravacao = null // { gesto, comecaEm, restantes }
  let proximaAtualizacaoStatus = 0

  function atualizarContagem() {
    const c = classificador.contagem()
    info.exemplos = GESTOS.map((g) => `${NOMES_GESTOS[g]} ${c[g]}`).join(' · ')
  }

  // ---- persistência ----
  // Os exemplos ficam salvos no navegador (localStorage): recarregar a página
  // não obriga a treinar de novo. Exportar/importar leva o treino para outro
  // computador. localStorage pode estar bloqueado (aba anônima, política do
  // navegador), por isso tudo fica em try/catch e o jogo funciona sem ele.

  function exemplosEmJSON() {
    return serializar(classificador.exemplos(), opcoes)
  }

  function aplicarExemplos(dados) {
    classificador.carregarExemplos(dados.classes)
    opcoes.zona = dados.zona
    opcoes.apagarObjeto = dados.apagarObjeto
    predicao = null
    atualizarContagem()
  }

  function salvarNoNavegador() {
    try {
      localStorage.setItem(CHAVE_EXEMPLOS, JSON.stringify(exemplosEmJSON()))
    } catch {
      avisar('Não deu para salvar os exemplos neste navegador')
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

  function exportar() {
    if (!classificador?.treinado) {
      avisar('Grave os gestos antes de exportar')
      return
    }
    const blob = new Blob([JSON.stringify(exemplosEmJSON())], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'rebote3d-gestos.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  inputArquivo.addEventListener('change', async () => {
    const arquivo = inputArquivo.files?.[0]
    inputArquivo.value = ''
    if (!arquivo || !classificador) return
    try {
      if (arquivo.size > TAMANHO_MAXIMO_IMPORTACAO) throw new Error('arquivo grande demais')
      aplicarExemplos(desserializar(JSON.parse(await arquivo.text())))
      salvarNoNavegador()
      avisar('Exemplos importados')
    } catch (erro) {
      avisar(`Não foi possível importar: ${erro.message}`, 4000)
    }
  })

  function apagar() {
    if (!classificador) return
    classificador.limpar()
    predicao = null
    atualizarContagem()
    try {
      localStorage.removeItem(CHAVE_EXEMPLOS)
    } catch {
      // sem localStorage não há o que apagar
    }
  }

  painelGestos(
    painel,
    info,
    opcoes,
    {
      gravar: (gesto) => {
        if (!classificador) return
        gravacao = { gesto, comecaEm: performance.now() + ESPERA_ANTES_DE_GRAVAR_MS, restantes: QUADROS_POR_GRAVACAO }
      },
      apagar,
      exportar,
      importar: () => inputArquivo.click(),
    },
    GESTOS,
    NOMES_GESTOS,
    ZONAS,
  )

  // ---- carregamento ----
  // O TensorFlow.js é carregado à parte, para a cena aparecer antes.
  elStatus.textContent = 'Carregando TensorFlow.js e MobileNet…'
  import('./vision/model.js')
    .then(async ({ ClassificadorDeGestos }) => {
      const c = new ClassificadorDeGestos()
      await c.carregar(import.meta.env.BASE_URL)
      classificador = c
      const recuperou = carregarDoNavegador()
      atualizarContagem()
      elStatus.textContent = recuperou
        ? `MobileNet pronta (backend ${c.backend}). Exemplos recuperados do navegador.`
        : `MobileNet pronta (backend ${c.backend}). Grave os gestos no painel.`
    })
    .catch((erro) => {
      elStatus.textContent = `Falha ao carregar o TensorFlow.js (${erro.message}).`
    })

  // ---- a cada quadro ----

  /**
   * Grava exemplos (durante uma gravação) ou classifica o quadro atual.
   * Só deve ser chamado quando canvasEntrada acabou de receber um quadro novo.
   */
  function processar(agora) {
    if (!classificador) return
    if (gravacao) {
      if (agora < gravacao.comecaEm) return
      classificador.adicionarExemplo(canvasEntrada, gravacao.gesto)
      gravacao.restantes--
      if (gravacao.restantes === 0) {
        gravacao = null
        atualizarContagem()
        salvarNoNavegador()
      }
      return
    }
    // A inferência é assíncrona e roda só a cada N quadros novos: a
    // renderização não espera por ela e o FPS do jogo não cai.
    quadrosDesdeInferencia++
    if (inferindo || quadrosDesdeInferencia < opcoes.inferirACada || !classificador.treinado) return
    quadrosDesdeInferencia = 0
    inferindo = true
    const inicio = performance.now()
    classificador
      .classificar(canvasEntrada, opcoes.k)
      .then((r) => {
        predicao = r
        tempoIA = performance.now() - inicio
        const gesto = confirmador.registrar(r, opcoes, performance.now())
        if (gesto === 'sacar' || gesto === 'pausar') {
          aoConfirmar(gesto)
          avisar(`Gesto ${NOMES_GESTOS[gesto].toUpperCase()} reconhecido`)
        }
      })
      // exemplos apagados enquanto a classificação rodava: descarta o resultado
      .catch(() => (predicao = null))
      .finally(() => (inferindo = false))
  }

  function atualizarStatus(agora) {
    if (!classificador || agora < proximaAtualizacaoStatus) return
    proximaAtualizacaoStatus = agora + 250
    const tensores = `${classificador.tensores()} tensores na memória`
    if (!classificador.treinado) {
      elStatus.textContent = `Grave exemplos de pelo menos dois gestos.\n${tensores}`
      return
    }
    const gesto = predicao ? `${NOMES_GESTOS[predicao.gesto]} (${Math.round(predicao.confianca * 100)}%)` : '—'
    elStatus.textContent = `Gesto: ${gesto}\nTensorFlow.js: ${tempoIA.toFixed(0)} ms · ${tensores}`
  }

  /** Mensagem central durante a gravação de exemplos, ou null. */
  function mensagemDeGravacao(agora) {
    if (!gravacao) return null
    const nome = NOMES_GESTOS[gravacao.gesto].toUpperCase()
    if (agora < gravacao.comecaEm) {
      return `Prepare o gesto ${nome}: gravando em ${Math.ceil((gravacao.comecaEm - agora) / 1000)} s`
    }
    const feitos = QUADROS_POR_GRAVACAO - gravacao.restantes
    return `Gravando ${nome}: ${feitos}/${QUADROS_POR_GRAVACAO} — mexa um pouco a mão`
  }

  return {
    opcoes,
    processar,
    atualizarStatus,
    mensagemDeGravacao,
    get treinado() {
      return classificador?.treinado ?? false
    },
    // para inspeção no console do navegador
    get classificador() {
      return classificador
    },
    get predicao() {
      return predicao
    },
    get gravacao() {
      return gravacao
    },
  }
}
