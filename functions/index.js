/**
 * Cloud Functions — Software de Pesquisa Psicossocial (NR-1)
 *
 * ATUALIZAÇÃO (interface administrativa): adiciona as funções que faltavam
 * para o back-office operar sem tocar direto no Firestore do cliente
 * (que as Security Rules bloqueiam por desenho — ver firestore.rules):
 *
 *   createOrg / listOrgs               -> gestão de organizações
 *   createUnit / updateUnit /
 *     deleteUnit / listUnits           -> hierarquia de setores (Decisão 4)
 *   createRound / listRounds /
 *     getRoundSummary                  -> gestão de rodadas, sem nunca
 *                                          devolver dado bruto (só contagens
 *                                          via aggregation queries)
 *
 * FIX (controle-acesso-custom-claims.md): assertBackOffice() checava
 * `request.auth.token.role === "backoffice_admin"` (claim flat) —
 * incompatível com o formato namespaced já documentado e já usado nos
 * testes de firestore.rules: `{ backoffice: { role, orgIds } }`. Além de
 * checar o papel, agora também escopa por orgId quando aplicável — um
 * operador autorizado só para org_123 não pode mais operar org_456 só
 * porque o token é válido (ver controle-acesso-custom-claims.md, seção 1,
 * "Regra de verificação").
 *
 * Toda leitura/escrita usa o Admin SDK (via getFirestore()), que ignora
 * as Security Rules por design — a coleção de respostas brutas nunca é
 * devolvida ao back-office como documento; só contagens agregadas.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { computeAggregates } = require("./lib/computeAggregates");

initializeApp();
const db = getFirestore();

const BLIND_INDEX_KEY = defineSecret("BLIND_INDEX_KEY");
const RATE_LIMIT_HMAC_KEY = defineSecret("RATE_LIMIT_HMAC_KEY");

const RATE_LIMIT_GLOBAL = 60;
const RATE_LIMIT_GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_INVALID = 10;
const RATE_LIMIT_INVALID_WINDOW_MS = 15 * 60 * 1000;

// IDs de orgId/unitId/roundId são sempre gerados/validados aqui — nunca
// aceitos como texto livre, para não abrir caminho de path injection nas
// referências de coleção montadas por concatenação de string.
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function requireId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new HttpsError(
      "invalid-argument",
      `${label} inválido: deve ser alfanumérico (com '-' ou '_'), até 128 caracteres.`
    );
  }
}

// ───────────────────────────────────────────────────────────────────────
// Autorização de back-office (ver controle-acesso-custom-claims.md, §1)
// ───────────────────────────────────────────────────────────────────────
/**
 * @param {object} request
 * @param {string} [orgId] Se fornecido, exige que orgId esteja na lista
 *   `orgIds` do claim — impede operar organização fora do escopo.
 * @returns {{ role: string, orgIds: string[] }} o claim, para uso pelo
 *   chamador (ex: listOrgs usa orgIds para saber quais orgs listar).
 */
function assertBackOffice(request, orgId) {
  const claim = request.auth && request.auth.token && request.auth.token.backoffice;
  if (!claim || claim.role !== "backoffice_admin") {
    throw new HttpsError("permission-denied", "Operação restrita ao back-office.");
  }
  if (orgId && (!Array.isArray(claim.orgIds) || !claim.orgIds.includes(orgId))) {
    throw new HttpsError(
      "permission-denied",
      "Este operador não está autorizado para esta organização."
    );
  }
  return claim;
}

function blindIndex(stableEmployeeId, secretKey) {
  return crypto
    .createHmac("sha256", secretKey)
    .update(stableEmployeeId.trim().toLowerCase())
    .digest("hex");
}

function generateInviteCode() {
  return crypto.randomBytes(12).toString("base64url");
}

function hashIp(ip, secretKey) {
  return crypto.createHmac("sha256", secretKey).update(ip).digest("hex");
}

function getClientIp(request) {
  const raw = request.rawRequest;
  const fwd = raw?.headers?.["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return raw?.ip || "unknown";
}

async function checkBucket(key, limit, windowMs) {
  const windowIndex = Math.floor(Date.now() / windowMs);
  const bucketRef = db.collection("rate_limits").doc(`${key}__${windowIndex}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(bucketRef);
    const count = snap.exists ? snap.data().count : 0;
    if (count >= limit) return false;
    tx.set(
      bucketRef,
      { count: FieldValue.increment(1), expiresAt: new Date(Date.now() + windowMs * 2) },
      { merge: true }
    );
    return true;
  });
}

async function checkGlobalRateLimit(request, secretKey) {
  const ipHash = hashIp(getClientIp(request), secretKey);
  return checkBucket(`global_${ipHash}`, RATE_LIMIT_GLOBAL, RATE_LIMIT_GLOBAL_WINDOW_MS);
}

async function checkInvalidAttemptRateLimit(request, secretKey) {
  const ipHash = hashIp(getClientIp(request), secretKey);
  return checkBucket(`invalid_${ipHash}`, RATE_LIMIT_INVALID, RATE_LIMIT_INVALID_WINDOW_MS);
}

// ═══════════════════════════════════════════════════════════════════════
// Organizações
// ═══════════════════════════════════════════════════════════════════════

/** Cria uma organização. Não exige orgId no escopo do claim, porque o
 * orgId ainda não existe em nenhum claim até ser criado — a concessão do
 * acesso ao operador é um passo manual separado (set-backoffice-claim.js,
 * ver controle-acesso-custom-claims.md, "Concedido via"). */
exports.createOrg = onCall(async (request) => {
  assertBackOffice(request);
  const { orgId, name } = request.data || {};
  requireId(orgId, "orgId");
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new HttpsError("invalid-argument", "name é obrigatório.");
  }

  const orgRef = db.collection("orgs").doc(orgId);
  const snap = await orgRef.get();
  if (snap.exists) {
    throw new HttpsError("already-exists", "Já existe uma organização com este orgId.");
  }

  await orgRef.set({ name: name.trim(), createdAt: FieldValue.serverTimestamp() });
  return { orgId, name: name.trim() };
});

/** Lista só as organizações dentro do escopo (orgIds) do operador. */
exports.listOrgs = onCall(async (request) => {
  const claim = assertBackOffice(request);
  const orgIds = Array.isArray(claim.orgIds) ? claim.orgIds : [];
  if (orgIds.length === 0) return { orgs: [] };

  // Cláusula "in" do Firestore aceita no máximo 30 valores por consulta.
  const chunks = [];
  for (let i = 0; i < orgIds.length; i += 30) chunks.push(orgIds.slice(i, i + 30));

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      db.collection("orgs").where(FieldPath.documentId(), "in", chunk).get()
    )
  );

  const orgs = [];
  snaps.forEach((snap) => snap.forEach((doc) => orgs.push({ orgId: doc.id, ...doc.data() })));
  return { orgs };
});

// ═══════════════════════════════════════════════════════════════════════
// Unidades / hierarquia de setores (Decisão 4)
// ═══════════════════════════════════════════════════════════════════════

exports.listUnits = onCall(async (request) => {
  const { orgId } = request.data || {};
  requireId(orgId, "orgId");
  assertBackOffice(request, orgId);

  const snap = await db.collection("orgs").doc(orgId).collection("units").get();
  return { units: snap.docs.map((d) => ({ unitId: d.id, ...d.data() })) };
});

exports.createUnit = onCall(async (request) => {
  const { orgId, unitId, name, parentUnitId } = request.data || {};
  requireId(orgId, "orgId");
  requireId(unitId, "unitId");
  assertBackOffice(request, orgId);

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new HttpsError("invalid-argument", "name é obrigatório.");
  }
  if (parentUnitId != null) requireId(parentUnitId, "parentUnitId");
  if (parentUnitId === unitId) {
    throw new HttpsError("invalid-argument", "Uma unidade não pode ser pai de si mesma.");
  }

  const unitRef = db.collection("orgs").doc(orgId).collection("units").doc(unitId);
  const snap = await unitRef.get();
  if (snap.exists) {
    throw new HttpsError("already-exists", "Já existe uma unidade com este unitId.");
  }

  if (parentUnitId) {
    const parentSnap = await db.collection("orgs").doc(orgId).collection("units").doc(parentUnitId).get();
    if (!parentSnap.exists) {
      throw new HttpsError("failed-precondition", "parentUnitId não existe nesta organização.");
    }
  }

  await unitRef.set({
    name: name.trim(),
    parentUnitId: parentUnitId || null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { orgId, unitId, name: name.trim(), parentUnitId: parentUnitId || null };
});

exports.updateUnit = onCall(async (request) => {
  const { orgId, unitId, name, parentUnitId } = request.data || {};
  requireId(orgId, "orgId");
  requireId(unitId, "unitId");
  assertBackOffice(request, orgId);

  if (parentUnitId != null) requireId(parentUnitId, "parentUnitId");
  if (parentUnitId === unitId) {
    throw new HttpsError("invalid-argument", "Uma unidade não pode ser pai de si mesma.");
  }

  const unitRef = db.collection("orgs").doc(orgId).collection("units").doc(unitId);
  const snap = await unitRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Unidade não encontrada.");

  // Impede ciclo: sobe a cadeia de pais do parentUnitId proposto e
  // rejeita se, em algum ponto, chegar de volta a unitId.
  if (parentUnitId) {
    const unitsSnap = await db.collection("orgs").doc(orgId).collection("units").get();
    const units = {};
    unitsSnap.forEach((d) => (units[d.id] = d.data()));
    if (!units[parentUnitId]) {
      throw new HttpsError("failed-precondition", "parentUnitId não existe nesta organização.");
    }
    let cursor = parentUnitId;
    while (cursor) {
      if (cursor === unitId) {
        throw new HttpsError("invalid-argument", "Essa mudança criaria um ciclo na hierarquia.");
      }
      cursor = units[cursor]?.parentUnitId || null;
    }
  }

  const update = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof name === "string" && name.trim().length > 0) update.name = name.trim();
  if (parentUnitId !== undefined) update.parentUnitId = parentUnitId || null;

  await unitRef.update(update);
  return { orgId, unitId };
});

exports.deleteUnit = onCall(async (request) => {
  const { orgId, unitId } = request.data || {};
  requireId(orgId, "orgId");
  requireId(unitId, "unitId");
  assertBackOffice(request, orgId);

  const unitsRef = db.collection("orgs").doc(orgId).collection("units");
  const childSnap = await unitsRef.where("parentUnitId", "==", unitId).limit(1).get();
  if (!childSnap.empty) {
    throw new HttpsError(
      "failed-precondition",
      "Esta unidade tem filhos na hierarquia — mova ou remova os filhos primeiro."
    );
  }

  await unitsRef.doc(unitId).delete();
  return { orgId, unitId, deleted: true };
});

// ═══════════════════════════════════════════════════════════════════════
// Rodadas
// ═══════════════════════════════════════════════════════════════════════

exports.listRounds = onCall(async (request) => {
  const { orgId } = request.data || {};
  requireId(orgId, "orgId");
  assertBackOffice(request, orgId);

  const snap = await db.collection("orgs").doc(orgId).collection("rounds").get();
  return { rounds: snap.docs.map((d) => ({ roundId: d.id, ...d.data() })) };
});

exports.createRound = onCall(async (request) => {
  const { orgId, roundId, minK } = request.data || {};
  requireId(orgId, "orgId");
  requireId(roundId, "roundId");
  assertBackOffice(request, orgId);

  const k = Number.isInteger(minK) ? minK : 5; // Decisão 3 — padrão de mercado (Parte 5)
  if (k < 1) throw new HttpsError("invalid-argument", "minK deve ser um inteiro >= 1.");

  const roundRef = db.collection("orgs").doc(orgId).collection("rounds").doc(roundId);
  const snap = await roundRef.get();
  if (snap.exists) {
    throw new HttpsError("already-exists", "Já existe uma rodada com este roundId.");
  }

  await roundRef.set({
    minK: k,
    status: "aberta",
    createdAt: FieldValue.serverTimestamp(),
  });
  return { orgId, roundId, minK: k, status: "aberta" };
});

/**
 * Resumo operacional de uma rodada — só contagens (aggregation queries
 * via Admin SDK), nunca um documento de `responses` ou `invites`. É
 * seguro devolver isso ao back-office porque não revela conteúdo de
 * resposta nem identidade — mas ainda assim não é exposto ao
 * company_admin (ver firestore.rules: só `reports` é legível pela
 * empresa).
 */
exports.getRoundSummary = onCall(async (request) => {
  const { orgId, roundId } = request.data || {};
  requireId(orgId, "orgId");
  requireId(roundId, "roundId");
  assertBackOffice(request, orgId);

  const roundRef = db.collection("orgs").doc(orgId).collection("rounds").doc(roundId);
  const roundSnap = await roundRef.get();
  if (!roundSnap.exists) throw new HttpsError("not-found", "Rodada não encontrada.");

  const [invitesCount, usedCount, responsesCount, reportsCount] = await Promise.all([
    roundRef.collection("invites").count().get(),
    roundRef.collection("invites").where("used", "==", true).count().get(),
    roundRef.collection("responses").count().get(),
    roundRef.collection("reports").count().get(),
  ]);

  return {
    orgId,
    roundId,
    minK: roundSnap.data().minK,
    status: roundSnap.data().status || "aberta",
    invitesSent: invitesCount.data().count,
    invitesUsed: usedCount.data().count,
    responsesReceived: responsesCount.data().count,
    reportsGenerated: reportsCount.data().count,
  };
});

// ═══════════════════════════════════════════════════════════════════════
// importInvites — Decisão 2
// ═══════════════════════════════════════════════════════════════════════
exports.importInvites = onCall(
  { secrets: [BLIND_INDEX_KEY] },
  async (request) => {
    const { orgId, roundId, employees } = request.data || {};
    requireId(orgId, "orgId");
    requireId(roundId, "roundId");
    assertBackOffice(request, orgId);

    if (!Array.isArray(employees) || employees.length === 0) {
      throw new HttpsError("invalid-argument", "employees deve ser um array não vazio.");
    }
    if (employees.length > 500) {
      throw new HttpsError(
        "invalid-argument",
        "employees excede 500 itens por chamada (limite de operações do batch). Divida em múltiplas chamadas."
      );
    }

    const secretKey = BLIND_INDEX_KEY.value();
    const batch = db.batch();
    const invites = [];

    for (const { stableEmployeeId, unitId } of employees) {
      if (typeof stableEmployeeId !== "string" || stableEmployeeId.trim().length === 0) {
        throw new HttpsError("invalid-argument", "Cada item de employees precisa de stableEmployeeId.");
      }
      requireId(unitId, "unitId (em employees[])");

      const code = generateInviteCode();
      const hash = blindIndex(stableEmployeeId, secretKey);
      // stableEmployeeId sai de escopo aqui — não é escrito em lugar algum.

      const inviteRef = db
        .collection("orgs").doc(orgId)
        .collection("rounds").doc(roundId)
        .collection("invites").doc(code);

      batch.set(inviteRef, {
        unitId,
        blindIndex: hash,
        used: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      invites.push({ code, unitId });
    }

    await batch.commit();
    return { count: invites.length, invites };
  }
);

// ═══════════════════════════════════════════════════════════════════════
// submitResponse — chamada pelo trabalhador (sem alteração de lógica)
// ═══════════════════════════════════════════════════════════════════════
exports.submitResponse = onCall(
  { secrets: [BLIND_INDEX_KEY, RATE_LIMIT_HMAC_KEY] },
  async (request) => {
    const { orgId, roundId, code, answers } = request.data || {};
    if (!code || !answers) {
      throw new HttpsError("invalid-argument", "Código e respostas são obrigatórios.");
    }

    const rateLimitKey = RATE_LIMIT_HMAC_KEY.value();

    const withinGlobalLimit = await checkGlobalRateLimit(request, rateLimitKey);
    if (!withinGlobalLimit) {
      throw new HttpsError("resource-exhausted", "Muitas requisições. Tente novamente mais tarde.");
    }

    const roundRef = db.collection("orgs").doc(orgId).collection("rounds").doc(roundId);
    const inviteRef = roundRef.collection("invites").doc(code);

    let result;
    try {
      result = await db.runTransaction(async (tx) => {
        const inviteSnap = await tx.get(inviteRef);
        if (!inviteSnap.exists) {
          const err = new HttpsError("not-found", "Código de acesso inválido.");
          err.invalidAttempt = true;
          throw err;
        }
        const invite = inviteSnap.data();

        if (invite.used) {
          const err = new HttpsError("already-exists", "Esta pesquisa já foi respondida com este acesso.");
          err.invalidAttempt = true;
          throw err;
        }

        const linkageRef = roundRef.collection("linkage").doc(invite.blindIndex);
        const linkageSnap = await tx.get(linkageRef);
        if (linkageSnap.exists) {
          const err = new HttpsError(
            "already-exists",
            "Já existe uma resposta registrada para este participante nesta rodada."
          );
          err.invalidAttempt = true;
          throw err;
        }

        const participantRef = db.collection("orgs").doc(orgId).collection("participants").doc(invite.blindIndex);
        const participantSnap = await tx.get(participantRef);

        const responseRef = roundRef.collection("responses").doc();
        tx.set(responseRef, {
          unitId: invite.unitId,
          answers,
          submittedAt: FieldValue.serverTimestamp(),
        });

        tx.set(linkageRef, { usedAt: FieldValue.serverTimestamp() });
        tx.update(inviteRef, { used: true });

        tx.set(
          participantRef,
          {
            lastRoundId: roundId,
            ...(participantSnap.exists ? {} : { firstRoundId: roundId }),
          },
          { merge: true }
        );

        return { unitId: invite.unitId };
      });
    } catch (err) {
      if (err.invalidAttempt) {
        const withinInvalidLimit = await checkInvalidAttemptRateLimit(request, rateLimitKey);
        if (!withinInvalidLimit) {
          throw new HttpsError("resource-exhausted", "Muitas tentativas inválidas. Tente novamente mais tarde.");
        }
      }
      throw err;
    }

    return { status: "ok", unitId: result.unitId };
  }
);

// ═══════════════════════════════════════════════════════════════════════
// computeAggregateReport — Decisões 3 e 4
// ═══════════════════════════════════════════════════════════════════════
exports.computeAggregateReport = onCall(async (request) => {
  const { orgId, roundId } = request.data || {};
  requireId(orgId, "orgId");
  requireId(roundId, "roundId");
  assertBackOffice(request, orgId);

  const roundRef = db.collection("orgs").doc(orgId).collection("rounds").doc(roundId);
  const roundSnap = await roundRef.get();
  if (!roundSnap.exists) throw new HttpsError("not-found", "Rodada não encontrada.");
  const { minK } = roundSnap.data();

  const unitsSnap = await db.collection("orgs").doc(orgId).collection("units").get();
  const units = {};
  unitsSnap.forEach((doc) => (units[doc.id] = { id: doc.id, ...doc.data() }));

  const responsesSnap = await roundRef.collection("responses").get();
  const countByUnit = {};
  const answersByUnit = {};
  responsesSnap.forEach((doc) => {
    const { unitId, answers } = doc.data();
    countByUnit[unitId] = (countByUnit[unitId] || 0) + 1;
    (answersByUnit[unitId] ||= []).push(answers);
  });

  const batch = db.batch();
  const reportedUnits = new Set();
  const skippedBelowThreshold = [];

  for (const unitId of Object.keys(units)) {
    if (reportedUnits.has(unitId)) continue;

    let currentId = unitId;
    let mergedCount = 0;
    let mergedAnswers = [];
    const fusedFrom = [];

    while (currentId) {
      mergedCount += countByUnit[currentId] || 0;
      mergedAnswers = mergedAnswers.concat(answersByUnit[currentId] || []);
      fusedFrom.push(currentId);
      if (mergedCount >= minK) break;
      currentId = units[currentId]?.parentUnitId || null;
    }

    if (mergedCount === 0) continue;

    if (mergedCount >= minK) {
      const finalUnitId = fusedFrom[fusedFrom.length - 1];
      const reportRef = roundRef.collection("reports").doc(finalUnitId);
      batch.set(reportRef, {
        unitId: finalUnitId,
        unitName: units[finalUnitId]?.name || finalUnitId,
        fusedFrom,
        n: mergedCount,
        ...computeAggregates(mergedAnswers),
        computedAt: FieldValue.serverTimestamp(),
      });
      fusedFrom.forEach((id) => reportedUnits.add(id));
    } else {
      skippedBelowThreshold.push({ unitId, mergedCount });
      fusedFrom.forEach((id) => reportedUnits.add(id));
    }
  }

  batch.update(roundRef, { status: "fechada", closedAt: FieldValue.serverTimestamp() });

  await batch.commit();
  return { status: "ok", skippedBelowThreshold };
});
