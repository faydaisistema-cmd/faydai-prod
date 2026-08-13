// api/home.js
//
// Serve public/questionario.html através de uma Serverless Function, em
// vez de depender da detecção automática de arquivos estáticos da Vercel
// (que, por razão ainda não identificada, está retornando 404 mesmo com
// outputDirectory declarado explicitamente e o arquivo confirmado íntegro
// no repositório).
//
// Lê o arquivo em tempo de execução — por isso precisa da entrada
// "functions" → "includeFiles" no vercel.json, garantindo que
// public/questionario.html seja empacotado junto com esta function no
// deploy (senão fs.readFileSync não encontra o arquivo em produção).

const fs = require("fs");
const path = require("path");

module.exports = function handler(req, res) {
  try {
    const filePath = path.join(process.cwd(), "public", "questionario.html");
    const html = fs.readFileSync(filePath, "utf8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).json({ error: "Não foi possível carregar a página.", detail: err.message });
  }
};

