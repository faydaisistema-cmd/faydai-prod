const crypto = require('crypto');
const { defineSecret } = require('firebase-functions/params');

// Uma secret por versão de chave — nunca sobrescrita, só adicionada.
// Rotação exige rodar um backfill controlado antes de aposentar uma versão antiga.
const BLIND_INDEX_KEY_V1 = defineSecret('BLIND_INDEX_KEY_V1');
const BLIND_INDEX_KEY_V2 = defineSecret('BLIND_INDEX_KEY_V2');

const ACTIVE_KEY_VERSION = 'v2'; // versão usada para gerar NOVOS índices

const KEY_SECRETS = {
  v1: BLIND_INDEX_KEY_V1,
  v2: BLIND_INDEX_KEY_V2,
};

function getSecretRefs() {
  return Object.values(KEY_SECRETS);
}

// stableId = identificador estável do trabalhador (matrícula).
// Nunca persistir stableId em nenhum documento — só usar em memória.
function computeBlindIndex(stableId, version = ACTIVE_KEY_VERSION) {
  const secretRef = KEY_SECRETS[version];
  if (!secretRef) throw new Error(`versão de chave desconhecida: ${version}`);

  return crypto
    .createHmac('sha256', secretRef.value())
    .update(stableId.trim().toLowerCase())
    .digest('hex');
}

module.exports = { computeBlindIndex, getSecretRefs, ACTIVE_KEY_VERSION };
