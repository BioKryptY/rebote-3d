// Módulo vazio usado no lugar de "fs" e "crypto" no build (ver vite.config.js).
// O OpenCV.js só chama esses módulos quando roda no Node.js; no navegador
// esse trecho nunca executa.
export default {}
