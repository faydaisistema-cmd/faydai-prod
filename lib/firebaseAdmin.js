const admin = require('firebase-admin');

function normalizePrivateKey(key) {
  if (!key) return key;
  // aceita tanto \n literal (texto) quanto quebra de linha já real
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
  });
}

module.exports = admin;
