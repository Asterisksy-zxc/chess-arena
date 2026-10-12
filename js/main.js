import {
  createGame, applyMove, gameStatus, positionKey, moveToSan, inCheck, checkers,
  findKing, opp, pseudoMoves, CELLS, ARENA, VALUES, FILES,
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
const TRIGGER_TITLE = { meteor: 'МЕТЕОРИТНЫЙ ДОЖДЬ!', fog: 'ТУМАН ВОЙНЫ!', night: 'НАСТУПИЛА НОЧЬ!' };
const END_TITLE = { fog: 'ТУМАН РАССЕЯЛСЯ', night: 'РАССВЕТ' };

const settings = { mode: 'arena', opponent: 'human', level: '2', color: 'w', timer: '0', ...load('arena.settings') };

const wrapEl = $('#boardWrap'), boardEl = $('#board'), piecesEl = $('#pieces'), fxEl = $('#fxLayer');
let game = null;
let selected = -1;
let flipped = false;
let squares = [];
const pieceEls = new Map();
let thinking = false;
let aiToken = 0;
let coverOn = false;
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
  const N = game.state.N, r = Math.floor(sq / N), c = sq % N;
  return flipped ? { row: r, col: N - 1 - c } : { row: N - 1 - r, col: c };
}
function sqAt(row, col) {
  const N = game.state.N;
  return flipped ? row * N + (N - 1 - col) : (N - 1 - row) * N + col;
}
function sqFromPoint(x, y) {
  const r = wrapEl.getBoundingClientRect(), N = game.state.N;
  const col = Math.floor(((x - r.left) / r.width) * N);
  const row = Math.floor(((y - r.top) / r.height) * N);
  if (col < 0 || row < 0 || col >= N || row >= N) return -1;
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
  if (pending.size) restartWorker();
  selected = -1;
  flipped = humanColor === 'b';
  hideCover();
  if ($('#dlgOver').open) $('#dlgOver').close();
  buildBoard();
  renderLegend();
  render();
  if (!silent) banner({ title: 'ИГРА НАЧАЛАСЬ!', text: state.mode === 'arena' ? 'Встаньте на цветную клетку, чтобы запустить событие' : 'Классические шахматы', color: '#ffcd75' });
  maybeBot();
}

function canHumanAct() {
  return game && !game.over && !thinking && !coverOn && (!game.humanColor || game.state.turn === game.humanColor);
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
  game.state = n;
  game.status = gameStatus(n, reps);
  game.lastMove = { from: m.from, to: m.to };

  const mover = s.turn;
  const trig = n.fx.find((f) => f.kind === 'trigger');
  const suffix = game.status.over && game.status.kind === 'mate' ? '#' : game.status.check ? '+' : '';
  game.history.push({
    color: mover, san: san + suffix, num: s.fullmove,
    ev: trig ? trig.type : null,
    hiddenFrom: n.fog && n.fog !== mover ? n.fog : null,
  });

  selected = -1;
  if (n.fx.some((f) => f.kind === 'capture')) sound.capture();
  else sound.move();
  if (game.status.check) setTimeout(() => sound.check(), 120);

  if (game.status.over) finish(game.status);
  if (!game.over && !game.humanColor && n.fog && n.turn !== n.fog) showCover(n.turn);
  render(n.fx);
  playFx(n.fx);
  if (!game.over) maybeBot();
}

function maybeBot() {
  const s = game.state;
  if (game.over || !game.humanColor || s.turn === game.humanColor) return;
  thinking = true;
  const token = ++aiToken;
  const t0 = performance.now();
  renderTurn();
  renderPlates();
  // в тумане бот «теряется» и играет как новичок
  const level = s.fog === s.turn ? 1 : +settings.level;
  askBot(s, level).then((mv) => {
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
  if (!game.snapshots.length || coverOn) return;
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
  const icon = $('#overIcon');
  icon.style.backgroundImage = iconSprite(info.icon || 'crown', info.icon === 'skull' ? '#f4f4f4' : info.win ? '#ffcd75' : '#94b0c2');
  $('#overTitle').textContent = info.title;
  $('#overText').textContent = info.text;
  $('#dlgOver').showModal();
}

// ---------------------------------------------------------------- туман

function showCover(color) {
  coverOn = true;
  $('#coverTitle').textContent = `ХОД ${GEN[color]}`;
  $('#cover').hidden = false;
}
function hideCover() {
  coverOn = false;
  $('#cover').hidden = true;
}

function fogVisibility(s, viewer) {
  const N = s.N, vis = new Set();
  for (let sq = 0; sq < N * N; sq++) {
    const p = s.board[sq];
    if (!p || p.c !== viewer) continue;
    const r = Math.floor(sq / N), c = sq % N;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N) vis.add(rr * N + cc);
      }
    }
  }
  for (const m of pseudoMoves(s, viewer)) vis.add(m.to);
  for (const c of checkers(s, viewer)) vis.add(c);
  return vis;
}

function computeView() {
  const s = game.state;
  const viewer = game.humanColor || s.turn;
  const vis = s.fog === viewer && !game.over ? fogVisibility(s, viewer) : null;
  const doomed = new Set();
  if (s.event && s.event.type === 'meteor') {
    for (const t of s.event.targets) if (s.board[t] && s.board[t].t !== 'k') doomed.add(t);
  }
  return { viewer, vis, doomed, moves: game.status.moves };
}

// ---------------------------------------------------------------- отрисовка

function buildBoard() {
  const N = game.state.N;
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${N}, 1fr)`;
  squares = new Array(N * N);
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
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
  wrapEl.style.setProperty('--sq', wrapEl.clientWidth / game.state.N + 'px');
}

function render(fx = []) {
  const view = computeView();
  const delayed = new Map();
  for (const f of fx) if (f.kind === 'meteorKill') delayed.set(f.piece.id, 560);
  wrapEl.classList.toggle('night', !!game.state.night);
  renderSquares(view, fx);
  renderPieces(view, delayed);
  renderTurn();
  renderEvent();
  renderPlates();
  renderHistory();
  $('#btnUndo').disabled = !game.snapshots.length;
}

function renderSquares(view) {
  const s = game.state, N = s.N;
  const targets = new Map();
  if (selected >= 0) for (const m of view.moves) if (m.from === selected) targets.set(m.to, m);
  const checkSq = game.status.check ? findKing(s, s.turn) : -1;
  const ev = s.event;
  const meteor = ev && ev.type === 'meteor' ? new Set(ev.targets) : null;
  const left = meteor ? ev.impactPly - s.ply : 0;
  for (let sq = 0; sq < N * N; sq++) {
    const d = squares[sq];
    const r = Math.floor(sq / N), c = sq % N;
    const { row, col } = disp(sq);
    const fogged = view.vis && !view.vis.has(sq);
    const p = s.board[sq];
    const cls = ['sq', (r + c) % 2 === 0 ? 'dark' : 'light'];
    if (game.lastMove && (game.lastMove.from === sq || game.lastMove.to === sq) && !fogged) cls.push('last');
    if (sq === selected) cls.push('sel');
    if (sq === checkSq) cls.push('check');
    if (fogged) cls.push('fog');
    if (p && !(fogged && p.c !== view.viewer)) cls.push('occupied');
    let html = '';
    if (col === 0) html += `<span class="coord rank">${r + 1}</span>`;
    if (row === N - 1) html += `<span class="coord file">${FILES[c]}</span>`;
    const cell = s.cells[sq];
    if (cell) {
      const C = CELLS[cell.type];
      html += `<div class="cell${ev ? ' locked' : ''}" style="--ec:${C.color}"><i style="${bg(iconSprite(cell.type, C.color))}"></i></div>`;
    }
    if (ev && ev.sq === sq && !p) {
      const C = CELLS[ev.type];
      html += `<div class="cell lit" style="--ec:${C.color}"><i style="${bg(iconSprite(ev.type, '#f4f4f4'))}"></i></div>`;
    } else if (ev && ev.sq === sq) {
      html += `<div class="cell lit" style="--ec:${CELLS[ev.type].color}"></div>`;
    }
    if (s.craters[sq] !== undefined) html += `<div class="crater"><b>${s.craters[sq] - s.ply}</b></div>`;
    if (meteor && meteor.has(sq)) html += `<div class="target"><b>${left}</b></div>`;
    const t = targets.get(sq);
    if (t) html += t.capture && p ? '<div class="cap"></div>' : '<div class="dot"></div>';
    const cn = cls.join(' ');
    if (d.className !== cn) d.className = cn;
    if (d._html !== html) { d.innerHTML = html; d._html = html; }
  }
}

function renderPieces(view, delayed) {
  const s = game.state, N = s.N;
  const seen = new Set();
  for (let sq = 0; sq < N * N; sq++) {
    const p = s.board[sq];
    if (!p) continue;
    seen.add(p.id);
    let e = pieceEls.get(p.id);
    const { row, col } = disp(sq);
    const pos = `translate(${col * 100}%, ${row * 100}%)`;
    if (!e) {
      e = h('div', 'pc');
      e.style.width = e.style.height = 100 / N + '%';
      e.style.transition = 'none';
      e.style.transform = pos;
      piecesEl.appendChild(e);
      pieceEls.set(p.id, e);
      requestAnimationFrame(() => requestAnimationFrame(() => { e.style.transition = ''; }));
    }
    const sprite = p.t + p.c;
    if (e._sprite !== sprite) { e.style.backgroundImage = pieceSprite(p.t, p.c); e._sprite = sprite; }
    const cls = ['pc'];
    if ('rbq'.includes(p.t)) cls.push('slider');
    if (view.doomed.has(sq)) cls.push('doomed');
    if (view.vis && !view.vis.has(sq) && p.c !== view.viewer) cls.push('hidden');
    const dragging = drag && drag.id === p.id && drag.moved;
    if (dragging) cls.push('dragging');
    e.className = cls.join(' ');
    if (!dragging && e.style.transform !== pos) e.style.transform = pos;
  }
  for (const [id, e] of pieceEls) {
    if (seen.has(id)) continue;
    pieceEls.delete(id);
    setTimeout(() => {
      e.classList.add('dying');
      setTimeout(() => e.remove(), 380);
    }, delayed.get(id) || 0);
  }
}

function renderTurn() {
  const s = game.state, c = s.turn;
  let title, sub = '';
  if (game.over) {
    const info = resultInfo(game.over);
    title = info.title;
  } else if (game.humanColor) {
    title = c === game.humanColor ? 'ВАШ ХОД' : 'ХОД БОТА';
    sub = thinking ? 'Бот думает…' : `Вы играете за ${GEN[game.humanColor].toLowerCase()} · ход ${s.fullmove}`;
  } else {
    title = `ХОД ${GEN[c]}`;
    sub = `Ход ${s.fullmove}`;
  }
  let alerts = '';
  if (!game.over && game.status.check) alerts = '<div class="alert check">ШАХ! КОРОЛЬ ПОД УДАРОМ</div>';
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
  const ev = s.event;
  let html = '<div class="panel-title">СОБЫТИЕ</div>';
  if (!ev) {
    html += '<div class="ev-idle"><b>ЗАТИШЬЕ</b>Встаньте фигурой на цветную клетку — она вспыхнет и запустит событие.</div>';
  } else {
    const C = CELLS[ev.type];
    const by = `Запустили ${NAME[ev.by].toLowerCase()}`;
    let text, left, total;
    if (ev.type === 'meteor') {
      left = ev.impactPly - s.ply; total = ARENA.meteorDelay;
      text = `${by}. Удар через ${left} — уводите фигуры с красных прицелов!`;
    } else {
      left = ev.endPly - s.ply; total = ARENA.eventLength;
      text = ev.type === 'fog' ? `${by}. ${NAME[s.fog]} видят только своё окружение.` : `${by}. Дальнобойные фигуры бьют лишь на 3 клетки.`;
    }
    html += `<div class="ev-row"><div class="ev-icon" style="${bg(iconSprite(ev.type, C.color))}"></div><div><div class="ev-name" style="color:${C.color}">${C.name.toUpperCase()}</div><div class="ev-text">${text}</div></div></div>${meter(left, total, C.color)}`;
  }
  panel.innerHTML = html;
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
  const s = game.state, viewer = game.humanColor || s.turn;
  const shown = (e) => {
    if (s.fog === viewer && e.hiddenFrom === viewer && !game.over) return '???';
    return (e.ev ? `<span class="ev" style="--c:${CELLS[e.ev].color}"></span>` : '') + e.san;
  };
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
  return Object.entries(CELLS).map(([k, C]) =>
    `<div class="legend-row" style="--c:${C.color}"><div class="legend-sw"><i style="${bg(iconSprite(k, C.color))}"></i></div><div><b>${C.name.toUpperCase()}</b><span>${C.desc}</span></div></div>`,
  ).join('');
}

function renderLegend() {
  $('#cellsPanel').hidden = game.state.mode !== 'arena';
  $('#cellsLegend').innerHTML = legendRows();
}

// ---------------------------------------------------------------- эффекты

function center(sq, clamp = false) {
  const { row, col } = disp(sq), N = game.state.N;
  let left = ((col + 0.5) * 100) / N;
  if (clamp) left = Math.min(80, Math.max(20, left)); // надписи не уезжают за край доски
  return { left: left + '%', top: ((row + 0.5) * 100) / N + '%' };
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
  el.style.setProperty('--c', b.color || '#ffcd75');
  el.innerHTML = `${b.icon ? `<div class="b-icon" style="${bg(iconSprite(b.icon, b.color))}"></div>` : ''}<div class="b-title">${b.title}</div>${b.text ? `<div class="b-text">${b.text}</div>` : ''}`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(nextBanner, 120);
  }, b.time || 2000);
}

function playFx(fx) {
  let meteorIdx = 0;
  for (const f of fx) {
    switch (f.kind) {
      case 'capture':
        fxAt(f.sq, 'burst', { color: '#f4f4f4', life: 500 });
        sparks(f.sq, '#f4f4f4');
        break;
      case 'trigger': {
        const C = CELLS[f.type];
        fxAt(f.sq, 'flash', { color: C.color, life: 750 });
        sparks(f.sq, C.color);
        fxAt(f.sq, 'label', { text: C.name.toUpperCase() + '!', color: C.color, delay: 100 });
        const text = f.type === 'meteor' ? `Цели на половине ${GEN[opp(f.by)].toLowerCase()} — удар через 2 хода`
          : f.type === 'fog' ? `${NAME[opp(f.by)]} ослеплены на 3 хода` : 'Дальнобойные фигуры бьют лишь на 3 клетки';
        banner({ icon: f.type, title: TRIGGER_TITLE[f.type], text, color: C.color, time: 2200 });
        sound.trigger(f.type);
        shake(0);
        break;
      }
      case 'meteorKill':
      case 'meteorHit': {
        const delay = meteorIdx++ * 170;
        fxAt(f.sq, 'meteor', { delay, life: 520, style: bg(iconSprite('meteor', CELLS.meteor.color)) });
        fxAt(f.sq, 'boom', { delay: delay + 480, life: 650 });
        sparks(f.sq, '#ef7d57', delay + 480);
        setTimeout(() => sound.boom(), delay + 480);
        shake(delay + 480);
        break;
      }
      case 'meteorBlocked':
        fxAt(f.sq, 'label', { text: 'КОРОЛЬ УСТОЯЛ', color: '#ffcd75', delay: 500 });
        break;
      case 'cellSpawn':
        fxAt(f.sq, 'burst', { color: CELLS[f.type].color, life: 500, delay: 200 });
        break;
      case 'eventEnd':
        banner({ title: END_TITLE[f.type], color: '#a7f070', time: 1300 });
        sound.end(false);
        break;
    }
  }
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
  const r = wrapEl.getBoundingClientRect(), size = r.width / game.state.N;
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
  if (!game || !game.clocks || game.over || coverOn || !game.history.length) return;
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
$('#coverBtn').onclick = () => { hideCover(); render(); };
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
    const name = (sq) => FILES[sq % game.state.N] + (Math.floor(sq / game.state.N) + 1);
    const m = game.status.moves.find((x) => name(x.from) === from && name(x.to) === to && (!promo || x.promo === promo));
    if (m) makeMove(m);
    return !!m;
  },
};

// Для скриншотов и отладки: index.html#moves=b2b4,c9c8,b4b5 разыгрывает ходы без диалога.
if (location.hash.startsWith('#moves=')) {
  dlgNew.close();
  for (const mv of location.hash.slice(7).split(',')) {
    const [, from, to, promo] = mv.match(/^([a-j]\d+)([a-j]\d+)([qrbn])?$/) || [];
    if (from) window.arena.play(from, to, promo);
  }
}
