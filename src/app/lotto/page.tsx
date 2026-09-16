import Link from "next/link";
import OpenAI from "openai";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createLottoAnalysisSummary, type LottoAnalysisSummary, type LottoDraw } from "@/lib/lotto/analyze";
import { isSameKoreaWeek } from "@/lib/cache/korea-week";
import { getLatestCompletedDraw } from "@/lib/lotto/draw-calendar";
import { evaluateLottoPredictions, type LottoPredictionEvaluation, type StoredLottoPrediction } from "@/lib/lotto/evaluation";
import { createBalancedFallbackSets, hasValidRecommendationSets, type RecommendedSet } from "@/lib/lotto/recommendations";
import styles from "./page.module.scss";

export const dynamic = "force-dynamic";
const MAX_RECOMMENDATION_ATTEMPTS = 3;

type SelectedNumber = { rank: number; number: number; reason: string };
type AiAnalysis = {
  analyzedFromRound: number;
  analyzedToRound: number;
  selectedNumbers: SelectedNumber[];
  recommendedSets: RecommendedSet[];
  summary: string;
};

const aiAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["analyzedFromRound", "analyzedToRound", "selectedNumbers", "recommendedSets", "summary"],
  properties: {
    analyzedFromRound: { type: "integer" },
    analyzedToRound: { type: "integer" },
    selectedNumbers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rank", "number", "reason"],
        properties: { rank: { type: "integer" }, number: { type: "integer" }, reason: { type: "string" } },
      },
    },
    recommendedSets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["numbers"],
        properties: { numbers: { type: "array", items: { type: "integer" } } },
      },
    },
    summary: { type: "string" },
  },
} as const;

function getRequiredEnv(name: "OPENAI_API_KEY" | "OPENAI_MODEL") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not configured.`);
  return value;
}

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 45;
}

function isValidCombination(value: unknown): value is RecommendedSet["numbers"] {
  return Array.isArray(value) && value.length === 6 && value.every(isValidNumber) && new Set(value).size === 6;
}

function isValidSelectedNumbers(value: unknown): value is SelectedNumber[] {
  return Array.isArray(value) && value.length === 10 && value.every((selected, index) => (
    selected &&
    selected.rank === index + 1 &&
    isValidNumber(selected.number) &&
    typeof selected.reason === "string" &&
    selected.reason.trim().length > 0
  )) && new Set(value.map((selected) => selected.number)).size === 10;
}

function extractAiCandidate(value: unknown): Omit<AiAnalysis, "recommendedSets"> | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<AiAnalysis>;
  if (
    !Number.isInteger(result.analyzedFromRound) ||
    !Number.isInteger(result.analyzedToRound) ||
    !isValidSelectedNumbers(result.selectedNumbers) ||
    typeof result.summary !== "string" ||
    result.summary.trim().length === 0
  ) return null;

  return {
    analyzedFromRound: result.analyzedFromRound as number,
    analyzedToRound: result.analyzedToRound as number,
    selectedNumbers: result.selectedNumbers,
    summary: result.summary,
  };
}

function validateAiAnalysis(value: unknown): AiAnalysis {
  if (!value || typeof value !== "object") throw new Error("AI 분석 결과가 올바른 객체가 아닙니다.");

  const result = value as Partial<AiAnalysis>;
  const selectedNumbers = result.selectedNumbers;
  const recommendedSets = result.recommendedSets;
  const validSelectedNumbers = isValidSelectedNumbers(selectedNumbers);
  const validRecommendedSets = Array.isArray(recommendedSets) && recommendedSets.length === 10 && recommendedSets.every((set) => set && isValidCombination(set.numbers));

  if (
    !Number.isInteger(result.analyzedFromRound) ||
    !Number.isInteger(result.analyzedToRound) ||
    !validSelectedNumbers ||
    new Set(selectedNumbers.map((selected) => selected.number)).size !== 10 ||
    !validRecommendedSets ||
    !hasValidRecommendationSets(recommendedSets as RecommendedSet[]) ||
    typeof result.summary !== "string" ||
    result.summary.trim().length === 0
  ) throw new Error("AI 분석 결과 검증에 실패했습니다.");

  return {
    analyzedFromRound: result.analyzedFromRound as number,
    analyzedToRound: result.analyzedToRound as number,
    selectedNumbers: selectedNumbers as SelectedNumber[],
    recommendedSets: recommendedSets.map((set) => ({ numbers: set.numbers as RecommendedSet["numbers"] })),
    summary: result.summary,
  };
}

async function loadRecentDraws(): Promise<LottoDraw[]> {
  const { data, error } = await createServerSupabaseClient()
    .from("lotto_draws")
    .select("round, draw_date, number1, number2, number3, number4, number5, number6, bonus_number")
    .order("round", { ascending: false })
    .limit(100);

  if (error) throw new Error("최근 로또 데이터를 조회하지 못했습니다.");
  return (data ?? []) as LottoDraw[];
}

async function loadCachedAnalysis(latestDrawRound: number | null): Promise<AiAnalysis | null> {
  const { data, error } = await createServerSupabaseClient()
    .from("lotto_analysis_results")
    .select("analyzed_from_round, analyzed_to_round, selected_numbers, recommended_sets, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error("저장된 로또 분석 결과를 조회하지 못했습니다.");
  if (!data || latestDrawRound === null || data.analyzed_to_round !== latestDrawRound || !isSameKoreaWeek(data.created_at)) return null;

  try {
    return validateAiAnalysis({
      analyzedFromRound: data.analyzed_from_round,
      analyzedToRound: data.analyzed_to_round,
      selectedNumbers: data.selected_numbers,
      recommendedSets: data.recommended_sets,
      summary: data.summary,
    });
  } catch {
    // An older cache may not satisfy the current recommendation constraints.
    // Treat it as stale so the page can generate and save a corrected analysis.
    return null;
  }
}

async function loadPredictionEvaluation(draws: LottoDraw[]): Promise<LottoPredictionEvaluation> {
  const { data, error } = await createServerSupabaseClient()
    .from("lotto_analysis_results")
    .select("analyzed_to_round, recommended_sets, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error("추천 결과 이력을 조회하지 못했습니다.");
  return evaluateLottoPredictions((data ?? []) as StoredLottoPrediction[], draws);
}

async function analyzeWithOpenAI(
  summary: LottoAnalysisSummary,
  evaluation: LottoPredictionEvaluation,
): Promise<AiAnalysis> {
  let lastCandidate: Omit<AiAnalysis, "recommendedSets"> | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RECOMMENDATION_ATTEMPTS; attempt += 1) {
    try {
      const response = await new OpenAI({ apiKey: getRequiredEnv("OPENAI_API_KEY") }).responses.create({
        model: getRequiredEnv("OPENAI_MODEL"),
        input: `
You are analyzing Korean Lotto 6/45 history for entertainment only.
Use the supplied statistical summary of the latest 100 draws.
Use the prior walk-forward evaluation below as feedback from earlier recommendations.
Treat small samples as noise; do not chase individual past winning numbers or claim a lasting advantage.
Select exactly 10 notable numbers ranked from 1 to 10 and explain each choice in Korean.
Create exactly 10 different recommendation sets using the full number range 1 to 45.
Each set must contain exactly 6 unique numbers. Across the 10 sets, cover at least 30 different numbers.
Any two sets may share at most 2 numbers. Do not restrict recommendation sets to the selected TOP 10.
Use the historical statistics only as a light reference; prioritize variety across the 10 sets.
Use long-term frequency, recent 10-draw frequency, last appearance, consecutive misses,
pair co-occurrence, odd/even distribution, number ranges, and draw sum statistics.
Describe past frequencies only. Never call a number reliable, due, or more likely to win.
Do not claim that any number or combination is more likely to win. Return only the requested JSON object.

Statistical summary:
${JSON.stringify(summary)}

Prior recommendation evaluation:
${JSON.stringify({
  forecastCount: evaluation.forecastCount,
  averageMatchesPerSet: evaluation.averageMatchesPerSet,
  randomAverageMatchesPerSet: evaluation.randomAverageMatchesPerSet,
  threeOrMoreRate: evaluation.threeOrMoreRate,
  randomThreeOrMoreRate: evaluation.randomThreeOrMoreRate,
  recentRounds: evaluation.rounds.slice(-10),
})}
`,
        text: { format: { type: "json_schema", name: "lotto_analysis", strict: true, schema: aiAnalysisSchema } },
      });

      if (!response.output_text) throw new Error("AI 분석 결과가 비어 있습니다.");

      const parsed = JSON.parse(response.output_text);
      const candidate = extractAiCandidate(parsed);
      if (
        candidate &&
        candidate.analyzedFromRound === summary.analyzedFromRound &&
        candidate.analyzedToRound === summary.analyzedToRound
      ) lastCandidate = candidate;
      const analysis = validateAiAnalysis(parsed);
      if (
        analysis.analyzedFromRound !== summary.analyzedFromRound ||
        analysis.analyzedToRound !== summary.analyzedToRound
      ) throw new Error("AI 분석 회차가 실제 분석 데이터와 일치하지 않습니다.");
      return analysis;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("AI 분석에 실패했습니다.");
    }
  }

  if (lastCandidate) {
    return {
      ...lastCandidate,
      recommendedSets: createBalancedFallbackSets(lastCandidate.analyzedToRound),
    };
  }

  throw lastError ?? new Error("AI 분석에 실패했습니다.");
}

async function saveAnalysis(analysis: AiAnalysis): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await createServerSupabaseClient()
    .from("lotto_analysis_results")
    .upsert({
      analyzed_from_round: analysis.analyzedFromRound,
      analyzed_to_round: analysis.analyzedToRound,
      selected_numbers: analysis.selectedNumbers,
      recommended_sets: analysis.recommendedSets,
      summary: analysis.summary,
      model: getRequiredEnv("OPENAI_MODEL"),
      created_at: now,
      updated_at: now,
    }, { onConflict: "analyzed_from_round,analyzed_to_round" });

  if (error) throw new Error("AI 분석 결과를 저장하지 못했습니다.");
}

function NumberBall({ number }: { number: number }) {
  return <span className={styles.numberBall}>{number}</span>;
}

export default async function LottoPage() {
  let analysis: AiAnalysis | null = null;
  let errorMessage = "";
  let analyzedDrawCount = 0;
  let evaluation: LottoPredictionEvaluation | null = null;

  try {
    const draws = await loadRecentDraws();
    analyzedDrawCount = draws.length;
    const expectedLatestDraw = getLatestCompletedDraw();
    const latestDraw = draws[0];

    if (!latestDraw) {
      errorMessage = "분석할 로또 데이터가 없습니다.";
    } else if (latestDraw.round !== expectedLatestDraw.round || latestDraw.draw_date !== expectedLatestDraw.date) {
      errorMessage = `당첨 데이터가 최신 회차(${expectedLatestDraw.round}회)까지 동기화되지 않아 추천을 갱신하지 않았습니다. 잠시 후 다시 시도해 주세요.`;
    } else {
      evaluation = await loadPredictionEvaluation(draws);
      analysis = await loadCachedAnalysis(latestDraw.round);
      if (!analysis) {
        analysis = await analyzeWithOpenAI(createLottoAnalysisSummary(draws), evaluation);
        await saveAnalysis(analysis);
      }
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "로또 분석 중 오류가 발생했습니다.";
  }

  return (
    <main className={styles.page}>
      <section className={styles.container} aria-labelledby="lotto-title">
        <Link href="/" className={styles.backLink}>← LuckyPicK-AI</Link>
        <header className={styles.header}>
          <p className={styles.eyebrow}>LOTTO ANALYSIS</p>
          <h1 id="lotto-title">최근 흐름으로 보는 로또 분석</h1>
          <p>최근 {analyzedDrawCount || 100}회의 당첨 데이터를 바탕으로 AI가 주목한 흐름을 정리했습니다.</p>
        </header>

        {errorMessage ? (
          <section className={styles.errorCard} role="alert">
            <h2>분석을 완료하지 못했습니다</h2>
            <p>{errorMessage}</p>
            <a href="/lotto" className={styles.retryLink}>다시 시도</a>
          </section>
        ) : analysis ? (
          <>
            <section className={styles.summaryCard}>
              <p className={styles.eyebrow}>AI SUMMARY</p>
              <p>{analysis.summary}</p>
              <span className={styles.rangeLabel}>{analysis.analyzedFromRound}회 ~ {analysis.analyzedToRound}회 분석</span>
            </section>

            <section className={styles.section} aria-labelledby="selected-title">
              <div className={styles.sectionHeading}>
                <div><p className={styles.eyebrow}>TOP 10</p><h2 id="selected-title">AI가 주목한 번호</h2></div>
                <span className={styles.sectionHint}>통계 기반 참고용</span>
              </div>
              <div className={styles.selectedList}>
                {analysis.selectedNumbers.map((selected) => (
                  <article className={styles.selectedItem} key={selected.number}>
                    <span className={styles.rank}>{String(selected.rank).padStart(2, "0")}</span>
                    <NumberBall number={selected.number} />
                    <div><h3>{selected.number}번</h3><p>{selected.reason}</p></div>
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.section} aria-labelledby="recommendation-title">
              <div className={styles.sectionHeading}>
                <div><p className={styles.eyebrow}>10 SETS</p><h2 id="recommendation-title">추천 번호 조합</h2></div>
                <span className={styles.sectionHint}>1~45 전체에서 분산 구성</span>
              </div>
              <div className={styles.recommendationGrid}>
                {analysis.recommendedSets.map((set, index) => (
                  <article className={styles.recommendationCard} key={`${index}-${set.numbers.join("-")}`}>
                    <span>SET {String(index + 1).padStart(2, "0")}</span>
                    <div className={styles.numberRow}>{set.numbers.map((number) => <NumberBall key={number} number={number} />)}</div>
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.section} aria-labelledby="evaluation-title">
              <div className={styles.sectionHeading}>
                <div><p className={styles.eyebrow}>WALK-FORWARD CHECK</p><h2 id="evaluation-title">추천 누적 검증</h2></div>
                <span className={styles.sectionHint}>추첨 전에 만든 추천만 집계</span>
              </div>
              {evaluation && evaluation.forecastCount > 0 ? (
                <>
                  <p className={styles.evaluationText}>
                    {evaluation.forecastCount}회차, {evaluation.setCount}조합 검증 결과 조합당 평균 {evaluation.averageMatchesPerSet.toFixed(2)}개가 일치했습니다.
                    무작위 조합의 이론적 평균은 {evaluation.randomAverageMatchesPerSet.toFixed(2)}개입니다.
                  </p>
                  <p className={styles.evaluationText}>
                    3개 이상 일치한 조합은 {evaluation.setsWithThreeOrMore}개({(evaluation.threeOrMoreRate * 100).toFixed(1)}%)였고,
                    무작위 조합의 이론적 비율은 {(evaluation.randomThreeOrMoreRate * 100).toFixed(1)}%입니다.
                  </p>
                  <div className={styles.evaluationRounds}>
                    {evaluation.rounds.slice(-5).reverse().map((round) => (
                      <span key={round.round}>
                        {round.round}회 · 최고 {round.bestSetMatches}개 · 3개 이상 {round.setsWithThreeOrMore}조합
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className={styles.evaluationText}>
                  아직 추첨 전에 저장된 추천 기록이 없습니다. 이번 추천부터 다음 회차 결과와 대조해 쌓고, 무작위 조합 기준과 비교합니다.
                </p>
              )}
              <p className={styles.evaluationNote}>
                이 기록은 다음 분석의 참고 입력으로 전달됩니다. 로또 추첨은 독립적이므로 과거 성과가 다음 회차의 확률 상승을 뜻하지는 않습니다.
              </p>
            </section>
          </>
        ) : null}

        <p className={styles.disclaimer}>본 결과는 과거 데이터의 통계적 분석이며 당첨을 보장하지 않습니다.</p>
      </section>
    </main>
  );
}
