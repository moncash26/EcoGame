// Genera www/ (lo que va dentro de la app) a partir del juego web en ../index.html.
// - separa el script del juego en game.js
// - fuentes locales (la app funciona sin internet)
// - empaqueta el puente nativo (src/native.js) con esbuild
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const game = join(root, '..');
const www = join(root, 'www');

rmSync(www, { recursive: true, force: true });
mkdirSync(join(www, 'fonts'), { recursive: true });

let html = readFileSync(join(game, 'index.html'), 'utf8');

// 1) script del juego -> game.js
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('No encontré el <script> del juego en index.html');
writeFileSync(join(www, 'game.js'), m[1].trim() + '\n');
html = html.replace(m[0], '<script type="module" src="native.js"></script>');

// 2) fuentes locales en lugar de Google Fonts
html = html
  .replace(/<link rel="preconnect"[^>]*>\s*/g, '')
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="fonts/fonts.css">')
  .replace(/<link rel="manifest"[^>]*>\s*/g, '');
const fonts = [
  ['unbounded', 'Unbounded', [500, 800]],
  ['figtree', 'Figtree', [400, 600, 700]],
];
let css = '';
for (const [pkg, family, weights] of fonts) {
  const dir = join(root, 'node_modules', '@fontsource', pkg, 'files');
  for (const w of weights) {
    for (const subset of ['latin', 'latin-ext']) {
      const file = `${pkg}-${subset}-${w}-normal.woff2`;
      copyFileSync(join(dir, file), join(www, 'fonts', file));
      const range = subset === 'latin'
        ? 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
        : 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
      css += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(${file}) format('woff2');unicode-range:${range}}\n`;
    }
  }
}
writeFileSync(join(www, 'fonts', 'fonts.css'), css);

// 3) íconos del juego
copyFileSync(join(game, 'icon.svg'), join(www, 'icon.svg'));
writeFileSync(join(www, 'index.html'), html);

// 4) puente nativo
await build({
  entryPoints: [join(root, 'src', 'native.js')],
  bundle: true, format: 'esm', splitting: true, outdir: www,
  target: ['es2020', 'safari15', 'chrome90'], minify: true, legalComments: 'none',
  logLevel: 'warning',
});

const files = readdirSync(www);
console.log('www listo:', files.join(', '));
