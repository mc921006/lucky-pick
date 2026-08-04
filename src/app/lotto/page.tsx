import Link from "next/link";
import OpenAI from "openai";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createLottoAnalysisSummary, type LottoAnalysisSummary, type LottoDraw } from "@/lib/lotto/analyze";
import styles from "./page.module.scss";

export const dynamic = "force-dynamic";
const ANALYSIS_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type SelectedNumber = { rank: number; number: number; reason: string };
type RecommendedSet = { numbers: [number, number, number, number, number, number] };
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

function validateAiAnalysis(value: unknown): AiAnalysis {
  if (!value || typeof value !== "object") throw new Error("AI 분석 결과가 올바른 객체가 아닙니다.");

  const result = value as Partial<AiAnalysis>;
  const selectedNumbers = result.selectedNumbers;
  const recommendedSets = result.recommendedSets;
  const validSelectedNumbers = Array.isArray(selectedNumbers) && selectedNumbers.length === 10 && selectedNumbers.every((selected, index) => (
    selected && selected.rank === index + 1 && isValidNumber(selected.number) && typeof selected.reason === "string" && selected.reason.trim().length > 0
  ));
  const validRecommendedSets = Array.isArray(recommendedSets) && recommendedSets.length === 10 && recommendedSets.every((set) => set && isValidCombination(set.numbers));

  if (
    !Number.isInteger(result.analyzedFromRound) ||
    !Number.isInteger(result.analyzedToRound) ||
    !validSelectedNumbers ||
    new Set(selectedNumbers.map((selected) => selected.number)).size !== 10 ||
    !validRecommendedSets ||
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

async function loadCachedAnalysis(): Promise<AiAnalysis | null> {
  const { data, error } = await createServerSupabaseClient()
    .from("lotto_analysis_results")
    .select("analyzed_from_round, analyzed_to_round, selected_numbers, recommended_sets, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error("저장된 로또 분석 결과를 조회하지 못했습니다.");
  if (!data || Date.now() - new Date(data.created_at).getTime() >= ANALYSIS_CACHE_MAX_AGE_MS) return null;

  return validateAiAnalysis({
    analyzedFromRound: data.analyzed_from_round,
    analyzedToRound: data.analyzed_to_round,
    selectedNumbers: data.selected_numbers,
    recommendedSets: data.recommended_sets,
    summary: data.summary,
  });
}

async function analyzeWithOpenAI(summary: LottoAnalysisSummary): Promise<AiAnalysis> {
  const response = await new OpenAI({ apiKey: getRequiredEnv("OPENAI_API_KEY") }).responses.create({
    model: getRequiredEnv("OPENAI_MODEL"),
    input: `
You are analyzing Korean Lotto 6/45 history for entertainment only.
Use the supplied statistical summary of the latest 100 draws.
Select exactly 10 notable numbers ranked from 1 to 10 and explain each choice in Korean.
Create exactly 10 recommendation sets, each with exactly 6 unique numbers from 1 to 45.
Use long-term frequency, recent 10-draw frequency, last appearance, consecutive misses,
pair co-occurrence, odd/even distribution, number ranges, and draw sum statistics.
Do not claim that any number is more likely to win. Return only the requested JSON object.

Statistical summary:
${JSON.stringify(summary)}
`,
    text: { format: { type: "json_schema", name: "lotto_analysis", strict: true, schema: aiAnalysisSchema } },
  });

  if (!response.output_text) throw new Error("AI 분석 결과가 비어 있습니다.");

  try {
    return validateAiAnalysis(JSON.parse(response.output_text));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("AI 분석 결과")) throw error;
    throw new Error("AI 분석 결과가 JSON 형식이 아닙니다.");
  }
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

  try {
    analysis = await loadCachedAnalysis();

    if (!analysis) {
      const draws = await loadRecentDraws();
      analyzedDrawCount = draws.length;
      if (draws.length === 0) errorMessage = "분석할 로또 데이터가 없습니다.";
      else {
        analysis = await analyzeWithOpenAI(createLottoAnalysisSummary(draws));
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
            <Link href="/lotto" className={styles.retryLink}>다시 시도</Link>
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
          </>
        ) : null}

        <p className={styles.disclaimer}>본 결과는 과거 데이터의 통계적 분석이며 당첨을 보장하지 않습니다.</p>
      </section>
    </main>
  );
}
