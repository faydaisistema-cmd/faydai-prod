const admin = require('../../lib/firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' });

  try {
    const { orgId, roundId, code, answers } = req.body;
    const db = admin.firestore();

    const inviteRef = db.doc(`orgs/${orgId}/rounds/${roundId}/invites/${code}`);
    const linkageRef = db.doc(`orgs/${orgId}/rounds/${roundId}/linkage/${code}`);
    const responseRef = db.collection(`orgs/${orgId}/rounds/${roundId}/responses`).doc();

    await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      const linkageSnap = await tx.get(linkageRef);

      if (!inviteSnap.exists) throw { status: 404, message: 'código inválido.' };
      const invite = inviteSnap.data();

      if (invite.used || linkageSnap.exists) {
        throw { status: 409, message: 'essa resposta já foi enviada.' };
      }

      const participantRef = db.doc(`orgs/${orgId}/participants/${invite.blindIndex}`);
      const participantSnap = await tx.get(participantRef);

      tx.set(responseRef, {
        unitId: invite.unitId,
        answers,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.set(linkageRef, {
        blindIndex: invite.blindIndex,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.update(inviteRef, { used: true });

      tx.set(
        participantRef,
        {
          lastRoundId: roundId,
          roundsAnswered: admin.firestore.FieldValue.increment(1),
          firstSeenAt: participantSnap.exists
            ? participantSnap.data().firstSeenAt
            : admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
