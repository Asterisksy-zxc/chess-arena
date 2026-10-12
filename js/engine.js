// Шахматный движок «Живой Арены»: классические правила + скрытые клетки событий.
// Состояние неизменяемое: applyMove возвращает новое состояние, исходное не трогается.
// Вся «случайность» арены берётся из зерна партии, поэтому ход всегда приводит
// к одному и тому же результату.

export const FILES = 'abcdefghijklmn';
export const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
export const LETTER = { k: 'Кр', q: 'Ф', r: 'Л', b: 'С', n: 'К', p: '' };

// Клетки событий спрятаны: их не видно, пока на них не встанет фигура.
export const CELLS = {
  lava:   { color: '#ff5a00', name: 'Пол — это лава', short: 'Лава', desc: 'Четверть пустых клеток на 3 хода превращается в лаву: по ней нельзя ходить и сквозь неё нельзя бить.' },
  mirror: { color: '#ff2bd6', name: 'Зеркало', short: 'Зеркало', desc: 'Вся доска отражается слева направо: фланги меняются местами, рокировка пропадает.' },
};

export const ARENA = {
  cellCount: 6,     // сколько скрытых клеток на старте
  minCells: 3,      // если осталось меньше — прячутся новые
  lavaShare: 0.25,  // доля пустых клеток, которые становятся лавой
  lavaLength: 6,    // сколько полуходов держится лава (по 3 хода каждому)
  respawnDelay: 4,
};

const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KING = [...ORTH, ...DIAG];
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

export const opp = (c) => (c === 'w' ? 'b' : 'w');
export const sqName = (s, sq) => FILES[sq % s.W] + (Math.floor(sq / s.W) + 1);
const rowOf = (s, sq) => Math.floor(sq / s.W);
export const mirrorFile = (s, sq) => rowOf(s, sq) * s.W + (s.W - 1 - (sq % s.W));

// Детерминированный генератор: одинаковые (зерно, ход, клетка) — одинаковый результат.
function rngFor(seed, a, b = 0) {
  let t = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b)) >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- создание

export function createGame(mode = 'arena', seed = 1) {
  const W = 8, H = mode === 'arena' ? 14 : 8;
  const board = new Array(W * H).fill(null);
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  let id = 0;
  for (let i = 0; i < 8; i++) {
    board[i] = { t: back[i], c: 'w', id: id++ };
    board[W + i] = { t: 'p', c: 'w', id: id++ };
    board[(H - 2) * W + i] = { t: 'p', c: 'b', id: id++ };
    board[(H - 1) * W + i] = { t: back[i], c: 'b', id: id++ };
  }
  const s = {
    W, H, mode, board, seed: seed >>> 0, turn: 'w',
    castle: { wK: true, wQ: true, bK: true, bQ: true },
    kingFile: 4, rookFiles: [0, 7],
    ep: -1, ply: 0, halfmove: 0, fullmove: 1,
    cells: {}, lava: {}, event: null,
    nextSpawnPly: 0, lost: { w: [], b: [] }, fx: [],
  };
  if (mode === 'arena') hideCells(s, ARENA.cellCount, rngFor(s.seed, 0, 777), true);
  return s;
}

// Прячет клетки в случайных местах середины поля, но не там, куда пешки
// могут шагнуть первым же ходом. Типы: на старте хотя бы по одному каждого.
function hideCells(s, count, rng, initial) {
  const { W, H } = s;
  const pool = [];
  for (let sq = 0; sq < W * H; sq++) {
    const r = rowOf(s, sq);
    if (r < 4 || r > H - 5) continue;
    if (s.board[sq] || s.cells[sq] || s.lava[sq] !== undefined) continue;
    pool.push(sq);
  }
  const types = Object.keys(CELLS);
  shuffle(pool, rng).slice(0, count).forEach((sq, i) => {
    const type = initial && i < types.length ? types[i] : types[Math.floor(rng() * types.length)];
    s.cells[sq] = { type };
  });
}

function cloneState(s) {
  return {
    ...s,
    board: s.board.slice(),
    castle: { ...s.castle },
    cells: { ...s.cells },
    lava: { ...s.lava },
    lost: { w: s.lost.w, b: s.lost.b },
    fx: [],
  };
}

// ---------------------------------------------------------------- атаки

export function isAttacked(s, sq, by) {
  const W = s.W, H = s.H, b = s.board;
  const r = Math.floor(sq / W), c = sq % W;
  const pr = by === 'w' ? r - 1 : r + 1;
  if (pr >= 0 && pr < H) {
    for (const dc of [-1, 1]) {
      const pc = c + dc;
      if (pc < 0 || pc >= W) continue;
      const p = b[pr * W + pc];
      if (p && p.c === by && p.t === 'p') return true;
    }
  }
  for (const [dr, dc] of KNIGHT) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
    const p = b[rr * W + cc];
    if (p && p.c === by && p.t === 'n') return true;
  }
  for (const [dr, dc] of KING) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
    const p = b[rr * W + cc];
    if (p && p.c === by && p.t === 'k') return true;
  }
  for (let i = 0; i < 8; i++) {
    const [dr, dc] = KING[i];
    const diag = i >= 4;
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < H && cc >= 0 && cc < W) {
      const q = rr * W + cc;
      if (s.lava[q] !== undefined) break;
      const p = b[q];
      if (p) {
        if (p.c === by && (p.t === 'q' || (diag ? p.t === 'b' : p.t === 'r'))) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }
  return false;
}

export function findKing(s, color) {
  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i];
    if (p && p.t === 'k' && p.c === color) return i;
  }
  return -1;
}

export function inCheck(s, color) {
  const k = findKing(s, color);
  return k >= 0 && isAttacked(s, k, opp(color));
}

// ---------------------------------------------------------------- генерация ходов

export function pseudoMoves(s, color = s.turn) {
  const out = [];
  for (let sq = 0; sq < s.board.length; sq++) {
    const p = s.board[sq];
    if (p && p.c === color) genPiece(s, sq, out);
  }
  return out;
}

function genPiece(s, from, out) {
  const W = s.W, H = s.H, b = s.board, p = b[from];
  const r = Math.floor(from / W), c = from % W;
  const enemy = opp(p.c);
  const canCapture = (t) => t.c === enemy && t.t !== 'k';
  const open = (sq) => s.lava[sq] === undefined;

  if (p.t === 'p') {
    const dir = p.c === 'w' ? 1 : -1;
    const start = p.c === 'w' ? 1 : H - 2;
    const last = p.c === 'w' ? H - 1 : 0;
    const r1 = r + dir;
    if (r1 < 0 || r1 >= H) return;
    const push = (to, extra) => {
      if (r1 === last) for (const pr of ['q', 'r', 'b', 'n']) out.push({ from, to, promo: pr, ...extra });
      else out.push({ from, to, ...extra });
    };
    const f1 = r1 * W + c;
    if (!b[f1] && open(f1)) {
      push(f1, {});
      if (r === start) {
        const f2 = (r + 2 * dir) * W + c;
        if (!b[f2] && open(f2)) out.push({ from, to: f2, double: true });
      }
    }
    for (const dc of [-1, 1]) {
      const c1 = c + dc;
      if (c1 < 0 || c1 >= W) continue;
      const to = r1 * W + c1;
      const t = b[to];
      if (t) {
        if (canCapture(t)) push(to, { capture: true });
      } else if (to === s.ep && open(to)) {
        const v = b[r * W + c1];
        if (v && v.t === 'p' && v.c === enemy) out.push({ from, to, ep: true, capture: true });
      }
    }
    return;
  }

  if (p.t === 'n' || p.t === 'k') {
    for (const [dr, dc] of p.t === 'n' ? KNIGHT : KING) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
      const to = rr * W + cc;
      if (!open(to)) continue;
      const t = b[to];
      if (!t) out.push({ from, to });
      else if (canCapture(t)) out.push({ from, to, capture: true });
    }
    if (p.t === 'k') genCastle(s, from, p.c, out);
    return;
  }

  const dirs = p.t === 'r' ? ORTH : p.t === 'b' ? DIAG : KING;
  for (const [dr, dc] of dirs) {
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < H && cc >= 0 && cc < W) {
      const to = rr * W + cc;
      if (!open(to)) break;
      const t = b[to];
      if (!t) out.push({ from, to });
      else {
        if (canCapture(t)) out.push({ from, to, capture: true });
        break;
      }
      rr += dr; cc += dc;
    }
  }
}

function genCastle(s, from, color, out) {
  const W = s.W, home = color === 'w' ? 0 : s.H - 1, kf = s.kingFile;
  if (from !== home * W + kf) return;
  const enemy = opp(color);
  let attackedNow = null;
  for (const [side, rf, dir] of [['K', s.rookFiles[1], 1], ['Q', s.rookFiles[0], -1]]) {
    if (!s.castle[color + side]) continue;
    const rookSq = home * W + rf;
    const rook = s.board[rookSq];
    if (!rook || rook.t !== 'r' || rook.c !== color) continue;
    let clear = true;
    for (let f = Math.min(kf, rf) + 1; f < Math.max(kf, rf); f++) {
      const q = home * W + f;
      if (s.board[q] || s.lava[q] !== undefined) { clear = false; break; }
    }
    if (!clear) continue;
    if (attackedNow === null) attackedNow = isAttacked(s, from, enemy);
    if (attackedNow) return;
    if (isAttacked(s, home * W + kf + dir, enemy)) continue;
    // клетку прибытия короля проверяет общий фильтр легальности
    out.push({ from, to: home * W + kf + 2 * dir, castle: side, rookFrom: rookSq, rookTo: home * W + kf + dir });
  }
}

// ---------------------------------------------------------------- применение хода

// noTrigger: применить ход, не трогая скрытые клетки. Так проверяется легальность,
// чтобы список возможных ходов никогда не выдавал, где спрятаны клетки.
export function applyMove(s, m, noTrigger = false) {
  const n = cloneState(s);
  const W = n.W;
  const piece = n.board[m.from];
  const mover = piece.c;
  const capSq = m.ep ? rowOf(n, m.from) * W + (m.to % W) : m.to;
  const captured = n.board[capSq];
  if (captured) n.board[capSq] = null;
  n.board[m.from] = null;
  n.board[m.to] = m.promo ? { ...piece, t: m.promo } : piece;
  if (m.castle) {
    n.board[m.rookTo] = n.board[m.rookFrom];
    n.board[m.rookFrom] = null;
  }
  if (piece.t === 'k') { n.castle[mover + 'K'] = false; n.castle[mover + 'Q'] = false; }
  touchCastle(n, m.from);
  touchCastle(n, capSq);
  if (captured) {
    n.lost = { ...n.lost, [captured.c]: [...n.lost[captured.c], captured] };
    n.fx.push({ kind: 'capture', sq: capSq, piece: captured });
  }
  n.halfmove = piece.t === 'p' || captured ? 0 : n.halfmove + 1;
  n.ep = m.double ? (m.from + m.to) / 2 : -1;
  if (!noTrigger && n.mode === 'arena' && n.cells[m.to] && !n.event) triggerCell(n, m.to, mover);
  endTurn(n);
  return n;
}

function touchCastle(n, sq) {
  const W = n.W;
  for (const [color, home] of [['w', 0], ['b', n.H - 1]]) {
    if (sq === home * W + n.rookFiles[0]) n.castle[color + 'Q'] = false;
    if (sq === home * W + n.rookFiles[1]) n.castle[color + 'K'] = false;
  }
}

// Фигура встала на скрытую клетку: клетка вспыхивает, событие начинается.
// Оба события не могут подставить короля того, кто наступил: лава только
// перекрывает линии, а зеркало сохраняет все расстояния между фигурами.
function triggerCell(n, sq, by) {
  const type = n.cells[sq].type;
  delete n.cells[sq];
  const p = n.ply;
  n.fx.push({ kind: 'trigger', type, sq, by });
  if (type === 'lava') {
    const rng = rngFor(n.seed, p, sq);
    const empty = [];
    for (let q = 0; q < n.W * n.H; q++) if (!n.board[q] && n.lava[q] === undefined && !n.cells[q]) empty.push(q);
    const picked = shuffle(empty, rng).slice(0, Math.round(empty.length * ARENA.lavaShare));
    for (const q of picked) n.lava[q] = p + ARENA.lavaLength;
    n.event = { type, by, sq, startedPly: p, endPly: p + ARENA.lavaLength };
    n.fx.push({ kind: 'lava', squares: picked });
  } else if (type === 'mirror') {
    const flip = (q) => mirrorFile(n, q);
    const board = new Array(n.board.length).fill(null);
    n.board.forEach((x, q) => { board[flip(q)] = x; });
    n.board = board;
    n.lava = Object.fromEntries(Object.entries(n.lava).map(([q, v]) => [flip(+q), v]));
    n.cells = Object.fromEntries(Object.entries(n.cells).map(([q, v]) => [flip(+q), v]));
    if (n.ep >= 0) n.ep = flip(n.ep);
    n.castle = { wK: false, wQ: false, bK: false, bQ: false };
    n.nextSpawnPly = p + ARENA.respawnDelay;
    n.fx.push({ kind: 'mirror' });
  }
}

function endTurn(n) {
  n.turn = opp(n.turn);
  n.ply++;
  if (n.turn === 'w') n.fullmove++;
  if (n.mode === 'arena') tickWorld(n);
}

// Изменения мира в начале хода: лава остывает, прячутся новые клетки.
function tickWorld(n) {
  for (const k of Object.keys(n.lava)) {
    if (n.lava[k] <= n.ply) delete n.lava[k];
  }
  const ev = n.event;
  if (ev && n.ply >= ev.endPly) {
    n.fx.push({ kind: 'eventEnd', type: ev.type });
    n.event = null;
    n.nextSpawnPly = n.ply + ARENA.respawnDelay;
  }
  if (!n.event && n.ply >= n.nextSpawnPly && Object.keys(n.cells).length < ARENA.minCells) {
    hideCells(n, 2, rngFor(n.seed, n.ply, 4242), false);
    n.fx.push({ kind: 'cellsHidden' });
  }
}

// ---------------------------------------------------------------- легальность и итог

export function legalMoves(s) {
  const res = [];
  for (const m of pseudoMoves(s)) {
    if (!inCheck(applyMove(s, m, true), s.turn)) res.push(m);
  }
  return res;
}

export function insufficientMaterial(s) {
  const rest = s.board.filter((p) => p && p.t !== 'k');
  if (rest.length === 0) return true;
  return rest.length === 1 && (rest[0].t === 'n' || rest[0].t === 'b');
}

export function positionKey(s) {
  let k = '';
  for (const p of s.board) k += p ? (p.c === 'w' ? p.t.toUpperCase() : p.t) : '.';
  k += s.turn + (s.castle.wK ? 'K' : '') + (s.castle.wQ ? 'Q' : '') + (s.castle.bK ? 'k' : '') + (s.castle.bQ ? 'q' : '');
  k += s.ep;
  if (s.mode === 'arena') {
    k += '|' + Object.keys(s.cells).sort().join(',');
    k += '|' + Object.keys(s.lava).sort().join(',');
  }
  return k;
}

export function gameStatus(s, repetitions = 1) {
  const moves = legalMoves(s);
  const check = inCheck(s, s.turn);
  if (!moves.length) {
    return check
      ? { over: true, kind: 'mate', winner: opp(s.turn), check, moves }
      : { over: true, kind: 'stalemate', check, moves };
  }
  if (insufficientMaterial(s)) return { over: true, kind: 'material', check, moves };
  if (s.halfmove >= 100) return { over: true, kind: 'fifty', check, moves };
  if (repetitions >= 3) return { over: true, kind: 'repetition', check, moves };
  return { over: false, check, moves };
}

// ---------------------------------------------------------------- нотация (русская)

export function moveToSan(s, m, legal) {
  if (m.castle) return m.castle === 'K' ? '0-0' : '0-0-0';
  const W = s.W, p = s.board[m.from];
  const dest = sqName(s, m.to);
  const cap = m.capture || m.ep;
  if (p.t === 'p') {
    return (cap ? FILES[m.from % W] + 'x' : '') + dest + (m.promo ? '=' + LETTER[m.promo] : '');
  }
  const others = legal.filter((o) => o.to === m.to && o.from !== m.from && s.board[o.from].t === p.t);
  let dis = '';
  if (others.length) {
    const sameFile = others.some((o) => o.from % W === m.from % W);
    const sameRank = others.some((o) => rowOf(s, o.from) === rowOf(s, m.from));
    if (!sameFile) dis = FILES[m.from % W];
    else if (!sameRank) dis = String(rowOf(s, m.from) + 1);
    else dis = sqName(s, m.from);
  }
  return LETTER[p.t] + dis + (cap ? 'x' : '') + dest;
}

// ---------------------------------------------------------------- FEN (для тестов классики)

export function fromFEN(fen) {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const s = createGame('classic');
  s.board = new Array(64).fill(null);
  let id = 0;
  placement.split('/').forEach((row, i) => {
    const r = 7 - i;
    let c = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { c += +ch; continue; }
      const t = ch.toLowerCase();
      s.board[r * 8 + c] = { t, c: ch === t ? 'b' : 'w', id: id++ };
      c++;
    }
  });
  s.turn = turn;
  s.castle = { wK: castling.includes('K'), wQ: castling.includes('Q'), bK: castling.includes('k'), bQ: castling.includes('q') };
  s.ep = ep && ep !== '-' ? (+ep[1] - 1) * 8 + FILES.indexOf(ep[0]) : -1;
  s.halfmove = +(half || 0);
  s.fullmove = +(full || 1);
  return s;
}

export function perft(s, depth) {
  if (depth === 0) return 1;
  let total = 0;
  for (const m of pseudoMoves(s)) {
    const n = applyMove(s, m, true);
    if (inCheck(n, s.turn)) continue;
    total += depth === 1 ? 1 : perft(n, depth - 1);
  }
  return total;
}
