// Проверка движка: perft на эталонных позициях (классика) + сценарии арены.
import {
  createGame, fromFEN, perft, applyMove, legalMoves, gameStatus, inCheck,
  sqName,
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
const withCells = (s, cells) => ({ ...s, cells: Object.fromEntries(Object.entries(cells).map(([k, type]) => [at(s, k), { type }])) });
{
  const s = createGame('arena', 7);
  ok(s.W === 8 && s.H === 14, 'арена 8×14');
  ok(s.board[4]?.t === 'k' && s.board[13 * 8 + 4]?.t === 'k', 'короли на e1/e14');
  ok(legalMoves(s).length === 20, `ходов на старте арены: ${legalMoves(s).length}`);
  const cells = Object.keys(s.cells).map(Number);
  const types = new Set(Object.values(s.cells).map((c) => c.type));
  ok(cells.length === 6 && types.size === 2, 'на старте 6 скрытых клеток обоих типов');
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
  // Во время лавы другие клетки не срабатывают (клетки лава не заливает)
  let s = play(withCells(createGame('arena', 7), { d5: 'lava', a11: 'mirror' }), 'd2d4', 'a13a12', 'd4d5', 'a12a11');
  ok(s.cells[at(s, 'a11')]?.type === 'mirror' && s.board[4]?.t === 'k', 'пока идёт лава, другие клетки не срабатывают');
}
{
  // Случайная партия: движок не ломается и не допускает взятия короля
  let triggered = 0;
  for (let g = 0; g < 40; g++) {
    let s = createGame('arena', g * 977 + 13);
    for (let i = 0; i < 200; i++) {
      const st = gameStatus(s);
      if (st.over) break;
      const m = st.moves[Math.floor(Math.random() * st.moves.length)];
      const n = applyMove(s, m);
      if (inCheck(n, s.turn)) { ok(false, 'событие подставило короля того, кто ходил'); break; }
      if (n.board.filter((p) => p && p.t === 'k').length !== 2) { ok(false, 'король исчез'); break; }
      if (n.fx.some((f) => f.kind === 'trigger')) triggered++;
      s = n;
    }
  }
  ok(triggered > 0, `40 случайных партий на арене без ошибок (событий: ${triggered})`);
}

console.log(failed ? `\nПровалено: ${failed}` : '\nВсе тесты пройдены');
process.exit(failed ? 1 : 0);
