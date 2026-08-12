import React, { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from "recharts";
import { ChevronDown, TrendingUp, TrendingDown, Minus, AlertTriangle, Users, Activity, Target } from "lucide-react";

// ---------------------------------------------------------------------------
// Tokens
// Paleta pensada para um instrumento clínico, não um semáforo de trânsito:
// tons abatidos de salvia -> ocre -> tijolo em vez de verde/amarelo/vermelho puros.
// ---------------------------------------------------------------------------
const TOKENS = {
  ink: "#1E2A26",
  inkSoft: "#4B5A55",
  paper: "#F6F7F5",
  panel: "#FFFFFF",
  line: "#DFE3DF",
  structural: "#2F4858",
  low: "#4C7A6B",
  lowSoft: "#E4EEE9",
  medium: "#C08A3E",
  mediumSoft: "#F5EBDA",
  high: "#A44A3F",
  highSoft: "#F3E1DD",
};

function scoreColor(score) {
  // interpola entre tijolo (1) -> ocre (3) -> salvia (5)
  if (score >= 4) return TOKENS.low;
  if (score >= 2.5) return TOKENS.medium;
  return TOKENS.high;
}
function scoreSoft(score) {
  if (score >= 4) return TOKENS.lowSoft;
  if (score >= 2.5) return TOKENS.mediumSoft;
  return TOKENS.highSoft;
}
function riskLabel(score) {
  if (score >= 4) return "Baixo";
  if (score >= 2.5) return "Médio";
  return "Alto";
}

// ---------------------------------------------------------------------------
// Dados mockados — formato equivalente ao que viria de period_aggregates
// ---------------------------------------------------------------------------
const DIMENSIONS = [
  "Carga de trabalho",
  "Autonomia",
  "Relações interpessoais",
  "Reconhecimento",
  "Clareza de papel",
  "Segurança psicológica",
];

const DEPARTMENTS = ["Produção", "Manutenção", "Qualidade", "Logística", "Administrativo", "Comercial"];

const HEATMAP = {
  "Produção": [2.1, 2.8, 3.4, 2.6, 3.9, 2.9],
  "Manutenção": [2.6, 3.1, 3.8, 3.0, 4.1, 3.3],
  "Qualidade": [3.7, 4.0, 4.2, 3.6, 4.3, 4.1],
  "Logística": [2.9, 2.7, 3.5, 2.8, 3.6, 3.0],
  "Administrativo": [4.1, 4.3, 4.4, 4.0, 4.5, 4.2],
  "Comercial": [3.5, 3.8, 3.6, 3.4, 4.0, 3.7],
};

const DEPT_AVERAGE = Object.fromEntries(
  DEPARTMENTS.map((d) => [d, HEATMAP[d].reduce((a, b) => a + b, 0) / HEATMAP[d].length])
);

const PERIODS = ["2025 - 1º Sem.", "2025 - 2º Sem.", "2026 - 1º Sem."];

const PERIOD_COMPARISON = DIMENSIONS.map((dim, i) => {
  const current = HEATMAP[DEPARTMENTS[0]][i] + 0.6; // valor médio geral ilustrativo
  const previous = current - [0.3, -0.2, 0.1, -0.4, 0.2, -0.1][i];
  return { dimension: dim, current: +current.toFixed(1), previous: +previous.toFixed(1) };
});

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------
function StatCard({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="bg-white border border-[#DFE3DF] rounded-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wide uppercase text-[#4B5A55]">{label}</span>
        <Icon size={16} strokeWidth={1.75} style={{ color: tone || TOKENS.structural }} />
      </div>
      <div className="font-display text-[34px] leading-none text-[#1E2A26]">{value}</div>
      {sub && <div className="text-[12px] text-[#4B5A55]">{sub}</div>}
    </div>
  );
}

function InsightBanner({ worstDept, worstDim, worstScore }) {
  return (
    <div
      className="rounded-sm border-l-4 bg-white border border-[#DFE3DF] px-5 py-4 flex items-start gap-3"
      style={{ borderLeftColor: TOKENS.high }}
    >
      <AlertTriangle size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: TOKENS.high }} />
      <div>
        <p className="text-[13px] font-medium text-[#1E2A26]">
          {worstDept} concentra o maior risco neste ciclo
        </p>
        <p className="text-[13px] text-[#4B5A55] mt-1 leading-relaxed">
          A dimensão <span className="font-medium text-[#1E2A26]">{worstDim}</span> registrou score médio de{" "}
          <span className="font-mono-data font-medium text-[#1E2A26]">{worstScore.toFixed(1)}</span> em{" "}
          {worstDept}, abaixo do limite de risco alto (2,5). Recomenda-se priorizar essa combinação
          departamento/dimensão nas próximas ações de RH.
        </p>
      </div>
    </div>
  );
}

function Heatmap() {
  return (
    <div className="bg-white border border-[#DFE3DF] rounded-sm p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-display text-[17px] text-[#1E2A26]">Score por dimensão e departamento</h2>
        <div className="flex items-center gap-3 text-[11px] text-[#4B5A55]">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: TOKENS.high }} /> Alto risco
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: TOKENS.medium }} /> Médio
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: TOKENS.low }} /> Baixo
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr>
              <th className="text-left text-[11px] font-medium uppercase tracking-wide text-[#4B5A55] pb-2 pr-3 w-40">
                Departamento
              </th>
              {DIMENSIONS.map((d) => (
                <th
                  key={d}
                  className="text-[10.5px] font-medium text-[#4B5A55] pb-2 px-1 text-center align-bottom"
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 90 }}
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEPARTMENTS.map((dept) => (
              <tr key={dept}>
                <td className="text-[13px] text-[#1E2A26] py-1 pr-3 border-t border-[#EEF0EE]">{dept}</td>
                {HEATMAP[dept].map((score, i) => (
                  <td key={i} className="border-t border-[#EEF0EE] p-1">
                    <div
                      className="h-11 rounded-sm flex items-center justify-center font-mono-data text-[12.5px]"
                      style={{ background: scoreSoft(score), color: scoreColor(score) }}
                      title={`${dept} · ${DIMENSIONS[i]}: ${score.toFixed(1)}`}
                    >
                      {score.toFixed(1)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DistributionChart() {
  const data = DEPARTMENTS.map((d) => ({ department: d, score: +DEPT_AVERAGE[d].toFixed(1) }));
  return (
    <div className="bg-white border border-[#DFE3DF] rounded-sm p-5">
      <h2 className="font-display text-[17px] text-[#1E2A26] mb-4">Distribuição de risco por departamento</h2>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid horizontal={false} stroke="#EEF0EE" />
          <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 11, fill: TOKENS.inkSoft }} axisLine={{ stroke: "#DFE3DF" }} tickLine={false} />
          <YAxis
            type="category"
            dataKey="department"
            width={110}
            tick={{ fontSize: 12, fill: TOKENS.ink }}
            axisLine={{ stroke: "#DFE3DF" }}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "#F6F7F5" }}
            formatter={(v) => [`${v} — risco ${riskLabel(v)}`, "Score médio"]}
            contentStyle={{ fontSize: 12, borderRadius: 2, border: "1px solid #DFE3DF" }}
          />
          <Bar dataKey="score" radius={[0, 2, 2, 0]} barSize={18}>
            {data.map((entry, i) => (
              <Cell key={i} fill={scoreColor(entry.score)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function FilterPanel({ period, setPeriod }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-[#DFE3DF] rounded-sm p-5">
      <h2 className="text-[11px] font-medium tracking-wide uppercase text-[#4B5A55] mb-3">Período avaliado</h2>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between border border-[#DFE3DF] rounded-sm px-3 py-2.5 text-[13px] text-[#1E2A26] bg-[#F6F7F5] hover:bg-[#EEF0EE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F4858]"
        >
          {period}
          <ChevronDown size={15} strokeWidth={1.75} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-[#DFE3DF] rounded-sm shadow-sm overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPeriod(p);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-[13px] text-[#1E2A26] hover:bg-[#F6F7F5] focus:outline-none focus-visible:bg-[#F6F7F5]"
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11.5px] text-[#4B5A55] mt-3 leading-relaxed">
        Comparação sempre relativa ao ciclo imediatamente anterior.
      </p>
    </div>
  );
}

function PeriodComparisonPanel() {
  return (
    <div className="bg-white border border-[#DFE3DF] rounded-sm p-5">
      <h2 className="text-[11px] font-medium tracking-wide uppercase text-[#4B5A55] mb-4">
        Variação por dimensão vs. ciclo anterior
      </h2>
      <ul className="flex flex-col divide-y divide-[#EEF0EE]">
        {PERIOD_COMPARISON.map((row) => {
          const delta = +(row.current - row.previous).toFixed(1);
          const Icon = delta > 0.05 ? TrendingUp : delta < -0.05 ? TrendingDown : Minus;
          const tone = delta > 0.05 ? TOKENS.low : delta < -0.05 ? TOKENS.high : TOKENS.inkSoft;
          return (
            <li key={row.dimension} className="py-2.5 flex items-center justify-between gap-2">
              <span className="text-[12.5px] text-[#1E2A26] leading-tight">{row.dimension}</span>
              <span className="flex items-center gap-1.5 shrink-0 font-mono-data text-[12.5px]" style={{ color: tone }}>
                <Icon size={13} strokeWidth={2} />
                {delta > 0 ? "+" : ""}
                {delta.toFixed(1)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
export default function PsychosocialDashboard() {
  const [period, setPeriod] = useState(PERIODS[2]);

  const { worstDept, worstDim, worstScore } = useMemo(() => {
    let min = 5, wd = "", wdim = "";
    DEPARTMENTS.forEach((dept) => {
      HEATMAP[dept].forEach((score, i) => {
        if (score < min) {
          min = score;
          wd = dept;
          wdim = DIMENSIONS[i];
        }
      });
    });
    return { worstDept: wd, worstDim: wdim, worstScore: min };
  }, []);

  const overallAvg = useMemo(() => {
    const all = Object.values(HEATMAP).flat();
    return all.reduce((a, b) => a + b, 0) / all.length;
  }, []);

  const highRiskCount = DEPARTMENTS.filter((d) => DEPT_AVERAGE[d] < 2.5).length;

  return (
    <div className="min-h-screen bg-[#F6F7F5]" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .font-display { font-family: 'Fraunces', serif; font-weight: 600; }
        .font-mono-data { font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      {/* Top bar */}
      <header className="border-b border-[#DFE3DF] bg-white">
        <div className="max-w-[1280px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[#4B5A55]">Avaliação de risco psicossocial</p>
            <h1 className="font-display text-[20px] text-[#1E2A26]">Painel de RH</h1>
          </div>
          <div className="text-[12px] text-[#4B5A55] font-mono-data">{period}</div>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Coluna principal */}
        <div className="lg:col-span-8 flex flex-col gap-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Participação" value="78%" sub="312 de 400 convocados" icon={Users} />
            <StatCard label="Score médio geral" value={overallAvg.toFixed(1)} sub="Escala de 1 a 5" icon={Activity} />
            <StatCard
              label="Depto. em risco alto"
              value={highRiskCount}
              sub={`de ${DEPARTMENTS.length} departamentos`}
              icon={AlertTriangle}
              tone={highRiskCount > 0 ? TOKENS.high : TOKENS.low}
            />
            <StatCard label="Dimensão mais crítica" value={worstScore.toFixed(1)} sub={worstDim} icon={Target} tone={TOKENS.high} />
          </div>

          <InsightBanner worstDept={worstDept} worstDim={worstDim} worstScore={worstScore} />

          <Heatmap />
          <DistributionChart />
        </div>

        {/* Painel lateral: filtros + comparação entre períodos */}
        <aside className="lg:col-span-4 flex flex-col gap-5">
          <FilterPanel period={period} setPeriod={setPeriod} />
          <PeriodComparisonPanel />
        </aside>
      </main>
    </div>
  );
}
