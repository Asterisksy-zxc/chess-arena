// Бот: альфа-бета поиск + форсированные взятия. Использует тот же генератор ходов,
// что и игра, поэтому понимает клетки событий, ночь, кратеры и летящие метеориты.
import { pseudoMoves, applyMove, inCheck, VALUES } from './engine.js';

const MATE = 100000;
const TIMEOUT = Symbol('timeout');
let nodes = 0;
let deadline = Infinity;

export const LEVELS = {
  1: { name: 'Новичок', depth: 1, timeMs: 400, noise: 140 },
  2: { name: 'Любитель', depth: 3, timeMs: 900, noise: 40 },
  3: { name: 'Мастер', depth: 5, timeMs: 2200, noise: 0 },
};

export function evaluate(s) {
  const W = s.W, H = s.H, b = s.board, cx = (W - 1) / 2, cy = (H - 1) / 2;
  let npm = 0;
  for (const p of b) if (p && p.t !== 'p' && p.t !== 'k') npm += VALUES[p.t];
  const phase = Math.min(1, npm / 6200); // 1 — дебют, 0 — эндшпиль
  let score = 0;
  for (let sq = 0; sq < W * H; sq++) {
    const p = b[sq];
    if (!p) continue;
    const r = Math.floor(sq / W), c = sq % W;
    const dist = Math.max(Math.abs(r - cy), Math.abs(c - cx) * 0.8);
    const adv = p.c === 'w' ? r : H - 1 - r;
    let v = VALUES[p.t];
    switch (p.t) {
      case 'p': v += adv * adv * (1.2 + (1 - phase) * 1.5) + (dist < 1.6 ? 12 : 0); break;
      case 'n': v += (3.5 - dist) * 12; break;
      case 'b': v += (3.5 - dist) * 6; break;
      case 'q': v += (3.5 - dist) * 3 * (1 - phase); break;
      case 'k':
        v += phase * ((adv === 0 ? 25 : -adv * 18) + Math.abs(c - cx) * 5);
        v += (1 - phase) * (3.5 - dist) * 12;
        break;
    }
    score += p.c === 'w' ? v : -v;
  }
  const ev = s.event;
  if (ev && ev.type === 'meteor') {
    for (const t of ev.targets) {
      const p = b[t];
      if (p && p.t !== 'k') score -= (p.c === 'w' ? 1 : -1) * VALUES[p.t] * 0.8;
    }
  }
  return score + (s.turn === 'w' ? 10 : -10);
}

function moveOrder(s, m) {
  let sc = 0;
  if (m.capture) {
    const victim = m.ep ? VALUES.p : VALUES[s.board[m.to].t];
    sc += 10000 + victim * 10 - VALUES[s.board[m.from].t] / 10;
  }
  if (m.promo) sc += 8000 + VALUES[m.promo];
  if (m.castle) sc += 300;
  return sc;
}

function ordered(s, moves) {
  return moves.map((m) => ({ m, k: moveOrder(s, m) })).sort((a, b) => b.k - a.k).map((x) => x.m);
}

function quiesce(s, alpha, beta, qd) {
  if ((++nodes & 2047) === 0 && Date.now() > deadline) throw TIMEOUT;
  const stand = evaluate(s);
  if (qd >= 5) return stand;
  const max = s.turn === 'w';
  if (max) { if (stand >= beta) return stand; if (stand > alpha) alpha = stand; }
  else { if (stand <= alpha) return stand; if (stand < beta) beta = stand; }
  let best = stand;
  const caps = ordered(s, pseudoMoves(s).filter((m) => m.capture || m.promo));
  for (const m of caps) {
    const n = applyMove(s, m);
    if (inCheck(n, s.turn)) continue;
    const sc = quiesce(n, alpha, beta, qd + 1);
    if (max) { if (sc > best) best = sc; if (sc > alpha) alpha = sc; }
    else { if (sc < best) best = sc; if (sc < beta) beta = sc; }
    if (alpha >= beta) break;
  }
  return best;
}

function search(s, depth, alpha, beta, ply) {
  if ((++nodes & 2047) === 0 && Date.now() > deadline) throw TIMEOUT;
  if (depth <= 0) return quiesce(s, alpha, beta, 0);
  const max = s.turn === 'w';
  let best = max ? -Infinity : Infinity;
  let any = false;
  for (const m of ordered(s, pseudoMoves(s))) {
    const n = applyMove(s, m);
    if (inCheck(n, s.turn)) continue;
    any = true;
    const sc = search(n, depth - 1, alpha, beta, ply + 1);
    if (max) { if (sc > best) best = sc; if (sc > alpha) alpha = sc; }
    else { if (sc < best) best = sc; if (sc < beta) beta = sc; }
    if (alpha >= beta) break;
  }
  if (!any) return inCheck(s, s.turn) ? (max ? -MATE + ply : MATE - ply) : 0;
  return best;
}

export function findBestMove(s, level = 2) {
  const cfg = LEVELS[level] || LEVELS[2];
  const root = [];
  for (const m of ordered(s, pseudoMoves(s))) {
    const n = applyMove(s, m);
    if (!inCheck(n, s.turn)) root.push({ m, n, score: 0 });
  }
  if (!root.length) return null;
  if (root.length === 1) return root[0].m;
  const max = s.turn === 'w';
  deadline = Date.now() + cfg.timeMs;
  nodes = 0;
  let best = root[0].m;
  for (let d = 1; d <= cfg.depth; d++) {
    try {
      let alpha = -Infinity, beta = Infinity;
      for (const r of root) {
        r.score = search(r.n, d - 1, alpha, beta, 1) + (cfg.noise ? (Math.random() - 0.5) * cfg.noise : 0);
        if (max) alpha = Math.max(alpha, r.score);
        else beta = Math.min(beta, r.score);
      }
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      break;
    }
    root.sort((a, b) => (max ? b.score - a.score : a.score - b.score));
    best = root[0].m;
    if (Math.abs(root[0].score) > MATE - 500) break;
  }
  return best;
}
