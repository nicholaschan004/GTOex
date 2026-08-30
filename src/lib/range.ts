/**
 * Parser for the notation poker ranges are published in.
 *
 *   "22+, A2s+, K9s+, QTs+, JTs, AJo+, KQo"
 *
 * Storing charts this way rather than as 169 booleans is what makes 80 of them
 * writable and reviewable: one line per range, and a diff shows the actual
 * strategy change instead of a wall of flipped flags.
 *
 * Every failure throws. A typo in chart data that silently produced a smaller
 * range would show up as the trainer quietly marking correct answers wrong,
 * which is close to impossible to notice by playing.
 */

import { RANKS, type HandClass, type Rank, isRank, rankIndex } from "./cards";

export class RangeSyntaxError extends Error {
  constructor(
    readonly token: string,
    detail: string,
  ) {
    super(`Bad range token "${token}": ${detail}`);
    this.name = "RangeSyntaxError";
  }
}

type Suffix = "s" | "o";

interface Term {
  hi: Rank;
  lo: Rank;
  /** null on a non-pair means the token named no suffix, so it covers both. */
  suffix: Suffix | null;
  isPair: boolean;
}

const TERM_PATTERN = /^([2-9tjqkaTJQKA])([2-9tjqkaTJQKA])([soSO])?$/;

function parseTerm(term: string, token: string): Term {
  const match = TERM_PATTERN.exec(term);
  if (!match) throw new RangeSyntaxError(token, `"${term}" is not a hand`);

  const [, rawA, rawB, rawSuffix] = match;
  if (!rawA || !rawB) throw new RangeSyntaxError(token, `"${term}" is not a hand`);

  const a = rawA.toUpperCase();
  const b = rawB.toUpperCase();
  if (!isRank(a) || !isRank(b)) {
    throw new RangeSyntaxError(token, `"${term}" names an unknown rank`);
  }

  const suffix = rawSuffix ? (rawSuffix.toLowerCase() as Suffix) : null;

  if (a === b) {
    if (suffix) {
      throw new RangeSyntaxError(
        token,
        `a pair cannot be suited or offsuit, so "${term}" is not a hand`,
      );
    }
    return { hi: a, lo: a, suffix: null, isPair: true };
  }

  const aIsHigher = rankIndex(a) < rankIndex(b);
  return {
    hi: aIsHigher ? a : b,
    lo: aIsHigher ? b : a,
    suffix,
    isPair: false,
  };
}

/** One term to the classes it names. A bare "AK" covers both AKs and AKo. */
function classesOf(hi: Rank, lo: Rank, suffix: Suffix | null, isPair: boolean): HandClass[] {
  if (isPair) return [`${hi}${hi}`];
  if (suffix) return [`${hi}${lo}${suffix}`];
  return [`${hi}${lo}s`, `${hi}${lo}o`];
}

function rankAt(index: number, token: string): Rank {
  const rank = RANKS[index];
  if (!rank) throw new RangeSyntaxError(token, `rank index ${index} is out of bounds`);
  return rank;
}

/**
 * "77+" and "A9s+".
 *
 * For a pair the pair rank climbs to aces. For anything else the HIGH card is
 * held fixed and the KICKER climbs to just below it, so "A9s+" is A9s..AKs.
 * That is the rule Flopzilla, PioSOLVER and GTO+ all use. It makes "T9s+" mean
 * T9s alone, since there is no rank between a nine and a ten, and it is
 * deliberately NOT read as the suited connectors climbing to AKs.
 */
function expandPlus(body: string, token: string): HandClass[] {
  const term = parseTerm(body, token);
  const out: HandClass[] = [];

  if (term.isPair) {
    for (let i = rankIndex(term.hi); i >= 0; i--) {
      const rank = rankAt(i, token);
      out.push(`${rank}${rank}`);
    }
    return out;
  }

  for (let i = rankIndex(term.lo); i > rankIndex(term.hi); i--) {
    out.push(...classesOf(term.hi, rankAt(i, token), term.suffix, false));
  }
  return out;
}

/** "99-66" and "AJs-A9s". Endpoint order does not matter. */
function expandDash(token: string): HandClass[] {
  const parts = token.split("-");
  const [leftRaw, rightRaw] = parts;
  if (parts.length !== 2 || !leftRaw || !rightRaw) {
    throw new RangeSyntaxError(token, "a range needs exactly two endpoints");
  }

  const left = parseTerm(leftRaw, token);
  const right = parseTerm(rightRaw, token);

  if (left.isPair !== right.isPair) {
    throw new RangeSyntaxError(token, "cannot span from a pair to a non-pair");
  }

  const out: HandClass[] = [];

  if (left.isPair) {
    const from = Math.min(rankIndex(left.hi), rankIndex(right.hi));
    const to = Math.max(rankIndex(left.hi), rankIndex(right.hi));
    for (let i = from; i <= to; i++) {
      const rank = rankAt(i, token);
      out.push(`${rank}${rank}`);
    }
    return out;
  }

  if (left.hi !== right.hi) {
    throw new RangeSyntaxError(
      token,
      `both endpoints must share a high card, but got ${left.hi} and ${right.hi}`,
    );
  }
  if (left.suffix !== right.suffix) {
    throw new RangeSyntaxError(token, "both endpoints must be suited, or both offsuit");
  }

  const from = Math.min(rankIndex(left.lo), rankIndex(right.lo));
  const to = Math.max(rankIndex(left.lo), rankIndex(right.lo));
  for (let i = from; i <= to; i++) {
    out.push(...classesOf(left.hi, rankAt(i, token), left.suffix, false));
  }
  return out;
}

function expandToken(token: string): HandClass[] {
  if (token.includes("-")) return expandDash(token);
  if (token.endsWith("+")) {
    const body = token.slice(0, -1);
    if (!body) throw new RangeSyntaxError(token, "nothing before the +");
    return expandPlus(body, token);
  }
  const term = parseTerm(token, token);
  return classesOf(term.hi, term.lo, term.suffix, term.isPair);
}

/** Expand published range notation into the set of hand classes it covers. */
export function parseRange(notation: string): Set<HandClass> {
  const out = new Set<HandClass>();
  for (const token of notation.split(/[\s,]+/)) {
    if (!token) continue;
    for (const hand of expandToken(token)) out.add(hand);
  }
  return out;
}
