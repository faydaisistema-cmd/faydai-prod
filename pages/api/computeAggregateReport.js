const admin = require('../../lib/firebaseAdmin');
const { requireRole } = require('../../lib/auth');
const { getUnitChain } = require('../../lib/hierarchy');
const { COPSOQ_DIMENSIONS } = require('../../lib/copsoqDimensions');

function dimensionPassesDiversity(values) {
  return new Set(values).size >= 2;
}

async function getResponsesForUnit(db, orgId, roundId, unitId) {
  const snap = await db
    .collection(`orgs/${orgId}/rounds/${roundId}/responses`)
    .where('unitId', '==', unitId)
    .get();
  return snap.docs.map((d) => d.data());
  // simplificação conhecida: níveis acima do setor-folha ainda não somam descendentes
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' });

  try {
    const { orgId, roundId } = req.body;
    await requireRole(req, 'backoffice_admin');

    const db = admin.firestore();
    const roundSnap = await db.doc(`orgs/${orgId}/rounds/${roundId}`).get();
    if (!roundSnap.exists) throw { status: 404, message: 'rodada não encontrada.' };
    const { minK } = roundSnap.data();

    const unitsSnap = await db.collection(`orgs/${orgId}/units`).get();
    const leafUnits = unitsSnap.docs.filter((u) => u.data().isLeaf);

    const log = [];

    for (const leaf of leafUnits) {
      const chain = await getUnitChain(db, orgId, leaf.id);
      let published = false;

      for (const unit of chain) {
        const responses = await getResponsesForUnit(db, orgId, roundId, unit.id);
        if (responses.length < minK) continue;

        const dimensions = {};
        for (const dim of COPSOQ_DIMENSIONS) {
          const values = responses.map((r) => r.answers?.[dim]).filter((v) => v !== undefined);
          dimensions[dim] = dimensionPassesDiversity(values)
            ? { status: 'published' }
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
        await db.doc(`orgs/${orgId}/rounds/${roundId}/reports/${leaf.id}`).set({
          status: 'insufficient_data',
          computedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        log.push(`${leaf.id} → insufficient_data`);
      }
    }

    res.status(200).json({ log });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
