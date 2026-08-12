// api/_lib/rateLimiter.js
//
// Rate limiting para submitResponse — endpoint público, sem autenticação,
// protegido só pelo código de convite (12 bytes aleatórios, ver
// generateInviteCode em firebaseAdmin.js). O risco aqui não é um usuário
// autenticado abusando da API; é alguém tentando ADIVINHAR códigos válidos
// por força bruta, ou floodar o endpoint.
//
// Duas janelas por IP, contadas separadamente:
//
//   - "global"  — toda tentativa, válida ou não. Limite frouxo — existe
//     só para conter flood grosseiro, e precisa tolerar o caso comum de
//     várias pessoas do mesmo escritório (mesmo IP/NAT corporativo)
//     respondendo a pesquisa ao mesmo tempo.
//
//   - "invalid" — só tentativas com código inexistente ou já usado.
//     Limite estrito: um trabalhador legítimo erra o código no máximo
//     uma ou duas vezes antes de conferir o link de novo; muitas
//     tentativas inválidas seguidas do mesmo IP é o padrão de brute
//     force, não de uso normal.
//
// O IP nunca é persistido em claro — é hasheado com HMAC usando uma
// chave PRÓPRIA (RATE_LIMIT_HMAC_KEY), separada da BLIND_INDEX_KEY.
// Nunca reaproveitar chave de HMAC entre dois mecanismos diferentes,
// mesmo que sirvam a propósitos parecidos — são segredos com blast
// radius diferente.
//
// Os buckets se auto-destroem via TTL nativo do Firestore (campo
// `expiresAt`), não por Cloud Function de limpeza. ATENÇÃO — isso exige
// um passo de configuração fora do código:
//
//   gcloud firestore fields ttls update expiresAt \
//     --collection-group=rate_limits --enable-ttl
//
// (ou: console do Firebase → Firestore → Índices → TTL Policies →
// coleção `rate_limits`, campo `expiresAt`). Sem isso os documentos de
// rate limit se acumulam indefinidamente.

const crypto = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");

const GLOBAL_LIMIT = 60; // tentativas por IP
const GLOBAL_WINDOW_MS = 60 * 60 * 1000; // 1 hora

const INVALID_LIMIT = 10; // tentativas com código inválido/usado por IP
const INVALID_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

function hashIp(ip) {
  const secret = process.env.RATE_LIMIT_HMAC_KEY;
  if (!secret) {
    throw new Error("RATE_LIMIT_HMAC_KEY não configurada nas variáveis de ambiente.");
  }
  return crypto.createHmac("sha256", secret).update(ip).digest("hex");
}

/** Extrai o IP do requisitante atrás do proxy da Vercel. */
function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Lê e incrementa um bucket de janela fixa numa única transação.
 * Retorna `false` sem incrementar se o bucket já está no limite —
 * assim uma sequência de tentativas acima do limite não continua
 * inflando o contador indefinidamente.
 */
async function checkBucket(db, key, limit, windowMs) {
  const windowIndex = Math.floor(Date.now() / windowMs);
  const bucketRef = db.collection("rate_limits").doc(`${key}__${windowIndex}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(bucketRef);
    const count = snap.exists ? snap.data().count : 0;

    if (count >= limit) {
      return false;
    }

    tx.set(
      bucketRef,
      {
        count: FieldValue.increment(1),
        // TTL com margem: o bucket some bem depois da janela fechar,
        // não precisa ser exato.
        expiresAt: new Date(Date.now() + windowMs * 2),
      },
      { merge: true }
    );
    return true;
  });
}

/**
 * Checa e incrementa o limite global por IP. Chamar no início do
 * handler, antes de qualquer leitura de convite.
 */
async function checkGlobalLimit(db, req) {
  const ipHash = hashIp(getClientIp(req));
  return checkBucket(db, `global_${ipHash}`, GLOBAL_LIMIT, GLOBAL_WINDOW_MS);
}

/**
 * Checa e incrementa o limite de tentativas inválidas por IP. Chamar
 * só depois de já ter constatado que o código era inválido, já usado,
 * ou duplicado via linkage — nunca numa submissão bem-sucedida.
 */
async function checkInvalidAttemptLimit(db, req) {
  const ipHash = hashIp(getClientIp(req));
  return checkBucket(db, `invalid_${ipHash}`, INVALID_LIMIT, INVALID_WINDOW_MS);
}

module.exports = { checkGlobalLimit, checkInvalidAttemptLimit, getClientIp, hashIp };
