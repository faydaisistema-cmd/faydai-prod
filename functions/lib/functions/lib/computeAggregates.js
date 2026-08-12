// functions/lib/computeAggregates.js
//
// Cópia intencional de api/_lib/computeAggregates.js — Cloud Functions
// (este arquivo) e as rotas Vercel em api/ são dois deploys separados
// que hoje coexistem (ver controle-acesso-custom-claims.md, seção 4:
// "hoje existem dois mecanismos... vale decidir qual dos dois caminhos
// é o canônico"). Enquanto essa decisão não for tomada, a lógica de
// agregação precisa ficar idêntica nos dois lados — se só um for
// atualizado, os dois caminhos passam a calcular risco psicossocial de
// forma diferente para a mesma empresa, dependendo de qual deploy
// respondeu. Editar os dois arquivos juntos até a consolidação.
//
// Implementação real do cálculo de agregados por dimensão (antes um
// placeholder em compute-aggregate-report.js / index.js). Chamado só
// depois que o chamador já decidiu que `mergedCount >= minK` — este
// módulo não sabe nada sobre limiar de k-anonimato, não é sua
// responsabilidade.
//
// Formato de entrada: um array de "answers" — um item por resposta
// individual já fundida no ramo da hierarquia (Decisão 4) — no mesmo
// formato gravado por submit-response.js / questionario.html:
//
//   [{ dimension: "Carga de trabalho", value: 0..4 }, ...]
//
// `value` é o índice na escala Likert de 5 pontos usada em
// questionario.html (0 = "Nunca" … 4 = "Sempre"). Não é, ainda, o
// `dimensionScores`/`overallScore` já normalizado que o documento
// schema-avaliacao-psicossocial.md presume — aquele formato pressupõe
// um cálculo no momento do submit que hoje não existe; este módulo
// calcula a partir do dado bruto que de fato chega em `responses`.

// ───────────────────────────────────────────────────────────────────
// Polaridade por dimensão
// ───────────────────────────────────────────────────────────────────
// Nem toda dimensão tem o mesmo sentido de risco: em "Autonomia" e
// "Suporte da liderança", responder "Sempre" é bom; em "Carga de
// trabalho", "Insegurança" e "Esgotamento", responder "Sempre" é ruim.
// Sem inverter a escala nas positivas, uma equipe com muita autonomia
// apareceria com score de alto risco.
//
// TODO: mover para um campo `polarity` na coleção `dimensions` (ver
// schema-avaliacao-psicossocial.md) quando ela passar a ser
// referenciada de fato pelo questionário — hoje `questionario.html`
// só emite o texto da dimensão, sem dimensionId, então a tabela
// precisa viver aqui, acoplada ao texto exato das perguntas atuais.
const DIMENSION_POLARITY = {
  "Carga de trabalho": "negative",
  "Autonomia": "positive",
  "Suporte da liderança": "positive",
  "Insegurança": "negative",
  "Esgotamento": "negative",
};

const SCALE_MAX_INDEX = 4; // "Sempre" — ver array SCALE em questionario.html

/**
 * Converte um valor bruto da escala (0..4) num score de bem-estar
 * (1..5, onde 5 = melhor), respeitando a polaridade da dimensão.
 *
 * Dimensão fora da tabela é tratada como "negative" (o lado mais
 * conservador — assume o pior caso em vez de inflar o score por
 * engano) e gera um aviso; não deveria acontecer em produção
 * enquanto o questionário for a única fonte de `dimension`.
 */
function wellbeingScore(dimension, value) {
  const polarity = DIMENSION_POLARITY[dimension];
  if (!polarity) {
    console.warn(
      `[computeAggregates] dimensão desconhecida: "${dimension}" — tratando como "negative".`
    );
  }
  const v = Math.max(0, Math.min(SCALE_MAX_INDEX, Number(value) || 0));
  return polarity === "positive" ? v + 1 : SCALE_MAX_INDEX - v + 1;
}

/**
 * Faixas de risco — mesmos limiares usados em
 * schema-avaliacao-psicossocial.md e no mock de
 * PsychosocialDashboard.jsx (>=4.0 baixo, >=2.5 médio, abaixo alto),
 * para o cálculo real já bater com o que o dashboard hoje simula.
 */
function riskLevel(average) {
  if (average == null || Number.isNaN(average)) return "sem dados";
  if (average >= 4.0) return "baixo";
  if (average >= 2.5) return "médio";
  return "alto";
}

function round(n, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * @param {Array<Array<{dimension: string, value: number}>>} answersList
 *   Uma entrada por resposta individual (já fundida, se necessário,
 *   pelo caller para atingir minK).
 * @returns {{
 *   responseCount: number,
 *   overallAverage: number|null,
 *   overallRiskLevel: string,
 *   dimensions: Record<string, { n: number, average: number, riskLevel: string }>
 * }}
 */
function computeAggregates(answersList) {
  const dimensionSums = {}; // { [dimension]: { sum, n } }
  let respondentsWithScore = 0;
  let overallSum = 0;

  for (const answers of answersList || []) {
    if (!Array.isArray(answers) || answers.length === 0) continue;

    let respondentSum = 0;
    let respondentCount = 0;

    for (const { dimension, value } of answers) {
      if (!dimension || value == null) continue;
      const score = wellbeingScore(dimension, value);

      const d = dimensionSums[dimension] || { sum: 0, n: 0 };
      d.sum += score;
      d.n += 1;
      dimensionSums[dimension] = d;

      respondentSum += score;
      respondentCount += 1;
    }

    if (respondentCount > 0) {
      // Média das dimensões respondidas POR ESSA resposta — se no
      // futuro nem toda resposta cobrir todas as dimensões (ex:
      // questionário customizado por empresa), isso evita que uma
      // resposta com mais itens pese mais que outra no overall.
      overallSum += respondentSum / respondentCount;
      respondentsWithScore += 1;
    }
  }

  const dimensions = {};
  for (const [dimension, { sum, n }] of Object.entries(dimensionSums)) {
    const average = n > 0 ? round(sum / n) : null;
    dimensions[dimension] = { n, average, riskLevel: riskLevel(average) };
  }

  const overallAverage =
    respondentsWithScore > 0 ? round(overallSum / respondentsWithScore) : null;

  return {
    responseCount: answersList.length,
    overallAverage,
    overallRiskLevel: riskLevel(overallAverage),
    dimensions,
  };
}

module.exports = { computeAggregates, wellbeingScore, riskLevel, DIMENSION_POLARITY };

