// dashboard-firestore-reads.js
//
// Funções de leitura para o PsychosocialDashboard.jsx, autenticadas com
// o custom claim `company_admin` (ver firestore.rules). Leem SOMENTE as
// coleções permitidas ao cliente: orgs/{orgId}, orgs/{orgId}/units, e
// orgs/{orgId}/rounds/{roundId}/reports.
//
// Extraído de schema-avaliacao-psicossocial.md (Seção 3).

import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "./firebaseClient"; // inicialização do Firestore client-side

/**
 * Lista de relatórios disponíveis para a rodada — já agregados e
 * filtrados pelo limiar de k-anonimato dentro da Cloud Function
 * computeAggregateReport. Se um setor não atingiu o limiar, ele
 * simplesmente não aparece aqui.
 */
export async function getReports(orgId, roundId) {
  const snap = await getDocs(
    collection(db, "orgs", orgId, "rounds", roundId, "reports")
  );
  return snap.docs.map((d) => ({ unitId: d.id, ...d.data() }));
}

/**
 * Hierarquia de setores da empresa, usada para rotular os relatórios
 * fundidos (ex: mostrar "Manutenção + Qualidade" quando
 * fusedFrom.length > 1).
 */
export async function getUnits(orgId) {
  const snap = await getDocs(collection(db, "orgs", orgId, "units"));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
}

/**
 * Metadados não sensíveis da empresa (nome, config geral).
 */
export async function getOrg(orgId) {
  const snap = await getDoc(doc(db, "orgs", orgId));
  return snap.exists() ? snap.data() : null;
}

/**
 * Compara relatórios entre rodadas diferentes. Diferente do desenho
 * antigo (period_aggregates, 1 leitura por período), aqui cada rodada
 * exige uma leitura de coleção própria — ainda barato, mas não é O(1).
 */
export async function compareRounds(orgId, roundIds) {
  const results = await Promise.all(
    roundIds.map(async (roundId) => ({
      roundId,
      reports: await getReports(orgId, roundId),
    }))
  );
  return results;
}
