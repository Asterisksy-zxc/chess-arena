// Шахматный движок «Живой Арены»: классические правила + клетки силы и мировые события.
// Состояние неизменяемое: applyMove возвращает новое состояние, исходное не трогается.

export const FILES = 'abcdefghijkl';
export const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
export const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
export const FIG = { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '' };

export const TILES = {
  dash:    { icon: '⚡', name: 'Рывок',    desc: 'Фигура сразу делает ещё один ход (без взятия).' },
  shield:  { icon: '🛡️', name: 'Щит',      desc: 'Фигуру нельзя взять 3 хода соперника. Спасает и от метеорита.' },
  trap:    { icon: '❄️', name: 'Капкан',   desc: 'Фигура вмерзает и пропускает 2 своих хода, но продолжает бить.' },
  portal:  { icon: '🌀', name: 'Портал',   desc: 'Фигура переносится на парный портал, если тот свободен.' },
  eye:     { icon: '👁️', name: 'Око',      desc: 'Следующий туман войны вам не страшен — вы видите всю доску.' },
  academy: { icon: '⭐', name: 'Академия', desc: 'Пешка, вставшая сюда, превращается в коня или слона.' },
};

export const EVENTS = {
  fog:    { icon: '🌫️', name: 'Туман войны',       desc: 'Видно только клетки, куда могут пойти ваши фигуры, и соседние с ними.', duration: 6 },
  night:  { icon: '🌙', name: 'Ночь',              desc: 'Ладьи, слоны и ферзи ходят и бьют не дальше 3 клеток.', duration: 6 },
  meteor: { icon: '☄️', name: 'Метеоритный дождь', desc: 'Метеориты уничтожат фигуры на отмеченных клетках и оставят кратеры. Короля не трогают.', duration: 0 },
  runes:  { icon: '✨', name: 'Дождь рун',         desc: 'На поле появятся новые клетки силы.', duration: 0 },
};

export const ARENA = {
  announceLead: 4,  // полуходов от объявления события до его начала
  eventGap: 4,      // полуходов затишья после события
  firstEvent: 6,    // первое объявление
  craterLife: 10,   // сколько полуходов живёт кратер
  respawnEvery: 10, // как часто подсыпаются клетки силы
  minTiles: 4,
};

const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KING = [...ORTH, ...DIAG];
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

export const opp = (c) => (c === 'w' ? 'b' : 'w');
export const sqName = (s, sq) => FILES[sq % s.N] + (Math.floor(sq / s.N) + 1);
const rowOf = (s, sq) => Math.floor(sq / s.N);
const mirror = (s, sq) => s.N * s.N - 1 - sq; // центральная симметрия

export const isFrozen = (s, p) => p.frozenUntil > s.ply;
export const isShielded = (s, p) => p.shieldUntil > s.ply;

// ---------------------------------------------------------------- создание

export function createGame(mode = 'arena') {
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
    N, mode, board, turn: 'w',
    castle: { wK: true, wQ: true, bK: true, bQ: true },
    kingFile: off + 4, rookFiles: [off, off + 7],
    ep: -1, ply: 0, halfmove: 0, fullmove: 1,
    tiles: {}, craters: {}, event: null, night: false, fog: false,
    fogImmune: { w: false, b: false }, eye: { w: false, b: false },
    bonus: -1, lost: { w: [], b: [] },
    nextEventPly: ARENA.firstEvent, deck: [], lastEventType: null, lastSpawnPly: 0,
    fx: [],
  };
  if (mode === 'arena') {
    const place = (r, c, type) => {
      const sq = r * N + c;
      const tw = mirror(s, sq);
      s.tiles[sq] = type === 'portal' ? { type, twin: tw } : { type };
      s.tiles[tw] = type === 'portal' ? { type, twin: sq } : { type };
    };
    place(4, 2, 'portal'); // c5 <-> h6
    place(4, 0, 'dash');   // a5 / j6
    place(4, 5, 'shield'); // f5 / e6
    place(4, 4, 'trap');   // e5 / f6
  }
  return s;
}

function cloneState(s) {
  return {
    ...s,
    board: s.board.slice(),
    castle: { ...s.castle },
    tiles: { ...s.tiles },
    craters: { ...s.craters },
    eye: { ...s.eye },
    fogImmune: { ...s.fogImmune },
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

export function pseudoMoves(s) {
  const out = [];
  if (s.bonus >= 0) {
    genPiece(s, s.bonus, out, true);
    out.push({ pass: true, from: s.bonus, to: s.bonus });
    return out;
  }
  for (let sq = 0; sq < s.board.length; sq++) {
    const p = s.board[sq];
    if (p && p.c === s.turn && !isFrozen(s, p)) genPiece(s, sq, out, false);
  }
  return out;
}

function genPiece(s, from, out, quiet) {
  const N = s.N, b = s.board, p = b[from];
  const r = Math.floor(from / N), c = from % N;
  const enemy = opp(p.c);
  const arena = s.mode === 'arena';
  const canCapture = (t) => t.c === enemy && t.t !== 'k' && !(t.shieldUntil > s.ply);
  const academyAt = (to) => arena && !quiet && s.tiles[to] && s.tiles[to].type === 'academy';

  if (p.t === 'p') {
    const dir = p.c === 'w' ? 1 : -1;
    const start = p.c === 'w' ? 1 : N - 2;
    const last = p.c === 'w' ? N - 1 : 0;
    const r1 = r + dir;
    if (r1 < 0 || r1 >= N) return;
    const push = (to, extra) => {
      if (r1 === last) for (const pr of ['q', 'r', 'b', 'n']) out.push({ from, to, promo: pr, ...extra });
      else if (academyAt(to)) for (const pr of ['n', 'b']) out.push({ from, to, promo: pr, academy: true, ...extra });
      else out.push({ from, to, ...extra });
    };
    const f1 = r1 * N + c;
    if (!b[f1] && s.craters[f1] === undefined) {
      push(f1, {});
      if (r === start) {
        const f2 = (r + 2 * dir) * N + c;
        if (!b[f2] && s.craters[f2] === undefined) {
          if (academyAt(f2)) for (const pr of ['n', 'b']) out.push({ from, to: f2, double: true, promo: pr, academy: true });
          else out.push({ from, to: f2, double: true });
        }
      }
    }
    if (quiet) return;
    for (const dc of [-1, 1]) {
      const c1 = c + dc;
      if (c1 < 0 || c1 >= N) continue;
      const to = r1 * N + c1;
      const t = b[to];
      if (t) {
        if (canCapture(t)) push(to, { capture: true });
      } else if (to === s.ep) {
        const v = b[r * N + c1];
        if (v && v.t === 'p' && v.c === enemy && canCapture(v)) out.push({ from, to, ep: true, capture: true });
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
      else if (!quiet && canCapture(t)) out.push({ from, to, capture: true });
    }
    if (p.t === 'k' && !quiet) genCastle(s, from, p.c, out);
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
        if (!quiet && canCapture(t)) out.push({ from, to, capture: true });
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
    if (!rook || rook.t !== 'r' || rook.c !== color || isFrozen(s, rook)) continue;
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
  if (m.pass) {
    n.bonus = -1;
    n.fx.push({ kind: 'pass' });
    endTurn(n);
    return n;
  }
  const wasBonus = s.bonus >= 0;
  n.bonus = -1;
  const piece = n.board[m.from];
  const mover = piece.c;
  const capSq = m.ep ? rowOf(n, m.from) * N + (m.to % N) : m.to;
  const captured = n.board[capSq];
  if (captured) n.board[capSq] = null;
  n.board[m.from] = null;
  const moved = m.promo && !m.academy ? { ...piece, t: m.promo } : piece;
  n.board[m.to] = moved;
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

  let bonus = false;
  if (n.mode === 'arena' && !wasBonus && piece.t !== 'k') bonus = activateTile(n, m, moved);
  if (bonus) n.bonus = m.to;
  else endTurn(n);
  return n;
}

function touchCastle(n, sq) {
  const N = n.N;
  for (const [color, home] of [['w', 0], ['b', N - 1]]) {
    if (sq === home * N + n.rookFiles[0]) n.castle[color + 'Q'] = false;
    if (sq === home * N + n.rookFiles[1]) n.castle[color + 'K'] = false;
  }
}

// Возвращает true, если ход даёт право на рывок (ход ещё не передаётся).
function activateTile(n, m, moved) {
  const tile = n.tiles[m.to];
  if (!tile) return false;
  const fx = n.fx;
  switch (tile.type) {
    case 'dash':
      delete n.tiles[m.to];
      fx.push({ kind: 'tile', type: 'dash', sq: m.to });
      return true;
    case 'shield':
      delete n.tiles[m.to];
      n.board[m.to] = { ...moved, shieldUntil: n.ply + 6 };
      fx.push({ kind: 'tile', type: 'shield', sq: m.to });
      return false;
    case 'trap':
      delete n.tiles[m.to];
      n.board[m.to] = { ...moved, frozenUntil: n.ply + 5 };
      fx.push({ kind: 'tile', type: 'trap', sq: m.to });
      return false;
    case 'eye':
      delete n.tiles[m.to];
      n.eye[moved.c] = true;
      fx.push({ kind: 'tile', type: 'eye', sq: m.to });
      return false;
    case 'academy':
      if (moved.t !== 'p' || !m.promo) return false;
      delete n.tiles[m.to];
      n.board[m.to] = { ...moved, t: m.promo };
      fx.push({ kind: 'tile', type: 'academy', sq: m.to });
      return false;
    case 'portal': {
      const tw = tile.twin;
      if (n.board[tw] || n.craters[tw] !== undefined) {
        fx.push({ kind: 'portalBlocked', sq: m.to });
        return false;
      }
      n.board[tw] = n.board[m.to];
      n.board[m.to] = null;
      fx.push({ kind: 'teleport', from: m.to, to: tw });
      return false;
    }
  }
  return false;
}

function endTurn(n) {
  n.turn = opp(n.turn);
  n.ply++;
  if (n.turn === 'w') n.fullmove++;
  if (n.mode === 'arena') tickWorld(n);
}

// Детерминированные изменения мира в начале хода. Всё случайное выбирается заранее,
// при объявлении события, поэтому и игроки, и бот видят, что произойдёт.
function tickWorld(n) {
  const fx = n.fx;
  for (const k of Object.keys(n.craters)) {
    if (n.craters[k] <= n.ply) {
      delete n.craters[k];
      fx.push({ kind: 'craterGone', sq: +k });
    }
  }
  const ev = n.event;
  if (!ev) return;
  if (ev.phase === 'announced' && n.ply >= ev.startPly) {
    fx.push({ kind: 'eventStart', type: ev.type });
    if (ev.type === 'meteor') {
      for (const t of ev.targets) {
        const p = n.board[t];
        if (p && (p.t === 'k' || p.shieldUntil > n.ply)) {
          fx.push({ kind: 'meteorBlocked', sq: t });
          continue;
        }
        if (p) {
          n.board[t] = null;
          n.lost = { ...n.lost, [p.c]: [...n.lost[p.c], p] };
          fx.push({ kind: 'meteorKill', sq: t, piece: p });
        } else {
          fx.push({ kind: 'meteorHit', sq: t });
        }
        delete n.tiles[t];
        n.craters[t] = n.ply + ARENA.craterLife;
      }
      finishEvent(n);
    } else if (ev.type === 'runes') {
      for (const { sq, type } of ev.spawn) {
        if (n.tiles[sq] || n.craters[sq] !== undefined) continue;
        n.tiles[sq] = { type };
        fx.push({ kind: 'tileSpawn', sq, type });
      }
      finishEvent(n);
    } else {
      n.event = { ...ev, phase: 'active', endPly: n.ply + EVENTS[ev.type].duration };
      if (ev.type === 'night') n.night = true;
      if (ev.type === 'fog') {
        n.fog = true;
        n.fogImmune = { ...n.eye };
        n.eye = { w: false, b: false };
      }
    }
  } else if (ev.phase === 'active' && n.ply >= ev.endPly) {
    fx.push({ kind: 'eventEnd', type: ev.type });
    n.night = false;
    n.fog = false;
    n.fogImmune = { w: false, b: false };
    finishEvent(n);
  }
}

function finishEvent(n) {
  n.lastEventType = n.event.type;
  n.event = null;
  n.nextEventPly = n.ply + ARENA.eventGap;
}

// ---------------------------------------------------------------- режиссёр событий (случайность)

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function reservedSquares(s) {
  const res = new Set();
  if (s.event && s.event.targets) s.event.targets.forEach((t) => res.add(t));
  if (s.event && s.event.spawn) s.event.spawn.forEach((x) => res.add(x.sq));
  return res;
}

function middleSquares(s) {
  const out = [];
  for (let sq = 0; sq < s.N * s.N; sq++) {
    const r = rowOf(s, sq);
    if (r >= 2 && r <= s.N - 3) out.push(sq);
  }
  return out;
}

function pickSpawnPairs(s, count, rng) {
  const reserved = reservedSquares(s);
  const free = (sq) => !s.board[sq] && !s.tiles[sq] && s.craters[sq] === undefined && !reserved.has(sq);
  const pool = shuffle(middleSquares(s).filter((sq) => free(sq) && free(mirror(s, sq))), rng);
  const types = ['dash', 'dash', 'shield', 'shield', 'trap', 'trap', 'academy', 'academy', 'eye'];
  const res = [];
  const used = new Set();
  for (const sq of pool) {
    if (res.length >= count * 2) break;
    const tw = mirror(s, sq);
    if (used.has(sq) || used.has(tw)) continue;
    const type = types[Math.floor(rng() * types.length)];
    res.push({ sq, type }, { sq: tw, type });
    used.add(sq); used.add(tw);
  }
  return res;
}

function pickMeteorTargets(s, rng) {
  const ok = (sq) => {
    const p = s.board[sq];
    return !(p && p.t === 'k') && !s.tiles[sq] && s.craters[sq] === undefined;
  };
  const cands = middleSquares(s).filter((sq) => ok(sq) && ok(mirror(s, sq)) && sq < mirror(s, sq));
  const busy = shuffle(cands.filter((sq) => s.board[sq] || s.board[mirror(s, sq)]), rng);
  const rest = shuffle(cands, rng);
  const res = [];
  for (const sq of [...busy.slice(0, 1), ...rest]) {
    if (res.length >= 4) break;
    if (res.includes(sq)) continue;
    res.push(sq, mirror(s, sq));
  }
  return res;
}

export function directorStep(s, rng = Math.random) {
  if (s.mode !== 'arena' || s.bonus >= 0) return s;
  let n = null;
  const edit = () => {
    if (!n) { n = cloneState(s); n.fx = s.fx.slice(); }
    return n;
  };
  if (!s.event && s.ply >= s.nextEventPly) {
    const x = edit();
    let deck = x.deck.length ? x.deck.slice() : shuffle(Object.keys(EVENTS), rng);
    if (deck[0] === x.lastEventType && deck.length > 1) [deck[0], deck[1]] = [deck[1], deck[0]];
    const type = deck.shift();
    x.deck = deck;
    const ev = { type, phase: 'announced', startPly: x.ply + ARENA.announceLead, announcedPly: x.ply };
    if (type === 'meteor') ev.targets = pickMeteorTargets(x, rng);
    if (type === 'runes') ev.spawn = pickSpawnPairs(x, 2, rng);
    x.event = ev;
    x.fx.push({ kind: 'eventAnnounce', type });
  }
  const tileCount = Object.values(s.tiles).filter((t) => t.type !== 'portal').length;
  if (s.ply - s.lastSpawnPly >= ARENA.respawnEvery && tileCount < ARENA.minTiles) {
    const x = edit();
    x.lastSpawnPly = x.ply;
    for (const { sq, type } of pickSpawnPairs(x, 1, rng)) {
      x.tiles[sq] = { type };
      x.fx.push({ kind: 'tileSpawn', sq, type });
    }
  }
  return n || s;
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
  k += s.ep + '|' + s.bonus;
  if (s.mode === 'arena') {
    k += '|' + Object.keys(s.tiles).sort().map((q) => q + s.tiles[q].type[0]).join(',');
    k += '|' + Object.keys(s.craters).sort().join(',');
    k += '|' + (s.event ? s.event.type + s.event.phase : '') + (s.night ? 'N' : '') + (s.fog ? 'F' : '');
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

// ---------------------------------------------------------------- нотация

export function moveToSan(s, m, legal) {
  if (m.pass) return '…';
  if (m.castle) return m.castle === 'K' ? 'O-O' : 'O-O-O';
  const N = s.N, p = s.board[m.from];
  const dest = sqName(s, m.to);
  const cap = m.capture || m.ep;
  if (p.t === 'p') {
    let san = (cap ? FILES[m.from % N] + 'x' : '') + dest;
    if (m.promo) san += m.academy ? '⭐' + FIG[m.promo] : '=' + FIG[m.promo];
    return san;
  }
  const others = legal.filter((o) => !o.pass && o.to === m.to && o.from !== m.from && s.board[o.from].t === p.t);
  let dis = '';
  if (others.length) {
    const sameFile = others.some((o) => o.from % N === m.from % N);
    const sameRank = others.some((o) => rowOf(s, o.from) === rowOf(s, m.from));
    if (!sameFile) dis = FILES[m.from % N];
    else if (!sameRank) dis = String(rowOf(s, m.from) + 1);
    else dis = sqName(s, m.from);
  }
  return FIG[p.t] + dis + (cap ? 'x' : '') + dest;
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
