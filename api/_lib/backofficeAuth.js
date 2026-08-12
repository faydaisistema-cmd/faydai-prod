// api/_lib/backofficeAuth.js
//
// Substitui o mecanismo antigo (header `x-backoffice-token` compartilhado)
// pela verificação do custom claim `backoffice`, conforme especificado em
// controle-acesso-custom-claims.md, seção 1:
//
//   {
//     "backoffice": {
//       "role": "backoffice_admin",
//       "orgIds": ["org_123", "org_456"]
//     }
//   }
//
// Verificado sempre por este middleware + Admin SDK — NUNCA por Firestore
// Security Rules (o Admin SDK já ignora as rules por design, e o claim
// `backoffice` nunca é lido em firestore.rules; ver comentário no topo
// daquele arquivo).
//
// Uso em um endpoint (api/import-invites.js, api/compute-aggregate-report.js):
//
//   const { requireBackofficeAuth } = require("./_lib/backofficeAuth");
//
//   module.exports = async function handler(req, res) {
//     const auth = await requireBackofficeAuth(req, res);
//     if (!auth) return; // requireBackofficeAuth já respondeu (401/403)
//     const { orgId, roundId } = req.body;
//     ...
//   };

const { getAuth } = require("firebase-admin/auth");
const { getDb } = require("./firebaseAdmin"); // garante initializeApp() já chamado

/**
 * Verifica o ID token do Firebase enviado no header Authorization e
 * confirma que o chamador tem o claim backoffice_admin com acesso ao
 * orgId da requisição.
 *
 * O orgId usado na comparação vem SEMPRE do corpo/rota da requisição,
 * nunca só do claim isoladamente — impede que um token válido para
 * org_123 seja usado para operar org_456 (ver controle-acesso-custom-
 * claims.md, seção 1, "Regra de verificação").
 *
 * Em caso de falha, já escreve a resposta HTTP (401/403) e retorna
 * `null`. Em caso de sucesso, retorna o decoded token para uso
 * opcional pelo handler (ex: auditoria/logging de qual operador agiu).
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<import('firebase-admin/auth').DecodedIdToken|null>}
 */
async function requireBackofficeAuth(req, res) {
  getDb(); // efeito colateral: garante initializeApp() chamado uma vez

  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    res.status(401).json({ error: "Token de autenticação ausente." });
    return null;
  }

  let decoded;
  try {
    // checkRevoked: true — honra revokeRefreshTokens() usado no fluxo
    // de revogação (ver controle-acesso-custom-claims.md, seção 1).
    decoded = await getAuth().verifyIdToken(match[1], true);
  } catch (err) {
    res.status(401).json({ error: "Token inválido ou expirado." });
    return null;
  }

  const claim = decoded.backoffice;
  if (!claim || claim.role !== "backoffice_admin" || !Array.isArray(claim.orgIds)) {
    res.status(403).json({ error: "Operação restrita ao back-office." });
    return null;
  }

  // orgId pode vir do corpo (POST) ou de query/rota — normaliza aqui.
  const orgId = req.body?.orgId || req.query?.orgId;
  if (!orgId) {
    res.status(400).json({ error: "orgId é obrigatório." });
    return null;
  }

  if (!claim.orgIds.includes(orgId)) {
    // Comentário deliberado: não revelar se orgId existe ou não —
    // resposta idêntica a "sem permissão nenhuma", evita enumeração.
    res.status(403).json({ error: "Operação restrita ao back-office." });
    return null;
  }

  return decoded;
}

module.exports = { requireBackofficeAuth };
