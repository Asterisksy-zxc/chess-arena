import {
  createGame, applyMove, gameStatus, directorStep, positionKey, moveToSan, inCheck, checkers,
  findKing, opp, pseudoMoves, isFrozen, isShielded, TILES, EVENTS, ARENA, GLYPH, VALUES, FILES,
} from './engine.js';
import { LEVELS, findBestMove } from './ai.js';
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

const TILE_COLORS = { dash: '#ffd23f', shield: '#4cc9f0', trap: '#a5f3fc', portal: '#b388ff', eye: '#f472b6', academy: '#86efac' };
const EVENT_START = { fog: 'Опустился туман войны', night: 'Наступила ночь', meteor: 'Метеоритный дождь!', runes: 'Дождь рун!' };
const EVENT_END = { fog: 'Туман рассеялся', night: 'Рассвет — ночь закончилась' };
const COLOR_NAME = { w: 'белые', b: 'чёрные' };
const COLOR_GEN = { w: 'белых', b: 'чёрных' };

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

const plural = (n, f = ['ход', 'хода', 'ходов']) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return f[2];
  if (b > 1 && b < 5) return f[1];
  if (b === 1) return f[0];
  return f[2];
};
const glyph = (t) => GLYPH[t] + '︎';
const figHtml = (san) => san.replace(/[♔♕♖♗♘]/g, '<span class="fig">$&</span>');

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
  const state = createGame(settings.mode);
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
  $('#dlgOver').open && $('#dlgOver').close();
  buildBoard();
  renderLegend();
  render();
  if (state.mode === 'arena' && !silent) {
    banner({ icon: '🌋', title: 'Арена ожила', text: 'Клетки силы ждут смельчаков. Первое событие — через пару ходов.' });
  }
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
  let n = applyMove(s, m);
  n = directorStep(n);
  const key = positionKey(n);
  const reps = (game.reps.get(key) || 0) + 1;
  game.reps.set(key, reps);
  game.state = n;
  game.status = gameStatus(n, reps);

  if (!m.pass) {
    const tp = n.fx.find((f) => f.kind === 'teleport');
    game.lastMove = { from: m.from, to: tp ? tp.to : m.to };
  }
  const mover = s.turn;
  const oppCheck = inCheck(n, opp(mover));
  const marks = n.fx.map((f) => (f.kind === 'tile' ? TILES[f.type].icon : f.kind === 'teleport' ? '🌀' : '')).join('');
  const suffix = game.status.over && game.status.kind === 'mate' ? '#' : oppCheck ? '+' : '';
  if (s.bonus >= 0 && game.history.length) {
    if (!m.pass) game.history[game.history.length - 1].san += ' → ' + san + suffix;
  } else {
    game.history.push({ color: mover, san: san + marks + suffix, num: s.fullmove, fog: s.fog || n.fog });
  }

  selected = n.bonus >= 0 && canHumanAct() ? n.bonus : -1;
  if (n.fx.some((f) => f.kind === 'capture')) sound.capture();
  else if (!m.pass) sound.move();
  if (oppCheck || game.status.check) setTimeout(() => sound.check(), 120);

  if (game.status.over) finish(game.status);
  if (!game.over && !game.humanColor && n.fog && n.turn !== mover) showCover(n.turn);
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
  renderBars();
  askBot(s, +settings.level).then((mv) => {
    if (token !== aiToken) return;
    const wait = Math.max(0, (s.bonus >= 0 ? 380 : 550) - (performance.now() - t0));
    setTimeout(() => {
      if (token !== aiToken) return;
      thinking = false;
      const legal = game.status.moves;
      const m = (mv && legal.find((x) => x.from === mv.from && x.to === mv.to && !!x.pass === !!mv.pass && (x.promo || '') === (mv.promo || ''))) || legal[0];
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
    while (game.snapshots.length && (snap.state.turn !== game.humanColor || snap.state.bonus >= 0)) snap = game.snapshots.pop();
  } else {
    while (game.snapshots.length && snap.state.bonus >= 0) snap = game.snapshots.pop();
  }
  Object.assign(game, { state: snap.state, status: snap.status, lastMove: snap.lastMove, history: snap.history, reps: snap.reps, over: null });
  selected = snap.state.bonus >= 0 ? snap.state.bonus : -1;
  if ($('#dlgOver').open) $('#dlgOver').close();
  render();
  maybeBot();
}

function finish(res) {
  game.over = res;
  thinking = false;
  aiToken++;
  setTimeout(() => sound.end(), 300);
  setTimeout(() => { if (game.over === res) showOver(res); }, 1100);
}

function resultInfo(res) {
  const vsBot = !!game.humanColor;
  const winText = (w) => (vsBot ? (w === game.humanColor ? 'Вы победили! 🎉' : 'Победил бот') : `Победили ${COLOR_NAME[w]}`);
  switch (res.kind) {
    case 'mate': return { icon: '🏆', title: 'Мат!', text: winText(res.winner) };
    case 'stalemate': return { icon: '🤝', title: 'Пат', text: 'Ничья: ходить некуда, но шаха нет.' };
    case 'material': return { icon: '🤝', title: 'Ничья', text: 'Недостаточно материала, чтобы поставить мат.' };
    case 'fifty': return { icon: '🤝', title: 'Ничья', text: '50 ходов без взятий и ходов пешками.' };
    case 'repetition': return { icon: '🤝', title: 'Ничья', text: 'Позиция повторилась трижды.' };
    case 'timeout': return { icon: '⏰', title: 'Время вышло!', text: res.winner ? winText(res.winner) : 'Ничья: у соперника не хватает материала.' };
  }
  return { icon: '🏁', title: 'Конец', text: '' };
}

function showOver(res) {
  const info = resultInfo(res);
  $('#overIcon').textContent = info.icon;
  $('#overTitle').textContent = info.title;
  $('#overText').textContent = info.text;
  $('#dlgOver').showModal();
}

// ---------------------------------------------------------------- туман: передача устройства

function showCover(color) {
  coverOn = true;
  $('#coverTitle').textContent = `Ход ${COLOR_GEN[color]}`;
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
    if (p.t === 'p') {
      const rr = r + (p.c === 'w' ? 1 : -1);
      for (const dc of [-1, 1]) if (rr >= 0 && rr < N && c + dc >= 0 && c + dc < N) vis.add(rr * N + c + dc);
    }
  }
  for (const m of pseudoMoves({ ...s, turn: viewer, bonus: -1 })) vis.add(m.to);
  for (const c of checkers(s, viewer)) vis.add(c);
  return vis;
}

function computeView() {
  const s = game.state;
  const viewer = game.humanColor || s.turn;
  const vis = s.fog && !s.fogImmune[viewer] && !game.over ? fogVisibility(s, viewer) : null;
  const doomed = new Set();
  const ev = s.event;
  if (ev && ev.type === 'meteor' && ev.phase === 'announced') {
    for (const t of ev.targets) {
      const p = s.board[t];
      if (p && p.t !== 'k' && !(p.shieldUntil > ev.startPly)) doomed.add(t);
    }
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
      const sq = sqAt(row, col);
      const d = h('div', 'sq');
      boardEl.appendChild(d);
      squares[sq] = d;
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
  const teleports = new Map();
  const delayed = new Map();
  for (const f of fx) {
    if (f.kind === 'teleport' && game.state.board[f.to]) teleports.set(game.state.board[f.to].id, f);
    if (f.kind === 'meteorKill') delayed.set(f.piece.id, 620);
  }
  wrapEl.classList.toggle('night', !!game.state.night);
  renderSquares(view);
  renderPieces(view, teleports, delayed);
  renderTurn();
  renderEvent();
  renderBars();
  renderHistory();
  $('#btnUndo').disabled = !game.snapshots.length;
}

function renderSquares(view) {
  const s = game.state, N = s.N;
  const targets = new Map();
  if (selected >= 0) for (const m of view.moves) if (m.from === selected && !m.pass) targets.set(m.to, m);
  const checkSq = game.status.check ? findKing(s, s.turn) : -1;
  const ev = s.event;
  const meteor = ev && ev.type === 'meteor' && ev.phase === 'announced' ? new Set(ev.targets) : null;
  const runes = ev && ev.type === 'runes' && ev.phase === 'announced' ? new Set(ev.spawn.map((x) => x.sq)) : null;
  const left = ev ? ev.startPly - s.ply : 0;
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
    const tile = s.tiles[sq];
    if (tile) html += `<div class="tile t-${tile.type}"><span>${TILES[tile.type].icon}</span></div>`;
    if (s.craters[sq] !== undefined) html += `<div class="crater"><b>${s.craters[sq] - s.ply}</b></div>`;
    if (meteor && meteor.has(sq)) html += `<div class="target"><b>☄️</b><i>${left}</i></div>`;
    if (runes && runes.has(sq)) html += '<div class="rune-soon">✨</div>';
    const t = targets.get(sq);
    if (t) {
      html += t.capture && p ? '<div class="ring"></div>' : '<div class="dot"></div>';
      if (tile) cls.push('hint-tile');
    }
    const cn = cls.join(' ');
    if (d.className !== cn) d.className = cn;
    if (d._html !== html) { d.innerHTML = html; d._html = html; }
  }
}

function renderPieces(view, teleports, delayed) {
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
    const shield = isShielded(s, p), frozen = isFrozen(s, p);
    const cls = ['pc', p.c];
    if ('rbq'.includes(p.t)) cls.push('slider');
    if (shield) cls.push('shield');
    if (frozen) cls.push('frozen');
    if (s.bonus === sq) cls.push('bonus');
    if (view.doomed.has(sq)) cls.push('doomed');
    if (view.vis && !view.vis.has(sq) && p.c !== view.viewer) cls.push('hidden');
    const dragging = drag && drag.id === p.id && drag.moved;
    if (dragging) cls.push('dragging');
    e.className = cls.join(' ');
    let badge = '';
    if (frozen) badge = `<span class="badge fr">❄${Math.ceil((p.frozenUntil - s.ply) / 2)}</span>`;
    else if (shield) badge = `<span class="badge sh">🛡${Math.ceil((p.shieldUntil - s.ply) / 2)}</span>`;
    const inner = `<span class="g">${glyph(p.t)}</span>${badge}`;
    if (e._inner !== inner) { e.innerHTML = inner; e._inner = inner; }
    e.style.setProperty('--pos', pos);
    if (dragging) continue;
    const tp = teleports.get(p.id);
    if (tp) {
      const a = disp(tp.from);
      e.style.transform = `translate(${a.col * 100}%, ${a.row * 100}%)`;
      setTimeout(() => {
        e.style.transition = 'none';
        e.style.transform = pos;
        e.classList.add('warp');
        void e.offsetWidth;
        e.style.transition = '';
        setTimeout(() => e.classList.remove('warp'), 520);
      }, 260);
    } else if (e.style.transform !== pos) {
      e.style.transform = pos;
    }
  }
  for (const [id, e] of pieceEls) {
    if (seen.has(id)) continue;
    pieceEls.delete(id);
    const wait = delayed.get(id) || 0;
    setTimeout(() => {
      e.classList.add('dying');
      setTimeout(() => e.remove(), 330);
    }, wait);
  }
}

function renderTurn() {
  const s = game.state, c = s.turn;
  let title, sub;
  if (game.over) {
    const info = resultInfo(game.over);
    title = info.title;
    sub = info.text;
  } else if (game.humanColor) {
    title = c === game.humanColor ? 'Ваш ход' : 'Ход бота';
    sub = thinking ? '<span class="thinking">Бот думает</span>' : `Играют ${COLOR_NAME[c]} · ход ${s.fullmove}`;
  } else {
    title = `Ход ${COLOR_GEN[c]}`;
    sub = `Ход ${s.fullmove}`;
  }
  let alerts = '';
  if (!game.over && game.status.check) alerts += `<div class="alert check">⚠️ Шах! Королю ${COLOR_GEN[c]} грозит опасность</div>`;
  if (!game.over && s.bonus >= 0) {
    alerts += `<div class="alert bonus"><span>⚡ Рывок! Ещё один ход этой фигурой (без взятия)</span>${canHumanAct() ? '<button class="btn small" id="btnSkip">Пропустить</button>' : ''}</div>`;
  }
  if (game.over) alerts += `<div class="alert over">${resultInfo(game.over).icon} Нажмите «Новая игра», чтобы сыграть ещё</div>`;
  $('#turnCard').innerHTML = `<div class="turn-main"><div class="turn-dot ${c}"></div><div><div class="turn-title">${title}</div><div class="turn-sub">${sub}</div></div></div>${alerts}`;
  const skip = $('#btnSkip');
  if (skip) skip.onclick = () => { const m = game.status.moves.find((x) => x.pass); if (m) makeMove(m); };
}

function renderEvent() {
  const s = game.state, card = $('#eventCard');
  card.hidden = s.mode !== 'arena';
  if (card.hidden) return;
  const ev = s.event;
  const row = (kind, kicker, E) => `<div class="ev-row"><div class="ev-icon">${E.icon}</div><div><div class="ev-kicker ${kind}">${kicker}</div><div class="ev-name">${E.name}</div><div class="ev-desc">${E.desc}</div></div></div>`;
  let html;
  if (ev && ev.phase === 'announced') {
    const left = ev.startPly - s.ply, total = ev.startPly - ev.announcedPly;
    html = row('soon', `Надвигается · через ${left} ${plural(left)}`, EVENTS[ev.type]) + `<div class="ev-bar"><i style="width:${((total - left) / total) * 100}%"></i></div>`;
    if (ev.type === 'meteor') html += '<div class="ev-extra">Уведите фигуры с отмеченных ☄️ клеток!</div>';
    if (ev.type === 'runes') html += '<div class="ev-extra">Новые клетки появятся на отмеченных ✨ местах.</div>';
  } else if (ev && ev.phase === 'active') {
    const left = ev.endPly - s.ply, total = EVENTS[ev.type].duration;
    html = row('now', `Сейчас · ещё ${left} ${plural(left)}`, EVENTS[ev.type]) + `<div class="ev-bar"><i style="width:${(left / total) * 100}%"></i></div>`;
    const immune = ['w', 'b'].filter((c) => s.fog && s.fogImmune[c]);
    if (immune.length) html += `<div class="ev-extra">👁️ Око: ${immune.map((c) => COLOR_NAME[c]).join(' и ')} видят сквозь туман.</div>`;
  } else {
    const left = Math.max(0, s.nextEventPly - s.ply);
    html = `<div class="ev-row"><div class="ev-icon">🌤️</div><div><div class="ev-kicker">Затишье</div><div class="ev-name">Арена спокойна</div><div class="ev-desc">${left ? `Новое событие объявят через ${left} ${plural(left)}.` : 'Скоро объявят новое событие.'}</div></div></div>`;
  }
  const eyes = ['w', 'b'].filter((c) => s.eye[c]);
  if (eyes.length) html += `<div class="ev-extra">👁️ Око у: ${eyes.map((c) => COLOR_GEN[c]).join(', ')} — следующий туман им не страшен.</div>`;
  card.innerHTML = html;
}

function material(s, color) {
  return s.board.reduce((sum, p) => sum + (p && p.c === color ? VALUES[p.t] : 0), 0);
}

function fmtClock(ms) {
  const t = Math.max(0, ms);
  if (t < 10000) return (t / 1000).toFixed(1);
  const sec = Math.ceil(t / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function renderBars() {
  const bottom = flipped ? 'b' : 'w';
  renderBar($('#barBottom'), bottom);
  renderBar($('#barTop'), opp(bottom));
}

function renderBar(bar, color) {
  const s = game.state;
  const name = game.humanColor
    ? (color === game.humanColor ? 'Вы' : `Бот · ${LEVELS[settings.level].name}`)
    : (color === 'w' ? 'Белые' : 'Чёрные');
  const taken = s.lost[opp(color)].slice().sort((a, b) => VALUES[b.t] - VALUES[a.t]).map((p) => glyph(p.t)).join('');
  const diff = Math.round((material(s, color) - material(s, opp(color))) / 100);
  const active = !game.over && s.turn === color;
  bar.classList.toggle('active', active);
  const badges = (s.eye[color] ? '👁️' : '') + (s.fog && s.fogImmune[color] ? '👁️' : '');
  const think = thinking && active ? '<span class="thinking">думает</span>' : '';
  bar.innerHTML = `
    <div class="avatar ${color}">${glyph('k')}</div>
    <div class="pinfo">
      <span class="pname">${name} ${think}</span>
      <span class="captured">${taken}${diff > 0 ? `<span class="adv">+${diff}</span>` : ''}</span>
    </div>
    <span class="pbadges">${badges}</span>
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
    ol.innerHTML = '<li class="history-empty">Ходов пока нет — начинайте!</li>';
    return;
  }
  const s = game.state, viewer = game.humanColor || s.turn;
  const hideFog = s.fog && !s.fogImmune[viewer] && !game.over;
  const shown = (e) => (hideFog && e.fog && e.color !== viewer ? '🌫️ ?' : e.san);
  const rows = [];
  for (const e of hist) {
    const last = rows[rows.length - 1];
    if (e.color === 'b' && last && !last.b && last.num === e.num) last.b = shown(e);
    else rows.push({ num: e.num, w: e.color === 'w' ? shown(e) : '…', b: e.color === 'b' ? shown(e) : '' });
  }
  const lastIdx = hist.length - 1, lastColor = hist[lastIdx].color;
  ol.innerHTML = rows.map((r, i) => {
    const isLast = i === rows.length - 1;
    return `<li><span class="n">${r.num}.</span><span class="mv ${isLast && lastColor === 'w' ? 'lastmv' : ''}">${figHtml(r.w)}</span><span class="mv ${isLast && lastColor === 'b' ? 'lastmv' : ''}">${figHtml(r.b)}</span></li>`;
  }).join('');
  ol.scrollTop = ol.scrollHeight;
}

function legendItem(icon, name, desc, color) {
  return `<div class="lg-item"><div class="lg-ic" style="--tc:${color}">${icon}</div><div><b>${name}</b><span>${desc}</span></div></div>`;
}

function renderLegend() {
  const leg = $('#legend');
  leg.hidden = game.state.mode !== 'arena';
  if (leg.hidden) return;
  const tiles = Object.entries(TILES).map(([k, t]) => legendItem(t.icon, t.name, t.desc, TILE_COLORS[k])).join('');
  const events = Object.values(EVENTS).map((e) => legendItem(e.icon, e.name, e.desc, '#8d97ad')).join('');
  $('#legendBody').innerHTML = `<div class="legend-grid"><div class="lg-sep">Клетки силы — встань и получи</div>${tiles}<div class="lg-sep">Мировые события — объявляются за ${ARENA.announceLead} хода</div>${events}</div>`;
}

function fillRules() {
  const li = (icon, name, desc) => `<li><span class="ic">${icon}</span><span><b>${name}.</b> ${desc}</span></li>`;
  $('#rulesTiles').innerHTML = Object.values(TILES).map((t) => li(t.icon, t.name, t.desc)).join('');
  $('#rulesEvents').innerHTML = Object.values(EVENTS).map((e) => li(e.icon, e.name, e.desc + (e.duration ? ` Длится ${e.duration} ходов.` : ''))).join('');
}

// ---------------------------------------------------------------- эффекты

function fxAt(sq, type, text = '', { color, delay = 0, life = 1500 } = {}) {
  setTimeout(() => {
    if (!game) return;
    const { row, col } = disp(sq);
    const N = game.state.N;
    const e = h('div', 'fx ' + type, text);
    e.style.left = ((col + 0.5) * 100) / N + '%';
    e.style.top = ((row + 0.5) * 100) / N + '%';
    if (color) e.style.setProperty('--c', color);
    fxEl.appendChild(e);
    setTimeout(() => e.remove(), life);
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
  el.className = 'banner' + (b.warn ? ' warn' : '');
  el.innerHTML = `<div class="b-icon">${b.icon}</div><div class="b-title">${b.title}</div>${b.text ? `<div class="b-text">${b.text}</div>` : ''}`;
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(nextBanner, 320);
  }, b.time || 2300);
}

function playFx(fx) {
  let meteorIdx = 0;
  for (const f of fx) {
    switch (f.kind) {
      case 'capture':
        fxAt(f.sq, 'burst', '', { color: '#fff', life: 700 });
        break;
      case 'tile': {
        const T = TILES[f.type], color = TILE_COLORS[f.type];
        fxAt(f.sq, 'burst', '', { color, life: 700 });
        fxAt(f.sq, 'label', `${T.icon} ${T.name}!`, { color, delay: 120 });
        if (f.type === 'trap') sound.freeze(); else sound.magic();
        break;
      }
      case 'teleport':
        fxAt(f.from, 'swirl', '', { life: 900 });
        fxAt(f.to, 'swirl', '', { delay: 250, life: 900 });
        fxAt(f.to, 'label', '🌀 Портал!', { color: TILE_COLORS.portal, delay: 300 });
        sound.warp();
        break;
      case 'portalBlocked':
        fxAt(f.sq, 'label', '🌀 Выход занят', { color: TILE_COLORS.portal });
        break;
      case 'meteorKill':
      case 'meteorHit': {
        const delay = meteorIdx++ * 160;
        fxAt(f.sq, 'meteor', '☄️', { delay, life: 560 });
        fxAt(f.sq, 'boom', '', { delay: delay + 520, life: 750 });
        setTimeout(() => {
          sound.boom();
          wrapEl.classList.remove('shake');
          void wrapEl.offsetWidth;
          wrapEl.classList.add('shake');
        }, delay + 520);
        break;
      }
      case 'meteorBlocked':
        fxAt(f.sq, 'label', '🛡️ Устоял!', { color: '#4cc9f0', delay: 500 });
        break;
      case 'tileSpawn':
        fxAt(f.sq, 'sparkle', '✨', { life: 1000, delay: 200 });
        break;
      case 'eventAnnounce': {
        const E = EVENTS[f.type];
        banner({ icon: E.icon, title: `Через ${ARENA.announceLead} хода: ${E.name}`, text: E.desc, warn: true, time: 2600 });
        sound.announce();
        break;
      }
      case 'eventStart': {
        const E = EVENTS[f.type];
        banner({ icon: E.icon, title: EVENT_START[f.type], text: f.type === 'meteor' || f.type === 'runes' ? '' : E.desc, time: 2000 });
        sound.event();
        break;
      }
      case 'eventEnd':
        banner({ icon: f.type === 'night' ? '🌅' : '🌤️', title: EVENT_END[f.type], time: 1500 });
        break;
    }
  }
}

// ---------------------------------------------------------------- ввод

async function askPromo(cands) {
  const dlg = $('#dlgPromo'), box = $('#promoChoices');
  const color = game.state.turn;
  $('#promoTitle').textContent = cands[0].academy ? '⭐ Академия: кем станет пешка?' : 'Превращение пешки';
  box.innerHTML = '';
  return new Promise((resolve) => {
    let done = false;
    for (const m of cands) {
      const b = h('button', color, glyph(m.promo));
      b.type = 'button';
      b.onclick = () => { done = true; dlg.close(); resolve(m); };
      box.appendChild(b);
    }
    dlg.onclose = () => { if (!done) resolve(null); };
    dlg.showModal();
  });
}

async function tryMove(from, to) {
  const cands = game.status.moves.filter((m) => m.from === from && m.to === to && !m.pass);
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
  if (selected >= 0 && selected !== sq && moves.some((m) => m.from === selected && m.to === sq && !m.pass)) {
    tryMove(selected, sq);
    return;
  }
  if (moves.some((m) => m.from === sq && !m.pass)) {
    const wasSelected = selected === sq;
    if (!wasSelected) { selected = sq; sound.select(); render(); }
    drag = { sq, id: s.board[sq].id, el: pieceEls.get(s.board[sq].id), x0: e.clientX, y0: e.clientY, moved: false, wasSelected };
    wrapEl.setPointerCapture(e.pointerId);
  } else if (s.bonus < 0 && selected >= 0) {
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
    if (sq >= 0 && sq !== d.sq && game.status.moves.some((m) => m.from === d.sq && m.to === sq && !m.pass)) {
      tryMove(d.sq, sq);
      return;
    }
    render();
  } else if (d.wasSelected && game.state.bonus < 0) {
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
const syncSoundBtn = () => { soundBtn.textContent = sound.muted ? '🔇' : '🔊'; };
soundBtn.onclick = () => { sound.toggle(); syncSoundBtn(); };
syncSoundBtn();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && game && selected >= 0 && game.state.bonus < 0) { selected = -1; render(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
});

fillRules();
startWorker();
newGame(true);
openNewDialog();

// Отладочный доступ из консоли: arena.play('e2', 'e4')
window.arena = {
  get game() { return game; },
  play(from, to, promo) {
    const name = (sq) => FILES[sq % game.state.N] + (Math.floor(sq / game.state.N) + 1);
    const m = game.status.moves.find((x) => !x.pass && name(x.from) === from && name(x.to) === to && (!promo || x.promo === promo));
    if (m) makeMove(m);
    return !!m;
  },
  pass() { const m = game.status.moves.find((x) => x.pass); if (m) makeMove(m); return !!m; },
};
