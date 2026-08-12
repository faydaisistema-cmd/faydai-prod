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
//     const { orgId, roundId } = req.body;
//     if (!orgId || !roundId) {
//       return res.status(400).json({ error: "orgId e roundId são obrigatórios." });
//     }
//     const user = await requireBackofficeAuth(req, res, orgId);
//     if (!user) return; // requireBackofficeAuth já respondeu (401/403)
//     ...
//   };
//
// Assinatura alinhada com relatorioautenticacaobackofficefaydai.pdf, seção
// 4.1 — orgId é passado explicitamente pelo handler (já validado como
// presente no corpo), em vez de o middleware adivinhar de onde extraí-lo.
// Isso mantém o middleware genérico e a validação de formato do corpo como
// responsabilidade do handler, não do middleware de auth.

const { getAuth } = require("firebase-admin/auth");
const { getDb } = require("./firebaseAdmin"); // garante initializeApp() já chamado

/**
 * Verifica o ID token do Firebase enviado no header Authorization e
 * confirma que o chamador tem o claim backoffice_admin com acesso ao
 * orgId informado.
 *
 * O orgId usado na comparação é sempre o que o HANDLER extraiu da
 * requisição (corpo, query, rota), nunca só o claim isoladamente —
 * impede que um token válido para org_123 seja usado para operar
 * org_456 (ver controle-acesso-custom-claims.md, seção 1, "Regra de
 * verificação").
 *
 * Em caso de falha, já escreve a resposta HTTP (401/403) e retorna
 * `null`. Em caso de sucesso, retorna `{ uid, role }` para uso
 * opcional pelo handler (ex: auditoria/logging de qual operador agiu).
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} orgId - organização que a operação pretende afetar,
 *   já extraída pelo handler chamador
 * @returns {Promise<{uid: string, role: string}|null>}
 */
async function requireBackofficeAuth(req, res, orgId) {
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
    res.status(403).json({ error: "Usuário sem permissão para esta organização." });
    return null;
  }

  if (!orgId || !claim.orgIds.includes(orgId)) {
    // Comentário deliberado: mesma mensagem tanto para "claim não cobre
    // esse orgId" quanto para "orgId ausente" — não revelar detalhe que
    // ajude enumeração.
    res.status(403).json({ error: "Usuário sem permissão para esta organização." });
    return null;
  }

  return { uid: decoded.uid, role: claim.role };
}

module.exports = { requireBackofficeAuth };
