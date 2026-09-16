export type StoredLottoPrediction = {
  analyzed_to_round: number;
  recommended_sets: unknown;
  created_at: string;
};

export type EvaluationDraw = {
  round: number;
  draw_date: string;
  number1: number;
  number2: number;
  number3: number;
  number4: number;
  number5: number;
  number6: number;
};

export type LottoPredictionEvaluation = {
  forecastCount: number;
  setCount: number;
  totalMatches: number;
  setsWithThreeOrMore: number;
  averageMatchesPerSet: number;
  threeOrMoreRate: number;
  randomAverageMatchesPerSet: number;
  randomThreeOrMoreRate: number;
  rounds: Array<{ round: number; bestSetMatches: number; setsWithThreeOrMore: number }>;
};

const LOTTO_NUMBER_COUNT = 45;
const DRAW_NUMBER_COUNT = 6;
const SETS_PER_PREDICTION = 10;

function isValidSet(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === DRAW_NUMBER_COUNT && value.every((number) => (
    typeof number === "number" && Number.isInteger(number) && number >= 1 && number <= LOTTO_NUMBER_COUNT
  )) && new Set(value).size === DRAW_NUMBER_COUNT;
}

function isValidRecommendedSet(value: unknown): value is { numbers: number[] } {
  if (typeof value !== "object" || value === null || !("numbers" in value)) return false;
  return isValidSet(value.numbers);
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = (result * (n - index + 1)) / index;
  return result;
}

function getRandomThreeOrMoreRate(): number {
  const allCombinations = choose(LOTTO_NUMBER_COUNT, DRAW_NUMBER_COUNT);
  let matchingCombinations = 0;

  for (let matches = 3; matches <= DRAW_NUMBER_COUNT; matches += 1) {
    matchingCombinations += choose(DRAW_NUMBER_COUNT, matches) * choose(LOTTO_NUMBER_COUNT - DRAW_NUMBER_COUNT, DRAW_NUMBER_COUNT - matches);
  }

  return matchingCombinations / allCombinations;
}

export function evaluateLottoPredictions(
  predictions: StoredLottoPrediction[],
  draws: EvaluationDraw[],
): LottoPredictionEvaluation {
  const drawByRound = new Map(draws.map((draw) => [draw.round, draw]));
  const rounds: LottoPredictionEvaluation["rounds"] = [];
  let totalMatches = 0;
  let setCount = 0;
  let setsWithThreeOrMore = 0;

  predictions.forEach((prediction) => {
    if (!Number.isInteger(prediction.analyzed_to_round) || typeof prediction.created_at !== "string") return;
    const sets = prediction.recommended_sets;
    if (!Array.isArray(sets) || sets.length !== SETS_PER_PREDICTION || !sets.every(isValidRecommendedSet)) return;

    const targetDraw = drawByRound.get(prediction.analyzed_to_round + 1);
    if (!targetDraw) return;

    const generatedAt = Date.parse(prediction.created_at);
    const drawTime = Date.parse(`${targetDraw.draw_date}T20:35:00+09:00`);
    // Exclude stale forecasts generated after the target draw had already happened.
    if (!Number.isFinite(generatedAt) || generatedAt >= drawTime) return;

    const winningNumbers = new Set([
      targetDraw.number1,
      targetDraw.number2,
      targetDraw.number3,
      targetDraw.number4,
      targetDraw.number5,
      targetDraw.number6,
    ]);
    const hitCounts = sets.map((set) => set.numbers.filter((number) => winningNumbers.has(number)).length);
    const matchedSets = hitCounts.filter((count) => count >= 3).length;

    totalMatches += hitCounts.reduce((sum, count) => sum + count, 0);
    setCount += hitCounts.length;
    setsWithThreeOrMore += matchedSets;
    rounds.push({
      round: targetDraw.round,
      bestSetMatches: Math.max(...hitCounts),
      setsWithThreeOrMore: matchedSets,
    });
  });

  rounds.sort((first, second) => first.round - second.round);

  return {
    forecastCount: rounds.length,
    setCount,
    totalMatches,
    setsWithThreeOrMore,
    averageMatchesPerSet: setCount > 0 ? totalMatches / setCount : 0,
    threeOrMoreRate: setCount > 0 ? setsWithThreeOrMore / setCount : 0,
    randomAverageMatchesPerSet: DRAW_NUMBER_COUNT * DRAW_NUMBER_COUNT / LOTTO_NUMBER_COUNT,
    randomThreeOrMoreRate: getRandomThreeOrMoreRate(),
    rounds,
  };
}
