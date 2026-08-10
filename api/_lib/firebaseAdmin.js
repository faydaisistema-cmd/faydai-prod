// api/_lib/firebaseAdmin.js
//
// Inicialização compartilhada do Firebase Admin SDK para as funções
// serverless do Vercel. Lida a partir de variáveis de ambiente
// configuradas no painel do Vercel (Settings → Environment Variables),
// nunca hardcoded no código.

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const crypto = require("crypto");

function getDb() {
  if (getApps().length === 0) {
    // FIREBASE_SERVICE_ACCOUNT = conteúdo JSON da conta de serviço,
    // colado inteiro como uma única variável de ambiente no Vercel.
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

/**
 * Calcula o blind index (Parte 3 da pesquisa) de um identificador
 * estável do trabalhador. HMAC-SHA256 com chave secreta vinda de
 * variável de ambiente (BLIND_INDEX_KEY) — nunca em código, nunca em
 * documento do Firestore.
 */
function blindIndex(stableEmployeeId) {
  const secretKey = process.env.BLIND_INDEX_KEY;
  if (!secretKey) {
    throw new Error("BLIND_INDEX_KEY não configurada nas variáveis de ambiente.");
  }
  return crypto
    .createHmac("sha256", secretKey)
    .update(stableEmployeeId.trim().toLowerCase())
    .digest("hex");
}

/** Gera um código de convite curto e não-adivinhável (Decisão 2). */
function generateInviteCode() {
  return crypto.randomBytes(12).toString("base64url");
}

module.exports = { getDb, blindIndex, generateInviteCode };

