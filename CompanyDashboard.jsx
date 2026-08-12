// admin/CompanyDashboard.jsx
//
// Dashboard do RH/liderança da empresa cliente (papel company_admin —
// ver controle-acesso-custom-claims.md, §2). Só leitura: consome as
// funções já existentes em dashboard-firestore-reads.js, que por sua vez
// só conseguem ler `orgs/{orgId}`, `orgs/{orgId}/units` e
// `orgs/{orgId}/rounds/{roundId}/reports` — o firestore.rules bloqueia
// qualquer outra coleção para este papel, então não há como esta tela
// acidentalmente vazar dado bruto mesmo com um bug de UI.
//
// Pressupõe login já feito com custom claim `company` — mesmo ponto em
// aberto do AdminApp.jsx.

import React, { useState, useEffect, useCallback } from "react";
import { getReports, getUnits, getOrg } from "./dashboard-firestore-reads";
import "./CompanyDashboard.css";

export default function CompanyDashboard({ orgId, roundIds }) {
  const [org, setOrg] = useState(null);
  const [units, setUnits] = useState({});
  const [roundId, setRoundId] = useState(roundIds?.[0] || null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!orgId || !roundId) return;
    setLoading(true);
    setError(null);
    try {
      const [orgData, unitsData, reportsData] = await Promise.all([
        getOrg(orgId),
        getUnits(orgId),
        getReports(orgId, roundId),
      ]);
      setOrg(orgData);
      setUnits(unitsData);
      setReports(reportsData.sort((a, b) => (a.overallAverage ?? 5) - (b.overallAverage ?? 5)));
    } catch (e) {
      setError(e?.message || "Não foi possível carregar os relatórios.");
    } finally {
      setLoading(false);
    }
  }, [orgId, roundId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="cd">
      <header className="cd-top">
        <div className="cd-brand">
          Faydai<span>Risco psicossocial</span>
        </div>
        <div className="cd-org">{org?.name || orgId}</div>
      </header>

      {roundIds && roundIds.length > 1 && (
        <div className="cd-round-picker">
          {roundIds.map((r) => (
            <button
              key={r}
              className={"cd-round-btn" + (r === roundId ? " active" : "")}
              onClick={() => setRoundId(r)}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="cd-status">Carregando…</p>}
      {error && <p className="cd-status cd-status-error">{error}</p>}

      {!loading && !error && reports.length === 0 && (
        <div className="cd-empty">
          <p>Nenhum relatório publicado ainda para esta rodada.</p>
          <p className="cd-empty-sub">
            Isso pode ser porque a rodada ainda está aberta, ou porque
            nenhum setor atingiu o número mínimo de respostas necessário
            para preservar o anonimato.
          </p>
        </div>
      )}

      {!loading && !error && reports.length > 0 && (
        <div className="cd-grid">
          {reports.map((r) => (
            <ReportCard key={r.unitId} report={r} units={units} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report, units }) {
  const fusedNames = (report.fusedFrom || [report.unitId])
    .map((id) => units[id]?.name || id)
    .join(" + ");

  return (
    <article className="cd-card">
      <div className="cd-card-head">
        <h3>{report.unitName || fusedNames}</h3>
        <span className="cd-n">n={report.n}</span>
      </div>
      {report.fusedFrom && report.fusedFrom.length > 1 && (
        <p className="cd-fused-note">Agrupado com: {fusedNames}</p>
      )}

      <div className="cd-overall">
        <RiskBar value={report.overallAverage} />
        <span className="cd-overall-label">{riskLabel(report.overallAverage)}</span>
      </div>

      <ul className="cd-dims">
        {Object.entries(report.dimensions || {}).map(([dim, d]) => (
          <li key={dim}>
            <span className="cd-dim-name">{dim}</span>
            <RiskBar value={d.average} compact />
          </li>
        ))}
      </ul>
    </article>
  );
}

function riskLabel(average) {
  if (average == null) return "Sem dados";
  if (average >= 4.0) return "Risco baixo";
  if (average >= 2.5) return "Risco médio";
  return "Risco alto";
}

function riskColor(average) {
  if (average == null) return "#B7C0BA";
  if (average >= 4.0) return "#1F5C55";
  if (average >= 2.5) return "#E3A23C";
  return "#B3453A";
}

function RiskBar({ value, compact }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, ((value - 1) / 4) * 100));
  return (
    <div className={"cd-riskbar" + (compact ? " compact" : "")}>
      <div className="cd-riskbar-track">
        <div className="cd-riskbar-fill" style={{ width: `${pct}%`, background: riskColor(value) }} />
      </div>
      {!compact && <span className="cd-riskbar-value">{value != null ? value.toFixed(2) : "—"}</span>}
    </div>
  );
}
