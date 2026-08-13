const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

exports.submitResponse = onCall(async (request) => {
  const { orgId, roundId, code, answers } = request.data;

  const db = admin.firestore();
  const inviteRef = db.doc(`orgs/${orgId}/rounds/${roundId}/invites/${code}`);
  const linkageRef = db.doc(`orgs/${orgId}/rounds/${roundId}/linkage/${code}`);
  const responseRef = db.collection(`orgs/${orgId}/rounds/${roundId}/responses`).doc();

  await db.runTransaction(async (tx) => {
    // 1. LEITURAS — todas antes de qualquer escrita
    const inviteSnap = await tx.get(inviteRef);
    const linkageSnap = await tx.get(linkageRef);

    if (!inviteSnap.exists) {
      throw new HttpsError('not-found', 'código inválido.');
    }
    const invite = inviteSnap.data();

    if (invite.used || linkageSnap.exists) {
      // mensagem genérica — não revela qual checagem falhou
      throw new HttpsError('failed-precondition', 'essa resposta já foi enviada.');
    }

    const participantRef = db.doc(`orgs/${orgId}/participants/${invite.blindIndex}`);
    const participantSnap = await tx.get(participantRef);

    // 2. ESCRITAS
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

  return { status: 'ok' };
});
