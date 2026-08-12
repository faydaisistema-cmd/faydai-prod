// api/import-invites.js
//
// Chamada uma vez pelo RH/back-office ao abrir uma rodada (Decisão 2).
// O identificador do trabalhador é usado só em memória para calcular o
// blind index e imediatamente descartado — nunca é escrito em nenhum
// documento do Firestore.
//
// Restrita a quem tem o custom claim backoffice_admin com acesso ao
// orgId da requisição — ver api/_lib/backofficeAuth.js e
// controle-acesso-custom-claims.md, seção 1. Substitui o mecanismo
// anterior de token compartilhado (x-backoffice-token).

const { getDb, blindIndex, generateInviteCode } = require("./_lib/firebaseAdmin");
const { requireBackofficeAuth } = require("./_lib/backofficeAuth");
const { FieldValue } = require("firebase-admin/firestore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  // requireBackofficeAuth já escreve a resposta (401/403/400) e retorna
  // null em caso de falha — o handler só precisa checar e sair.
  const auth = await requireBackofficeAuth(req, res);
  if (!auth) return;

  const { orgId, roundId, employees } = req.body;
  // employees: [{ stableEmployeeId, unitId }, ...] — vem do sistema de
  // RH da empresa, nunca digitado pelo trabalhador.

  if (!orgId || !roundId || !Array.isArray(employees)) {
    return res.status(400).json({ error: "orgId, roundId e employees são obrigatórios." });
  }

  const db = getDb();
  const batch = db.batch();
  const invites = [];

  for (const { stableEmployeeId, unitId } of employees) {
    const code = generateInviteCode();
    const hash = blindIndex(stableEmployeeId);
    // stableEmployeeId sai de escopo aqui — não é escrito em lugar algum.

    const inviteRef = db
      .collection("orgs").doc(orgId)
      .collection("rounds").doc(roundId)
      .collection("invites").doc(code);

    batch.set(inviteRef, {
      unitId,
      blindIndex: hash,
      used: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    invites.push({ code, unitId }); // devolvido ao RH para montar os links
  }

  await batch.commit();
  return res.status(200).json({ count: invites.length, invites });
};
