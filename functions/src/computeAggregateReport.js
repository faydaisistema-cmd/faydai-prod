const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getUnitChain } = require('./lib/hierarchy');
const { COPSOQ_DIMENSIONS } = require('./lib/copsoqDimensions');

// l-diversidade simplificada: evita o ataque de homogeneidade
// (setor pode passar no k-anonimato geral e ainda vazar uma dimensão unânime).
function dimensionPassesDiversity(values) {
  return new Set(values).size >= 2;
}

async function getResponsesForUnit(db, orgId, roundId, unitId) {
  const snap = await db
    .collection(`orgs/${orgId}/rounds/${roundId}/responses`)
    .where('unitId', '==', unitId)
    .get();
  return snap.docs.map((d) => d.data());
  // simplificação conhecida: para níveis acima do setor-folha, isto precisa
  // somar respostas de TODOS os setores-folha descendentes, não só deste unitId —
  // requer um índice de descendência ainda não modelado.
}

exports.computeAggregateReport = onCall(async (request) => {
  const { orgId, roundId } = request.data;

  if (request.auth?.token.role !== 'backoffice_admin') {
    throw new HttpsError('permission-denied', 'apenas back-office pode fechar rodada.');
  }

  const db = admin.firestore();
  const roundSnap = await db.doc(`orgs/${orgId}/rounds/${roundId}`).get();
  if (!roundSnap.exists) throw new HttpsError('not-found', 'rodada não encontrada.');
  const { minK } = roundSnap.data(); // nenhum parâmetro de override em nenhum lugar

  const unitsSnap = await db.collection(`orgs/${orgId}/units`).get();
  const leafUnits = unitsSnap.docs.filter((u) => u.data().isLeaf);

  const log = [];

  for (const leaf of leafUnits) {
    const chain = await getUnitChain(db, orgId, leaf.id);
    let published = false;

    for (const unit of chain) {
      const responses = await getResponsesForUnit(db, orgId, roundId, unit.id);
      if (responses.length < minK) continue; // sobe para o pai

      const dimensions = {};
      for (const dim of COPSOQ_DIMENSIONS) {
        const values = responses.map((r) => r.answers?.[dim]).filter((v) => v !== undefined);
        dimensions[dim] = dimensionPassesDiversity(values)
          ? { status: 'published' } // score real ainda depende do COPSOQ final
          : { status: 'suppressed' };
      }

      await db.doc(`orgs/${orgId}/rounds/${roundId}/reports/${leaf.id}`).set({
        status: 'published',
        publishedAtUnitId: unit.id,
        dimensions,
        computedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      log.push(`${leaf.id} → publicado em ${unit.id}`);
      published = true;
      break;
    }

    if (!published) {
      // nem a empresa inteira atingiu o limiar — nunca fica em silêncio
      await db.doc(`orgs/${orgId}/rounds/${roundId}/reports/${leaf.id}`).set({
        status: 'insufficient_data',
        computedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      log.push(`${leaf.id} → insufficient_data`);
    }
  }

  return { log };
});
