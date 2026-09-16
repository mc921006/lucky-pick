export type RecommendedSet = { numbers: [number, number, number, number, number, number] };

export function hasValidRecommendationSets(recommendedSets: RecommendedSet[]): boolean {
  if (recommendedSets.length !== 10) return false;
  const combinationKeys = new Set<string>();
  const coveredNumbers = new Set<number>();

  for (const set of recommendedSets) {
    const sortedNumbers = [...set.numbers].sort((first, second) => first - second);
    const key = sortedNumbers.join("-");
    if (combinationKeys.has(key)) return false;
    combinationKeys.add(key);
    sortedNumbers.forEach((number) => coveredNumbers.add(number));
  }

  if (coveredNumbers.size < 30) return false;

  for (let firstIndex = 0; firstIndex < recommendedSets.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < recommendedSets.length; secondIndex += 1) {
      const firstSet = new Set(recommendedSets[firstIndex].numbers);
      const overlap = recommendedSets[secondIndex].numbers.filter((number) => firstSet.has(number)).length;
      if (overlap > 2) return false;
    }
  }

  return true;
}

export function createBalancedFallbackSets(seed: number): RecommendedSet[] {
  let randomState = (seed ^ 0x9e3779b9) >>> 0;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x1_0000_0000;
  };
  const shuffledNumbers = Array.from({ length: 45 }, (_, index) => index + 1);

  for (let index = shuffledNumbers.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffledNumbers[index], shuffledNumbers[swapIndex]] = [shuffledNumbers[swapIndex], shuffledNumbers[index]];
  }

  // Overlapping six-number windows cover 42 distinct numbers; neighboring sets share only two.
  return Array.from({ length: 10 }, (_, index) => ({
    numbers: shuffledNumbers.slice(index * 4, index * 4 + 6).sort((first, second) => first - second) as RecommendedSet["numbers"],
  }));
}
