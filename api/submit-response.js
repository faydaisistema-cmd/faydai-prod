// api/submit-response.js
//
// Chamada pelo trabalhador ao abrir o link do RH e enviar a pesquisa
// (Decisões 1, 2 e 5). Roda em uma única transação: valida o código,
// checa duplicidade, grava a resposta, marca o convite como usado e
// atualiza o metadado de continuidade entre rodadas.

const { getDb } = require("./_lib/firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  const { orgId, roundId, code, answers } = req.body;

  if (!orgId || !roundId || !code || !answers) {
    return res.status(400).json({ error: "orgId, roundId, código e respostas são obrigatórios." });
  }

  const db = getDb();
  const roundRef = db.collection("orgs").doc(orgId).collection("rounds").doc(roundId);
  const inviteRef = roundRef.collection("invites").doc(code);

  try {
    const result = await db.runTransaction(async (tx) => {
      // ── FASE 1: todas as leituras primeiro (regra de transação do
      // Firestore — nenhuma escrita pode ocorrer antes da última leitura).
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) {
        const err = new Error("Código de acesso inválido.");
        err.statusCode = 404;
        throw err;
      }
      const invite = inviteSnap.data();

      if (invite.used) {
        // Decisão 5: resposta é definitiva. Um código já usado nunca
        // permite nova submissão — não existe fluxo de edição.
        const err = new Error("Esta pesquisa já foi respondida com este acesso.");
        err.statusCode = 409;
        throw err;
      }

      // Checagem adicional de duplicidade via linkage, além do flag
      // `used` do convite — defesa em profundidade.
      const linkageRef = roundRef.collection("linkage").doc(invite.blindIndex);
      const linkageSnap = await tx.get(linkageRef);
      if (linkageSnap.exists) {
        const err = new Error("Já existe uma resposta registrada para este participante nesta rodada.");
        err.statusCode = 409;
        throw err;
      }

      const participantRef = db
        .collection("orgs").doc(orgId)
        .collection("participants").doc(invite.blindIndex);
      const participantSnap = await tx.get(participantRef);

      // ── FASE 2: agora todas as escritas.
      // A resposta NÃO guarda o blindIndex — fica isolado na coleção
      // `linkage`, separando conteúdo da resposta do mecanismo de
      // identificação (Parte 3 da pesquisa).
      const responseRef = roundRef.collection("responses").doc();
      tx.set(responseRef, {
        unitId: invite.unitId,
        answers,
        submittedAt: FieldValue.serverTimestamp(),
      });

      tx.set(linkageRef, { usedAt: FieldValue.serverTimestamp() });
      tx.update(inviteRef, { used: true });

      // Continuidade entre rodadas (Decisão 1).
      tx.set(
        participantRef,
        {
          lastRoundId: roundId,
          ...(participantSnap.exists ? {} : { firstRoundId: roundId }),
        },
        { merge: true }
      );

      return { unitId: invite.unitId };
    });

    return res.status(200).json({ status: "ok", unitId: result.unitId });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message });
  }
};

