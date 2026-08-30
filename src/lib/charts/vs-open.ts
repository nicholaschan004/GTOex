/**
 * Defending against a single raise, at 100bb.
 *
 * BASELINE DATA, NOT SOLVER OUTPUT. Same standing as the opening charts: close
 * to consensus, internally consistent, and meant to be replaced by computed
 * ranges. The tests are what hold them to account.
 *
 * The two ranges for each spot are written DISJOINT. A hand is a 3-bet or a
 * call or a fold, never two of those, and the test suite fails if any spot
 * lists a hand twice. Writing them with precedence instead ("3-bet wins") would
 * hide a typo, because an accidental overlap would silently resolve rather than
 * being reported.
 *
 * The shape of the data reflects how the spot actually plays:
 *   - defending gets wider as the opener's seat gets later, because a button
 *     open is a much weaker range than an under the gun open
 *   - the big blind defends widest of all: it has already paid one blind and it
 *     closes the action, so it is getting a price nobody else gets
 *   - the small blind 3-bets rather than calls. It would play every later
 *     street out of position with the big blind still to act behind it, so a
 *     flat call invites exactly the situation it least wants.
 */

import type { Position, RfiPosition } from "../positions";

export interface Defense {
  /** Re-raise. */
  threeBet: string;
  /** Flat call. Disjoint from threeBet. */
  call: string;
}

export const VS_OPEN_100BB: Record<RfiPosition, Partial<Record<Position, Defense>>> = {
  UTG: {
    HJ: {
      threeBet: "QQ+, AKs, AKo, A5s",
      call: "77-JJ, ATs-AQs, KJs+, QJs, JTs, AQo",
    },
    CO: {
      threeBet: "QQ+, AKs, AKo, A5s, A4s",
      call: "66-JJ, ATs-AQs, KTs+, QTs+, JTs, T9s, AQo",
    },
    BTN: {
      threeBet: "QQ+, AKs, AKo, A5s, A4s, A3s",
      call: "22-JJ, A9s-AQs, KTs+, QTs+, J9s+, T9s, 98s, AQo, AJo, KQo",
    },
    SB: {
      threeBet: "QQ+, AKs, AKo, AQs, A5s, A4s",
      call: "88-JJ, ATs, AJs, KQs",
    },
    BB: {
      threeBet: "QQ+, AKs, AKo, A5s, A4s, A3s",
      call:
        "22-JJ, A2s, A6s-AQs, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, " +
        "AQo, AJo, ATo, KQo, KJo, QJo",
    },
  },

  HJ: {
    CO: {
      threeBet: "QQ+, AKs, AKo, A5s, A4s",
      call: "66-JJ, ATs-AQs, KTs+, QTs+, JTs, T9s, AQo, AJo",
    },
    BTN: {
      threeBet: "JJ+, AKs, AKo, AQs, A5s, A4s, A3s",
      call: "22-TT, A9s-AJs, KTs+, QTs+, J9s+, T9s, 98s, 87s, AQo, AJo, KQo",
    },
    SB: {
      threeBet: "QQ+, AKs, AKo, AQs, A5s, A4s, A3s",
      call: "77-JJ, ATs, AJs, KJs, KQs, QJs",
    },
    BB: {
      threeBet: "QQ+, AKs, AKo, A5s, A4s, A3s, A2s",
      call:
        "22-JJ, A6s-AQs, K8s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, " +
        "AQo, AJo, ATo, A9o, KQo, KJo, KTo, QJo, QTo, JTo",
    },
  },

  CO: {
    BTN: {
      threeBet: "JJ+, AKs, AKo, AQs, A5s, A4s, A3s, KQs",
      call:
        "22-TT, A8s-AJs, KTs-KJs, QTs+, J9s+, T9s, 98s, 87s, 76s, " +
        "AQo, AJo, ATo, KQo, KJo",
    },
    SB: {
      threeBet: "TT+, AKs, AKo, AQs, AQo, A5s, A4s, A3s, KQs",
      call: "55-99, ATs, AJs, KJs, QJs, JTs, T9s",
    },
    BB: {
      threeBet: "JJ+, AKs, AKo, AQs, A5s, A4s, A3s, A2s, K9s",
      call:
        "22-TT, A6s-AJs, K8s, KTs-KQs, Q8s+, J8s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, " +
        "AQo, AJo, ATo, A9o, A8o, KQo, KJo, KTo, QJo, QTo, JTo, J9o, T9o",
    },
  },

  BTN: {
    SB: {
      threeBet: "TT+, AKs, AKo, AQs, AQo, AJs, A5s, A4s, A3s, A2s, KQs, KJs",
      call: "44-99, ATs, KTs, QJs, QTs, JTs, T9s, 98s",
    },
    BB: {
      threeBet: "TT+, AKs, AKo, AQs, AQo, A5s, A4s, A3s, A2s, K9s, K8s",
      call:
        "22-99, A6s-AJs, K2s-K7s, KTs-KQs, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, " +
        "AJo, ATo, A9o, A8o, A7o, KQo, KJo, KTo, K9o, QJo, QTo, Q9o, JTo, J9o, T9o, 98o",
    },
  },

  SB: {
    BB: {
      threeBet: "99+, AKs, AKo, AQs, AQo, AJs, A5s, A4s, A3s, A2s, KQs, KJs, K9s",
      call:
        "22-88, A6s-ATs, K2s-K8s, KTs, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, " +
        "AJo, ATo, A9o, A8o, A7o, A6o, A5o, KQo, KJo, KTo, K9o, K8o, " +
        "QJo, QTo, Q9o, JTo, J9o, T9o, 98o, 87o",
    },
  },
};

/** The seats that can face an open from a given seat, in acting order. */
export function defendersAgainst(opener: RfiPosition): Position[] {
  return Object.keys(VS_OPEN_100BB[opener]) as Position[];
}
