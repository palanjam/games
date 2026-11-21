// Five Crowns meld solver. Shared by the server engine and the phone page, so
// it has no imports and touches nothing but its arguments.
//
// A card is { id, suit, rank, joker }: rank 3..13 (J 11, Q 12, K 13), or a
// joker with suit and rank null. Jokers and cards of the round's wild rank are
// wild and can stand in for any card in a book or a run.

export const SUITS = ['stars', 'hearts', 'clubs', 'spades', 'diamonds'];
export const MIN_RANK = 3;
export const MAX_RANK = 13;

export function isWild(card, wildRank) {
  return Boolean(card.joker) || card.rank === wildRank;
}

export function cardPoints(card, wildRank) {
  if (card.joker) return 50;
  if (card.rank === wildRank) return 20;
  return card.rank;
}

const sum = (cards, wildRank) => cards.reduce((s, c) => s + cardPoints(c, wildRank), 0);

// Best arrangement: the one with the fewest penalty points left over.
//
// Exhaustive search with memoisation over (natural cards still unplaced, wilds
// still unplaced, whether a book has been made). The lowest unplaced natural
// is either deadwood or sits in some book or run with other unplaced naturals
// and some wilds; trying every such meld covers every arrangement.
//
// Wilds are interchangeable inside melds, so the search only counts them:
// melds take the jokers first, so any wilds left over are the cheapest ones.
// Books take only the wilds they need, because a book can soak up any number
// of spare wilds at the end; without a book, spare wilds score unless three
// or more of them make a meld of their own.
export function arrange(cards, wildRank) {
  const naturals = [];
  const wilds = [];
  for (const c of cards) (isWild(c, wildRank) ? wilds : naturals).push(c);
  wilds.sort((a, b) => cardPoints(b, wildRank) - cardPoints(a, wildRank));
  const n = naturals.length;
  const totalWilds = wilds.length;

  const leftoverCost = (k, book) => (book || k >= 3 ? 0 : sum(wilds.slice(totalWilds - k), wildRank));

  // Where to find an unplaced natural of a given suit and rank for a run slot.
  const bySuitRank = new Map();
  naturals.forEach((c, i) => {
    const key = `${c.suit}:${c.rank}`;
    if (!bySuitRank.has(key)) bySuitRank.set(key, []);
    bySuitRank.get(key).push(i);
  });
  const freeOf = (mask, suit, rank) => bySuitRank.get(`${suit}:${rank}`)?.find((j) => mask & (1 << j)) ?? -1;

  // key -> { cost, meld } where meld is null (lowest natural is deadwood) or
  // { take: [natural indices], wilds, slots } (slots: run order, -1 = wild;
  // null for a book).
  const memo = new Map();
  const keyOf = (mask, w, book) => (mask * 32 + w) * 2 + book;

  function solve(mask, w, book) {
    if (mask === 0) return leftoverCost(w, book);
    const key = keyOf(mask, w, book);
    const hit = memo.get(key);
    if (hit) return hit.cost;

    const i = 31 - Math.clz32(mask & -mask); // lowest unplaced natural
    const rest = mask & ~(1 << i);
    const me = naturals[i];
    let best = { cost: me.rank + solve(rest, w, book), meld: null };
    const consider = (take, used, slots) => {
      let m = rest;
      for (const j of take) m &= ~(1 << j);
      const cost = solve(m, w - used, slots ? book : 1);
      if (cost < best.cost) best = { cost, meld: { take: [i, ...take], wilds: used, slots } };
    };

    // Books: any subset of the other unplaced naturals of this rank, plus the
    // wilds needed to reach three. Identical cards are interchangeable, so of
    // two same-suit cards only the first may be left out of a subset.
    const same = [];
    for (let j = i + 1; j < n; j++) if (rest & (1 << j) && naturals[j].rank === me.rank) same.push(j);
    subsets: for (let sub = 0; sub < 1 << same.length; sub++) {
      for (let b = 1; b < same.length; b++) {
        if (!(sub & (1 << b))) continue;
        for (let e = 0; e < b; e++) {
          if (!(sub & (1 << e)) && naturals[same[e]].suit === naturals[same[b]].suit) continue subsets;
        }
      }
      const take = same.filter((_, b) => sub & (1 << b));
      const need = Math.max(0, 2 - take.length);
      if (need <= w) consider(take, need, null);
    }

    // Runs: every window lo..hi (3+ long, within 3..K) holding this card;
    // each other slot is a natural of that suit (if one is free) or a wild.
    for (let lo = Math.max(MIN_RANK, me.rank - 10); lo <= me.rank; lo++) {
      for (let hi = Math.max(lo + 2, me.rank); hi <= Math.min(MAX_RANK, lo + 10); hi++) {
        const slots = [];
        const fill = (t, m, used, take) => {
          if (used > w) return;
          if (t > hi) {
            // A wild at the low end could equally sit one past the high end,
            // so only keep that shape when the run already reaches the King.
            if (slots[0] === -1 && hi < MAX_RANK) return;
            return consider(take, used, [...slots]);
          }
          if (t === me.rank) {
            slots.push(i);
            fill(t + 1, m, used, take);
            return void slots.pop();
          }
          const j = freeOf(m, me.suit, t);
          if (j >= 0) {
            slots.push(j);
            fill(t + 1, m & ~(1 << j), used, [...take, j]);
            slots.pop();
          }
          slots.push(-1);
          fill(t + 1, m, used + 1, take);
          slots.pop();
        };
        fill(lo, rest, 0, []);
      }
    }

    memo.set(key, best);
    return best.cost;
  }

  solve((1 << n) - 1, totalWilds, 0);

  // Walk the memo to rebuild the chosen melds, handing out wilds in order.
  const melds = [];
  const deadwood = [];
  let firstBook = null;
  let mask = (1 << n) - 1;
  let w = totalWilds;
  let book = 0;
  let nextWild = 0;
  while (mask) {
    const { meld } = memo.get(keyOf(mask, w, book));
    const i = 31 - Math.clz32(mask & -mask);
    if (!meld) {
      deadwood.push(naturals[i]);
      mask &= ~(1 << i);
      continue;
    }
    for (const j of meld.take) mask &= ~(1 << j);
    w -= meld.wilds;
    const fromWilds = wilds.slice(nextWild, nextWild + meld.wilds);
    nextWild += meld.wilds;
    if (meld.slots) {
      // Runs are listed by rank with wilds in the gaps they fill.
      let k = 0;
      melds.push(meld.slots.map((j) => (j < 0 ? fromWilds[k++] : naturals[j])));
    } else {
      book = 1;
      melds.push([...meld.take.map((j) => naturals[j]), ...fromWilds]);
      firstBook ??= melds.at(-1);
    }
  }
  const spare = wilds.slice(nextWild);
  if (firstBook) firstBook.push(...spare);
  else if (spare.length >= 3) melds.push(spare);
  else deadwood.push(...spare);

  return { melds, deadwood, points: sum(deadwood, wildRank) };
}

// Which single discard leaves the fewest points (ties: discard the
// highest-value card). Identical cards give identical results, so each kind
// is tried once.
export function bestDiscard(cards, wildRank) {
  let best = null;
  const tried = new Set();
  cards.forEach((card, idx) => {
    const kind = card.joker ? 'joker' : `${card.suit}:${card.rank}`;
    if (tried.has(kind)) return;
    tried.add(kind);
    const { points } = arrange(cards.filter((_, k) => k !== idx), wildRank);
    const value = cardPoints(card, wildRank);
    if (!best || points < best.points || (points === best.points && value > best.value)) {
      best = { cardId: card.id, points, value };
    }
  });
  return best && { cardId: best.cardId, points: best.points };
}
