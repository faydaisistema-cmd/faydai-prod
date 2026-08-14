const crypto = require('crypto');

// Uma variável de ambiente por versão de chave — nunca sobrescrita, só adicionada.
const ACTIVE_KEY_VERSION = 'v2';

const KEYS = {
  v1: process.env.BLIND_INDEX_KEY_V1,
  v2: process.env.BLIND_INDEX_KEY_V2,
};

function computeBlindIndex(stableId, version = ACTIVE_KEY_VERSION) {
  const key = KEYS[version];
  if (!key) throw new Error(`chave da versão ${version} não configurada no Vercel.`);

  return crypto
    .createHmac('sha256', key)
    .update(stableId.trim().toLowerCase())
    .digest('hex');
}

module.exports = { computeBlindIndex, ACTIVE_KEY_VERSION };
