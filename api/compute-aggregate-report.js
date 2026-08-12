// api/compute-aggregate-report.js
//
// Chamada pelo back-office ao fechar uma rodada (Decisões 3 e 4). Para
// cada setor-folha, soma-se o número de respostas; se abaixo do limiar
// mínimo, sobe recursivamente para o setor pai, fundindo contagens, até
// atingir o limiar ou esgotar a hierarquia.
//
// Restrita a quem tem o custom claim backoffice_admin com acesso ao
// orgId da requisição — ver api/_lib/backofficeAuth.js e
// controle-acesso-custom-claims.md, seção 1. Substitui o mecanismo
// anterior de token compartilhado (x-backoffice-token).

const { getDb } = require("./_lib/firebaseAdmin");
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

  const { orgId, roundId } = req.body;
  if (!orgId || !roundId) {
    return res.status(400).json({ error: "orgId e roundId são obrigatórios." });
  }

  const db = getDb();
  const roundRef = db.collection("orgs").doc(orgId).collection("rounds").doc(roundId);
  const roundSnap = await roundRef.get();
  if (!roundSnap.exists) {
    return res.status(404).json({ error: "Rodada não encontrada." });
  }
  const { minK } = roundSnap.data(); // limiar mínimo (Decisão 3) — ex: 5

  // Carrega toda a hierarquia de setores da empresa (Decisão 4).
  const unitsSnap = await db.collection("orgs").doc(orgId).collection("units").get();
  const units = {};
  unitsSnap.forEach((doc) => (units[doc.id] = { id: doc.id, ...doc.data() }));

  // Conta respostas por setor.
  const responsesSnap = await roundRef.collection("responses").get();
  const countByUnit = {};
  const answersByUnit = {};
  responsesSnap.forEach((doc) => {
    const { unitId, answers } = doc.data();
    countByUnit[unitId] = (countByUnit[unitId] || 0) + 1;
    (answersByUnit[unitId] ||= []).push(answers);
  });

  const batch = db.batch();
  const reportedUnits = new Set();
  const skippedBelowThreshold = [];

  for (const unitId of Object.keys(units)) {
    if (reportedUnits.has(unitId)) continue;

    let currentId = unitId;
    let mergedCount = 0;
    let mergedAnswers = [];
    const fusedFrom = [];

    while (currentId) {
      mergedCount += countByUnit[currentId] || 0;
      mergedAnswers = mergedAnswers.concat(answersByUnit[currentId] || []);
      fusedFrom.push(currentId);

      if (mergedCount >= minK) break;
      currentId = units[currentId]?.parentUnitId || null;
    }

    if (mergedCount === 0) continue; // ninguém respondeu nesse ramo ainda

    if (mergedCount >= minK) {
      const reportRef = roundRef.collection("reports").doc(fusedFrom[fusedFrom.length - 1]);
      batch.set(reportRef, {
        n: mergedCount,
        fusedFrom,
        aggregates: computeAggregates(mergedAnswers),
        computedAt: FieldValue.serverTimestamp(),
      });
      fusedFrom.forEach((id) => reportedUnits.add(id));
    } else {
      // Caso-limite: mesmo subindo até o topo da hierarquia, não
      // atingiu o limiar. Nenhum relatório é gravado para este ramo.
      skippedBelowThreshold.push({ unitId, mergedCount });
      fusedFrom.forEach((id) => reportedUnits.add(id));
    }
  }

  await batch.commit();
  return res.status(200).json({ status: "ok", skippedBelowThreshold });
};

/** Placeholder — cálculo real das médias/distribuições por dimensão do
 * questionário (COPSOQ ou equivalente, ver dossiê de pesquisa legal). */
function computeAggregates(answersList) {
  return { responseCount: answersList.length };
}
