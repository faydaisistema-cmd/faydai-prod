const admin = require('../lib/firebaseAdmin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' });

  try {
    const { setupSecret, uid, role, orgId } = req.body;

    // protege esta rota com uma senha só sua, nunca exposta no frontend
    if (setupSecret !== process.env.SETUP_SECRET) {
      return res.status(403).json({ error: 'senha de configuração incorreta.' });
    }

    await admin.auth().setCustomUserClaims(uid, { role, orgId });
    res.status(200).json({ status: 'ok', uid, role, orgId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
