// Пиксельные спрайты 16×16: каждая буква — пиксель. Рисуются в SVG без сглаживания.
// k — контур, a — основной цвет, b — тень, c — блик, . — пусто.

const PIECES = {
  p: [
    '................',
    '................',
    '................',
    '......kkkk......',
    '.....kccaak.....',
    '.....kcaaak.....',
    '.....kaaabk.....',
    '......kkkk......',
    '.....kcaabk.....',
    '......kcbk......',
    '......kcbk......',
    '.....kcaabk.....',
    '....kcaaaabk....',
    '...kcaaaaaabk...',
    '...kkkkkkkkkk...',
    '................',
  ],
  r: [
    '................',
    '..kkk.kkkk.kkk..',
    '..kck.kcak.kak..',
    '..kckkkcakkkak..',
    '..kcaaaaaaaabk..',
    '..kkkkkkkkkkkk..',
    '...kcaaaaaabk...',
    '...kcaaaaaabk...',
    '...kcaaaaaabk...',
    '...kcaaaaaabk...',
    '...kcaaaaaabk...',
    '..kkkkkkkkkkkk..',
    '..kcaaaaaaaabk..',
    '.kcaaaaaaaaaabk.',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
  n: [
    '................',
    '......kk.k......',
    '.....kcakak.....',
    '....kcaaaaak....',
    '...kcakaaaabk...',
    '..kcaaaaaaaabk..',
    '.kcaaaaaaaaabk..',
    '.kaaakkcaaaabk..',
    '..kkk.kcaaaabk..',
    '......kcaaaabk..',
    '.....kcaaaaabk..',
    '....kcaaaaaabk..',
    '...kkkkkkkkkkk..',
    '...kcaaaaaaabk..',
    '..kkkkkkkkkkkkk.',
    '................',
  ],
  b: [
    '................',
    '.......kk.......',
    '......kcak......',
    '.......kk.......',
    '......kcak......',
    '.....kcaaak.....',
    '....kcaakabk....',
    '....kcakaabk....',
    '....kcaaaabk....',
    '.....kcaabk.....',
    '......kkkk......',
    '.....kcaabk.....',
    '....kcaaaabk....',
    '...kcaaaaaabk...',
    '...kkkkkkkkkk...',
    '................',
  ],
  q: [
    '................',
    '.kk..kk..kk..kk.',
    '.kk..kk..kk..kk.',
    '..k..kk..kk..k..',
    '..kk.kk..kk.kk..',
    '..kcakkaakkabk..',
    '..kcaaaaaaaabk..',
    '...kcaaaaaabk...',
    '...kcaaaaaabk...',
    '....kcaaaabk....',
    '...kkkkkkkkkk...',
    '....kcaaaabk....',
    '...kcaaaaaabk...',
    '..kcaaaaaaaabk..',
    '..kkkkkkkkkkkk..',
    '................',
  ],
  k: [
    '................',
    '.......kk.......',
    '......kcak......',
    '.....kkcakk.....',
    '.....kccaak.....',
    '.....kkcakk.....',
    '......kcak......',
    '...kkkkkkkkkk...',
    '..kcaaaaaaaabk..',
    '..kcaakaakaabk..',
    '...kcaaaaaabk...',
    '...kkkkkkkkkk...',
    '...kcaaaaaabk...',
    '..kcaaaaaaaabk..',
    '..kkkkkkkkkkkk..',
    '................',
  ],
};

const PALETTE = {
  w: { k: '#05041a', a: '#ffffff', b: '#a9c8ff', c: '#ffffff' },
  b: { k: '#05041a', a: '#2a2366', b: '#160f45', c: '#9b8cff' },
};

// Иконки событий 10×10: a — цвет события, c — светлый блик, k — тёмный.
const ICONS = {
  meteor: [
    '.......cc.',
    '......ca..',
    '.....ca...',
    '..aaaa....',
    '.aaccaa...',
    'aacaaaak..',
    'aaaaaaak..',
    '.aaaaakk..',
    '..akkkk...',
    '..........',
  ],
  fog: [
    '..........',
    '....aaa...',
    '..aaccaa..',
    '.acaaaaaa.',
    'aaaaaaaaaa',
    'aaaaaaaaaa',
    '.aaaaaaaa.',
    '..........',
    'aa.aaaa.aa',
    '..........',
  ],
  night: [
    '...aaaa...',
    '..acaa....',
    '.aca......',
    '.aa.....c.',
    'aaa.......',
    'aaa.......',
    '.aa....c..',
    '.aaa......',
    '..aaaaaa..',
    '...aaaa...',
  ],
  crown: [
    'a...aa...a',
    'aa..aa..aa',
    'aaa.aa.aaa',
    'aaaaaaaaaa',
    'acaacaacaa',
    'aaaaaaaaaa',
    'kkkkkkkkkk',
    '..........',
    '..........',
    '..........',
  ],
  skull: [
    '..aaaaaa..',
    '.aaaaaaaa.',
    'aakkaakkaa',
    'aakkaakkaa',
    'aaaaaaaaaa',
    '.aaakkaaa.',
    '..aaaaaa..',
    '..akakak..',
    '..........',
    '..........',
  ],
};

function toSvg(map, colors) {
  const h = map.length, w = map[0].length;
  let rects = '';
  for (let y = 0; y < h; y++) {
    const row = map[y];
    let x = 0;
    while (x < w) {
      const ch = row[x];
      if (ch === '.' || !colors[ch]) { x++; continue; }
      let run = 1;
      while (x + run < w && row[x + run] === ch) run++;
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${colors[ch]}"/>`;
      x += run;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects}</svg>`;
}

const uri = (svg) => `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
const cache = new Map();

export function pieceSprite(type, color) {
  const key = type + color;
  if (!cache.has(key)) cache.set(key, uri(toSvg(PIECES[type], PALETTE[color])));
  return cache.get(key);
}

export function iconSprite(name, color, light = '#ffffff', dark = '#1a1c2c') {
  const key = 'i' + name + color;
  if (!cache.has(key)) cache.set(key, uri(toSvg(ICONS[name], { a: color, c: light, k: dark })));
  return cache.get(key);
}

export function iconHtml(name, color, cls = 'picon') {
  return `<i class="${cls}" style="background-image:${iconSprite(name, color)}"></i>`;
}
