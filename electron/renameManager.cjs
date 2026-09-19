const fs = require('node:fs/promises');
const path = require('node:path');

async function listFiles(folders) {
  const entries = [];
  for (const folder of folders) {
    const absolute = path.resolve(folder);
    const names = (await fs.readdir(absolute, { withFileTypes: true }))
      .filter((x) => x.isFile())
      .map((x) => x.name);
    for (const name of names) entries.push({ folder: absolute, name });
  }
  return entries;
}

async function renameFile({ folder, oldName, newName }) {
  if (
    !folder ||
    !oldName ||
    !newName ||
    path.basename(oldName) !== oldName ||
    path.basename(newName) !== newName
  )
    throw new Error('Nombre de archivo inválido.');
  await fs.rename(path.join(folder, oldName), path.join(folder, newName));
  return true;
}

module.exports = { listFiles, renameFile };
