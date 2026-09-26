const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

// Formatos que se admiten como origen (lectura). El orden define cómo se
// muestran en el selector. BMP no entra porque el libvips incluido no lo decodifica.
const INPUT_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'tif',
  'tiff',
  'avif',
  'heic',
  'heif',
];

// Formatos de salida disponibles. La clave es el código que viaja por IPC y
// mime, la extensión final del archivo convertido.
const OUTPUT_FORMATS = {
  jpg:  { label: 'JPEG', extension: '.jpg', description: 'Fotografía liviana con pérdida' },
  png:  { label: 'PNG', extension: '.png', description: 'Calidad sin pérdida y transparencia' },
  webp: { label: 'WebP', extension: '.webp', description: 'Ideal para la web, transpariencia' },
  gif:  { label: 'GIF', extension: '.gif', description: 'Animaciones y máxima compatibilidad' },
  tiff: { label: 'TIFF', extension: '.tiff', description: 'Edición e impresión sin pérdida' },
  avif: { label: 'AVIF', extension: '.avif', description: 'Máxima compresión moderna' },
};

function isSupportedImage(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase().replace(/^\./, '');
  return INPUT_EXTENSIONS.includes(ext);
}

function isSupportedOutput(format) {
  return Object.prototype.hasOwnProperty.call(OUTPUT_FORMATS, format);
}

// Convierte un archivo de imagen al formato pedido y devuelve la ruta de la
// salida (guardada en la misma carpeta que el original). Si el formato de
// salida coincide con el de entrada, se escribe como "<nombre>-convertido.<ext>"
// para no pisar el original.
async function convertFile(filePath, format) {
  if (!isSupportedImage(filePath)) throw new Error('El formato de entrada no es soportado.');
  if (!isSupportedOutput(format)) throw new Error('El formato de salida no es soportado.');

  const image = sharp(filePath, { animated: true });
  switch (format) {
    case 'jpg':
      image.jpeg({ quality: 90 });
      break;
    case 'png':
      image.png({ compressionLevel: 9 });
      break;
    case 'webp':
      image.webp({ quality: 90 });
      break;
    case 'gif':
      image.gif();
      break;
    case 'tiff':
      image.tiff();
      break;
    case 'avif':
      image.avif({ quality: 70 });
      break;
  }

  const extension = OUTPUT_FORMATS[format].extension;
  const sourceExt = path.extname(filePath);
  const dir       = path.dirname(filePath);
  const base      = path.basename(filePath, sourceExt);
  let outputPath  = path.join(dir, `${base}${extension}`);
  if (path.resolve(outputPath).toLowerCase() === path.resolve(filePath).toLowerCase()) {
    outputPath = path.join(dir, `${base}-convertido${extension}`);
  }

  await image.toFile(outputPath);
  return outputPath;
}

// Devuelve la imagen como data URL lista para mostrar en el renderer. El
// archivo se valida decodificándolo y se re-codifica a WebP (hasta 1600px en
// el lado más largo) para garantizar que cualquier formato soportado se
// muestre sin depender de los codecs del navegador. Los GIF animados y los SVG
// se pasan tal cual (formato legible por Chromium).
async function previewDataUrl(filePath, maxSide = 1600) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return null;

    const data = await fs.readFile(filePath);
    const image = sharp(data, { animated: true, failOn: 'error' });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || !meta.format) return null;

    if (meta.format === 'svg') {
      return `data:image/svg+xml;base64,${data.toString('base64')}`;
    }

    const animated = meta.format === 'gif' && meta.pages && meta.pages > 1;
    if (!animated) {
      image.rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
    }
    const buffer = animated
      ? await image.gif().toBuffer()
      : await image.webp({ quality: 90 }).toBuffer();
    return `data:${animated ? 'image/gif' : 'image/webp'};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = {
  INPUT_EXTENSIONS,
  OUTPUT_FORMATS,
  isSupportedImage,
  isSupportedOutput,
  convertFile,
  previewDataUrl,
};