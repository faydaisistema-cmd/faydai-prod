/**
 * Testes das Security Rules (firestore.rules) contra o Firestore Emulator.
 *
 * Cobre o contrato descrito em controle-acesso-custom-claims.md:
 *  - company_admin só lê `reports` do próprio orgId (nunca de outro orgId)
 *  - company_admin lê metadados não sensíveis: orgs/{orgId}, units, rounds
 *  - invites, responses, linkage, participants: SEMPRE negado, mesmo para
 *    company_admin do próprio org e mesmo autenticado
 *  - write em qualquer coleção via cliente: sempre negado (só Admin SDK)
 *  - usuário não autenticado: negado em tudo
 *  - claim `backoffice` presente não deve, por si só, liberar leitura via
 *    rules (backoffice_admin é validado só no middleware/Admin SDK, nunca
 *    aqui — ver seção 2 de controle-acesso-custom-claims.md)
 *
 * Rodar:
 *   npm install
 *   npm test
 *
 * (roda `firebase emulators:exec` internamente — não precisa subir o
 * emulador manualmente, mas é preciso ter Java instalado localmente,
 * exigência do próprio Firestore Emulator.)
 */

const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc } = require("firebase/firestore");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ORG_A = "org_123";
const ORG_B = "org_456";

let testEnv;

before(async function () {
  this.timeout(20000);
  testEnv = await initializeTestEnvironment({
    projectId: "faydai-rules-test",
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

/** Popula dados usando um contexto sem regras (equivalente ao Admin SDK). */
async function seed(orgId, unitId) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "orgs", orgId), { name: "Empresa " + orgId });
    await setDoc(doc(db, "orgs", orgId, "units", unitId), { parentUnitId: null });
    await setDoc(doc(db, "orgs", orgId, "rounds", "round_1"), { minK: 5 });
    await setDoc(doc(db, "orgs", orgId, "rounds", "round_1", "reports", unitId), {
      n: 8,
      aggregates: { responseCount: 8 },
    });
    await setDoc(doc(db, "orgs", orgId, "rounds", "round_1", "invites", "code_1"), {
      unitId,
      blindIndex: "hash_abc",
      used: false,
    });
    await setDoc(doc(db, "orgs", orgId, "rounds", "round_1", "responses", "resp_1"), {
      unitId,
      answers: { q1: 2 },
    });
    await setDoc(doc(db, "orgs", orgId, "rounds", "round_1", "linkage", "hash_abc"), {
      usedAt: new Date(),
    });
    await setDoc(doc(db, "orgs", orgId, "participants", "hash_abc"), {
      lastRoundId: "round_1",
    });
  });
}

function companyAdmin(orgId) {
  return testEnv.authenticatedContext("company_user_uid", {
    company: { role: "company_admin", orgId },
  });
}

function backofficeOnly() {
  // Simula um token que só tem o namespace `backoffice` — nunca deve
  // ganhar leitura via rules, porque backoffice_admin não é checado aqui.
  return testEnv.authenticatedContext("backoffice_user_uid", {
    backoffice: { role: "backoffice_admin", orgIds: [ORG_A, ORG_B] },
  });
}

function anon() {
  return testEnv.unauthenticatedContext();
}

describe("reports/{unitId}", () => {
  beforeEach(async () => {
    await seed(ORG_A, "unit_1");
    await seed(ORG_B, "unit_1");
  });

  it("company_admin lê reports do PRÓPRIO org", async () => {
    const db = companyAdmin(ORG_A).firestore();
    await assertSucceeds(
      getDoc(doc(db, "orgs", ORG_A, "rounds", "round_1", "reports", "unit_1"))
    );
  });

  it("company_admin NÃO lê reports de OUTRO org", async () => {
    const db = companyAdmin(ORG_A).firestore();
    await assertFails(
      getDoc(doc(db, "orgs", ORG_B, "rounds", "round_1", "reports", "unit_1"))
    );
  });

  it("claim só com namespace backoffice NÃO lê reports via rules", async () => {
    const db = backofficeOnly().firestore();
    await assertFails(
      getDoc(doc(db, "orgs", ORG_A, "rounds", "round_1", "reports", "unit_1"))
    );
  });

  it("usuário não autenticado NÃO lê reports", async () => {
    const db = anon().firestore();
    await assertFails(
      getDoc(doc(db, "orgs", ORG_A, "rounds", "round_1", "reports", "unit_1"))
    );
  });

  it("company_admin NÃO escreve em reports (só Admin SDK)", async () => {
    const db = companyAdmin(ORG_A).firestore();
    await assertFails(
      setDoc(doc(db, "orgs", ORG_A, "rounds", "round_1", "reports", "unit_2"), { n: 99 })
    );
  });
});

describe("coleções sempre bloqueadas ao cliente (invites, responses, linkage, participants)", () => {
  beforeEach(async () => {
    await seed(ORG_A, "unit_1");
  });

  const paths = [
    (o) => ["orgs", o, "rounds", "round_1", "invites", "code_1"],
    (o) => ["orgs", o, "rounds", "round_1", "responses", "resp_1"],
    (o) => ["orgs", o, "rounds", "round_1", "linkage", "hash_abc"],
    (o) => ["orgs", o, "participants", "hash_abc"],
  ];

  for (const p of paths) {
    const segs = p(ORG_A);
    const label = segs.join("/");

    it(`company_admin do próprio org NÃO lê ${label}`, async () => {
      const db = companyAdmin(ORG_A).firestore();
      await assertFails(getDoc(doc(db, ...segs)));
    });

    it(`usuário não autenticado NÃO lê ${label}`, async () => {
      const db = anon().firestore();
      await assertFails(getDoc(doc(db, ...segs)));
    });
  }
});

describe("metadados não sensíveis (orgs, units, rounds)", () => {
  beforeEach(async () => {
    await seed(ORG_A, "unit_1");
  });

  it("company_admin lê orgs/{orgId} do próprio org", async () => {
    const db = companyAdmin(ORG_A).firestore();
    await assertSucceeds(getDoc(doc(db, "orgs", ORG_A)));
  });

  it("company_admin lê units do próprio org", async () => {
    const db = companyAdmin(ORG_A).firestore();
    await assertSucceeds(getDoc(doc(db, "orgs", ORG_A, "units", "unit_1")));
  });

  it("company_admin lê rounds do próprio org", async () => {
    const db = companyAdmin(ORG_A).firestore();
    await assertSucceeds(getDoc(doc(db, "orgs", ORG_A, "rounds", "round_1")));
  });

  it("company_admin NÃO lê units de outro org", async () => {
    await seed(ORG_B, "unit_1");
    const db = companyAdmin(ORG_A).firestore();
    await assertFails(getDoc(doc(db, "orgs", ORG_B, "units", "unit_1")));
  });

  it("ninguém escreve em orgs/{orgId} via cliente", async () => {
    const db = companyAdmin(ORG_A).firestore();
    await assertFails(setDoc(doc(db, "orgs", ORG_A), { name: "hack" }));
  });
});
