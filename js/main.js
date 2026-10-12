import {
  createGame, applyMove, gameStatus, positionKey, moveToSan, findKing, opp, mirrorFile,
  CELLS, ARENA, VALUES, FILES,
} from './engine.js';
import { LEVELS, findBestMove } from './ai.js';
import { pieceSprite, iconSprite } from './sprites.js';
import { sound } from './sound.js';

const $ = (s) => document.querySelector(s);
const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } };

const NAME = { w: 'БЕЛЫЕ', b: 'ЧЁРНЫЕ' };
const GEN = { w: 'БЕЛЫХ', b: 'ЧЁРНЫХ' };
const PIECE = { p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король' };
const cap = (t) => t[0].toUpperCase() + t.slice(1).toLowerCase();
const plural = (n, [one, few, many]) => {
  const d = n % 10, dd = n % 100;
  return n + ' ' + (d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many);
};
const MOVES = ['ход', 'хода', 'ходов'];
const NEON = ['#ff2e88', '#29f0ff', '#ffe14d', '#9b5cff', '#39ff14', '#ff7a1a', '#00a2ff', '#ff2bd6'];

const settings = { mode: 'arena', opponent: 'human', level: '2', color: 'w', timer: '0', ...load('arena.settings') };

const wrapEl = $('#boardWrap'), boardEl = $('#board'), piecesEl = $('#pieces'), fxEl = $('#fxLayer');
let game = null;
let selected = -1;
let flipped = false;
let squares = [];
const pieceEls = new Map();
let thinking = false;
let aiToken = 0;
let animLock = false; // пока идёт диско-волна, ходить нельзя
let drag = null;

const bg = (url) => `background-image:${url}`;

// ---------------------------------------------------------------- бот (в отдельном потоке)

let worker = null;
const pending = new Map();
let reqId = 0;

function startWorker() {
  try {
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (p) p.resolve(e.data.move);
    };
    worker.onerror = () => {
      worker = null;
      for (const p of pending.values()) p.resolve(findBestMove(p.state, p.level));
      pending.clear();
    };
  } catch {
    worker = null;
  }
}

function restartWorker() {
  if (worker) worker.terminate();
  pending.clear();
  startWorker();
}

function askBot(state, level) {
  return new Promise((resolve) => {
    if (worker) {
      const id = ++reqId;
      pending.set(id, { resolve, state, level });
      worker.postMessage({ id, state, level });
    } else {
      setTimeout(() => resolve(findBestMove(state, level)), 30);
    }
  });
}

// ---------------------------------------------------------------- координаты

function disp(sq) {
  const { W, H } = game.state, r = Math.floor(sq / W), c = sq % W;
  return flipped ? { row: r, col: W - 1 - c } : { row: H - 1 - r, col: c };
}
function sqAt(row, col) {
  const { W, H } = game.state;
  return flipped ? row * W + (W - 1 - col) : (H - 1 - row) * W + col;
}
function sqFromPoint(x, y) {
  const r = wrapEl.getBoundingClientRect(), { W, H } = game.state;
  const col = Math.floor(((x - r.left) / r.width) * W);
  const row = Math.floor(((y - r.top) / r.height) * H);
  if (col < 0 || row < 0 || col >= W || row >= H) return -1;
  return sqAt(row, col);
}

// ---------------------------------------------------------------- партия

function newGame(silent = false) {
  save('arena.settings', settings);
  let humanColor = null;
  if (settings.opponent === 'bot') {
    humanColor = settings.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.color;
  }
  const state = createGame(settings.mode, (Math.random() * 2 ** 32) >>> 0);
  const minutes = +settings.timer;
  game = {
    state,
    status: gameStatus(state),
    history: [],
    snapshots: [],
    reps: new Map([[positionKey(state), 1]]),
    humanColor,
    clocks: minutes ? { w: minutes * 60000, b: minutes * 60000 } : null,
    over: null,
    lastMove: null,
  };
  aiToken++;
  thinking = false;
  animLock = false;
  stopDisco();
  if (pending.size) restartWorker();
  selected = -1;
  flipped = humanColor === 'b';
  if ($('#dlgOver').open) $('#dlgOver').close();
  buildBoard();
  renderLegend();
  render();
  if (!silent) banner({ title: 'ИГРА НАЧАЛАСЬ!', text: state.mode === 'arena' ? 'Где-то на поле спрятаны клетки событий. Найдите их!' : 'Классические шахматы', color: '#ffe14d' });
  maybeBot();
}

function canHumanAct() {
  return game && !game.over && !thinking && !animLock && (!game.humanColor || game.state.turn === game.humanColor);
}

function makeMove(m) {
  const s = game.state;
  const san = moveToSan(s, m, game.status.moves);
  game.snapshots.push({
    state: s, status: game.status, lastMove: game.lastMove,
    history: game.history.map((x) => ({ ...x })), reps: new Map(game.reps),
  });
  const n = applyMove(s, m);
  const key = positionKey(n);
  const reps = (game.reps.get(key) || 0) + 1;
  game.reps.set(key, reps);
  const status = gameStatus(n, reps);
  const trig = n.fx.find((f) => f.kind === 'trigger');
  const suffix = status.over && status.kind === 'mate' ? '#' : status.check ? '+' : '';
  game.history.push({ color: s.turn, san: san + suffix, num: s.fullmove, ev: trig ? trig.type : null });
  game.lastMove = { from: m.from, to: m.to };
  selected = -1;
  if (n.fx.some((f) => f.kind === 'capture')) sound.capture();
  else sound.move();

  const commit = () => {
    if (n.fx.some((f) => f.kind === 'mirror')) {
      game.lastMove = { from: mirrorFile(n, m.from), to: mirrorFile(n, m.to) };
    }
    // портал переносит фигуру мгновенно, без скольжения через всю доску
    const portal = n.fx.find((f) => f.kind === 'portal');
    const jumper = portal && pieceEls.get(n.board[portal.to].id);
    if (jumper) jumper.style.transition = 'none';
    game.state = n;
    game.status = status;
    if (status.check) setTimeout(() => sound.check(), 120);
    if (status.over) finish(status);
    render(n.fx);
    if (jumper) requestAnimationFrame(() => requestAnimationFrame(() => { jumper.style.transition = ''; }));
    playFx(n.fx);
    if (!game.over) maybeBot();
  };

  if (!trig) { commit(); return; }

  // Клетка найдена: сначала показываем ход без события, по полу идёт диско-волна,
  // и только потом событие срабатывает.
  game.state = applyMove(s, m, true);
  game.status = { ...gameStatus(game.state), moves: [] };
  animLock = true;
  render([]);
  const token = aiToken;
  discoWave(trig.sq, CELLS[trig.type].color).then(() => {
    if (token !== aiToken || game.state.ply !== n.ply) return;
    animLock = false;
    commit();
  });
}

function maybeBot() {
  const s = game.state;
  if (game.over || !game.humanColor || s.turn === game.humanColor) return;
  thinking = true;
  const token = ++aiToken;
  const t0 = performance.now();
  renderTurn();
  renderPlates();
  // бот не знает, где спрятаны клетки
  askBot({ ...s, cells: {}, noCells: true }, +settings.level).then((mv) => {
    if (token !== aiToken) return;
    const wait = Math.max(0, 550 - (performance.now() - t0));
    setTimeout(() => {
      if (token !== aiToken) return;
      thinking = false;
      const legal = game.status.moves;
      const m = (mv && legal.find((x) => x.from === mv.from && x.to === mv.to && (x.promo || '') === (mv.promo || ''))) || legal[0];
      if (m) makeMove(m);
    }, wait);
  });
}

function undo() {
  if (!game.snapshots.length || animLock) return;
  aiToken++;
  if (thinking) restartWorker();
  thinking = false;
  let snap = game.snapshots.pop();
  if (game.humanColor) {
    while (game.snapshots.length && snap.state.turn !== game.humanColor) snap = game.snapshots.pop();
  }
  Object.assign(game, { state: snap.state, status: snap.status, lastMove: snap.lastMove, history: snap.history, reps: snap.reps, over: null });
  selected = -1;
  if ($('#dlgOver').open) $('#dlgOver').close();
  render();
  maybeBot();
}

function finish(res) {
  game.over = res;
  thinking = false;
  aiToken++;
  setTimeout(() => sound.end(res.kind === 'mate' || res.kind === 'timeout'), 300);
  setTimeout(() => { if (game.over === res) showOver(res); }, 1100);
}

function resultInfo(res) {
  const vsBot = !!game.humanColor;
  const win = (w) => (vsBot ? (w === game.humanColor ? 'ВЫ ПОБЕДИЛИ!' : 'ПОБЕДИЛ БОТ') : `ПОБЕДИЛИ ${NAME[w]}`);
  switch (res.kind) {
    case 'mate': return { title: 'МАТ!', text: win(res.winner), win: true, icon: vsBot && res.winner !== game.humanColor ? 'skull' : 'crown' };
    case 'stalemate': return { title: 'ПАТ', text: 'Ничья: ходить некуда, но шаха нет.' };
    case 'material': return { title: 'НИЧЬЯ', text: 'Не хватает фигур, чтобы поставить мат.' };
    case 'fifty': return { title: 'НИЧЬЯ', text: '50 ходов без взятий и ходов пешками.' };
    case 'repetition': return { title: 'НИЧЬЯ', text: 'Позиция повторилась трижды.' };
    case 'timeout': return res.winner
      ? { title: 'ВРЕМЯ ВЫШЛО!', text: win(res.winner), win: true, icon: 'crown' }
      : { title: 'ВРЕМЯ ВЫШЛО!', text: 'Ничья: у соперника не хватает фигур.' };
  }
  return { title: 'КОНЕЦ', text: '' };
}

function showOver(res) {
  const info = resultInfo(res);
  $('#overIcon').style.backgroundImage = iconSprite(info.icon || 'crown', info.icon === 'skull' ? '#ffffff' : info.win ? '#ffe14d' : '#b9b2ff');
  $('#overTitle').textContent = info.title;
  $('#overText').textContent = info.text;
  $('#dlgOver').showModal();
}

// ---------------------------------------------------------------- отрисовка

function buildBoard() {
  const { W, H } = game.state;
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${W}, 1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${H}, 1fr)`;
  document.documentElement.style.setProperty('--ratio', W / H);
  squares = new Array(W * H);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const d = h('div', 'sq');
      boardEl.appendChild(d);
      squares[sqAt(row, col)] = d;
    }
  }
  piecesEl.innerHTML = '';
  pieceEls.clear();
  updateSqSize();
}

function updateSqSize() {
  if (!game) return;
  wrapEl.style.setProperty('--sq', wrapEl.clientWidth / game.state.W + 'px');
}

function render() {
  renderSquares();
  renderPieces();
  renderTurn();
  renderEvent();
  renderPlates();
  renderHistory();
  $('#btnUndo').disabled = !game.snapshots.length;
}

function renderSquares() {
  const s = game.state, { W, H } = s;
  const targets = new Map();
  if (selected >= 0) for (const m of game.status.moves) if (m.from === selected) targets.set(m.to, m);
  const checkSq = game.status.check ? findKing(s, s.turn) : -1;
  const ev = s.event;
  for (let sq = 0; sq < W * H; sq++) {
    const d = squares[sq];
    const r = Math.floor(sq / W), c = sq % W;
    const { row, col } = disp(sq);
    const p = s.board[sq];
    const cls = ['sq', (r + c) % 2 === 0 ? 'dark' : 'light'];
    if (game.lastMove && (game.lastMove.from === sq || game.lastMove.to === sq)) cls.push('last');
    if (sq === selected) cls.push('sel');
    if (sq === checkSq) cls.push('check');
    let html = '';
    if (col === 0) html += `<span class="coord rank">${r + 1}</span>`;
    if (row === H - 1) html += `<span class="coord file">${FILES[c]}</span>`;
    if (ev && ev.sq === sq) html += `<div class="cell lit" style="--ec:${CELLS[ev.type].color}"></div>`;
    if (s.lava[sq] !== undefined) html += `<div class="lava"><b>${Math.ceil((s.lava[sq] - s.ply) / 2)}</b></div>`;
    const t = targets.get(sq);
    if (t) html += t.capture && p ? '<div class="cap"></div>' : '<div class="dot"></div>';
    const cn = cls.join(' ');
    if (d.className !== cn) d.className = cn;
    if (d._html !== html) { d.innerHTML = html; d._html = html; }
  }
}

function renderPieces() {
  const s = game.state, { W, H } = s;
  const seen = new Set();
  for (let sq = 0; sq < W * H; sq++) {
    const p = s.board[sq];
    if (!p) continue;
    seen.add(p.id);
    let e = pieceEls.get(p.id);
    const { row, col } = disp(sq);
    const pos = `translate(${col * 100}%, ${row * 100}%)`;
    if (!e) {
      e = h('div', 'pc');
      e.style.width = 100 / W + '%';
      e.style.height = 100 / H + '%';
      e.style.transition = 'none';
      e.style.transform = pos;
      piecesEl.appendChild(e);
      pieceEls.set(p.id, e);
      requestAnimationFrame(() => requestAnimationFrame(() => { e.style.transition = ''; }));
    }
    const sprite = p.t + p.c;
    if (e._sprite !== sprite) { e.style.backgroundImage = pieceSprite(p.t, p.c); e._sprite = sprite; }
    const dragging = drag && drag.id === p.id && drag.moved;
    e.className = 'pc' + (dragging ? ' dragging' : '') + (p.frozen ? ' frozen' : '');
    if (!dragging && e.style.transform !== pos) e.style.transform = pos;
  }
  for (const [id, e] of pieceEls) {
    if (seen.has(id)) continue;
    pieceEls.delete(id);
    e.classList.add('dying');
    setTimeout(() => e.remove(), 380);
  }
}

function renderTurn() {
  const s = game.state, c = s.turn;
  let title, sub = '';
  if (game.over) {
    title = resultInfo(game.over).title;
  } else if (game.humanColor) {
    title = c === game.humanColor ? 'ВАШ ХОД' : 'ХОД БОТА';
    sub = thinking ? 'Бот думает…' : `Вы играете за ${GEN[game.humanColor].toLowerCase()} · ход ${s.fullmove}`;
  } else {
    title = `ХОД ${GEN[c]}`;
    sub = `Ход ${s.fullmove}`;
  }
  let alerts = '';
  const le = s.lastEvent;
  if (!game.over && le && le.type === 'turbo' && le.ply === s.ply && !animLock) alerts += '<div class="alert turbo">ТУРБО: ЕЩЁ ОДИН ХОД!</div>';
  if (!game.over && game.status.check) alerts += '<div class="alert check">ШАХ! КОРОЛЬ ПОД УДАРОМ</div>';
  if (game.over) {
    const info = resultInfo(game.over);
    alerts = `<div class="alert ${info.win ? 'win' : 'draw'}">${info.text}</div>`;
  }
  $('#turnPanel').innerHTML = `<div class="turn-big"><span class="turn-chip ${c}"></span><span>${title}</span></div>${sub ? `<div class="turn-sub">${sub}</div>` : ''}${alerts}`;
}

function meter(left, total, color) {
  let html = `<div class="meter" style="--c:${color}">`;
  for (let i = 0; i < total; i++) html += `<i class="${i < left ? 'on' : ''}"></i>`;
  return html + '</div>';
}

function renderEvent() {
  const s = game.state, panel = $('#eventPanel');
  panel.hidden = s.mode !== 'arena';
  if (panel.hidden) return;
  let html = '<div class="panel-title">СОБЫТИЯ</div>';
  if (animLock) {
    html += '<div class="ev-idle"><b class="disco-text">ДИСКО!</b>Клетка найдена — пол сходит с ума…</div>';
  } else {
    const rows = [];
    const ev = s.event;
    if (ev) {
      const C = CELLS.lava, left = Math.ceil((ev.endPly - s.ply) / 2);
      rows.push(evRow(C, `Нашли ${NAME[ev.by].toLowerCase()}. По лаве нельзя ходить и бить сквозь неё. Остынет через ${plural(left, MOVES)}.`) + meter(left, ARENA.lavaLength / 2, C.color));
    }
    const ice = s.board.filter((p) => p && p.frozen);
    if (ice.length) {
      const C = CELLS.freeze, left = Math.ceil((Math.min(...ice.map((p) => p.frozen)) - s.ply) / 2);
      rows.push(evRow(C, `Во льду фигур ${GEN[ice[0].c].toLowerCase()}: ${ice.length}. Оттают через ${plural(left, MOVES)}.`) + meter(left, ARENA.freezeLength / 2, C.color));
    }
    const le = s.lastEvent;
    if (!rows.length && le) rows.push(evRow(CELLS[le.type], `Последняя находка — ${NAME[le.by].toLowerCase()}. ${CELLS[le.type].desc}`));
    if (!rows.length) rows.push('<div class="ev-idle"><b>ЗАТИШЬЕ</b>Наступите на скрытую клетку — по полу пройдёт диско-волна, и начнётся событие.</div>');
    html += rows.join('');
  }
  html += `<div class="ev-hidden">Спрятано клеток: <span class="hidden-count">${Object.keys(s.cells).length}</span></div>`;
  panel.innerHTML = html;
}

function evRow(C, text) {
  return `<div class="ev-row"><div class="ev-swatch" style="--c:${C.color}"></div><div><div class="ev-name" style="color:${C.color}">${C.name.toUpperCase()}</div><div class="ev-text">${text}</div></div></div>`;
}

function material(s, color) {
  return s.board.reduce((sum, p) => sum + (p && p.c === color ? VALUES[p.t] : 0), 0);
}

function fmtClock(ms) {
  const t = Math.max(0, ms);
  if (t < 10000) return (t / 1000).toFixed(1);
  const sec = Math.ceil(t / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function renderPlates() {
  const bottom = flipped ? 'b' : 'w';
  renderPlate($('#plateBottom'), bottom);
  renderPlate($('#plateTop'), opp(bottom));
}

function renderPlate(plate, color) {
  const s = game.state;
  const tag = color === 'w' ? 'P1' : 'P2';
  const name = game.humanColor
    ? (color === game.humanColor ? 'ВЫ' : `БОТ · ${LEVELS[settings.level].name.toUpperCase()}`)
    : NAME[color];
  const taken = s.lost[opp(color)].slice().sort((a, b) => VALUES[b.t] - VALUES[a.t])
    .map((p) => `<i style="${bg(pieceSprite(p.t, p.c))}"></i>`).join('');
  const diff = Math.round((material(s, color) - material(s, opp(color))) / 100);
  const active = !game.over && s.turn === color;
  plate.classList.toggle('active', active);
  const think = thinking && active ? '<span class="p-think">ДУМАЕТ</span>' : '';
  plate.innerHTML = `
    <span class="p-tag">${tag}</span>
    <div class="p-ava" style="${bg(pieceSprite('k', color))}"></div>
    <div class="p-info">
      <span class="p-name">${name} ${think}</span>
      <span class="p-caps">${taken}${diff > 0 ? `<span class="p-adv">+${diff}</span>` : ''}</span>
    </div>
    ${game.clocks ? `<div class="clock" id="clock-${color}">${fmtClock(game.clocks[color])}</div>` : ''}`;
}

function renderClocks() {
  if (!game.clocks) return;
  for (const c of ['w', 'b']) {
    const e = document.getElementById('clock-' + c);
    if (!e) continue;
    e.textContent = fmtClock(game.clocks[c]);
    e.classList.toggle('low', game.clocks[c] < 20000 && !game.over);
  }
}

function renderHistory() {
  const ol = $('#history');
  const hist = game.history;
  if (!hist.length) {
    ol.innerHTML = '<li class="history-empty">ХОДОВ ПОКА НЕТ</li>';
    return;
  }
  const shown = (e) => (e.ev ? `<span class="ev" style="--c:${CELLS[e.ev].color}"></span>` : '') + e.san;
  const rows = [];
  for (const e of hist) {
    const last = rows[rows.length - 1];
    if (e.color === 'b' && last && !last.b && last.num === e.num) last.b = shown(e);
    else rows.push({ num: e.num, w: e.color === 'w' ? shown(e) : '…', b: e.color === 'b' ? shown(e) : '' });
  }
  const lastColor = hist[hist.length - 1].color;
  ol.innerHTML = rows.map((r, i) => {
    const isLast = i === rows.length - 1;
    return `<li><span class="n">${r.num}.</span><span class="mv ${isLast && lastColor === 'w' ? 'lastmv' : ''}">${r.w}</span><span class="mv ${isLast && lastColor === 'b' ? 'lastmv' : ''}">${r.b}</span></li>`;
  }).join('');
  ol.scrollTop = ol.scrollHeight;
}

function legendRows() {
  return Object.values(CELLS).map((C) =>
    `<div class="legend-row" style="--c:${C.color}"><div class="legend-sw"></div><div><b>${C.name.toUpperCase()}</b><span>${C.desc}</span></div></div>`,
  ).join('');
}

function renderLegend() {
  $('#cellsPanel').hidden = game.state.mode !== 'arena';
  $('#cellsLegend').innerHTML = legendRows();
}

// ---------------------------------------------------------------- диско-волна

let discoTimer = null;
function stopDisco() {
  clearInterval(discoTimer);
  const layer = $('#disco');
  if (layer) layer.classList.remove('on');
}

// Волна цвета расходится кольцами от найденной клетки, затем весь пол
// вспыхивает цветом события. Возвращает промис, который выполняется по окончании.
function discoWave(origin, color) {
  const { W, H } = game.state;
  let layer = $('#disco');
  if (!layer) {
    layer = h('div', 'disco');
    layer.id = 'disco';
    wrapEl.insertBefore(layer, piecesEl);
  }
  stopDisco();
  layer.style.gridTemplateColumns = `repeat(${W}, 1fr)`;
  layer.style.gridTemplateRows = `repeat(${H}, 1fr)`;
  layer.innerHTML = '';
  const o = disp(origin);
  const tiles = [];
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const t = h('i');
      layer.appendChild(t);
      const dist = Math.max(Math.abs(row - o.row), Math.abs(col - o.col));
      tiles.push({ t, dist, colors: [0, 1, 2].map(() => NEON[Math.floor(Math.random() * NEON.length)]) });
    }
  }
  const maxDist = Math.max(...tiles.map((x) => x.dist));
  const STEP = 58, WAVES = 3, GAP = 230, GLOW = 210;
  const wavesEnd = (WAVES - 1) * GAP + maxDist * STEP + GLOW;
  const total = wavesEnd + 390;
  layer.classList.add('on');
  sound.disco();
  const t0 = performance.now();
  return new Promise((resolve) => {
    discoTimer = setInterval(() => {
      const t = performance.now() - t0;
      if (t >= total) {
        stopDisco();
        resolve();
        return;
      }
      if (t >= wavesEnd) {
        // финальная вспышка цветом события
        const on = Math.floor((t - wavesEnd) / 130) % 2 === 0;
        for (const x of tiles) x.t.style.background = on ? color : 'transparent';
        return;
      }
      for (const x of tiles) {
        let c = 'transparent';
        for (let w = 0; w < WAVES; w++) {
          const start = w * GAP + x.dist * STEP;
          if (t >= start && t < start + GLOW) c = w === WAVES - 1 ? color : x.colors[w];
        }
        x.t.style.background = c;
      }
    }, 30);
  });
}

// ---------------------------------------------------------------- эффекты

function center(sq, clamp = false) {
  const { row, col } = disp(sq), { W, H } = game.state;
  let left = ((col + 0.5) * 100) / W;
  if (clamp) left = Math.min(75, Math.max(25, left)); // надписи не уезжают за край доски
  return { left: left + '%', top: ((row + 0.5) * 100) / H + '%' };
}

function fxAt(sq, type, { text = '', color, delay = 0, life = 1400, style = '' } = {}) {
  setTimeout(() => {
    if (!game) return;
    const e = h('div', 'fx ' + type, text);
    const c = center(sq, type === 'label');
    e.style.cssText = `left:${c.left};top:${c.top};${color ? `--c:${color};` : ''}${style}`;
    fxEl.appendChild(e);
    setTimeout(() => e.remove(), life);
  }, delay);
}

function sparks(sq, color, delay = 0) {
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const d = 0.9 + Math.random() * 0.6;
    fxAt(sq, 'spark', { color, delay, life: 650, style: `--dx:calc(var(--sq) * ${(Math.cos(a) * d).toFixed(2)});--dy:calc(var(--sq) * ${(Math.sin(a) * d).toFixed(2)});` });
  }
}

function shake(delay = 0) {
  setTimeout(() => {
    wrapEl.classList.remove('shake');
    void wrapEl.offsetWidth;
    wrapEl.classList.add('shake');
  }, delay);
}

const bannerQueue = [];
let bannerBusy = false;
function banner(b) {
  bannerQueue.push(b);
  if (!bannerBusy) nextBanner();
}
function nextBanner() {
  const b = bannerQueue.shift();
  const el = $('#banner');
  if (!b) { bannerBusy = false; return; }
  bannerBusy = true;
  el.style.setProperty('--c', b.color || '#ffe14d');
  el.innerHTML = `<div class="b-title">${b.title}</div>${b.text ? `<div class="b-text">${b.text}</div>` : ''}`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(nextBanner, 120);
  }, b.time || 2000);
}

function playFx(fx) {
  for (const f of fx) {
    switch (f.kind) {
      case 'capture':
        fxAt(f.sq, 'burst', { color: '#ffffff', life: 500 });
        sparks(f.sq, '#ffffff');
        break;
      case 'trigger': {
        const C = CELLS[f.type];
        sparks(f.sq, C.color);
        shake(0);
        sound.trigger(f.type);
        const [title, text] = triggerText(f, fx);
        banner({ title, text, color: C.color, time: 2000 });
        break;
      }
      case 'lava':
        f.squares.forEach((sq, i) => fxAt(sq, 'burst', { color: CELLS.lava.color, delay: (i % 8) * 40, life: 500 }));
        break;
      case 'freeze':
        f.squares.forEach((sq, i) => {
          fxAt(sq, 'burst', { color: CELLS.freeze.color, delay: i * 120, life: 600 });
          sparks(sq, CELLS.freeze.color, i * 120);
        });
        break;
      case 'thaw':
        f.squares.forEach((sq) => fxAt(sq, 'burst', { color: '#ffffff', life: 500 }));
        banner({ title: 'ЛЁД РАСТАЯЛ', color: CELLS.freeze.color, time: 1100 });
        break;
      case 'upgrade':
        sparks(f.sq, CELLS.upgrade.color, 150);
        fxAt(f.sq, 'label', { text: PIECE[f.to].toUpperCase() + '!', color: CELLS.upgrade.color, delay: 150 });
        flashPiece(f.sq, CELLS.upgrade.color);
        break;
      case 'reinforce':
        f.squares.forEach((sq, i) => {
          fxAt(sq, 'burst', { color: CELLS.reinforce.color, delay: i * 160, life: 600 });
          sparks(sq, CELLS.reinforce.color, i * 160);
          flashPiece(sq, CELLS.reinforce.color, i * 160);
        });
        break;
      case 'portal':
        fxAt(f.from, 'flash', { color: CELLS.portal.color, life: 750 });
        fxAt(f.to, 'burst', { color: CELLS.portal.color, life: 600 });
        sparks(f.to, CELLS.portal.color, 100);
        flashPiece(f.to, CELLS.portal.color);
        break;
      case 'eventEnd':
        banner({ title: 'ЛАВА ОСТЫЛА', color: '#39ff14', time: 1300 });
        sound.end(false);
        break;
    }
  }
}

function triggerText(f, fx) {
  switch (f.type) {
    case 'lava': return ['ПОЛ — ЭТО ЛАВА!', 'На 3 хода по лаве нельзя ходить и сквозь неё нельзя бить'];
    case 'mirror': return ['ЗЕРКАЛО!', 'Доска отразилась: фланги поменялись местами, рокировки больше нет'];
    case 'freeze': {
      const k = fx.find((x) => x.kind === 'freeze')?.squares.length || 0;
      return ['ЗАМОРОЗКА!', `Фигуры ${GEN[opp(f.by)].toLowerCase()} во льду: ${k}. Не ходят 2 хода`];
    }
    case 'turbo': return ['ТУРБО!', `${cap(NAME[f.by])} ходят ещё раз подряд`];
    case 'upgrade': {
      const u = fx.find((x) => x.kind === 'upgrade');
      return ['ПРОКАЧКА!', u ? `${cap(PIECE[u.from])} → ${PIECE[u.to]}` : ''];
    }
    case 'reinforce': return ['ПОДКРЕПЛЕНИЕ!', `У ${GEN[f.by].toLowerCase()} из пола выросли новые пешки`];
    case 'portal': return ['ПОРТАЛ!', 'Фигура телепортировалась в тыл врага'];
  }
  return [CELLS[f.type].name.toUpperCase(), ''];
}

// Пиксельная вспышка на самой фигуре (прокачка, портал, новые пешки).
function flashPiece(sq, color, delay = 0) {
  setTimeout(() => {
    const p = game.state.board[sq];
    const e = p && pieceEls.get(p.id);
    if (!e || !e.animate) return;
    e.animate([
      { filter: `brightness(3) drop-shadow(0 0 0 ${color})` },
      { filter: `brightness(2.2) drop-shadow(0 0 4px ${color})` },
      { filter: 'none' },
    ], { duration: 650, easing: 'steps(6)' });
  }, delay);
}

// ---------------------------------------------------------------- ввод

async function askPromo(cands) {
  const dlg = $('#dlgPromo'), box = $('#promoChoices');
  const color = game.state.turn;
  box.innerHTML = '';
  return new Promise((resolve) => {
    let done = false;
    for (const m of cands) {
      const b = h('button');
      b.type = 'button';
      b.style.backgroundImage = pieceSprite(m.promo, color);
      b.setAttribute('aria-label', { q: 'Ферзь', r: 'Ладья', b: 'Слон', n: 'Конь' }[m.promo]);
      b.onclick = () => { done = true; dlg.close(); resolve(m); };
      box.appendChild(b);
    }
    dlg.onclose = () => { if (!done) resolve(null); };
    dlg.showModal();
  });
}

async function tryMove(from, to) {
  const cands = game.status.moves.filter((m) => m.from === from && m.to === to);
  if (!cands.length) return;
  let m = cands[0];
  if (cands.length > 1) {
    m = await askPromo(cands);
    if (!m) { render(); return; }
  }
  makeMove(m);
}

wrapEl.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (!game || !canHumanAct()) return;
  const sq = sqFromPoint(e.clientX, e.clientY);
  if (sq < 0) return;
  const s = game.state, moves = game.status.moves;
  if (selected >= 0 && selected !== sq && moves.some((m) => m.from === selected && m.to === sq)) {
    tryMove(selected, sq);
    return;
  }
  if (moves.some((m) => m.from === sq)) {
    const wasSelected = selected === sq;
    if (!wasSelected) { selected = sq; sound.select(); render(); }
    drag = { sq, id: s.board[sq].id, el: pieceEls.get(s.board[sq].id), x0: e.clientX, y0: e.clientY, moved: false, wasSelected };
    wrapEl.setPointerCapture(e.pointerId);
  } else if (selected >= 0) {
    selected = -1;
    render();
  }
});

wrapEl.addEventListener('pointermove', (e) => {
  if (!drag || !drag.el) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
  if (!drag.moved) { drag.moved = true; drag.el.classList.add('dragging'); }
  const r = wrapEl.getBoundingClientRect(), size = r.width / game.state.W;
  drag.el.style.transform = `translate(${e.clientX - r.left - size / 2}px, ${e.clientY - r.top - size / 2}px)`;
});

wrapEl.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.moved) {
    d.el.classList.remove('dragging');
    const sq = sqFromPoint(e.clientX, e.clientY);
    if (sq >= 0 && sq !== d.sq && game.status.moves.some((m) => m.from === d.sq && m.to === sq)) {
      tryMove(d.sq, sq);
      return;
    }
    render();
  } else if (d.wasSelected) {
    selected = -1;
    render();
  }
});

wrapEl.addEventListener('pointercancel', () => {
  if (drag && drag.el) drag.el.classList.remove('dragging');
  drag = null;
  if (game) render();
});

new ResizeObserver(updateSqSize).observe(wrapEl);

// ---------------------------------------------------------------- таймер

let lastTick = performance.now();
setInterval(() => {
  const now = performance.now(), dt = now - lastTick;
  lastTick = now;
  if (!game || !game.clocks || game.over || animLock || !game.history.length) return;
  const c = game.state.turn;
  game.clocks[c] = Math.max(0, game.clocks[c] - dt);
  renderClocks();
  if (game.clocks[c] === 0) {
    const other = opp(c);
    const canMate = game.state.board.some((p) => p && p.c === other && p.t !== 'k');
    finish({ over: true, kind: 'timeout', winner: canMate ? other : null });
    render();
  }
}, 100);

// ---------------------------------------------------------------- кнопки и диалоги

const formNew = $('#formNew'), dlgNew = $('#dlgNew');
function syncNewDialog() {
  dlgNew.classList.toggle('hide-bot', formNew.elements.opponent.value !== 'bot');
}
function openNewDialog() {
  for (const k of ['mode', 'opponent', 'level', 'color', 'timer']) {
    const inp = formNew.querySelector(`input[name="${k}"][value="${settings[k]}"]`);
    if (inp) inp.checked = true;
  }
  syncNewDialog();
  dlgNew.showModal();
}
formNew.addEventListener('change', syncNewDialog);
dlgNew.addEventListener('close', () => {
  if (dlgNew.returnValue !== 'start') return;
  const fd = new FormData(formNew);
  for (const k of ['mode', 'opponent', 'level', 'color', 'timer']) if (fd.get(k) != null) settings[k] = fd.get(k);
  sound.unlock();
  sound.start();
  newGame();
});

$('#btnNew').onclick = openNewDialog;
$('#btnOverNew').onclick = () => { $('#dlgOver').close(); openNewDialog(); };
$('#btnOverClose').onclick = () => $('#dlgOver').close();
$('#btnRules').onclick = () => $('#dlgRules').showModal();
$('#btnRulesOk').onclick = () => $('#dlgRules').close();
$('#btnUndo').onclick = undo;
$('#btnFlip').onclick = () => { flipped = !flipped; buildBoard(); render(); };
const soundBtn = $('#btnSound');
const syncSoundBtn = () => { soundBtn.textContent = sound.muted ? 'ЗВУК: ВЫКЛ' : 'ЗВУК: ВКЛ'; };
soundBtn.onclick = () => { sound.toggle(); syncSoundBtn(); };
syncSoundBtn();
$('#rulesCells').innerHTML = legendRows();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && game && selected >= 0) { selected = -1; render(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
});

startWorker();
newGame(true);
openNewDialog();

// Отладочный доступ из консоли: arena.play('e2', 'e4')
window.arena = {
  get game() { return game; },
  play(from, to, promo) {
    const name = (sq) => FILES[sq % game.state.W] + (Math.floor(sq / game.state.W) + 1);
    const m = game.status.moves.find((x) => name(x.from) === from && name(x.to) === to && (!promo || x.promo === promo));
    if (m) makeMove(m);
    return !!m;
  },
};

// Для скриншотов и отладки: index.html#cells=d5:lava;moves=d2d4,a13a12,d4d5
if (location.hash.length > 1) {
  const params = Object.fromEntries(location.hash.slice(1).split(';').map((x) => x.split('=')));
  if (params.cells || params.moves) dlgNew.close();
  if (params.seed) game.state.seed = +params.seed >>> 0;
  if (params.nocells) game.state.noCells = true; // новые клетки не прячутся
  if (params.cells) {
    const at = (name) => (+name.slice(1) - 1) * game.state.W + FILES.indexOf(name[0]);
    game.state.cells = Object.fromEntries(params.cells.split(',').map((x) => x.split(':')).map(([sq, type]) => [at(sq), { type }]));
  }
  for (const mv of (params.moves || '').split(',')) {
    const [, from, to, promo] = mv.match(/^([a-n]\d+)([a-n]\d+)([qrbn])?$/) || [];
    if (from) window.arena.play(from, to, promo);
  }
  render();
}
