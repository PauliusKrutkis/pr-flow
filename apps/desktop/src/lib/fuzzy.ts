/**
 * Scored fuzzy matching for every search surface. A match is a subsequence of
 * the query in the text, scored so that the rankings feel like an editor's
 * file picker: word-boundary hits, consecutive runs, and early matches rank
 * above scattered character soup.
 */

export interface FuzzyResult {
  indices: number[];
  score: number;
}

const BOUNDARY = /[\s/\-_.#:]/;
const TERM_SPLIT = /\s+/;

function isBoundaryStart(text: string, i: number): boolean {
  if (i === 0) {
    return true;
  }
  const prev = text[i - 1];
  if (BOUNDARY.test(prev)) {
    return true;
  }
  return prev === prev.toLowerCase() && text[i] === text[i].toUpperCase();
}

function matchSubstring(
  term: string,
  text: string,
  lowerText: string,
  lowerTerm: string
): FuzzyResult {
  const sub = lowerText.indexOf(lowerTerm);
  const indices = Array.from({ length: term.length }, (_, k) => sub + k);
  let score = 100 + term.length * 8;
  if (isBoundaryStart(text, sub)) {
    score += 40;
  }
  if (sub === 0) {
    score += 20;
  }
  score -= Math.min(sub, 20);
  return { indices, score };
}

function findSubsequenceChar(
  c: string,
  lowerText: string,
  text: string,
  start: number
): number {
  for (let j = start; j < lowerText.length; j += 1) {
    if (lowerText[j] === c && isBoundaryStart(text, j)) {
      return j;
    }
  }
  return lowerText.indexOf(c, start);
}

function scoreSubsequence(
  term: string,
  text: string,
  indices: number[]
): FuzzyResult {
  let score = term.length * 4;
  for (let k = 0; k < indices.length; k += 1) {
    const i = indices[k];
    if (isBoundaryStart(text, i)) {
      score += 12;
    }
    if (k > 0 && indices[k - 1] === i - 1) {
      score += 10;
    }
    score -= Math.floor(i / 24);
  }
  return { indices, score };
}

function matchSubsequence(
  term: string,
  text: string,
  lowerText: string,
  lowerTerm: string
): FuzzyResult | null {
  const indices: number[] = [];
  let ti = 0;
  for (const c of lowerTerm) {
    const found = findSubsequenceChar(c, lowerText, text, ti);
    if (found === -1) {
      return null;
    }
    indices.push(found);
    ti = found + 1;
  }
  return scoreSubsequence(term, text, indices);
}

/**
 * Match a single term (no spaces) against text, case-insensitively.
 * Greedy left-to-right with a simple retry: prefer boundary starts.
 */
function matchTerm(term: string, text: string): FuzzyResult | null {
  if (!term) {
    return { indices: [], score: 0 };
  }
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();

  if (lowerText.includes(lowerTerm)) {
    return matchSubstring(term, text, lowerText, lowerTerm);
  }
  return matchSubsequence(term, text, lowerText, lowerTerm);
}

/**
 * Match a whole query against text. Spaces split the query into terms that
 * must ALL match (order-independent); scores add up, indices merge.
 * Returns null when any term misses.
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const terms = query.trim().split(TERM_SPLIT).filter(Boolean);
  if (terms.length === 0) {
    return { indices: [], score: 0 };
  }
  let score = 0;
  const all = new Set<number>();
  for (const term of terms) {
    const m = matchTerm(term, text);
    if (!m) {
      return null;
    }
    score += m.score;
    for (const i of m.indices) {
      all.add(i);
    }
  }
  return { indices: [...all].sort((a, b) => a - b), score };
}

/**
 * Match a query against several fields of one item; the best field wins the
 * score. Returns per-field indices for highlighting (only fields that matched
 * the full query on their own get indices).
 */
export function fuzzyMatchFields(
  query: string,
  fields: Record<string, string>
): { score: number; indices: Record<string, number[]> } | null {
  const entries = Object.entries(fields);
  let best = Number.NEGATIVE_INFINITY;
  const indices: Record<string, number[]> = {};
  for (const [key, value] of entries) {
    const m = fuzzyMatch(query, value);
    if (m) {
      indices[key] = m.indices;
      if (m.score > best) {
        best = m.score;
      }
    }
  }
  if (best === Number.NEGATIVE_INFINITY) {
    return null;
  }
  return { indices, score: best };
}
