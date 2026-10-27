function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/[_./:@-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function score(query: string, candidate: string): number | null {
  const needle = normalize(query);
  const haystack = normalize(candidate);
  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 800 - Math.min(haystack.length, 99);
  const wordIndex = ` ${haystack}`.indexOf(` ${needle}`);
  if (wordIndex >= 0) return 700 - Math.min(wordIndex, 99);
  const substringIndex = haystack.indexOf(needle);
  if (substringIndex >= 0) return 600 - Math.min(substringIndex, 99);

  let cursor = 0;
  let gapCost = 0;
  let previous = -1;
  for (const character of needle) {
    const index = haystack.indexOf(character, cursor);
    if (index < 0) return null;
    if (previous >= 0) gapCost += index - previous - 1;
    previous = index;
    cursor = index + 1;
  }
  return 300 - gapCost - haystack.length / 100;
}

export function filterFuzzy<T>(
  items: readonly T[],
  query: string,
  searchableText: (item: T) => string | readonly string[],
): T[] {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return [...items];

  return items
    .map((item, index) => {
      const text = searchableText(item);
      const fields = typeof text === 'string' ? [text] : text;
      const scores = tokens.map((token) => {
        const matches = fields
          .map((field) => score(token, field))
          .filter((value) => value !== null);
        return matches.length ? Math.max(...matches) : null;
      });
      if (scores.some((value) => value === null)) return null;
      return {
        item,
        index,
        score: scores.reduce<number>((total, value) => total + (value ?? 0), 0),
      };
    })
    .filter(
      (match): match is { item: T; index: number; score: number } =>
        match !== null,
    )
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);
}
