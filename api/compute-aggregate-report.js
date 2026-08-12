// api/compute-aggregate-report.js
//
// Chamada pelo back-office ao fechar uma rodada (Decisões 3 e 4). Para
// cada setor-folha, soma-se o número de respostas; se abaixo do limiar
// mínimo, sobe recursivamente para o setor pai, fundindo contagens, até
// atingir o limiar ou esgotar a hierarquia.
//
// O doc gravado em `reports/{unitId}` é a ÚNICA fonte de dados que o
// dashboard da empresa (PsychosocialDashboard.jsx) consulta — ver
// controle-acesso-custom-claims.md, seção 2. O shape abaixo é o
// contrato entre esta função e o dashboard; qualquer mudança de campo
// aqui exige atualizar o dashboard também.

const { getDb } = require("./_lib/firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

// TODO: mover para a coleção `dimensions` (campo `polarity` ou
// `reverseScored: boolean`) quando ela deixar de ser um placeholder.
// Enquanto o questionário estiver hardcoded em questionario.html, a
// polaridade também precisa estar hardcoded aqui — do contrário a
// média das dimensões "positivas" (onde frequência alta = bom) sai
// com o sentido invertido em relação às "negativas".
const REVERSE_SCORED_DIMENSIONS = new Set([
  "Carga de trabalho",   // frequência alta de não terminar tarefas = pior
  "Insegurança",         // frequência alta de medo de desemprego = pior
  "Esgotamento",         // frequência alta de esgotamento = pior
]);
// Não-reversas (frequência alta = melhor): "Autonomia", "Suporte da liderança"

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  if (req.headers["x-backoffice-token"] !== process.env.BACKOFFICE_TOKEN) {
    return res.status(403).json({ error: "Operação restrita ao back-office." });
  }

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
      const finalUnitId = fusedFrom[fusedFrom.length - 1];
      const { dimensions, overallAverage } = computeAggregates(mergedAnswers);

      const reportRef = roundRef.collection("reports").doc(finalUnitId);
      batch.set(reportRef, {
        unitId: finalUnitId,
        unitName: units[finalUnitId]?.name || finalUnitId,
        fusedFrom,
        n: mergedCount,
        dimensions,
        overallAverage,
        computedAt: FieldValue.serverTimestamp(),
      });
      fusedFrom.forEach((id) => reportedUnits.add(id));
    } else {
      // Caso-limite: mesmo subindo até o topo da hierarquia, não
      // atingiu o limiar. Nenhum relatório é gravado para este ramo —
      // decisão de produto ainda em aberto (ver documento de decisões).
      skippedBelowThreshold.push({ unitId, mergedCount });
      fusedFrom.forEach((id) => reportedUnits.add(id));
    }
  }

  await batch.commit();
  return res.status(200).json({ status: "ok", skippedBelowThreshold });
};

/**
 * Calcula, por dimensão, a média das respostas (escala 0–4 de
 * frequência no questionário) já convertida para score 1–5 onde
 * 5 = melhor / menor risco — orientação que o dashboard espera
 * (scoreColor: >=4 baixo risco, <2.5 alto risco).
 *
 * mergedAnswers: array de arrays de { dimension: string, value: number }
 * — um array por resposta de trabalhador.
 */
function computeAggregates(mergedAnswers) {
  const sums = {};   // { [dimension]: { sum, n } }

  for (const answers of mergedAnswers) {
    for (const { dimension, value } of answers) {
      const bucket = sums[dimension] || { sum: 0, n: 0 };
      const reversed = REVERSE_SCORED_DIMENSIONS.has(dimension);
      const score = reversed ? 5 - value : 1 + value; // 0–4 -> 1–5
      bucket.sum += score;
      bucket.n += 1;
      sums[dimension] = bucket;
    }
  }

  const dimensions = {};
  let overallSum = 0;
  let overallN = 0;

  for (const [dimension, { sum, n }] of Object.entries(sums)) {
    const average = n > 0 ? sum / n : null;
    dimensions[dimension] = { average, n };
    if (average != null) {
      overallSum += average;
      overallN += 1;
    }
  }

  const overallAverage = overallN > 0 ? overallSum / overallN : null;
  return { dimensions, overallAverage };
}
