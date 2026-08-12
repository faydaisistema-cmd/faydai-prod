// scripts/set-backoffice-claim.js
//
// Atribui (ou revoga) o custom claim `backoffice_admin` a um usuário do
// Firebase Auth. Execução MANUAL, local, por administrador de confiança
// — nunca exposto como endpoint HTTP (ver controle-acesso-custom-claims.md,
// seção 1: "Concedido via scripts/set-backoffice-claim.js, execução manual
// local por administrador de confiança. Nunca via endpoint HTTP público").
//
// Requer a mesma variável de ambiente FIREBASE_SERVICE_ACCOUNT usada em
// api/_lib/firebaseAdmin.js (conteúdo JSON da conta de serviço).
//
// ── USO ──────────────────────────────────────────────────────────────
//
// Conceder acesso a duas organizações:
//   node scripts/set-backoffice-claim.js grant <uid> org_123,org_456
//
// Adicionar UMA organização à lista já existente do usuário (sem apagar
// as outras que ele já tinha):
//   node scripts/set-backoffice-claim.js add <uid> org_789
//
// Remover UMA organização da lista (mantém o claim, só tira o acesso a
// essa org específica):
//   node scripts/set-backoffice-claim.js remove <uid> org_456
//
// Revogar o claim inteiro (usuário deixa de ser backoffice_admin em
// qualquer organização) + invalidar tokens já emitidos:
//   node scripts/set-backoffice-claim.js revoke <uid>
//
// ─────────────────────────────────────────────────────────────────────

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

function initAdmin() {
  if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(serviceAccount) });
  }
}

async function main() {
  const [, , command, uid, orgArg] = process.argv;

  if (!command || !uid || (command !== "revoke" && !orgArg)) {
    console.error(
      "Uso: node scripts/set-backoffice-claim.js <grant|add|remove|revoke> <uid> [orgIds separados por vírgula]"
    );
    process.exit(1);
  }

  initAdmin();
  const auth = getAuth();

  const userRecord = await auth.getUser(uid);
  const existingClaim = userRecord.customClaims?.backoffice || { role: "backoffice_admin", orgIds: [] };

  let newClaims;

  if (command === "revoke") {
    // Remove o namespace `backoffice` inteiro; preserva outros namespaces
    // (ex: `company`) que porventura já existam no mesmo token — ver
    // controle-acesso-custom-claims.md, seção 0, sobre uma mesma pessoa
    // acumular os dois papéis.
    const { backoffice, ...rest } = userRecord.customClaims || {};
    newClaims = Object.keys(rest).length > 0 ? rest : null;
  } else {
    const orgIds = orgArg.split(",").map((s) => s.trim()).filter(Boolean);
    let updatedOrgIds;

    if (command === "grant") {
      updatedOrgIds = orgIds; // substitui a lista inteira
    } else if (command === "add") {
      updatedOrgIds = Array.from(new Set([...existingClaim.orgIds, ...orgIds]));
    } else if (command === "remove") {
      updatedOrgIds = existingClaim.orgIds.filter((id) => !orgIds.includes(id));
    } else {
      console.error(`Comando desconhecido: ${command}`);
      process.exit(1);
    }

    newClaims = {
      ...(userRecord.customClaims || {}),
      backoffice: { role: "backoffice_admin", orgIds: updatedOrgIds },
    };
  }

  await auth.setCustomUserClaims(uid, newClaims);

  // Força o usuário a obter um novo ID token com o claim atualizado na
  // próxima requisição — sem isso, um token já emitido continuaria
  // válido com o claim antigo até expirar (até 1h).
  await auth.revokeRefreshTokens(uid);

  console.log(`✅ Claim atualizado para uid=${uid}:`);
  console.log(JSON.stringify(newClaims, null, 2));
  console.log("Refresh tokens revogados — usuário precisa fazer login novamente.");
}

main().catch((err) => {
  console.error("Erro ao atualizar claim:", err);
  process.exit(1);
});

