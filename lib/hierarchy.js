async function getUnitChain(db, orgId, unitId) {
  const chain = [];
  let currentId = unitId;

  while (currentId) {
    const snap = await db.doc(`orgs/${orgId}/units/${currentId}`).get();
    if (!snap.exists) break;
    chain.push({ id: currentId, ...snap.data() });
    currentId = snap.data().parentUnitId || null;
  }

  return chain;
}

module.exports = { getUnitChain };
