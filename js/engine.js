// Шахматный движок «Живой Арены»: классические правила + клетки событий.
// Состояние неизменяемое: applyMove возвращает новое состояние, исходное не трогается.
// Вся «случайность» арены берётся из зерна партии, поэтому ход всегда приводит
// к одному и тому же результату — и в игре, и в расчётах бота.

export const FILES = 'abcdefghijkl';
export const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
export const LETTER = { k: 'Кр', q: 'Ф', r: 'Л', b: 'С', n: 'К', p: '' };

export const CELLS = {
  meteor: { color: '#ff3b5c', name: 'Метеориты', desc: 'На половину соперника падают метеориты: через 2 хода они уничтожат фигуры на отмеченных клетках и оставят кратеры.' },
  fog:    { color: '#3fa9ff', name: 'Туман',     desc: 'Соперник ослеплён на 3 своих хода: он видит только клетки рядом со своими фигурами.' },
  night:  { color: '#b45cff', name: 'Ночь',      desc: 'На 3 хода для всех: ладьи, слоны и ферзи ходят и бьют не дальше 3 клеток.' },
};

export const ARENA = {
  meteorDelay: 4,   // полуходов от вспышки до удара (у каждого по 2 хода)
  meteorCount: 3,
  eventLength: 6,   // сколько полуходов длятся туман и ночь
  craterLife: 10,
  respawnDelay: 4,  // через сколько полуходов после события появляются новые клетки
  minCells: 4,
};

const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KING = [...ORTH, ...DIAG];
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

export const opp = (c) => (c === 'w' ? 'b' : 'w');
export const sqName = (s, sq) => FILES[sq % s.N] + (Math.floor(sq / s.N) + 1);
const rowOf = (s, sq) => Math.floor(sq / s.N);
const mirror = (s, sq) => s.N * s.N - 1 - sq; // центральная симметрия

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
  const N = mode === 'arena' ? 10 : 8;
  const off = mode === 'arena' ? 1 : 0;
  const board = new Array(N * N).fill(null);
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  let id = 0;
  for (let i = 0; i < 8; i++) {
    board[off + i] = { t: back[i], c: 'w', id: id++ };
    board[N + off + i] = { t: 'p', c: 'w', id: id++ };
    board[(N - 2) * N + off + i] = { t: 'p', c: 'b', id: id++ };
    board[(N - 1) * N + off + i] = { t: back[i], c: 'b', id: id++ };
  }
  const s = {
    N, mode, board, seed: seed >>> 0, turn: 'w',
    castle: { wK: true, wQ: true, bK: true, bQ: true },
    kingFile: off + 4, rookFiles: [off, off + 7],
    ep: -1, ply: 0, halfmove: 0, fullmove: 1,
    cells: {}, craters: {}, event: null, night: false, fog: null,
    nextSpawnPly: 0, lost: { w: [], b: [] }, fx: [],
  };
  if (mode === 'arena') {
    const place = (r, c, type) => {
      s.cells[r * N + c] = { type };
      s.cells[mirror(s, r * N + c)] = { type };
    };
    place(4, 1, 'meteor'); // b5 / i6
    place(4, 4, 'night');  // e5 / f6
    place(4, 6, 'fog');    // g5 / d6
  }
  return s;
}

function cloneState(s) {
  return {
    ...s,
    board: s.board.slice(),
    castle: { ...s.castle },
    cells: { ...s.cells },
    craters: { ...s.craters },
    lost: { w: s.lost.w, b: s.lost.b },
    fx: [],
  };
}

// ---------------------------------------------------------------- атаки

export function isAttacked(s, sq, by) {
  const N = s.N, b = s.board;
  const r = Math.floor(sq / N), c = sq % N;
  const pr = by === 'w' ? r - 1 : r + 1;
  if (pr >= 0 && pr < N) {
    for (const dc of [-1, 1]) {
      const pc = c + dc;
      if (pc < 0 || pc >= N) continue;
      const p = b[pr * N + pc];
      if (p && p.c === by && p.t === 'p') return true;
    }
  }
  for (const [dr, dc] of KNIGHT) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
    const p = b[rr * N + cc];
    if (p && p.c === by && p.t === 'n') return true;
  }
  for (const [dr, dc] of KING) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
    const p = b[rr * N + cc];
    if (p && p.c === by && p.t === 'k') return true;
  }
  const range = s.night ? 3 : N;
  for (let i = 0; i < 8; i++) {
    const [dr, dc] = KING[i];
    const diag = i >= 4;
    let rr = r + dr, cc = c + dc, d = 1;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N && d <= range) {
      const q = rr * N + cc;
      if (s.craters[q] !== undefined) break;
      const p = b[q];
      if (p) {
        if (p.c === by && (p.t === 'q' || (diag ? p.t === 'b' : p.t === 'r'))) return true;
        break;
      }
      rr += dr; cc += dc; d++;
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

// Бьёт ли фигура с клетки from клетку to.
export function pieceAttacks(s, from, to) {
  const N = s.N, p = s.board[from];
  if (!p) return false;
  const dr = Math.floor(to / N) - Math.floor(from / N), dc = (to % N) - (from % N);
  const adr = Math.abs(dr), adc = Math.abs(dc);
  switch (p.t) {
    case 'p': return adc === 1 && dr === (p.c === 'w' ? 1 : -1);
    case 'n': return (adr === 1 && adc === 2) || (adr === 2 && adc === 1);
    case 'k': return Math.max(adr, adc) === 1;
  }
  const straight = dr === 0 || dc === 0, diag = adr === adc;
  if ((p.t === 'r' && !straight) || (p.t === 'b' && !diag) || (p.t === 'q' && !straight && !diag)) return false;
  const dist = Math.max(adr, adc);
  if (dist === 0 || (s.night && dist > 3)) return false;
  const sr = Math.sign(dr), sc = Math.sign(dc);
  for (let i = 1; i < dist; i++) {
    const q = from + (sr * i) * N + sc * i;
    if (s.board[q] || s.craters[q] !== undefined) return false;
  }
  return true;
}

// Фигуры, которые сейчас бьют короля стороны color.
export function checkers(s, color) {
  const k = findKing(s, color);
  const res = [];
  if (k < 0) return res;
  for (let sq = 0; sq < s.board.length; sq++) {
    const p = s.board[sq];
    if (p && p.c !== color && pieceAttacks(s, sq, k)) res.push(sq);
  }
  return res;
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
  const N = s.N, b = s.board, p = b[from];
  const r = Math.floor(from / N), c = from % N;
  const enemy = opp(p.c);
  const canCapture = (t) => t.c === enemy && t.t !== 'k';

  if (p.t === 'p') {
    const dir = p.c === 'w' ? 1 : -1;
    const start = p.c === 'w' ? 1 : N - 2;
    const last = p.c === 'w' ? N - 1 : 0;
    const r1 = r + dir;
    if (r1 < 0 || r1 >= N) return;
    const push = (to, extra) => {
      if (r1 === last) for (const pr of ['q', 'r', 'b', 'n']) out.push({ from, to, promo: pr, ...extra });
      else out.push({ from, to, ...extra });
    };
    const f1 = r1 * N + c;
    if (!b[f1] && s.craters[f1] === undefined) {
      push(f1, {});
      if (r === start) {
        const f2 = (r + 2 * dir) * N + c;
        if (!b[f2] && s.craters[f2] === undefined) out.push({ from, to: f2, double: true });
      }
    }
    for (const dc of [-1, 1]) {
      const c1 = c + dc;
      if (c1 < 0 || c1 >= N) continue;
      const to = r1 * N + c1;
      const t = b[to];
      if (t) {
        if (canCapture(t)) push(to, { capture: true });
      } else if (to === s.ep) {
        const v = b[r * N + c1];
        if (v && v.t === 'p' && v.c === enemy) out.push({ from, to, ep: true, capture: true });
      }
    }
    return;
  }

  if (p.t === 'n' || p.t === 'k') {
    for (const [dr, dc] of p.t === 'n' ? KNIGHT : KING) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
      const to = rr * N + cc;
      if (s.craters[to] !== undefined) continue;
      const t = b[to];
      if (!t) out.push({ from, to });
      else if (canCapture(t)) out.push({ from, to, capture: true });
    }
    if (p.t === 'k') genCastle(s, from, p.c, out);
    return;
  }

  const dirs = p.t === 'r' ? ORTH : p.t === 'b' ? DIAG : KING;
  const range = s.night ? 3 : N;
  for (const [dr, dc] of dirs) {
    let rr = r + dr, cc = c + dc, d = 1;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N && d <= range) {
      const to = rr * N + cc;
      if (s.craters[to] !== undefined) break;
      const t = b[to];
      if (!t) out.push({ from, to });
      else {
        if (canCapture(t)) out.push({ from, to, capture: true });
        break;
      }
      rr += dr; cc += dc; d++;
    }
  }
}

function genCastle(s, from, color, out) {
  const N = s.N, home = color === 'w' ? 0 : N - 1, kf = s.kingFile;
  if (from !== home * N + kf) return;
  const enemy = opp(color);
  let attackedNow = null;
  for (const [side, rf, dir] of [['K', s.rookFiles[1], 1], ['Q', s.rookFiles[0], -1]]) {
    if (!s.castle[color + side]) continue;
    const rookSq = home * N + rf;
    const rook = s.board[rookSq];
    if (!rook || rook.t !== 'r' || rook.c !== color) continue;
    let clear = true;
    for (let f = Math.min(kf, rf) + 1; f < Math.max(kf, rf); f++) {
      const q = home * N + f;
      if (s.board[q] || s.craters[q] !== undefined) { clear = false; break; }
    }
    if (!clear) continue;
    if (attackedNow === null) attackedNow = isAttacked(s, from, enemy);
    if (attackedNow) return;
    if (isAttacked(s, home * N + kf + dir, enemy)) continue;
    // клетку прибытия короля проверяет общий фильтр легальности
    out.push({ from, to: home * N + kf + 2 * dir, castle: side, rookFrom: rookSq, rookTo: home * N + kf + dir });
  }
}

// ---------------------------------------------------------------- применение хода

export function applyMove(s, m) {
  const n = cloneState(s);
  const N = n.N;
  const piece = n.board[m.from];
  const mover = piece.c;
  const capSq = m.ep ? rowOf(n, m.from) * N + (m.to % N) : m.to;
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
  if (n.mode === 'arena' && n.cells[m.to] && !n.event) triggerCell(n, m.to, mover);
  endTurn(n);
  return n;
}

function touchCastle(n, sq) {
  const N = n.N;
  for (const [color, home] of [['w', 0], ['b', N - 1]]) {
    if (sq === home * N + n.rookFiles[0]) n.castle[color + 'Q'] = false;
    if (sq === home * N + n.rookFiles[1]) n.castle[color + 'K'] = false;
  }
}

// Фигура встала на клетку события: клетка вспыхивает, событие начинается.
function triggerCell(n, sq, by) {
  const type = n.cells[sq].type;
  delete n.cells[sq];
  const p = n.ply;
  const ev = { type, by, sq, startedPly: p };
  if (type === 'meteor') {
    ev.impactPly = p + ARENA.meteorDelay;
    ev.targets = pickMeteorTargets(n, by, rngFor(n.seed, p, sq));
  } else {
    ev.endPly = p + ARENA.eventLength;
    if (type === 'fog') n.fog = opp(by);
    if (type === 'night') n.night = true;
  }
  n.event = ev;
  n.fx.push({ kind: 'trigger', type, sq, by });
}

function pickMeteorTargets(n, by, rng) {
  const N = n.N, enemy = opp(by);
  // половина соперника без его последней горизонтали — оттуда фигуры часто некуда увести
  const half = (sq) => {
    const r = rowOf(n, sq);
    return by === 'w' ? r >= N / 2 && r < N - 1 : r < N / 2 && r > 0;
  };
  const ok = [];
  for (let sq = 0; sq < N * N; sq++) {
    const p = n.board[sq];
    if (half(sq) && !(p && p.t === 'k') && n.craters[sq] === undefined && !n.cells[sq]) ok.push(sq);
  }
  const enemies = shuffle(ok.filter((sq) => n.board[sq] && n.board[sq].c === enemy), rng);
  const res = enemies.slice(0, 2);
  for (const sq of shuffle(ok, rng)) {
    if (res.length >= ARENA.meteorCount) break;
    if (!res.includes(sq)) res.push(sq);
  }
  return res;
}

function endTurn(n) {
  n.turn = opp(n.turn);
  n.ply++;
  if (n.turn === 'w') n.fullmove++;
  if (n.mode === 'arena') tickWorld(n);
}

// Изменения мира в начале хода: удары метеоритов, конец тумана и ночи, новые клетки.
function tickWorld(n) {
  const fx = n.fx;
  for (const k of Object.keys(n.craters)) {
    if (n.craters[k] <= n.ply) {
      delete n.craters[k];
      fx.push({ kind: 'craterGone', sq: +k });
    }
  }
  const ev = n.event;
  if (ev && ev.type === 'meteor' && n.ply >= ev.impactPly) {
    for (const t of ev.targets) {
      const p = n.board[t];
      if (p && p.t === 'k') { fx.push({ kind: 'meteorBlocked', sq: t }); continue; }
      if (p) {
        n.board[t] = null;
        n.lost = { ...n.lost, [p.c]: [...n.lost[p.c], p] };
        fx.push({ kind: 'meteorKill', sq: t, piece: p });
      } else {
        fx.push({ kind: 'meteorHit', sq: t });
      }
      delete n.cells[t];
      n.craters[t] = n.ply + ARENA.craterLife;
    }
    finishEvent(n);
  } else if (ev && ev.endPly !== undefined && n.ply >= ev.endPly) {
    n.night = false;
    n.fog = null;
    fx.push({ kind: 'eventEnd', type: ev.type });
    finishEvent(n);
  }
  if (!n.event && n.ply >= n.nextSpawnPly && Object.keys(n.cells).length < ARENA.minCells) spawnPair(n);
}

function finishEvent(n) {
  n.event = null;
  n.nextSpawnPly = n.ply + ARENA.respawnDelay;
}

function spawnPair(n) {
  const rng = rngFor(n.seed, n.ply, 4242);
  const free = (sq) => !n.board[sq] && !n.cells[sq] && n.craters[sq] === undefined;
  const pool = [];
  for (let sq = 0; sq < n.N * n.N; sq++) {
    const r = rowOf(n, sq);
    if (r >= 3 && r <= n.N - 4 && sq < mirror(n, sq) && free(sq) && free(mirror(n, sq))) pool.push(sq);
  }
  if (!pool.length) return;
  const sq = pool[Math.floor(rng() * pool.length)];
  const types = Object.keys(CELLS);
  const type = types[Math.floor(rng() * types.length)];
  n.cells[sq] = { type };
  n.cells[mirror(n, sq)] = { type };
  n.fx.push({ kind: 'cellSpawn', sq, type }, { kind: 'cellSpawn', sq: mirror(n, sq), type });
}

// ---------------------------------------------------------------- легальность и итог

export function legalMoves(s) {
  const res = [];
  for (const m of pseudoMoves(s)) {
    if (!inCheck(applyMove(s, m), s.turn)) res.push(m);
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
    k += '|' + Object.keys(s.cells).sort().map((q) => q + s.cells[q].type[0]).join(',');
    k += '|' + Object.keys(s.craters).sort().join(',');
    k += '|' + (s.event ? s.event.type + s.event.startedPly : '');
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
  const N = s.N, p = s.board[m.from];
  const dest = sqName(s, m.to);
  const cap = m.capture || m.ep;
  if (p.t === 'p') {
    return (cap ? FILES[m.from % N] + 'x' : '') + dest + (m.promo ? '=' + LETTER[m.promo] : '');
  }
  const others = legal.filter((o) => o.to === m.to && o.from !== m.from && s.board[o.from].t === p.t);
  let dis = '';
  if (others.length) {
    const sameFile = others.some((o) => o.from % N === m.from % N);
    const sameRank = others.some((o) => rowOf(s, o.from) === rowOf(s, m.from));
    if (!sameFile) dis = FILES[m.from % N];
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
    const n = applyMove(s, m);
    if (inCheck(n, s.turn)) continue;
    total += depth === 1 ? 1 : perft(n, depth - 1);
  }
  return total;
}
