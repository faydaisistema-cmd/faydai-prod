const admin = require('firebase-admin');
const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { computeBlindIndex, getSecretRefs } = require('./lib/blindIndex');

function generateInviteCode() {
  return crypto.randomBytes(6).toString('hex'); // curto, não-adivinhável
}

exports.importInvites = onCall({ secrets: getSecretRefs() }, async (request) => {
  const { orgId, roundId, workers } = request.data;
  // workers: [{ stableId: 'matricula123', unitId: 'setor_operacoes' }, ...]

  if (request.auth?.token.role !== 'company_admin' || request.auth.token.orgId !== orgId) {
    throw new HttpsError('permission-denied', 'apenas RH autenticado pode importar.');
  }

  const db = admin.firestore();
  const batch = db.batch();
  let count = 0;

  for (const worker of workers) {
    // stableId só existe em memória — nunca é gravado em nenhum documento.
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

  await batch.commit(); // atenção: lote > 500 precisa de chunking, não implementado aqui
  return { invitesGenerated: count };
});
