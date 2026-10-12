// Проверка движка: perft на эталонных позициях (классика) + сценарии арены.
import {
  createGame, fromFEN, perft, applyMove, legalMoves, gameStatus, inCheck,
  sqName, opp, ARENA, CELLS,
} from '../js/engine.js';

let failed = 0;
const ok = (cond, name) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failed++;
};

// Эталонные значения perft: https://www.chessprogramming.org/Perft_Results
const PERFT = [
  ['startpos', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['position3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['position4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['position5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];

for (const [name, fen, counts] of PERFT) {
  const s = fromFEN(fen);
  counts.forEach((expected, i) => {
    const t = Date.now();
    const got = perft(s, i + 1);
    ok(got === expected, `perft ${name} d${i + 1}: ${got} (ожидалось ${expected}) ${Date.now() - t}ms`);
  });
}

// Мат и пат
const findMove = (s, from, to, promo) => legalMoves(s).find((m) => sqName(s, m.from) === from && sqName(s, m.to) === to && (!promo || m.promo === promo));
const play = (s, ...moves) => moves.reduce((st, mv) => {
  const [, from, to, promo] = mv.match(/^([a-j]\d+)([a-j]\d+)([qrbn])?$/);
  const m = findMove(st, from, to, promo);
  if (!m) throw new Error('нет хода ' + mv);
  return applyMove(st, m);
}, s);

{
  const s = play(createGame('classic'), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  const st = gameStatus(s);
  ok(st.over && st.kind === 'mate' && st.winner === 'b', 'детский мат (дурацкий) определяется');
}
{
  const s = fromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  ok(gameStatus(s).kind === 'stalemate', 'пат определяется');
}
{
  const s = fromFEN('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  ok(gameStatus(s).kind === 'material', 'недостаточно материала');
}
{
  const s = play(fromFEN('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1'), 'e1c1');
  ok(s.board[2]?.t === 'k' && s.board[3]?.t === 'r', 'длинная рокировка');
}
{
  const s = play(fromFEN('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'), 'e5d6');
  ok(!s.board[4 * 8 + 3] && s.board[5 * 8 + 3]?.t === 'p', 'взятие на проходе');
}
{
  const s = play(fromFEN('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1'), 'b7b8n');
  ok(s.board[7 * 8 + 1]?.t === 'n', 'превращение пешки в коня');
}

// ---------------- Арена 8×14
const at = (s, name) => (+name.slice(1) - 1) * s.W + 'abcdefgh'.indexOf(name[0]);
const withCells = (s, cells) => ({ ...s, noCells: true, cells: Object.fromEntries(Object.entries(cells).map(([k, type]) => [at(s, k), { type }])) });
const count = (s, pred) => s.board.filter((p) => p && pred(p)).length;
const fx = (s, kind) => s.fx.find((f) => f.kind === kind);
{
  const s = createGame('arena', 7);
  ok(s.W === 8 && s.H === 14, 'арена 8×14');
  ok(s.board[4]?.t === 'k' && s.board[13 * 8 + 4]?.t === 'k', 'короли на e1/e14');
  ok(legalMoves(s).length === 20, `ходов на старте арены: ${legalMoves(s).length}`);
  const cells = Object.keys(s.cells).map(Number);
  const types = new Set(Object.values(s.cells).map((c) => c.type));
  ok(cells.length === ARENA.cellCount && types.size === Object.keys(CELLS).length, `на старте ${cells.length} скрытых клеток, все ${types.size} типов`);
  ok(cells.some((q) => !s.cells[111 - q]), 'клетки расставлены без симметрии');
  const other = createGame('arena', 8);
  ok(JSON.stringify(Object.keys(other.cells)) !== JSON.stringify(Object.keys(s.cells)), 'в разных партиях клетки в разных местах');
  ok(!legalMoves(s).some((m) => s.cells[m.to]), 'первым ходом на клетку не попасть');
  const t = Date.now();
  const p3 = perft(s, 3);
  ok(p3 > 8000, `perft арены d3 = ${p3} за ${Date.now() - t}ms`);
}
{
  // Лава: четверть пустых клеток на 3 хода
  let s = withCells(createGame('arena', 7), { d5: 'lava' });
  const before = legalMoves(play(s, 'd2d4', 'a13a12')).map((m) => m.from + '-' + m.to).join();
  const hidden = legalMoves(play({ ...s, cells: {} }, 'd2d4', 'a13a12')).map((m) => m.from + '-' + m.to).join();
  ok(before === hidden, 'список ходов не выдаёт, где спрятана клетка');
  s = play(s, 'd2d4', 'a13a12', 'd4d5');
  const lava = Object.keys(s.lava).map(Number);
  ok(s.event?.type === 'lava' && lava.length >= 15, `лава разлилась: ${lava.length} клеток`);
  ok(lava.every((q) => !s.board[q]), 'лава только на пустых клетках');
  ok(!legalMoves(s).some((m) => s.lava[m.to] !== undefined), 'на лаву нельзя ходить');
  s = { ...s, cells: {}, noCells: true };
  for (let i = 0; i < 6; i++) s = applyMove(s, legalMoves(s)[0]);
  ok(Object.keys(s.lava).length === 0 && !s.event, 'лава остыла через 3 хода каждого');
}
{
  // Зеркало: доска отражается слева направо, рокировка пропадает
  let s = play(withCells(createGame('arena', 7), { c5: 'mirror' }), 'c2c4', 'h13h12', 'c4c5');
  ok(s.board[4 * 8 + 5]?.t === 'p' && s.board[4 * 8 + 5]?.c === 'w', 'пешка c5 оказалась на f5');
  ok(s.board[3]?.t === 'k' && s.board[13 * 8 + 3]?.t === 'k', 'короли переехали на d-вертикаль');
  ok(!s.castle.wK && !s.castle.wQ && !s.castle.bK && !s.castle.bQ, 'рокировка пропала');
  ok(!s.event, 'зеркало срабатывает мгновенно');
}
{
  // Во время лавы остальные клетки тоже срабатывают; повторная лава становится прокачкой
  let s = play(withCells(createGame('arena', 7), { d5: 'lava', a11: 'mirror', h11: 'lava' }), 'd2d4', 'a13a12', 'd4d5', 'a12a11');
  ok(s.board[3]?.t === 'k' && s.event?.type === 'lava', 'зеркало сработало во время лавы и отразило её');
  const s2 = play(withCells(createGame('arena', 7), { d5: 'lava', h11: 'lava' }), 'd2d4', 'h13h12', 'd4d5', 'h12h11');
  ok(fx(s2, 'trigger')?.type === 'upgrade' && s2.board[at(s2, 'h11')]?.t === 'n', 'вторая лава во время лавы превратилась в прокачку');
}
{
  // Заморозка: три фигуры соперника (не король) вмерзают на 2 его хода
  let s = play(withCells(createGame('arena', 7), { d5: 'freeze' }), 'd2d4', 'a13a12', 'd4d5');
  const frozen = s.board.map((p, q) => (p && p.frozen ? q : -1)).filter((q) => q >= 0);
  ok(frozen.length === 3 && frozen.every((q) => s.board[q].c === 'b' && s.board[q].t !== 'k'), 'вмёрзли 3 фигуры чёрных, короля среди них нет');
  ok(!legalMoves(s).some((m) => s.board[m.from].frozen), 'замёрзшие фигуры не ходят');
  s = { ...s, cells: {}, noCells: true };
  for (let i = 0; i < 2; i++) s = applyMove(s, legalMoves(s)[0]);
  ok(s.board.some((p) => p && p.frozen) && s.turn === 'b', 'после первого хода соперника лёд ещё держится');
  s = applyMove(s, legalMoves(s)[0]);
  ok(!s.board.some((p) => p && p.frozen) && s.turn === 'w', 'лёд растаял через 2 хода соперника');
}
{
  // Турбо: нашедший ходит ещё раз
  const s = play(withCells(createGame('arena', 7), { d5: 'turbo' }), 'd2d4', 'a13a12', 'd4d5');
  ok(s.turn === 'w' && s.ep === -1, 'после турбо снова ход белых');
  const s2 = play(s, 'e2e4');
  ok(s2.turn === 'b' && s2.fullmove === s.fullmove, 'дальше очередь идёт как обычно');
  const sb = play(withCells(createGame('arena', 7), { e10: 'turbo' }), 'b1c3', 'e13e11', 'c3b1', 'e11e10');
  ok(sb.turn === 'b' && sb.fullmove === 2, 'турбо у чёрных не сбивает номер хода');
}
{
  // Прокачка: фигура на клетке повышается, id сохраняется
  const s0 = withCells(createGame('arena', 7), { d5: 'upgrade' });
  const id = s0.board[at(s0, 'd2')].id;
  const s = play(s0, 'd2d4', 'a13a12', 'd4d5');
  ok(s.board[at(s, 'd5')]?.t === 'n' && s.board[at(s, 'd5')]?.id === id, 'пешка стала конём');
}
{
  // Подкрепление: две новые пешки на своей половине
  const s = play(withCells(createGame('arena', 7), { d5: 'reinforce' }), 'd2d4', 'a13a12', 'd4d5');
  const added = fx(s, 'reinforce').squares;
  ok(count(s, (p) => p.c === 'w' && p.t === 'p') === 10 && added.length === 2, 'у белых стало 10 пешек');
  ok(added.every((q) => Math.floor(q / 8) >= 2 && Math.floor(q / 8) <= 6), 'новые пешки на своей половине');
  const ids = s.board.filter(Boolean).map((p) => p.id);
  ok(new Set(ids).size === ids.length, 'у новых фигур уникальные id');
}
{
  // Портал: фигура прыгает на половину соперника
  const s = play(withCells(createGame('arena', 7), { d5: 'portal' }), 'd2d4', 'a13a12', 'd4d5');
  const f = fx(s, 'portal');
  ok(f && !s.board[at(s, 'd5')] && s.board[f.to]?.t === 'p' && Math.floor(f.to / 8) >= 7, `пешка телепортировалась на ${sqName(s, f.to)}`);
  ok(!inCheck(s, 'w'), 'портал не подставил короля');
}
{
  // Случайные партии: движок не ломается и не допускает взятия короля
  const seen = {};
  for (let g = 0; g < 60; g++) {
    let s = createGame('arena', g * 977 + 13);
    for (let i = 0; i < 200; i++) {
      const st = gameStatus(s);
      if (st.over) break;
      const m = st.moves[Math.floor(Math.random() * st.moves.length)];
      const n = applyMove(s, m);
      if (inCheck(n, s.turn)) { ok(false, 'событие подставило короля того, кто ходил'); break; }
      if (n.board.filter((p) => p && p.t === 'k').length !== 2) { ok(false, 'король исчез'); break; }
      const ids = n.board.filter(Boolean).map((p) => p.id);
      if (new Set(ids).size !== ids.length) { ok(false, 'повторились id фигур'); break; }
      const t = fx(n, 'trigger');
      if (t) seen[t.type] = (seen[t.type] || 0) + 1;
      if (n.turn === s.turn && inCheck(n, opp(s.turn))) { ok(false, 'турбо при шахе сопернику'); break; }
      s = n;
    }
  }
  const total = Object.values(seen).reduce((a, b) => a + b, 0);
  ok(Object.keys(seen).length === Object.keys(CELLS).length, `60 случайных партий без ошибок, событий: ${total} (${Object.entries(seen).map(([k, v]) => k + ' ' + v).join(', ')})`);
}

console.log(failed ? `\nПровалено: ${failed}` : '\nВсе тесты пройдены');
process.exit(failed ? 1 : 0);
