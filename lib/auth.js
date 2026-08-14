const admin = require('./firebaseAdmin');

// Verifica o token do Firebase enviado no header Authorization: Bearer <token>
// e confere se o papel (custom claim) bate com o exigido.
async function requireRole(req, role, orgIdFromBody) {
  const header = req.headers.authorization || '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!idToken) throw { status: 401, message: 'não autenticado.' };

  const decoded = await admin.auth().verifyIdToken(idToken);

  if (decoded.role !== role) {
    throw { status: 403, message: 'sem permissão.' };
  }
  if (orgIdFromBody && decoded.orgId !== orgIdFromBody) {
    throw { status: 403, message: 'sem permissão para este org.' };
  }
  return decoded;
}

module.exports = { requireRole };
