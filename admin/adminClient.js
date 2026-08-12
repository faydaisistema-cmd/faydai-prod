// admin/adminClient.js
//
// Wrapper fino sobre os callables de back-office (functions/index.js).
// Nenhuma dessas chamadas toca o Firestore diretamente pelo cliente —
// tudo passa pelo Admin SDK do lado do servidor, por isso o operador de
// back-office não precisa (e não deve) ter regra de leitura liberada no
// firestore.rules. Autenticação: o usuário já precisa estar logado com o
// custom claim `backoffice` (ver controle-acesso-custom-claims.md) antes
// de qualquer uma dessas chamadas funcionar — o fluxo de login em si é
// responsabilidade de fora deste arquivo.

import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebaseClient"; // mesma inicialização usada pelo dashboard da empresa

const functions = getFunctions(app);
const call = (name) => httpsCallable(functions, name);

export const listOrgs = () => call("listOrgs")().then((r) => r.data.orgs);

export const createOrg = (orgId, name) =>
  call("createOrg")({ orgId, name }).then((r) => r.data);

export const listUnits = (orgId) =>
  call("listUnits")({ orgId }).then((r) => r.data.units);

export const createUnit = (orgId, unitId, name, parentUnitId) =>
  call("createUnit")({ orgId, unitId, name, parentUnitId: parentUnitId || null }).then((r) => r.data);

export const updateUnit = (orgId, unitId, name, parentUnitId) =>
  call("updateUnit")({ orgId, unitId, name, parentUnitId: parentUnitId ?? null }).then((r) => r.data);

export const deleteUnit = (orgId, unitId) =>
  call("deleteUnit")({ orgId, unitId }).then((r) => r.data);

export const listRounds = (orgId) =>
  call("listRounds")({ orgId }).then((r) => r.data.rounds);

export const createRound = (orgId, roundId, minK) =>
  call("createRound")({ orgId, roundId, minK }).then((r) => r.data);

export const getRoundSummary = (orgId, roundId) =>
  call("getRoundSummary")({ orgId, roundId }).then((r) => r.data);

/**
 * employees: [{ stableEmployeeId, unitId }, ...]
 * Retorna { count, invites: [{ code, unitId }] } — o stableEmployeeId
 * nunca volta do servidor, nem em eco; ele já saiu de escopo lá dentro.
 */
export const importInvites = (orgId, roundId, employees) =>
  call("importInvites")({ orgId, roundId, employees }).then((r) => r.data);

export const computeAggregateReport = (orgId, roundId) =>
  call("computeAggregateReport")({ orgId, roundId }).then((r) => r.data);
