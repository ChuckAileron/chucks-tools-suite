const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsAsync = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {
  INPUT_EXTENSIONS,
  OUTPUT_FORMATS,
  isSupportedImage,
  isSupportedOutput,
  convertFile,
  previewDataUrl,
} = require('../electron/imageConverter.cjs');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'image-converter-'));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function removeDir(dir) {
  // Best-effort: libvips puede mantener handles abiertos al terminar, así que
  // se reintenta y, si al final sigue bloqueado en Windows, se deja el temp
  // para el limpiador del sistema.
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 10) return;
      await delay(50 * attempt);
    }
  }
}

test('el rango de extensiones incluye origen y salida esperadas', () => {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'avif', 'heic', 'heif']) {
    assert.ok(INPUT_EXTENSIONS.includes(ext), `falta entrada ${ext}`);
  }
  for (const ext of ['jpg', 'png', 'webp', 'gif', 'tiff', 'avif']) {
    assert.ok(OUTPUT_FORMATS[ext], `falta salida ${ext}`);
  }
});

test('isSupportedImage distingue por extensión', () => {
  assert.ok(isSupportedImage('foto.JPG'));
  assert.ok(isSupportedImage('C:\\media\\imagen.webp'));
  assert.ok(isSupportedImage('C:/media/foto.heic'));
  assert.ok(!isSupportedImage('C:\\media\\doc.pdf'));
  assert.ok(!isSupportedImage('C:\\media\\foto.bmp'));
  assert.ok(!isSupportedImage(''));
});

test('isSupportedOutput valida formatos de salida', () => {
  assert.ok(isSupportedOutput('png'));
  assert.ok(isSupportedOutput('avif'));
  assert.ok(!isSupportedOutput('bmp'));
  assert.ok(!isSupportedOutput('pngx'));
});

test('convierte PNG a cada formato de salida y la salida sigue siendo legible', async () => {
  const dir = makeTempDir();
  try {
    const source = path.join(dir, 'fuente.png');
    await sharp({
      create: { width: 10, height: 8, channels: 3, background: { r: 200, g: 120, b: 40 } },
    }).png().toFile(source);

    for (const format of Object.keys(OUTPUT_FORMATS)) {
      const output = await convertFile(source, format);
      assert.ok(fs.existsSync(output), `no existe la salida ${format}: ${output}`);
      assert.equal(path.extname(output).toLowerCase(), OUTPUT_FORMATS[format].extension);
      const meta = await sharp(output).metadata();
      assert.equal(meta.width, 10, `ancho distinto en ${format}`);
      assert.equal(meta.height, 8, `alto distinto en ${format}`);
    }
  } finally {
    await removeDir(dir);
  }
});

test('no pisa el original cuando la extensión de salida coincide', async () => {
  const dir = makeTempDir();
  try {
    const source = path.join(dir, 'mismo.png');
    await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).png().toFile(source);
    const before = fs.readFileSync(source);
    const output = await convertFile(source, 'png');
    assert.notEqual(path.resolve(output).toLowerCase(), path.resolve(source).toLowerCase());
    assert.match(path.basename(output), /-convertido\.png$/);
    assert.deepEqual(fs.readFileSync(source), before, 'el original fue modificado');
    assert.ok((await sharp(output).metadata()).format === 'png');
  } finally {
    await removeDir(dir);
  }
});

test('convierte JPEG y GIF de entrada a WebP', async () => {
  const dir = makeTempDir();
  try {
    const jpeg = path.join(dir, 'foto.jpg');
    await sharp({
      create: { width: 12, height: 7, channels: 3, background: { r: 40, g: 180, b: 90 } },
    }).jpeg().toFile(jpeg);

    const gif = path.join(dir, 'simple.gif');
    await sharp({
      create: { width: 6, height: 6, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).gif().toFile(gif);

    for (const source of [jpeg, gif]) {
      const output = await convertFile(source, 'webp');
      assert.ok(fs.existsSync(output));
      assert.equal((await sharp(output).metadata()).format, 'webp');
    }
  } finally {
    await removeDir(dir);
  }
});

test('rechaza formatos o archivos inválidos con error de conversión', async () => {
  const dir = makeTempDir();
  try {
    const fake = path.join(dir, 'no-es-imagen.txt');
    await fsAsync.writeFile(fake, 'hola');
    await assert.rejects(() => convertFile(fake, 'png'), /entrada no es soportado/i);
    await assert.rejects(() => convertFile('ejemplo.png', 'pdf'), /salida no es soportado/i);
  } finally {
    await removeDir(dir);
  }
});

test('previewDataUrl entrega un data URL webp decodificable a partir de cualquier imagen', async () => {
  const dir = makeTempDir();
  try {
    const source = path.join(dir, 'foto.heic-compatible.png');
    await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 20, g: 90, b: 160 } },
    }).png().toFile(source);

    const dataUrl = await previewDataUrl(source);
    assert.match(dataUrl, /^data:image\/webp;base64,/);
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    const meta = await sharp(buffer).metadata();
    assert.equal(meta.format, 'webp');
    assert.ok(meta.width <= 1600);
    assert.ok(meta.height <= 1600);
  } finally {
    await removeDir(dir);
  }
});

test('previewDataUrl devuelve null para archivos inexistentes o ilógicos', async () => {
  const dir = makeTempDir();
  try {
    assert.equal(await previewDataUrl(path.join(dir, 'no-existe.png')), null);
    const fake = path.join(dir, 'texto.txt');
    await fsAsync.writeFile(fake, 'hola');
    assert.equal(await previewDataUrl(fake), null);
  } finally {
    await removeDir(dir);
  }
});
