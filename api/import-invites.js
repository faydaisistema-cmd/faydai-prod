// api/import-invites.js
//
// Chamada uma vez pelo RH/back-office ao abrir uma rodada (Decisão 2).
// O identificador do trabalhador é usado só em memória para calcular o
// blind index e imediatamente descartado — nunca é escrito em nenhum
// documento do Firestore.
//
// Restrita a quem tem o papel de back-office (checagem simplificada por
// token compartilhado — trocar por autenticação real antes de produção).

const { getDb, blindIndex, generateInviteCode } = require("./_lib/firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  if (req.headers["x-backoffice-token"] !== process.env.BACKOFFICE_TOKEN) {
    return res.status(403).json({ error: "Operação restrita ao back-office." });
  }

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
