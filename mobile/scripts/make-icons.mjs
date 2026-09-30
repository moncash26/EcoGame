// Genera los PNG base (resources/) a partir de un diseño vectorial; luego @capacitor/assets crea todos los tamaños.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
mkdirSync('resources', { recursive: true });
const mark = (s = 1, cx = 512, cy = 512) => `
  <g transform="translate(${cx} ${cy}) scale(${s}) translate(-512 -512)">
    <circle cx="300" cy="700" r="92" fill="#8E9BFF" opacity=".18"/>
    <circle cx="390" cy="610" r="100" fill="#8E9BFF" opacity=".32"/>
    <circle cx="480" cy="520" r="108" fill="#8E9BFF" opacity=".55"/>
    <circle cx="600" cy="420" r="190" fill="url(#halo)"/>
    <circle cx="600" cy="420" r="112" fill="#FFC96B"/>
    <circle cx="600" cy="420" r="62" fill="#FFF3D6"/>
    <circle cx="770" cy="720" r="44" fill="#FF6FAE"/>
  </g>`;
const defs = `<defs>
  <radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#1F2447"/><stop offset="1" stop-color="#0A0C18"/></radialGradient>
  <radialGradient id="halo"><stop offset=".55" stop-color="#FFC96B" stop-opacity=".55"/><stop offset="1" stop-color="#FFC96B" stop-opacity="0"/></radialGradient>
</defs>`;
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${body}</svg>`);

await sharp(svg(1024, 1024, `<rect width="1024" height="1024" fill="url(#bg)"/>${mark(1.15, 500, 500)}`)).png().toFile('resources/icon-only.png');
await sharp(svg(1024, 1024, `${mark(0.7, 500, 500)}`)).png().toFile('resources/icon-foreground.png');
await sharp(svg(1024, 1024, `<rect width="1024" height="1024" fill="url(#bg)"/>`)).png().toFile('resources/icon-background.png');
for (const name of ['splash', 'splash-dark'])
  await sharp(svg(2732, 2732, `<rect width="2732" height="2732" fill="#0A0C18"/>${mark(0.55, 1366, 1366)}`)).png().toFile(`resources/${name}.png`);
console.log('resources listos');
