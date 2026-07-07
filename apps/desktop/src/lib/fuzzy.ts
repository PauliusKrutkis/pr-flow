/**
 * Scored fuzzy matching for every search surface. A match is a subsequence of
 * the query in the text, scored so that the rankings feel like an editor's
 * file picker: word-boundary hits, consecutive runs, and early matches rank
 * above scattered character soup.
 */

export interface FuzzyResult {
  score: number;
  indices: number[];
}

const BOUNDARY = /[\s/\-_.#:]/;

function isBoundaryStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  if (BOUNDARY.test(prev)) return true;
  return prev === prev.toLowerCase() && text[i] === text[i].toUpperCase();
}

/**
 * Match a single term (no spaces) against text, case-insensitively.
 * Greedy left-to-right with a simple retry: prefer boundary starts.
 */
function matchTerm(term: string, text: string): FuzzyResult | null {
  if (!term) return { score: 0, indices: [] };
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();

  const sub = lowerText.indexOf(lowerTerm);
  if (sub !== -1) {
    const indices = Array.from({ length: term.length }, (_, k) => sub + k);
    let score = 100 + term.length * 8;
    if (isBoundaryStart(text, sub)) score += 40;
    if (sub === 0) score += 20;
    score -= Math.min(sub, 20); // earlier is better
    return { score, indices };
  }

  const indices: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < lowerTerm.length; qi++) {
    const c = lowerTerm[qi];
    let found = -1;
    for (let j = ti; j < lowerText.length; j++) {
      if (lowerText[j] === c && isBoundaryStart(text, j)) {
        found = j;
        break;
      }
    }
    if (found === -1) found = lowerText.indexOf(c, ti);
    if (found === -1) return null;
    indices.push(found);
    ti = found + 1;
  }

  let score = term.length * 4;
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    if (isBoundaryStart(text, i)) score += 12;
    if (k > 0 && indices[k - 1] === i - 1) score += 10; // consecutive run
    score -= Math.floor(i / 24); // light penalty for late matches
  }
  return { score, indices };
}

/**
 * Match a whole query against text. Spaces split the query into terms that
 * must ALL match (order-independent); scores add up, indices merge.
 * Returns null when any term misses.
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { score: 0, indices: [] };
  let score = 0;
  const all = new Set<number>();
  for (const term of terms) {
    const m = matchTerm(term, text);
    if (!m) return null;
    score += m.score;
    for (const i of m.indices) all.add(i);
  }
  return { score, indices: [...all].sort((a, b) => a - b) };
}

/**
 * Match a query against several fields of one item; the best field wins the
 * score. Returns per-field indices for highlighting (only fields that matched
 * the full query on their own get indices).
 */
export function fuzzyMatchFields(
  query: string,
  fields: Record<string, string>,
): { score: number; indices: Record<string, number[]> } | null {
  const entries = Object.entries(fields);
  let best = -Infinity;
  const indices: Record<string, number[]> = {};
  for (const [key, value] of entries) {
    const m = fuzzyMatch(query, value);
    if (m) {
      indices[key] = m.indices;
      if (m.score > best) best = m.score;
    }
  }
  if (best === -Infinity) return null;
  return { score: best, indices };
}
