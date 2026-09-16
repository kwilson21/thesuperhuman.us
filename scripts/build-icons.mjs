// Regenerate the browser icons from the existing SVG brand mark.
// Run from the repository root: node scripts/build-icons.mjs
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

await sharp('public/favicon.svg').resize(180, 180).png().toFile('public/apple-touch-icon.png');
const png = await sharp('public/favicon.svg').resize(32, 32).png().toBuffer();
// ICO directory with one PNG-compressed 32-bit image.
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 32;
header[7] = 32;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile('public/favicon.ico', Buffer.concat([header, png]));
