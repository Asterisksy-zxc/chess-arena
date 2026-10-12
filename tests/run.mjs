// Проверка движка: perft на эталонных позициях (классика) + сценарии арены.
import {
  createGame, fromFEN, perft, applyMove, legalMoves, gameStatus, inCheck,
  directorStep, sqName, checkers,
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
  const s = createGame('arena');
  ok(s.N === 10 && s.board[5]?.t === 'k' && s.board[95]?.t === 'k', 'арена 10×10, короли на f1/f10');
  ok(legalMoves(s).length === 24, `ходов на старте арены: ${legalMoves(s).length} (16 пешечных + 6 конских + 2 ладейных)`);
  const t = Date.now();
  const p3 = perft(s, 3);
  ok(p3 > 0, `perft арены d3 = ${p3} за ${Date.now() - t}ms`);
}
{
  // Рывок: ладья b1-a1, ..., a1-a5 (клетка рывка) -> ещё ход
  let s = createGame('arena');
  s = play(s, 'b1a1', 'b10a10', 'a1a5');
  ok(s.turn === 'w' && s.bonus === 40, 'рывок: ход остаётся за белыми');
  const bonusMoves = legalMoves(s);
  ok(bonusMoves.some((m) => m.pass) && bonusMoves.every((m) => m.pass || !m.capture), 'рывок: есть пропуск, нет взятий');
  s = applyMove(s, bonusMoves.find((m) => m.pass));
  ok(s.turn === 'b' && s.bonus === -1, 'рывок: после пропуска ход чёрных');
}
{
  // Портал: конь c1 -> d3 -> ... доходим до c5
  let s = createGame('arena');
  s = play(s, 'c2c4', 'h9h7', 'c4c5');
  ok(!s.board[42] && s.board[57]?.t === 'p' && s.board[57]?.c === 'w', 'портал: пешка c5 переносится на h6');
}
{
  // Щит: f-пешка f2-f4-f5
  let s = createGame('arena');
  s = play(s, 'f2f4', 'e9e8', 'f4f5');
  ok(s.board[45]?.shieldUntil > s.ply, 'щит повешен на пешку f5');
}
{
  // Капкан: e2-e4-e5, пешка вмерзает на 2 своих хода
  let s = createGame('arena');
  s = play(s, 'e2e4', 'b9b8', 'e4e5', 'b8b7');
  ok(!legalMoves(s).some((m) => m.from === 44), 'капкан: замороженная пешка не ходит');
  s = play(s, 'b2b3', 'c9c8', 'b3b4', 'c8c7');
  ok(legalMoves(s).some((m) => m.from === 44), 'капкан: через 2 хода пешка оттаяла');
}
{
  // Событие: режиссёр объявляет и запускает событие; ночь ограничивает дальность
  let s = createGame('arena');
  s = { ...s, ply: 6, nextEventPly: 6, deck: ['night'] };
  s = directorStep(s, () => 0.5);
  ok(s.event?.type === 'night' && s.event.phase === 'announced', 'ночь объявлена');
  s = play(s, 'h1g3', 'h10g8', 'g3h5', 'g8i7');
  ok(s.night === true, 'ночь наступила через 4 полухода');
}
{
  // Метеорит: детерминированный удар по объявленным клеткам, король не страдает
  let s = createGame('arena');
  s = { ...s, ply: 6, nextEventPly: 6, deck: ['meteor'] };
  s = directorStep(s, Math.random);
  const targets = s.event.targets;
  ok(targets.length >= 2, 'метеориты нацелены: ' + targets.map((t) => sqName(s, t)).join(' '));
  for (let i = 0; i < 4; i++) {
    const ms = legalMoves(s).filter((m) => !targets.includes(m.to));
    s = applyMove(s, ms[0]);
  }
  ok(targets.every((t) => s.craters[t] !== undefined || s.board[t]), 'кратеры на месте ударов');
  ok(!inCheck(s, 'b') || checkers(s, 'b').length > 0, 'состояние после удара корректно');
}
{
  // Случайная партия: движок не ломается и не допускает взятия короля
  for (let g = 0; g < 30; g++) {
    let s = createGame('arena');
    for (let i = 0; i < 160; i++) {
      s = directorStep(s);
      const st = gameStatus(s);
      if (st.over) break;
      const m = st.moves[Math.floor(Math.random() * st.moves.length)];
      const n = applyMove(s, m);
      if (inCheck(n, s.turn)) { ok(false, 'нелегальный ход прошёл фильтр'); break; }
      if (n.board.filter((p) => p && p.t === 'k').length !== 2) { ok(false, 'король исчез'); break; }
      s = n;
    }
  }
  ok(true, '30 случайных партий на арене без ошибок');
}

console.log(failed ? `\nПровалено: ${failed}` : '\nВсе тесты пройдены');
process.exit(failed ? 1 : 0);
