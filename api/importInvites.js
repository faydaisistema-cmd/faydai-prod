const admin = require('../lib/firebaseAdmin');
const crypto = require('crypto');
const { requireRole } = require('../lib/auth');
const { computeBlindIndex } = require('../lib/blindIndex');

function generateInviteCode() {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' });

  try {
    const { orgId, roundId, workers } = req.body;
    await requireRole(req, 'company_admin', orgId);

    const db = admin.firestore();
    const batch = db.batch();
    let count = 0;

    for (const worker of workers) {
      const blindIndex = computeBlindIndex(worker.stableId);
      const code = generateInviteCode();

      const inviteRef = db.doc(`orgs/${orgId}/rounds/${roundId}/invites/${code}`);
      batch.set(inviteRef, {
        unitId: worker.unitId,
        blindIndex,
        used: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      count += 1;
    }

    await batch.commit(); // lote > 500 precisa de chunking, não implementado aqui
    res.status(200).json({ invitesGenerated: count });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
