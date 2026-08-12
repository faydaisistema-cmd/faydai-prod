// admin/AdminApp.jsx
//
// Interface administrativa de back-office (operadores Faydai, papel
// backoffice_admin — ver controle-acesso-custom-claims.md, §1). Cobre o
// CRUD completo pedido: organizações, hierarquia de setores, rodadas,
// importação de convites e fechamento de rodada (disparo do relatório
// agregado). Nenhuma tela aqui lê `responses`, `invites` (conteúdo) ou
// `linkage` diretamente — só contagens vindas de getRoundSummary() e os
// metadados que os próprios callables devolvem.
//
// Pressupõe login já feito com custom claim `backoffice` — o fluxo de
// autenticação em si é um documento em aberto (ver
// controle-acesso-custom-claims.md, "Fora do escopo").

import React, { useState, useEffect, useCallback } from "react";
import * as api from "./adminClient";
import "./AdminApp.css";

const TABS = [
  { id: "orgs", label: "Organizações" },
  { id: "units", label: "Setores" },
  { id: "rounds", label: "Rodadas" },
  { id: "invites", label: "Convites" },
];

export default function AdminApp() {
  const [tab, setTab] = useState("orgs");
  const [orgs, setOrgs] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [banner, setBanner] = useState(null); // { tone: 'ok'|'error', text }

  const notify = (tone, text) => {
    setBanner({ tone, text });
    window.clearTimeout(notify._t);
    notify._t = window.setTimeout(() => setBanner(null), 5000);
  };

  const refreshOrgs = useCallback(async () => {
    try {
      const list = await api.listOrgs();
      setOrgs(list);
      if (!selectedOrgId && list.length > 0) setSelectedOrgId(list[0].orgId);
    } catch (e) {
      notify("error", describeError(e));
    }
  }, [selectedOrgId]);

  useEffect(() => {
    refreshOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedOrg = orgs.find((o) => o.orgId === selectedOrgId) || null;

  return (
    <div className="admin">
      <header className="admin-top">
        <div className="admin-brand">
          Faydai<span>Back-office</span>
        </div>
        <OrgPicker orgs={orgs} selectedOrgId={selectedOrgId} onChange={setSelectedOrgId} />
      </header>

      {banner && <div className={`admin-banner tone-${banner.tone}`}>{banner.text}</div>}

      <nav className="admin-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={"admin-tab" + (tab === t.id ? " active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="admin-panel">
        {tab === "orgs" && (
          <OrgsPanel orgs={orgs} onCreated={refreshOrgs} notify={notify} />
        )}
        {tab === "units" && (
          <UnitsPanel org={selectedOrg} notify={notify} />
        )}
        {tab === "rounds" && (
          <RoundsPanel org={selectedOrg} notify={notify} />
        )}
        {tab === "invites" && (
          <InvitesPanel org={selectedOrg} notify={notify} />
        )}
      </main>
    </div>
  );
}

function describeError(e) {
  // httpsCallable rejeita com { code, message } — nunca expor stack.
  return e?.message || "Algo deu errado. Tente novamente.";
}

function OrgPicker({ orgs, selectedOrgId, onChange }) {
  if (orgs.length === 0) return <span className="admin-org-picker-empty">Nenhuma organização ainda</span>;
  return (
    <select
      className="admin-org-picker"
      value={selectedOrgId || ""}
      onChange={(e) => onChange(e.target.value)}
    >
      {orgs.map((o) => (
        <option key={o.orgId} value={o.orgId}>
          {o.name} ({o.orgId})
        </option>
      ))}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Organizações
// ─────────────────────────────────────────────────────────────────────
function OrgsPanel({ orgs, onCreated, notify }) {
  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createOrg(orgId.trim(), name.trim());
      notify("ok", `Organização "${name}" criada.`);
      setOrgId("");
      setName("");
      onCreated();
    } catch (err) {
      notify("error", describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Organizações</h2>
      <form className="admin-form-inline" onSubmit={submit}>
        <input
          placeholder="orgId (ex: acme-industria)"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          required
        />
        <input
          placeholder="Nome da empresa"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit" disabled={busy}>{busy ? "Criando…" : "Criar organização"}</button>
      </form>

      <table className="admin-table">
        <thead><tr><th>orgId</th><th>Nome</th></tr></thead>
        <tbody>
          {orgs.map((o) => (
            <tr key={o.orgId}><td>{o.orgId}</td><td>{o.name}</td></tr>
          ))}
          {orgs.length === 0 && (
            <tr><td colSpan={2} className="admin-empty">Nenhuma organização no escopo deste operador.</td></tr>
          )}
        </tbody>
      </table>

      <p className="admin-note">
        Criar uma organização aqui não dá automaticamente a este operador
        acesso a ela — a concessão do orgId no claim <code>backoffice.orgIds</code>{" "}
        é um passo manual separado (ver <code>scripts/set-backoffice-claim.js</code>).
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Unidades / hierarquia de setores
// ─────────────────────────────────────────────────────────────────────
function UnitsPanel({ org, notify }) {
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ unitId: "", name: "", parentUnitId: "" });
  const [editingId, setEditingId] = useState(null);

  const refresh = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    try {
      setUnits(await api.listUnits(org.orgId));
    } catch (e) {
      notify("error", describeError(e));
    } finally {
      setLoading(false);
    }
  }, [org, notify]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!org) return <EmptyOrgState />;

  async function submit(e) {
    e.preventDefault();
    try {
      if (editingId) {
        await api.updateUnit(org.orgId, editingId, form.name.trim(), form.parentUnitId || null);
        notify("ok", `Setor "${form.name}" atualizado.`);
      } else {
        await api.createUnit(org.orgId, form.unitId.trim(), form.name.trim(), form.parentUnitId || null);
        notify("ok", `Setor "${form.name}" criado.`);
      }
      setForm({ unitId: "", name: "", parentUnitId: "" });
      setEditingId(null);
      refresh();
    } catch (err) {
      notify("error", describeError(err));
    }
  }

  async function remove(unitId) {
    if (!window.confirm(`Remover o setor "${unitId}"? Isso só funciona se ele não tiver filhos na hierarquia.`)) return;
    try {
      await api.deleteUnit(org.orgId, unitId);
      notify("ok", "Setor removido.");
      refresh();
    } catch (err) {
      notify("error", describeError(err));
    }
  }

  function startEdit(u) {
    setEditingId(u.unitId);
    setForm({ unitId: u.unitId, name: u.name || "", parentUnitId: u.parentUnitId || "" });
  }

  return (
    <section>
      <h2>Setores — {org.name}</h2>

      <form className="admin-form-inline" onSubmit={submit}>
        {!editingId && (
          <input
            placeholder="unitId (ex: manutencao)"
            value={form.unitId}
            onChange={(e) => setForm({ ...form, unitId: e.target.value })}
            required
          />
        )}
        <input
          placeholder="Nome do setor"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <select
          value={form.parentUnitId}
          onChange={(e) => setForm({ ...form, parentUnitId: e.target.value })}
        >
          <option value="">Sem setor pai (nível raiz)</option>
          {units.filter((u) => u.unitId !== editingId).map((u) => (
            <option key={u.unitId} value={u.unitId}>{u.name}</option>
          ))}
        </select>
        <button type="submit">{editingId ? "Salvar" : "Criar setor"}</button>
        {editingId && (
          <button type="button" className="admin-btn-secondary" onClick={() => { setEditingId(null); setForm({ unitId: "", name: "", parentUnitId: "" }); }}>
            Cancelar
          </button>
        )}
      </form>

      <table className="admin-table">
        <thead><tr><th>Setor</th><th>unitId</th><th>Setor pai</th><th></th></tr></thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.unitId}>
              <td>{u.name}</td>
              <td>{u.unitId}</td>
              <td>{units.find((p) => p.unitId === u.parentUnitId)?.name || "—"}</td>
              <td className="admin-row-actions">
                <button className="admin-link" onClick={() => startEdit(u)}>Editar</button>
                <button className="admin-link admin-link-danger" onClick={() => remove(u.unitId)}>Remover</button>
              </td>
            </tr>
          ))}
          {!loading && units.length === 0 && (
            <tr><td colSpan={4} className="admin-empty">Nenhum setor cadastrado ainda.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Rodadas
// ─────────────────────────────────────────────────────────────────────
function RoundsPanel({ org, notify }) {
  const [rounds, setRounds] = useState([]);
  const [summaries, setSummaries] = useState({}); // roundId -> summary
  const [form, setForm] = useState({ roundId: "", minK: 5 });
  const [closing, setClosing] = useState(null);

  const refresh = useCallback(async () => {
    if (!org) return;
    try {
      setRounds(await api.listRounds(org.orgId));
    } catch (e) {
      notify("error", describeError(e));
    }
  }, [org, notify]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!org) return <EmptyOrgState />;

  async function submit(e) {
    e.preventDefault();
    try {
      await api.createRound(org.orgId, form.roundId.trim(), Number(form.minK) || 5);
      notify("ok", `Rodada "${form.roundId}" criada com limiar mínimo ${form.minK}.`);
      setForm({ roundId: "", minK: 5 });
      refresh();
    } catch (err) {
      notify("error", describeError(err));
    }
  }

  async function loadSummary(roundId) {
    try {
      const s = await api.getRoundSummary(org.orgId, roundId);
      setSummaries((prev) => ({ ...prev, [roundId]: s }));
    } catch (err) {
      notify("error", describeError(err));
    }
  }

  async function closeRound(roundId) {
    if (!window.confirm(
      `Fechar a rodada "${roundId}"? Isso calcula e publica os relatórios agregados (respeitando o limiar mínimo automaticamente — Decisão 3) e não pode ser desfeito.`
    )) return;

    setClosing(roundId);
    try {
      const result = await api.computeAggregateReport(org.orgId, roundId);
      const skipped = result.skippedBelowThreshold?.length || 0;
      notify(
        "ok",
        skipped > 0
          ? `Rodada fechada. ${skipped} setor(es) não atingiram o limiar mínimo mesmo após fusão hierárquica — sem relatório para eles.`
          : "Rodada fechada e relatórios publicados."
      );
      refresh();
      loadSummary(roundId);
    } catch (err) {
      notify("error", describeError(err));
    } finally {
      setClosing(null);
    }
  }

  return (
    <section>
      <h2>Rodadas — {org.name}</h2>

      <form className="admin-form-inline" onSubmit={submit}>
        <input
          placeholder="roundId (ex: 2026-q3)"
          value={form.roundId}
          onChange={(e) => setForm({ ...form, roundId: e.target.value })}
          required
        />
        <input
          type="number"
          min={1}
          placeholder="Limiar mínimo (minK)"
          value={form.minK}
          onChange={(e) => setForm({ ...form, minK: e.target.value })}
        />
        <button type="submit">Criar rodada</button>
      </form>
      <p className="admin-note">
        O limiar mínimo é aplicado sempre automaticamente ao fechar a
        rodada — não existe botão de "liberar mesmo assim" (Decisão 3).
      </p>

      <table className="admin-table">
        <thead><tr><th>Rodada</th><th>minK</th><th>Status</th><th>Resumo</th><th></th></tr></thead>
        <tbody>
          {rounds.map((r) => {
            const s = summaries[r.roundId];
            return (
              <tr key={r.roundId}>
                <td>{r.roundId}</td>
                <td>{r.minK}</td>
                <td><StatusBadge status={r.status} /></td>
                <td>
                  {s ? (
                    <span className="admin-summary">
                      {s.invitesUsed}/{s.invitesSent} responderam · {s.reportsGenerated} relatório(s)
                    </span>
                  ) : (
                    <button className="admin-link" onClick={() => loadSummary(r.roundId)}>Carregar resumo</button>
                  )}
                </td>
                <td className="admin-row-actions">
                  {r.status !== "fechada" && (
                    <button
                      className="admin-btn-primary"
                      disabled={closing === r.roundId}
                      onClick={() => closeRound(r.roundId)}
                    >
                      {closing === r.roundId ? "Fechando…" : "Fechar rodada"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {rounds.length === 0 && (
            <tr><td colSpan={5} className="admin-empty">Nenhuma rodada criada ainda.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function StatusBadge({ status }) {
  const tone = status === "fechada" ? "closed" : "open";
  return <span className={`admin-badge tone-${tone}`}>{status === "fechada" ? "Fechada" : "Aberta"}</span>;
}

// ─────────────────────────────────────────────────────────────────────
// Convites — importação em lote (Decisão 2)
// ─────────────────────────────────────────────────────────────────────
function InvitesPanel({ org, notify }) {
  const [rounds, setRounds] = useState([]);
  const [roundId, setRoundId] = useState("");
  const [rawCsv, setRawCsv] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!org) return;
    api.listRounds(org.orgId).then(setRounds).catch((e) => notify("error", describeError(e)));
  }, [org, notify]);

  if (!org) return <EmptyOrgState />;

  function parseCsv(text) {
    // Formato esperado, uma linha por trabalhador: stableEmployeeId,unitId
    // (mesmo formato de entrada da função importInvites). Ignora linhas
    // vazias e cabeçalho opcional.
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.toLowerCase().startsWith("stableemployeeid"))
      .map((line) => {
        const [stableEmployeeId, unitId] = line.split(",").map((v) => v?.trim());
        return { stableEmployeeId, unitId };
      });
  }

  async function submit(e) {
    e.preventDefault();
    const employees = parseCsv(rawCsv);
    const invalid = employees.filter((e) => !e.stableEmployeeId || !e.unitId);
    if (invalid.length > 0) {
      notify("error", `${invalid.length} linha(s) inválida(s) — cada linha precisa de "identificador,unitId".`);
      return;
    }
    if (employees.length === 0) {
      notify("error", "Cole ao menos uma linha.");
      return;
    }

    setBusy(true);
    try {
      const res = await api.importInvites(org.orgId, roundId, employees);
      setResult(res.invites);
      notify("ok", `${res.count} convite(s) gerado(s).`);
    } catch (err) {
      notify("error", describeError(err));
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    const header = "code,unitId,link\n";
    const base = window.location.origin;
    const rows = result
      .map((r) => `${r.code},${r.unitId},${base}/questionario.html?code=${r.code}&org=${org.orgId}&round=${roundId}`)
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `convites-${org.orgId}-${roundId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <h2>Importar convites — {org.name}</h2>

      <form className="admin-form-stack" onSubmit={submit}>
        <label>
          Rodada
          <select value={roundId} onChange={(e) => setRoundId(e.target.value)} required>
            <option value="" disabled>Selecione a rodada</option>
            {rounds.map((r) => (
              <option key={r.roundId} value={r.roundId} disabled={r.status === "fechada"}>
                {r.roundId} {r.status === "fechada" ? "(fechada)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          Lista de trabalhadores — uma linha por pessoa: <code>identificador,unitId</code>
          <textarea
            rows={8}
            placeholder={"folha-00231,manutencao\nfolha-00459,qualidade"}
            value={rawCsv}
            onChange={(e) => setRawCsv(e.target.value)}
            required
          />
        </label>
        <p className="admin-note">
          O identificador (ex: ID de folha de pagamento) é usado só em
          memória no servidor para calcular o blind index — nunca é
          gravado em nenhum documento (Decisão 2, ver <code>importInvites</code>).
        </p>

        <button type="submit" disabled={busy || !roundId}>
          {busy ? "Importando…" : "Gerar convites"}
        </button>
      </form>

      {result && (
        <div className="admin-result">
          <div className="admin-result-head">
            <span>{result.length} convite(s) gerado(s)</span>
            <button className="admin-link" onClick={downloadCsv}>Baixar CSV com links</button>
          </div>
          <table className="admin-table">
            <thead><tr><th>Código</th><th>Setor</th></tr></thead>
            <tbody>
              {result.slice(0, 20).map((r) => (
                <tr key={r.code}><td>{r.code}</td><td>{r.unitId}</td></tr>
              ))}
            </tbody>
          </table>
          {result.length > 20 && (
            <p className="admin-note">Mostrando 20 de {result.length} — use "Baixar CSV" para a lista completa.</p>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyOrgState() {
  return <p className="admin-empty admin-empty-page">Crie ou selecione uma organização primeiro.</p>;
}
