/**
 * Cloud Functions — Software de Pesquisa Psicossocial (NR-1)
 *
 * Três funções, cada uma implementando diretamente uma das seis decisões
 * de produto tomadas a partir da pesquisa bibliográfica (Partes 1-5):
 *
 *   importInvites          -> Decisão 2 (acesso via código do RH,
 *                              identificador do trabalhador nunca persiste)
 *   submitResponse          -> Decisões 1, 2 e 5 (blind index, sem
 *                              digitação, resposta definitiva) + rate
 *                              limiting (ver seção "Rate limiting" abaixo)
 *   computeAggregateReport  -> Decisões 3 e 4 (limiar sempre automático,
 *                              fusão hierárquica)
 *
 * Toda leitura/escrita a coleções sensíveis usa o Admin SDK (via
 * getFirestore()), que ignora as Security Rules por design — ver
 * firestore.rules para o motivo (Parte 4 da pesquisa: agregação nativa
 * segue as mesmas regras de leitura de documento, então o cálculo do
 * agregado não pode depender de regra declarativa).
 *
 * ─── Rate limiting (submitResponse) ─────────────────────────────────────
 * submitResponse é público e sem autenticação — protegido só pelo código
 * de convite. O risco não é abuso de conta autenticada, é brute-force de
 * código ou flood. Duas janelas por IP, contadas separadamente:
 *
 *   - "global"  — toda tentativa, válida ou não. Limite frouxo — precisa
 *     tolerar o caso comum de várias pessoas do mesmo escritório (mesmo
 *     IP/NAT corporativo) respondendo ao mesmo tempo.
 *   - "invalid" — só tentativas com código inexistente/já usado/duplicado.
 *     Limite estrito — é o sinal real de brute-force.
 *
 * O IP nunca é persistido em claro: é hasheado com HMAC usando uma chave
 * PRÓPRIA (secret RATE_LIMIT_HMAC_KEY), separada da BLIND_INDEX_KEY —
 * nunca reaproveitar chave de HMAC entre mecanismos diferentes.
 *
 * Os buckets se auto-destroem via TTL nativo do Firestore (campo
 * `expiresAt`) — isso exige configurar a TTL policy na coleção
 * `rate_limits` fora do código (console do Firebase ou gcloud CLI),
 * já que Cloud Functions não gerencia índices/TTL.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

// Chave secreta do HMAC — nunca em código, nunca em documento do
// Firestore. Configurada via Secret Manager (firebase functions:secrets:set).
const BLIND_INDEX_KEY = defineSecret("BLIND_INDEX_KEY");

// Chave separada para o hash de rate limiting — mesmo mecanismo
// (HMAC-SHA256), mas propósito e blast radius diferentes do blind
// index, então vive em segredo próprio.
const RATE_LIMIT_HMAC_KEY = defineSecret("RATE_LIMIT_HMAC_KEY");

const RATE_LIMIT_GLOBAL = 60; // tentativas por IP
const RATE_LIMIT_GLOBAL_WINDOW_MS = 60 * 60 * 1000; // 1 hora

const RATE_LIMIT_INVALID = 10; // tentativas com código inválido/usado por IP
const RATE_LIMIT_INVALID_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

/**
 * Calcula o blind index (Parte 3) de um identificador estável do
 * trabalhador. HMAC-SHA256 com chave secreta — a mesma entrada sempre
 * produz o mesmo hash, permitindo checar duplicidade e continuidade
 * entre rodadas (Decisão 1) sem jamais reverter para o identificador
 * original.
 */
function blindIndex(stableEmployeeId, secretKey) {
  return crypto
    .createHmac("sha256", secretKey)
    .update(stableEmployeeId.trim().toLowerCase())
    .digest("hex");
}

/**
 * Gera um código de convite curto e não-adivinhável para o link que o
 * RH envia ao trabalhador (Decisão 2). Não carrega nenhuma informação
 * sobre a identidade da pessoa.
 */
function generateInviteCode() {
  return crypto.randomBytes(12).toString("base64url");
}

/** Hash HMAC do IP do requisitante — nunca persistir o IP em claro. */
function hashIp(ip, secretKey) {
  return crypto.createHmac("sha256", secretKey).update(ip).digest("hex");
}

/** Extrai o IP do requisitante numa Cloud Function v2 (onCall). */
function getClientIp(request) {
  const raw = request.rawRequest;
  const fwd = raw?.headers?.["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return raw?.ip || "unknown";
}

/**
 * Lê e incrementa um bucket de janela fixa numa única transação.
 * Retorna `false` sem incrementar se o bucket já está no limite.
 */
async function checkBucket(key, limit, windowMs) {
  const windowIndex = Math.floor(Date.now() / windowMs);
  const bucketRef = db.collection("rate_limits").doc(`${key}__${windowIndex}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(bucketRef);
    const count = snap.exists ? snap.data().count : 0;

    if (count >= limit) {
      return false;
    }

    tx.set(
      bucketRef,
      {
        count: FieldValue.increment(1),
        expiresAt: new Date(Date.now() + windowMs * 2),
      },
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

// ───────────────────────────────────────────────────────────────────────
// importInvites — chamada uma vez pelo RH/back-office ao abrir uma rodada
// ───────────────────────────────────────────────────────────────────────
//
// Recebe a lista de trabalhadores (identificador estável + setor) só
// nesta chamada. O identificador em claro NUNCA é persistido em nenhum
// documento — é usado apenas em memória para calcular o blind index, e
// descartado ao fim da execução da função.
exports.importInvites = onCall(
  { secrets: [BLIND_INDEX_KEY] },
  async (request) => {
    assertBackOffice(request); // checagem de papel administrativo, não implementada aqui

    const { orgId, roundId, employees } = request.data;
    // employees: [{ stableEmployeeId, unitId }, ...] — vem do sistema de
    // RH da empresa, nunca digitado pelo trabalhador.

    const secretKey = BLIND_INDEX_KEY.value();
    const batch = db.batch();
    const invites = [];

    for (const { stableEmployeeId, unitId } of employees) {
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

      invites.push({ code, unitId }); // devolvido ao RH para montar os links
    }

    await batch.commit();
    return { count: invites.length, invites };
  }
);

// ───────────────────────────────────────────────────────────────────────
// submitResponse — chamada pelo trabalhador ao abrir o link do RH
// ───────────────────────────────────────────────────────────────────────
exports.submitResponse = onCall(
  { secrets: [BLIND_INDEX_KEY, RATE_LIMIT_HMAC_KEY] },
  async (request) => {
    const { orgId, roundId, code, answers } = request.data;

    if (!code || !answers) {
      throw new HttpsError("invalid-argument", "Código e respostas são obrigatórios.");
    }

    const rateLimitKey = RATE_LIMIT_HMAC_KEY.value();

    // Camada 1: limite global por IP, antes de tocar em qualquer dado
    // de convite — barra flood grosseiro independentemente do código
    // ser válido.
    const withinGlobalLimit = await checkGlobalRateLimit(request, rateLimitKey);
    if (!withinGlobalLimit) {
      throw new HttpsError("resource-exhausted", "Muitas requisições. Tente novamente mais tarde.");
    }

    const roundRef = db.collection("orgs").doc(orgId).collection("rounds").doc(roundId);
    const inviteRef = roundRef.collection("invites").doc(code);

    // Transação: checar convite válido e não usado, gravar resposta,
    // marcar convite como usado e atualizar o índice de linkage — tudo
    // ou nada, para não deixar um convite "meio usado" em caso de falha.
    let result;
    try {
      result = await db.runTransaction(async (tx) => {
        // ── FASE 1: todas as leituras primeiro (regra de transação do
        // Firestore — nenhuma escrita pode ocorrer antes da última leitura).
        const inviteSnap = await tx.get(inviteRef);
        if (!inviteSnap.exists) {
          const err = new HttpsError("not-found", "Código de acesso inválido.");
          err.invalidAttempt = true;
          throw err;
        }
        const invite = inviteSnap.data();

        if (invite.used) {
          // Decisão 5: resposta é definitiva. Um código já usado nunca
          // permite nova submissão — não existe fluxo de edição.
          const err = new HttpsError(
            "already-exists",
            "Esta pesquisa já foi respondida com este acesso."
          );
          err.invalidAttempt = true;
          throw err;
        }

        // Checagem adicional de duplicidade via linkage, além do flag
        // `used` do convite — defesa em profundidade caso o mesmo
        // trabalhador tenha recebido, por engano, mais de um convite.
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

        const participantRef = db
          .collection("orgs").doc(orgId)
          .collection("participants").doc(invite.blindIndex);
        const participantSnap = await tx.get(participantRef);

        // ── FASE 2: agora todas as escritas.
        // Grava a resposta. Note que o blindIndex NÃO é salvo neste
        // documento — fica isolado na coleção `linkage`, separando
        // conteúdo da resposta do mecanismo de identificação, no mesmo
        // espírito do "Index Blind Storage" mapeado na Parte 3.
        const responseRef = roundRef.collection("responses").doc();
        tx.set(responseRef, {
          unitId: invite.unitId,
          answers,
          submittedAt: FieldValue.serverTimestamp(),
        });

        tx.set(linkageRef, {
          usedAt: FieldValue.serverTimestamp(),
        });

        tx.update(inviteRef, { used: true });

        // Continuidade entre rodadas (Decisão 1): registra metadado de
        // participação em nível de organização, sem nenhuma resposta
        // anexada — só permite, no futuro, calcular estatísticas
        // longitudinais agregadas (ex: "quantos participam há 3+ anos").
        tx.set(
          participantRef,
          {
            lastRoundId: roundId,
            // firstRoundId só é gravado na primeira vez que este blind
            // index aparece — não é sobrescrito em rodadas seguintes.
            ...(participantSnap.exists ? {} : { firstRoundId: roundId }),
          },
          { merge: true }
        );

        return { unitId: invite.unitId };
      });
    } catch (err) {
      // Camada 2: só conta contra o limite quando a tentativa era
      // realmente inválida — nunca em erro de infraestrutura, pra não
      // confundir instabilidade com abuso.
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

// ───────────────────────────────────────────────────────────────────────
// computeAggregateReport — roda no fechamento da rodada (agendada ou
// disparada manualmente pelo back-office; nunca pelo cliente da empresa)
// ───────────────────────────────────────────────────────────────────────
exports.computeAggregateReport = onCall(async (request) => {
  assertBackOffice(request);
  const { orgId, roundId } = request.data;

  const roundRef = db.collection("orgs").doc(orgId).collection("rounds").doc(roundId);
  const roundSnap = await roundRef.get();
  if (!roundSnap.exists) throw new HttpsError("not-found", "Rodada não encontrada.");
  const { minK } = roundSnap.data(); // limiar mínimo (Decisão 3) — ex: 5

  // Carrega toda a hierarquia de setores da empresa (Decisão 4).
  const unitsSnap = await db.collection("orgs").doc(orgId).collection("units").get();
  const units = {};
  unitsSnap.forEach((doc) => (units[doc.id] = { id: doc.id, ...doc.data() }));

  // Conta respostas por setor (Admin SDK — agregação segura, ver
  // Parte 4: aqui não há problema porque o Admin SDK ignora as regras
  // de qualquer forma; a distinção que importa é que o CLIENTE nunca
  // executa este tipo de consulta).
  const responsesSnap = await roundRef.collection("responses").get();
  const countByUnit = {};
  const answersByUnit = {};
  responsesSnap.forEach((doc) => {
    const { unitId, answers } = doc.data();
    countByUnit[unitId] = (countByUnit[unitId] || 0) + 1;
    (answersByUnit[unitId] ||= []).push(answers);
  });

  // Para cada setor-folha, sobe a hierarquia até atingir o limiar
  // mínimo (Decisão 4) ou esgotar os níveis (caso-limite ainda em
  // aberto — ver documento de decisões de produto).
  const batch = db.batch();
  const reportedUnits = new Set();

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

    if (mergedCount === 0) continue; // ninguém respondeu nesse ramo ainda

    const reportRef = roundRef.collection("reports").doc(fusedFrom[fusedFrom.length - 1]);
    // O relatório é gravado no ID do nível onde o limiar foi atingido
    // (ou o topo da hierarquia, no caso-limite) — os setores originais
    // ficam registrados em `fusedFrom` só para fins de auditoria interna,
    // nunca exibidos individualmente se abaixo do limiar.
    if (mergedCount >= minK) {
      batch.set(reportRef, {
        n: mergedCount,
        fusedFrom,
        aggregates: computeAggregates(mergedAnswers), // ex: médias por dimensão
        computedAt: FieldValue.serverTimestamp(),
      });
      fusedFrom.forEach((id) => reportedUnits.add(id));
    }
    // Se mesmo no topo da hierarquia mergedCount < minK, nenhum
    // relatório é gravado para este ramo — decisão pendente conforme
    // documento de decisões de produto.
  }

  await batch.commit();
  return { status: "ok" };
});

/** Placeholder — cálculo real das médias/distribuições por dimensão do
 * questionário (COPSOQ ou equivalente, ver dossiê de pesquisa legal). */
function computeAggregates(answersList) {
  // Implementação depende do desenho final do questionário.
  return { responseCount: answersList.length };
}

function assertBackOffice(request) {
  if (!request.auth || request.auth.token.role !== "backoffice_admin") {
    throw new HttpsError("permission-denied", "Operação restrita ao back-office.");
  }
}
