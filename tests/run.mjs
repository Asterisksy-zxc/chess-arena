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

// ---------------- Арена
{
  const s = createGame('arena', 7);
  ok(s.N === 10 && s.board[5]?.t === 'k' && s.board[95]?.t === 'k', 'арена 10×10, короли на f1/f10');
  ok(legalMoves(s).length === 24, `ходов на старте арены: ${legalMoves(s).length}`);
  ok(Object.keys(s.cells).length === 6, 'на старте 6 клеток событий');
  const t = Date.now();
  const p3 = perft(s, 3);
  ok(p3 > 0, `perft арены d3 = ${p3} за ${Date.now() - t}ms`);
}
{
  // Красная клетка b5: метеориты на половину чёрных, удар через 4 полухода
  let s = play(createGame('arena', 7), 'b2b4', 'j9j8'.replace('j9j8', 'c9c8'), 'b4b5');
  ok(s.event?.type === 'meteor' && s.event.by === 'w', 'красная клетка запустила метеориты');
  ok(s.event.targets.length === 3 && s.event.targets.every((t) => Math.floor(t / 10) >= 5), 'цели на половине чёрных: ' + s.event.targets.map((t) => sqName(s, t)).join(' '));
  const again = play(createGame('arena', 7), 'b2b4', 'c9c8', 'b4b5');
  ok(JSON.stringify(again.event.targets) === JSON.stringify(s.event.targets), 'цели детерминированы зерном');
  const targets = s.event.targets;
  for (let i = 0; i < 4; i++) s = applyMove(s, legalMoves(s).find((m) => !targets.includes(m.to) && !s.cells[m.to]));
  ok(!s.event && targets.every((t) => s.craters[t] !== undefined || s.board[t]?.t === 'k'), 'метеориты упали, на их месте кратеры');
}
{
  // Синяя клетка g5: туман для чёрных
  let s = play(createGame('arena', 7), 'g2g4', 'c9c8', 'g4g5');
  ok(s.fog === 'b' && s.event?.type === 'fog', 'синяя клетка ослепила чёрных');
  s = play(s, 'c8c7', 'h2h3', 'c7c6', 'h3h4', 'b9b8');
  ok(s.fog === null && !s.event, 'туман рассеялся через 3 хода соперника');
}
{
  // Фиолетовая клетка e5: ночь, дальность ограничена
  let s = play(createGame('arena', 7), 'e2e4', 'c9c8', 'e4e5');
  ok(s.night === true, 'фиолетовая клетка включила ночь');
  ok(!legalMoves(s).some((m) => m.from === 4 && Math.abs(Math.floor(m.to / 10) - 0) > 3), 'ферзь ночью ходит не дальше 3 клеток');
  s = play(s, 'c8c7', 'h2h3');
  const busy = play(s, 'g9g7'.replace('g9g7', 'b9b8'));
  ok(busy.night === true, 'пока идёт событие, другие клетки не срабатывают');
}
{
  // Случайная партия: движок не ломается и не допускает взятия короля
  for (let g = 0; g < 40; g++) {
    let s = createGame('arena', g * 977 + 13);
    let triggered = 0;
    for (let i = 0; i < 180; i++) {
      const st = gameStatus(s);
      if (st.over) break;
      const m = st.moves[Math.floor(Math.random() * st.moves.length)];
      const n = applyMove(s, m);
      if (inCheck(n, s.turn)) { ok(false, 'нелегальный ход прошёл фильтр'); break; }
      if (n.board.filter((p) => p && p.t === 'k').length !== 2) { ok(false, 'король исчез'); break; }
      if (n.fx.some((f) => f.kind === 'trigger')) triggered++;
      s = n;
    }
  }
  ok(true, '40 случайных партий на арене без ошибок');
}

console.log(failed ? `\nПровалено: ${failed}` : '\nВсе тесты пройдены');
process.exit(failed ? 1 : 0);
