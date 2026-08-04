export type LottoDraw = {
  round: number;
  draw_date: string;
  number1: number;
  number2: number;
  number3: number;
  number4: number;
  number5: number;
  number6: number;
  bonus_number: number;
};

export type NumberAnalysis = {
  number: number;
  totalCount: number;
  recent10Count: number;
  lastAppearanceRound: number | null;
  consecutiveMisses: number;
};

export type PairAnalysis = {
  numbers: [number, number];
  count: number;
};

export type LottoAnalysisSummary = {
  analyzedFromRound: number;
  analyzedToRound: number;
  drawCount: number;
  numberStats: NumberAnalysis[];
  pairCoOccurrences: PairAnalysis[];
  oddEvenDistribution: { odd: number; even: number };
  rangeDistribution: Record<string, number>;
  drawSum: { min: number; max: number; average: number };
};

const LOTTO_NUMBERS = Array.from({ length: 45 }, (_, index) => index + 1);

function getMainNumbers(draw: LottoDraw): number[] {
  return [draw.number1, draw.number2, draw.number3, draw.number4, draw.number5, draw.number6];
}

function roundAverage(value: number): number {
  return Math.round(value * 100) / 100;
}

export function createLottoAnalysisSummary(draws: LottoDraw[]): LottoAnalysisSummary {
  const orderedDraws = [...draws].sort((a, b) => b.round - a.round);
  const recentDraws = orderedDraws.slice(0, 10);
  const totalCounts = new Map(LOTTO_NUMBERS.map((number) => [number, 0]));
  const recentCounts = new Map(LOTTO_NUMBERS.map((number) => [number, 0]));
  const lastAppearance = new Map<number, number>();
  const pairCounts = new Map<string, PairAnalysis>();
  const rangeDistribution: Record<string, number> = {
    "1-10": 0,
    "11-20": 0,
    "21-30": 0,
    "31-40": 0,
    "41-45": 0,
  };
  let odd = 0;
  let even = 0;

  const drawSums = orderedDraws.map((draw) => {
    const numbers = getMainNumbers(draw);

    numbers.forEach((number) => {
      totalCounts.set(number, (totalCounts.get(number) ?? 0) + 1);
      if (number % 2 === 0) even += 1;
      else odd += 1;

      const range = number <= 10
        ? "1-10"
        : number <= 20
          ? "11-20"
          : number <= 30
            ? "21-30"
            : number <= 40
              ? "31-40"
              : "41-45";
      rangeDistribution[range] += 1;

      if (!lastAppearance.has(number)) lastAppearance.set(number, draw.round);
    });

    for (let firstIndex = 0; firstIndex < numbers.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < numbers.length; secondIndex += 1) {
        const pair = [numbers[firstIndex], numbers[secondIndex]].sort((a, b) => a - b) as [number, number];
        const key = pair.join("-");
        const existing = pairCounts.get(key);
        pairCounts.set(key, { numbers: pair, count: (existing?.count ?? 0) + 1 });
      }
    }

    return numbers.reduce((sum, number) => sum + number, 0);
  });

  recentDraws.forEach((draw) => {
    getMainNumbers(draw).forEach((number) => {
      recentCounts.set(number, (recentCounts.get(number) ?? 0) + 1);
    });
  });

  const orderedStats = LOTTO_NUMBERS.map((number) => ({
    number,
    totalCount: totalCounts.get(number) ?? 0,
    recent10Count: recentCounts.get(number) ?? 0,
    lastAppearanceRound: lastAppearance.get(number) ?? null,
    consecutiveMisses: lastAppearance.has(number)
      ? orderedDraws.findIndex((draw) => getMainNumbers(draw).includes(number))
      : orderedDraws.length,
  }));

  const pairCoOccurrences = [...pairCounts.values()]
    .sort((a, b) => b.count - a.count || a.numbers[0] - b.numbers[0] || a.numbers[1] - b.numbers[1])
    .slice(0, 30);

  return {
    analyzedFromRound: orderedDraws.at(-1)?.round ?? 0,
    analyzedToRound: orderedDraws[0]?.round ?? 0,
    drawCount: orderedDraws.length,
    numberStats: orderedStats,
    pairCoOccurrences,
    oddEvenDistribution: { odd, even },
    rangeDistribution,
    drawSum: {
      min: drawSums.length > 0 ? Math.min(...drawSums) : 0,
      max: drawSums.length > 0 ? Math.max(...drawSums) : 0,
      average: drawSums.length > 0 ? roundAverage(drawSums.reduce((sum, value) => sum + value, 0) / drawSums.length) : 0,
    },
  };
}
