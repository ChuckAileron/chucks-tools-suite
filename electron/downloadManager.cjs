const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { DownloaderHelper } = require('node-downloader-helper');
const sevenZip = require('7zip-min');
const { resolveUrl } = require('./urlResolver.cjs');
const videoProvider = require('./videoProvider.cjs');
const megaProvider = require('./megaProvider.cjs');
const teraboxProvider = require('./teraboxProvider.cjs');

function resolveSevenZa() {
  const resourcesPath = process.resourcesPath || '';
  const vendored = [
    path.join(resourcesPath, 'app.asar.unpacked', 'vendor', '7zip', '7z.exe'),
    path.join(__dirname, '..', 'vendor', '7zip', '7z.exe'),
  ];
  for (const candidate of vendored) if (fs.existsSync(candidate)) return candidate;
  const candidate = require('7zip-bin').path7za;
  const unpacked = candidate.replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpacked)) return unpacked;
  if (fs.existsSync(candidate)) return candidate;
  const fromResources = path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '7zip-bin',
    'win',
    process.arch,
    '7za.exe',
  );
  if (fs.existsSync(fromResources)) return fromResources;
  return candidate;
}
sevenZip.config({ binaryPath: resolveSevenZa() });

const PRIORITY = { urgent: 0, high: 1, medium: 2, low: 3 };
const ARCHIVE = /\.(zip|7z|rar|tar|gz|bz2|xz)$/i;
// Extensiones usadas por 7-Zip para dividir un comprimido en volúmenes.
// Al interpolarla en los detectores de abajo hay que agruparla como
// (?:...) : sin paréntesis la alternancia rompería los anclajes ^/$ y
// cualquier archivo terminado en "zip" (o que contenga "7z") haría match
// con grupos undefined.
const VOLUME_EXTENSIONS = 'rar|7z|zip';
// Detecta archivos comprimidos por partes (p. ej. "Serie.part1.rar",
// "Serie.part2.rar" o "Serie.7z.001", "Serie.7z.002"). Devuelve la clave que
// agrupa a todas las partes del mismo comprimido, o null si no es multiparte.
function archiveVolume(fileName) {
  const base = path.basename(String(fileName || ''));
  const parted = new RegExp(`^(.+?)\\.part(\\d+)\\.(${VOLUME_EXTENSIONS})$`, 'i').exec(base);
  if (parted)
    return {
      // La clave agrupa todas las partes del mismo comprimido: usa la
      // extensión (igual en todas) y no el índice, como hace el estilo
      // numerado abajo. Con el índice en la clave cada parte formaría su
      // propio grupo y la extracción se dispararía con una sola parte.
      key: `${parted[1].toLowerCase()}|${parted[3].toLowerCase()}|part`,
      first: Number(parted[2]) === 1,
      index: Number(parted[2]),
      baseName: parted[1],
    };
  const numbered = new RegExp(`^(.+?)\\.(${VOLUME_EXTENSIONS})\\.(\\d+)$`, 'i').exec(base);
  if (numbered)
    return {
      key: `${numbered[1].toLowerCase()}|${numbered[2].toLowerCase()}|num`,
      first: Number(numbered[3]) === 1,
      index: Number(numbered[3]),
      baseName: numbered[1],
    };
  return null;
}
const EXTRACTION_TIMEOUT = 10 * 60 * 1000;
// Si el error viene de una contraseña incorrecta/faltante, 7-Zip lo reporta
// en stderr (el `message` genérico solo trae el código de salida).
function extractionFailureStatus(error) {
  const detail = `${error?.stderr || ''} ${error?.message || ''}`;
  return /wrong password|contraseñ|password|data error/i.test(detail)
    ? 'password-required'
    : 'error';
}
function extractionErrorMessage(error) {
  return (error?.stderr || error?.message || '').trim() || 'No se pudo extraer el archivo.';
}
// Tamaño total y disponible del disco que contiene la ruta indicada. Se usa
// la raíz del disco para que funcione aunque la carpeta aún no exista.
function diskInfoFor(target) {
  const root = path.parse(path.resolve(target)).root;
  const drive = root.replace(/[\\/]+$/, '') || root;
  try {
    const stats = fs.statfsSync(root);
    const size = stats.bsize || 512;
    return { drive, total: stats.blocks * size, free: stats.bfree * size };
  } catch {
    // Respaldo para Windows si statfs no está disponible.
  }
  if (process.platform === 'win32') {
    try {
      const output = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `[IO.DriveInfo]::GetDrives() | Where-Object { $_.Name -eq '${root}'} | ForEach-Object { Write-Output "$($_.TotalSize) $($_.AvailableFreeSpace)" }`,
        ],
        { timeout: 15000, windowsHide: true, encoding: 'utf8' },
      );
      const [total, free] = String(output).trim().split(/\s+/).map(Number);
      if (Number.isFinite(total) && Number.isFinite(free)) return { drive, total, free };
    } catch {
      // Se devuelven ceros abajo.
    }
  }
  return { drive, total: 0, free: 0 };
}
const BROWSER_UA = 'Mozilla/5.0 Chrome/140 Safari/537.36';
const LINKS = /https?:\/\/[^\s<>"']+/gi;
const NAKED_LINKS = [
  /(?:www\.|m\.)?download\d*\.mediafire\.com\/[^\s<>"']*/gi,
  /(?:www\.|m\.)?mediafire\.com\/(?:file|folder)\/[^\s<>"']*/gi,
  /(?:www\.|docs\.)?drive\.google\.com\/[^\s<>"']*/gi,
  /(?:www\.)?mega\.(?:nz|io)\/[^\s<>"']*/gi,
];
function extractLinks(text) {
  const found = [];
  const add = (raw) => {
    let candidate = raw.replace(/[),.;]+$/, '');
    if (!candidate) return;
    if (candidate.startsWith('//')) candidate = 'https:' + candidate;
    else if (!/^https?:\/\//i.test(candidate)) candidate = 'https://' + candidate;
    if (!found.includes(candidate)) found.push(candidate);
  };
  for (const match of (text || '').matchAll(LINKS)) add(match[0]);
  for (const pattern of NAKED_LINKS)
    for (const match of (text || '').matchAll(pattern)) add(match[0]);
  return found.slice(0, 50);
}

class DownloadManager {
  constructor(dataFile, send) {
    this.dataFile = dataFile;
    this.send = send;
    this.tasks = new Map();
    this.active = new Map();
    this.starting = new Set();
    // Claves de volúmenes multiparte cuya extracción ya está en curso, para
    // que solo la parte que complete el conjunto dispare la extracción.
    this.volumeExtracting = new Set();
    this.settings = {
      defaultDirectory: '',
      concurrency: 3,
      autoExtract: true,
      clipboard: true,
      googleDriveApiKey: '',
    };
    this.load();
  }
  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      this.settings = { ...this.settings, ...data.settings };
      for (const task of data.tasks || []) {
        if (task.status === 'downloading') task.status = 'paused';
        if (task.downloaded > 0) task.startedOnce = true;
        this.tasks.set(task.id, task);
      }
    } catch {}
  }
  snapshot() {
    return { settings: this.settings, tasks: [...this.tasks.values()] };
  }
  emit() {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    fs.writeFileSync(this.dataFile, JSON.stringify(this.snapshot(), null, 2));
    this.send(this.snapshot());
  }
  sanitize(name) {
    return (
      path
        .basename(name)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/[. ]+$/, '') || `download-${Date.now()}`
    );
  }
  // Opciones de resolución disponibles para un video puntual (usado por el
  // selector de calidad de cada fila cuando el enlace es una lista de
  // YouTube, para no tener que listar una fila por resolución).
  async getVideoQualityOptions(url) {
    if (!videoProvider.isVideoLink(url)) return [];
    return videoProvider.listVideoQualityOptions(url);
  }
  async analyze(text) {
    const links = extractLinks(text);
    const batchCollection = links.length > 1 ? `Colección ${new Date().toLocaleString('es')}` : '';
    const groups = await Promise.all(
      links.map(async (raw) => {
        const originalUrl = raw.replace(/[),.;]+$/, '');
        if (videoProvider.isVideoLink(originalUrl)) {
          const isPlaylist = videoProvider.isPlaylistUrl(originalUrl);
          try {
            if (isPlaylist) {
              // Un enlace de lista de YouTube siempre debe identificar todos
              // sus videos; nunca se debe tratar como un video individual,
              // aunque la extracción falle o la lista quede vacía.
              const playlist = await videoProvider.listPlaylistVideos(originalUrl);
              if (!playlist.videos.length)
                throw new Error('La lista no tiene videos disponibles para descargar.');
              // Una lista de YouTube genera un candidato por video; el nombre
              // de la lista actúa como la colección de todos sus videos.
              return playlist.videos.map((video) => ({
                id: randomUUID(),
                originalUrl: video.url,
                url: video.url,
                name: video.title,
                host: new URL(video.url).hostname,
                online: true,
                mode: 'Playlist',
                videoUrl: video.url,
                videoFormat: 'video:best',
                collection: playlist.title,
                selected: true,
              }));
            }
            const formats = await videoProvider.listVideoFormats(originalUrl);
            if (!formats.length) throw new Error('Video sin formatos descargables.');
            return formats.map((format) => ({
              ...format,
              collection: batchCollection || format.collection,
            }));
          } catch (error) {
            return [
              {
                id: randomUUID(),
                originalUrl,
                url: originalUrl,
                name: '',
                host: new URL(originalUrl).hostname,
                online: false,
                mode: isPlaylist ? 'Playlist' : 'video',
                error: error.message,
                collection: batchCollection || (isPlaylist ? 'Lista de YouTube' : 'Video'),
                selected: false,
              },
            ];
          }
        }
        const mediafireKey = this.mediafireFolderKey(originalUrl);
        if (mediafireKey) {
          try {
            return await this.expandMediafireFolder(mediafireKey, originalUrl);
          } catch (error) {
            return [{ ...this.unsupportedFolder(originalUrl, 'MediaFire'), error: error.message }];
          }
        }
        const driveId = this.googleDriveFolderId(originalUrl);
        if (driveId) {
          try {
            return await this.expandGoogleDriveFolder(driveId, originalUrl);
          } catch (error) {
            return [
              { ...this.unsupportedFolder(originalUrl, 'Google Drive'), error: error.message },
            ];
          }
        }
        const driveFileId = this.googleDriveFileId(originalUrl);
        if (driveFileId) {
          try {
            return [await this.expandGoogleDriveFile(driveFileId, originalUrl)];
          } catch (error) {
            return [
              {
                ...this.unsupportedFolder(originalUrl, 'Google Drive'),
                name: 'Archivo de Google Drive',
                folderLink: false,
                error: error.message,
              },
            ];
          }
        }
        const fireloadKey = this.fireloadFolderKey(originalUrl);
        if (fireloadKey) {
          try {
            return await this.expandFireloadFolder(fireloadKey, originalUrl);
          } catch (error) {
            return [{ ...this.unsupportedFolder(originalUrl, 'Fireload'), error: error.message }];
          }
        }
        const megaFile = megaProvider.megaFileParts(originalUrl);
        if (megaFile) {
          try {
            return [await this.expandMegaFile(megaFile, originalUrl)];
          } catch (error) {
            const candidate = this.unsupportedFolder(originalUrl, 'MEGA');
            return [{ ...candidate, folderLink: false, error: error.message }];
          }
        }
        const megaFolder = megaProvider.megaFolderParts(originalUrl);
        if (megaFolder) {
          try {
            return await this.expandMegaFolder(megaFolder, originalUrl);
          } catch (error) {
            return [{ ...this.unsupportedFolder(originalUrl, 'MEGA'), error: error.message }];
          }
        }
        // Un enlace de MEGA sin clave (#...) no se puede descifrar: se reporta
        // con un mensaje claro en vez de intentar resolver la página como HTML.
        if (megaProvider.isMegaUrl(originalUrl))
          return [
            {
              ...this.unsupportedFolder(originalUrl, 'MEGA'),
              name: 'Enlace de MEGA',
              folderLink: false,
              error: 'A este enlace de MEGA le falta la clave de cifrado (#...).',
            },
          ];
        const teraboxShare = teraboxProvider.teraboxShareParts(originalUrl);
        if (teraboxShare) {
          try {
            return await this.expandTeraboxShare(originalUrl);
          } catch (error) {
            return [
              {
                ...this.unsupportedFolder(originalUrl, 'Terabox'),
                folderLink: false,
                error: error.message,
              },
            ];
          }
        }
        try {
          let result = await resolveUrl(originalUrl);
          if (
            result.mode === 'fireload-page' &&
            /(^|\.)fireload\.com$/i.test(new URL(result.finalUrl).hostname)
          )
            result = await resolveUrl(originalUrl);
          const parsed = new URL(result.finalUrl);
          const basename = decodeURIComponent(path.basename(parsed.pathname));
          const extension = path.extname(basename);
          const name = this.sanitize(
            result.title
              ? result.title.endsWith(extension)
                ? result.title
                : `${result.title}${extension}`
              : basename,
          );
          return [
            {
              id: randomUUID(),
              originalUrl,
              url: result.finalUrl,
              name,
              host: result.domain,
              online: (result.chain.at(-1)?.status || 0) < 400,
              mode: result.mode,
              collection: batchCollection || result.domain,
              selected: true,
            },
          ];
        } catch (error) {
          return [
            {
              id: randomUUID(),
              originalUrl,
              url: originalUrl,
              name: '',
              host: new URL(originalUrl).hostname,
              online: false,
              error: error.message,
              collection: batchCollection || 'Sin colección',
              selected: false,
            },
          ];
        }
      }),
    );
    return groups.flat();
  }
  mediafireFolderKey(value) {
    try {
      const url = new URL(value);
      if (!/(^|\.)mediafire\.com$/i.test(url.hostname) || !url.pathname.includes('/folder/'))
        return '';
      return url.hash.slice(1) || url.pathname.split('/folder/')[1]?.split('/')[0] || '';
    } catch {
      return '';
    }
  }
  fireloadFolderKey(value) {
    try {
      const url = new URL(value);
      if (!/(^|\.)fireload\.com$/i.test(url.hostname)) return '';
      return url.pathname.match(/\/folder\/([^/]+)/i)?.[1] || '';
    } catch {
      return '';
    }
  }
  googleDriveFolderId(value) {
    try {
      const url = new URL(value);
      if (!/(^|\.)drive\.google\.com$/i.test(url.hostname)) return '';
      return url.pathname.match(/\/(?:drive\/)?folders\/([^/?]+)/i)?.[1] || '';
    } catch {
      return '';
    }
  }
  googleDriveFileId(value) {
    try {
      const url = new URL(value);
      if (!/(^|\.)drive\.google\.com$/i.test(url.hostname)) return '';
      return url.pathname.match(/\/file\/d\/([^/?]+)/i)?.[1] || url.searchParams.get('id') || '';
    } catch {
      return '';
    }
  }
  unsupportedFolder(originalUrl, provider) {
    return {
      id: randomUUID(),
      originalUrl,
      url: originalUrl,
      name: `${provider} folder`,
      host: provider,
      collection: `${provider} · carpeta`,
      online: false,
      error: `${provider} no permitió leer esta carpeta (¿está compartida públicamente?).`,
      selected: false,
      folderLink: true,
    };
  }
  async expandMediafireFolder(folderKey, originalUrl) {
    const infoUrl = `https://www.mediafire.com/api/1.5/folder/get_info.php?folder_key=${encodeURIComponent(folderKey)}&response_format=json`;
    const info = await fetch(infoUrl, { signal: AbortSignal.timeout(15000) }).then((response) =>
      response.json(),
    );
    const rootName = info.response?.folder_info?.name || `MediaFire ${folderKey}`;
    const results = [];
    const walk = async (key, trail) => {
      if (results.length >= 500) return;
      const getContent = (type) =>
        fetch(
          `https://www.mediafire.com/api/1.5/folder/get_content.php?folder_key=${encodeURIComponent(key)}&content_type=${type}&chunk_size=1000&response_format=json`,
          { signal: AbortSignal.timeout(15000) },
        ).then((response) => response.json());
      const [filesData, foldersData] = await Promise.all([
        getContent('files'),
        getContent('folders'),
      ]);
      const files = filesData.response?.folder_content?.files;
      const folders = foldersData.response?.folder_content?.folders;
      if (!files && !folders)
        throw new Error(
          filesData.response?.message ||
            foldersData.response?.message ||
            'MediaFire no permitió leer la carpeta.',
        );
      for (const file of files || []) {
        const pageUrl = file.links?.normal_download;
        if (!pageUrl) continue;
        try {
          const resolved = await resolveUrl(pageUrl);
          results.push({
            id: randomUUID(),
            originalUrl: pageUrl,
            url: resolved.finalUrl,
            name: this.sanitize(file.filename),
            host: 'mediafire.com',
            online: true,
            mode: 'mediafire-folder',
            collection: [rootName, ...trail].join(' / '),
            selected: true,
          });
        } catch (error) {
          results.push({
            id: randomUUID(),
            originalUrl: pageUrl,
            url: pageUrl,
            name: this.sanitize(file.filename),
            host: 'mediafire.com',
            online: false,
            error: error.message,
            collection: [rootName, ...trail].join(' / '),
            selected: false,
          });
        }
      }
      for (const folder of folders || []) await walk(folder.folderkey, [...trail, folder.name]);
    };
    await walk(folderKey, []);
    if (!results.length) return [this.unsupportedFolder(originalUrl, 'MediaFire')];
    return results;
  }
  async fireloadListing(folderKey, pageStart, perPage) {
    const response = await fetch(
      'https://www.fireload.com/ajax/_view_folder_v2_file_listing.ajax.php',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-requested-with': 'XMLHttpRequest',
        },
        body: new URLSearchParams({
          url_hash: folderKey,
          nodeId: '-1',
          pageStart: String(pageStart),
          perPage: String(perPage),
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw new Error(`Fireload respondió ${response.status}.`);
    return response.text();
  }
  async expandFireloadFolder(folderKey, originalUrl) {
    const results = [];
    let rootName = '';
    let pageStart = 0;
    let total = Infinity;
    while (pageStart < total) {
      const html = await this.fireloadListing(folderKey, pageStart, 1000);
      if (!html.includes('dtfullurl')) {
        if (!results.length)
          throw new Error('La carpeta no permitió leer su contenido o está vacía.');
        break;
      }
      const totalMatch = html.match(/id="rspTotalResults" value="(\d+)"/);
      if (total === Infinity && totalMatch) total = Number(totalMatch[1]);
      if (!rootName) {
        const titleMatch = html.match(/id="rspPageTitle" value="([^"]*)"/);
        if (titleMatch?.[1]) rootName = this.sanitize(titleMatch[1]);
      }
      const fileUrls = [...html.matchAll(/dtfullurl="([^"]+)"/g)].map((match) =>
        match[1].replaceAll('&amp;', '&'),
      );
      const names = [...html.matchAll(/dtfilename="([^"]+)"/g)].map((match) => match[1]);
      if (!fileUrls.length) break;
      const fallbackName =
        rootName ||
        this.sanitize(originalUrl.replace(/\/$/, '').split('/').findLast?.() || 'Fireload');
      for (let index = 0; index < fileUrls.length; index += 1) {
        const filePage = fileUrls[index];
        const name = this.sanitize(names[index] || path.basename(new URL(filePage).pathname));
        let resolved;
        try {
          resolved = await resolveUrl(filePage);
          if (resolved.mode === 'fireload-page') resolved = await resolveUrl(filePage);
        } catch (error) {
          results.push({
            id: randomUUID(),
            originalUrl: filePage,
            url: filePage,
            name,
            host: 'fireload.com',
            online: false,
            error: error.message,
            collection: fallbackName,
            selected: false,
          });
          continue;
        }
        if (resolved.mode === 'fireload-page') {
          results.push({
            id: randomUUID(),
            originalUrl: filePage,
            url: filePage,
            name,
            host: 'fireload.com',
            online: false,
            error: 'Fireload no entregó el enlace directo del archivo.',
            collection: fallbackName,
            selected: false,
          });
          continue;
        }
        results.push({
          id: randomUUID(),
          originalUrl: filePage,
          url: resolved.finalUrl,
          name,
          host: 'fireload.com',
          online: true,
          mode: 'fireload-folder',
          collection: fallbackName,
          selected: true,
        });
      }
      pageStart += fileUrls.length;
      if (fileUrls.length < 1000) break;
    }
    if (!results.length) return [this.unsupportedFolder(originalUrl, 'Fireload')];
    return results;
  }
  async expandMegaFile(megaFile, originalUrl) {
    const info = await megaProvider.resolveMegaFile(megaFile.handle, megaFile.key);
    return {
      id: randomUUID(),
      originalUrl,
      url: info.url,
      name: this.sanitize(info.name),
      host: 'mega.nz',
      online: true,
      mode: 'mega-file',
      collection: 'MEGA',
      selected: true,
    };
  }
  async expandMegaFolder(megaFolder, originalUrl) {
    const tree = await megaProvider.resolveMegaFolderTree(megaFolder.handle, megaFolder.key);
    const byParent = new Map();
    for (const entry of tree.entries) {
      const siblings = byParent.get(entry.p) || [];
      siblings.push(entry);
      byParent.set(entry.p, siblings);
    }
    const results = [];
    const push = (entry, trail) => {
      // Descargar un archivo de una carpeta exige el contexto de la carpeta
      // (parámetro "n" de la API MEGA), así que el enlace canónico incluye el
      // handle+clave de la carpeta además del handle del archivo; con eso
      // basta para volver a resolverlo (y su clave) en cada reanudación.
      const url = `https://mega.nz/folder/${megaFolder.handle}#${megaFolder.key}/file/${entry.h}`;
      results.push({
        id: randomUUID(),
        originalUrl: url,
        url,
        name: this.sanitize(entry.name),
        host: 'mega.nz',
        online: true,
        mode: 'mega-folder',
        collection: [tree.name, ...trail].filter(Boolean).join(' / ') || 'MEGA',
        selected: true,
      });
    };
    const walk = async (parentId, trail) => {
      for (const entry of byParent.get(parentId) || []) {
        if (results.length >= 500) return;
        if (entry.t === 'folder') {
          // El nodo que coincide con el handle de la carpeta abierta ya está
          // representado por "tree.name" (el nombre inicial de la colección);
          // si además se agregara su propio nombre al trail quedaría
          // duplicado ("Fotos / Fotos"), así que solo se agregan los nombres
          // de las subcarpetas reales debajo de ella.
          const nextTrail = entry.h === megaFolder.handle ? trail : [...trail, entry.name];
          await walk(entry.h, nextTrail);
          continue;
        }
        push(entry, trail);
      }
    };
    // El nivel superior queda con padre '' (ver resolveMegaFolderTree): MEGA no
    // siempre expone un nodo para el handle público de la carpeta.
    await walk('', []);
    if (!results.length)
      return [
        {
          ...this.unsupportedFolder(originalUrl, 'MEGA'),
          error: 'La carpeta está vacía, no es pública o no tiene archivos descifrables.',
        },
      ];
    return results;
  }
  async expandTeraboxShare(originalUrl) {
    const share = await teraboxProvider.expandTeraboxShare(originalUrl);
    const collection = this.sanitize(share.name) || 'Terabox';
    return share.files.map((file) => ({
      id: randomUUID(),
      originalUrl,
      url:
        file.dlink ||
        teraboxProvider.teraboxDownloadUrl({
          host: share.host,
          surl: share.surl,
          uk: share.uk,
          shareid: share.shareid,
          fsId: file.fs_id,
        }),
      name: this.sanitize(file.name),
      host: 'terabox.com',
      online: true,
      mode: file.fromFolder ? 'terabox-folder' : 'terabox-file',
      collection,
      selected: true,
      providerData: {
        terabox: {
          host: share.host,
          surl: share.surl,
          uk: share.uk,
          shareid: share.shareid,
          fsId: file.fs_id,
        },
      },
    }));
  }
  async googleDriveRequest(pathname, parameters = {}) {
    if (!this.settings.googleDriveApiKey)
      throw new Error('Configura una API key de Google Drive para enumerar carpetas públicas.');
    const url = new URL(`https://www.googleapis.com/drive/v3/${pathname}`);
    url.searchParams.set('key', this.settings.googleDriveApiKey);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error?.message || `Google Drive respondió ${response.status}.`);
    return data;
  }
  googleExportInfo(mimeType) {
    return {
      'application/vnd.google-apps.document': {
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: '.docx',
      },
      'application/vnd.google-apps.spreadsheet': {
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: '.xlsx',
      },
      'application/vnd.google-apps.presentation': {
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extension: '.pptx',
      },
      'application/vnd.google-apps.drawing': { mime: 'image/png', extension: '.png' },
    }[mimeType];
  }
  googleDownloadUrl(file) {
    const exportInfo = this.googleExportInfo(file.mimeType);
    const endpoint = exportInfo ? `files/${file.id}/export` : `files/${file.id}`;
    const url = new URL(`https://www.googleapis.com/drive/v3/${endpoint}`);
    url.searchParams.set('key', this.settings.googleDriveApiKey);
    if (exportInfo) url.searchParams.set('mimeType', exportInfo.mime);
    else url.searchParams.set('alt', 'media');
    return { url: url.href, extension: exportInfo?.extension || '' };
  }
  // Enlace de descarga directo de un archivo público de Drive sin API key. El
  // flujo imita a gdown: la URL "uc" redirige a drive.usercontent.google.com o
  // devuelve una página de aviso con un formulario del que se sacan los
  // parámetros confirm/uuid; los archivos grandes cerrados por cuota anónima
  // devuelven una página HTML de error que se detecta aquí para no descargar
  // el HTML como si fuera el archivo.
  // Acumula las cookies Set-Cookie de una respuesta (la primera ocurrencia de
  // cada nombre gana, para no sobrescribir la download_warning_<id> con la de
  // una página posterior) y las devuelve como encabezado válido.
  driveCookieHeader(cookieJar) {
    return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  // Cookie de confirmación (download_warning_<id>) que Google fija al mostrar
  // el aviso de escaneo de archivos grandes; es la única que el descargador
  // final debe reenviar. Las demás (NID, etc.) solo acompañan durante la
  // resolución y no se exponen en el encabezado final.
  driveDownloadCookie(cookieJar) {
    return [...cookieJar.entries()]
      .filter(([name]) => name.startsWith('download_warning'))
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
  collectDriveCookies(response, cookieJar) {
    for (const raw of response.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!cookieJar.has(name)) cookieJar.set(name, value);
    }
  }
  // Analiza la página de aviso de escaneo de archivos pesados que Google
  // devuelve como HTML en vez del contenido. Devuelve undefined si la página no
  // es de aviso; si lo es, la URL de descarga definitiva:
  //   - Flujo actual: se arma desde el `action` del formulario
  //     (#download-form) con sus campos ocultos confirm/uuid, apuntando a
  //     drive.usercontent.google.com. Al descargar se debe reenviar la cookie
  //     download_warning_<id> que esta página fijó.
  //   - Flujo clásico (form a la propia "uc" sin uuid): devuelve
  //     { legacy: true, url } con la "uc" ya confirmada, que hay que volver a
  //     pedir para que redirija al archivo definitivo.
  parseDriveConfirmation(html, pageUrl, fileId) {
    const form = /<form[^>]*id="download-form"[\s\S]*?<\/form>/i.exec(html)?.[0];
    if (!form) return undefined;
    const fields = new Map();
    for (const input of form.matchAll(/<(?:input|button)[^>]*>/gi)) {
      const tag = input[0];
      const name = /(?:name|data-name)=["']([^"']+)["']/i.exec(tag)?.[1];
      if (name && !fields.has(name)) {
        const value = /value=(["'])(.*?)\1/i.exec(tag)?.[2] ?? '';
        fields.set(name, value);
      }
    }
    const confirm = fields.get('confirm') || '';
    if (!confirm) return undefined;
    const uuid = fields.get('uuid') || '';
    const id = fields.get('id') || fileId;
    const action = /<form[^>]*\baction=(["'])(.*?)\1/i.exec(form)?.[2] || '';
    if (uuid || /usercontent\.google\.com\/download/i.test(action)) {
      const base = action
        ? new URL(action, pageUrl).href
        : 'https://drive.usercontent.google.com/download';
      const params = new URLSearchParams();
      params.set('id', id);
      params.set('export', fields.get('export') || 'download');
      params.set('confirm', confirm);
      if (uuid) params.set('uuid', uuid);
      return { url: `${base}?${params.toString()}` };
    }
    return {
      legacy: true,
      url: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}&confirm=${encodeURIComponent(confirm)}`,
    };
  }
  async resolveGoogleDriveUrl(fileId) {
    const cookieJar = new Map();
    const ucBase = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
    let url = ucBase;
    for (let step = 0; step < 8; step += 1) {
      const headers = { 'User-Agent': BROWSER_UA };
      // Las cookies ya vistas (p. ej. download_warning_<id>) acompañan los
      // pasos siguientes de la resolución, como haría una sesión real.
      const cookie = this.driveCookieHeader(cookieJar);
      if (cookie) headers.Cookie = cookie;
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        headers,
      });
      this.collectDriveCookies(response, cookieJar);
      const type = String(response.headers.get('content-type') || '').toLowerCase();
      const location = response.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        // Archivo pequeño: uc redirige a la URL definitiva de descarga.
        url = new URL(location, url).href;
        continue;
      }
      if (type && !type.startsWith('text/html'))
        return { url, cookie: this.driveDownloadCookie(cookieJar) };
      const html = await response.text();
      // Página de aviso ("no se puede escanear el archivo", común en archivos
      // pesados): el formulario de confirmación trae la URL final y la página
      // fija la cookie de confirmación que algunos archivos grandes exigen al
      // descargar. En el flujo clásico se re-pide la "uc" con el token para
      // seguir la redirección.
      const confirmation = this.parseDriveConfirmation(html, url, fileId);
      if (confirmation) {
        if (confirmation.legacy) {
          url = confirmation.url;
          continue;
        }
        return {
          url: confirmation.url,
          cookie: this.driveDownloadCookie(cookieJar),
        };
      }
      if (/quota|too many user/i.test(html))
        return {
          error:
            'Google Drive está momentáneamente saturado (demasiados usuarios descargando este archivo). Espera un rato y reintenta; el límite puede tardar hasta 24 h en liberarse.',
        };
      if (/we[’'‘]re sorry|no longer|not found|access denied|permission/i.test(html))
        return { error: 'Google Drive no permite descargar este archivo.' };
      return { url, cookie: this.driveDownloadCookie(cookieJar) };
    }
    return { url, cookie: this.driveDownloadCookie(cookieJar) };
  }
  // Nombre de un archivo individual de Drive sin API key: se lee del <title>
  // de la página de vista del archivo ("Nombre.ext - Google Drive").
  async googleDriveFileName(fileId) {
    const response = await fetch(
      `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`,
      { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': BROWSER_UA } },
    );
    if (!response.ok) throw new Error('Google Drive no respondió la página del archivo.');
    const html = await response.text();
    const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '';
    return title.replace(/\s*-\s*Google Drive\s*$/i, '').trim();
  }
  // Vista embebida pública de una carpeta (sin API key): listado HTML con el
  // nombre de la carpeta y una entrada por archivo/subcarpeta.
  async googleDriveEmbeddedView(folderId) {
    const response = await fetch(
      `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`,
      { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': BROWSER_UA } },
    );
    if (!response.ok) throw new Error(`Google Drive respondió ${response.status}.`);
    const html = await response.text();
    const name =
      /<title>([\s\S]*?)<\/title>/i
        .exec(html)?.[1]
        ?.replace(/\s*-\s*Google Drive\s*$/i, '')
        .trim() || `Carpeta ${folderId}`;
    const entries = [];
    for (const raw of html.split(/<div class="flip-entry" id="entry-/i).slice(1)) {
      const block = raw.slice(
        0,
        raw.indexOf('class="flip-entry"') > 0 ? raw.indexOf('class="flip-entry"') : raw.length,
      );
      const title = /class="flip-entry-title[^>]*">([\s\S]*?)<\/div>/.exec(block)?.[1];
      if (!title) continue;
      const fileId = /\/file\/d\/([^/"?]+)/.exec(block)?.[1] || '';
      const folderId = /\/drive\/folders\/([^/"?]+)/.exec(block)?.[1] || '';
      const icon = /class="flip-entry-list-icon"><img src="([^"]*)"/.exec(block)?.[1] || '';
      entries.push({
        kind: folderId ? 'folder' : 'file',
        id: folderId || fileId,
        name: title.replaceAll('&amp;', '&').trim(),
        mime: /\/type\/([^"\s]+)/.exec(icon)?.[1] || '',
      });
    }
    return { name, entries };
  }
  // Indica si una tarea descarga desde Google Drive (host o URL de Drive).
  isGoogleDriveTask(task) {
    return (
      task.host === 'drive.google.com' ||
      /googleapis\.com\/drive|usercontent\.google\.com\/download/i.test(task.url || '')
    );
  }
  // Analiza el archivo descargado en busca de páginas HTML de error de Google
  // (cuota, aviso de escaneo, etc.) descargadas en lugar del archivo real.
  // Devuelve '' si el archivo parece legítimo, o un mensaje de error en español.
  googleDriveErrorInFile(filePath) {
    try {
      const stats = fs.statSync(filePath);
      // Un archivo real grande nunca va a ser una página de error (pocos KB).
      if (!stats.isFile() || stats.size > 1024 * 1024) return '';
      const head = fs.readFileSync(filePath, 'utf8');
      if (!/<html|<!doctype/i.test(head)) return '';
      if (
        /quota exceeded|too many users have viewed|too many users are currently viewing/i.test(head)
      )
        return 'Google Drive: cuota temporalmente superada (demasiados usuarios descargando). Reintenta más tarde; puede tardar hasta 24 h.';
      if (/virus scan|can't scan this file|too large for google to scan/i.test(head))
        return 'Google Drive devolvió un aviso de escaneo en vez del archivo. Reintenta más tarde.';
      return 'Google Drive no entregó el archivo (respuesta HTML en vez del contenido).';
    } catch {
      return '';
    }
  }
  async expandGoogleDriveFile(fileId, originalUrl) {
    if (this.settings.googleDriveApiKey) {
      let apiError;
      try {
        return await this.expandGoogleDriveFileApi(fileId, originalUrl);
      } catch (error) {
        apiError = error;
        // Un enlace de archivo que en realidad es una carpeta se reporta tal cual.
        if (/carpeta, no a un archivo/.test(error.message)) throw error;
      }
      try {
        return await this.expandGoogleDriveFileKeyless(fileId, originalUrl);
      } catch {
        throw apiError;
      }
    }
    return this.expandGoogleDriveFileKeyless(fileId, originalUrl);
  }
  async expandGoogleDriveFileApi(fileId, originalUrl) {
    const file = await this.googleDriveRequest(`files/${encodeURIComponent(fileId)}`, {
      fields: 'id,name,mimeType,size',
    });
    if (file.mimeType === 'application/vnd.google-apps.folder')
      throw new Error('El enlace corresponde a una carpeta, no a un archivo.');
    const download = this.googleDownloadUrl(file);
    return {
      id: randomUUID(),
      originalUrl,
      url: download.url,
      name: this.sanitize(file.name + download.extension),
      host: 'drive.google.com',
      online: true,
      mode: 'google-drive-file',
      collection: 'Google Drive',
      selected: true,
    };
  }
  async expandGoogleDriveFileKeyless(fileId, originalUrl) {
    const download = await this.resolveGoogleDriveUrl(fileId);
    if (download.error)
      throw new Error('Google Drive no entregó el enlace de descarga: ' + download.error);
    let name;
    try {
      name = await this.googleDriveFileName(fileId);
    } catch {
      name = '';
    }
    return {
      id: randomUUID(),
      originalUrl,
      url: download.url,
      name: this.sanitize(name || 'Archivo de Google Drive'),
      host: 'drive.google.com',
      online: true,
      mode: 'google-drive-file',
      collection: 'Google Drive',
      selected: true,
    };
  }
  async expandGoogleDriveFolder(folderId, originalUrl) {
    if (this.settings.googleDriveApiKey) {
      let apiError;
      try {
        return await this.expandGoogleDriveFolderApi(folderId, originalUrl);
      } catch (error) {
        apiError = error;
        // Algunas carpetas compartidas "por enlace" no se dejan enumerar con la
        // API pero sí por la vista web; se cae a la enumeración sin clave.
      }
      try {
        return await this.expandGoogleDriveFolderKeyless(folderId, originalUrl);
      } catch {
        throw apiError;
      }
    }
    return this.expandGoogleDriveFolderKeyless(folderId, originalUrl);
  }
  async expandGoogleDriveFolderApi(folderId, originalUrl) {
    const info = await this.googleDriveRequest(`files/${encodeURIComponent(folderId)}`, {
      fields: 'id,name,mimeType',
    });
    const results = [];
    const walk = async (id, trail) => {
      let pageToken = '';
      do {
        const data = await this.googleDriveRequest('files', {
          q: `'${id}' in parents and trashed = false`,
          fields: 'nextPageToken,files(id,name,mimeType,size)',
          pageSize: '1000',
          ...(pageToken ? { pageToken } : {}),
        });
        for (const file of data.files || []) {
          if (results.length >= 500) return;
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            await walk(file.id, [...trail, file.name]);
            continue;
          }
          const exportInfo = this.googleExportInfo(file.mimeType);
          if (file.mimeType.startsWith('application/vnd.google-apps.') && !exportInfo) continue;
          const download = this.googleDownloadUrl(file);
          results.push({
            id: randomUUID(),
            originalUrl: `https://drive.google.com/open?id=${file.id}`,
            url: download.url,
            name: this.sanitize(file.name + download.extension),
            host: 'drive.google.com',
            online: true,
            mode: 'google-drive-folder',
            collection: [info.name, ...trail].join(' / '),
            selected: true,
          });
        }
        pageToken = data.nextPageToken || '';
      } while (pageToken && results.length < 500);
    };
    await walk(folderId, []);
    if (!results.length)
      return [
        {
          ...this.unsupportedFolder(originalUrl, 'Google Drive'),
          error: 'La carpeta está vacía, no es pública o no contiene archivos exportables.',
        },
      ];
    return results;
  }
  async expandGoogleDriveFolderKeyless(folderId, originalUrl) {
    const root = await this.googleDriveEmbeddedView(folderId);
    const results = [];
    const push = (id, name, trail) =>
      results.push({
        id: randomUUID(),
        originalUrl: `https://drive.google.com/file/d/${id}/view`,
        url: `https://drive.google.com/uc?export=download&id=${id}`,
        name: this.sanitize(name),
        host: 'drive.google.com',
        online: true,
        mode: 'google-drive-folder',
        collection: [root.name, ...trail].filter(Boolean).join(' / '),
        selected: true,
      });
    const walk = async (id, trail) => {
      if (results.length >= 500) return;
      const { entries } = await this.googleDriveEmbeddedView(id);
      for (const entry of entries) {
        if (results.length >= 500) return;
        if (entry.kind === 'folder') {
          await walk(entry.id, [...trail, entry.name]);
          continue;
        }
        // Los tipos de Google (docs, sheets, etc.) no se exportan sin API key.
        if (/application\/vnd\.google-apps\./i.test(entry.mime)) continue;
        push(entry.id, entry.name, trail);
      }
    };
    for (const entry of root.entries) {
      if (results.length >= 500) break;
      if (entry.kind === 'folder') {
        await walk(entry.id, [entry.name]);
        continue;
      }
      if (/application\/vnd\.google-apps\./i.test(entry.mime)) continue;
      push(entry.id, entry.name, []);
    }
    if (!results.length)
      return [
        {
          ...this.unsupportedFolder(originalUrl, 'Google Drive'),
          error: 'La carpeta está vacía, no es pública o no contiene archivos descargables.',
        },
      ];
    return results;
  }
  add(items) {
    for (const item of items) {
      if (!item.destination) throw new Error('Selecciona una carpeta de descarga.');
      const task = {
        id: randomUUID(),
        originalUrl: item.originalUrl,
        url: item.url,
        name: this.sanitize(item.name),
        destination: path.resolve(item.destination),
        priority: item.priority || 'medium',
        password: item.password || '',
        extract: item.extract !== false,
        deleteArchive: item.deleteArchive !== false,
        host: item.host,
        collection: item.collection || item.host || 'Sin colección',
        videoUrl: item.videoUrl || '',
        videoFormat: item.videoFormat || '',
        providerData: item.providerData || undefined,
        status: 'pending',
        progress: 0,
        speed: 0,
        downloaded: 0,
        total: 0,
        createdAt: Date.now(),
      };
      this.tasks.set(task.id, task);
    }
    this.emit();
    this.process();
  }
  update(id, changes) {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (this.active.has(id)) {
      // La contraseña (y el nombre) pueden cambiarse mientras la tarea está
      // activa: la extracción ocurre después de la descarga y lee task.password.
      const safe = {};
      if (typeof changes.password === 'string') safe.password = changes.password;
      if (changes.name) safe.name = this.sanitize(changes.name);
      if (!Object.keys(safe).length) return false;
      Object.assign(task, safe);
      this.emit();
      return true;
    }
    if (changes.name) changes.name = this.sanitize(changes.name);
    Object.assign(task, changes);
    this.emit();
    return true;
  }
  applyControl(task, action) {
    const downloader = this.active.get(task.id);
    if (action === 'pause') {
      if (task.status !== 'downloading') return false;
      if (downloader) {
        // Se borra de "active" ANTES de detener el descargador: así el cupo
        // de concurrencia se libera de inmediato (permitiendo que otra tarea
        // pendiente avance) y, si el descargador emite luego un evento
        // asíncrono de pausa/detención, el guard de release()/fail() lo
        // ignora en vez de pisar el estado "paused" que se fija abajo.
        // node-downloader-helper's pause() no interrumpe la conexión de
        // forma confiable (la descarga puede seguir en curso en segundo
        // plano); stop() sí la corta, y como la tarea usa
        // resumeIfFileExists/resumeOnIncomplete, "Reanudar" retoma desde lo
        // ya descargado sin perder progreso.
        this.active.delete(task.id);
        downloader.stop();
      }
      task.status = 'paused';
    } else if (action === 'resume') {
      if (!['paused', 'stopped', 'error'].includes(task.status)) return false;
      task.status = 'pending';
      task.error = '';
    } else if (action === 'stop') {
      if (!['downloading', 'paused', 'pending'].includes(task.status)) return false;
      if (downloader) {
        downloader.stop();
        this.active.delete(task.id);
      }
      task.status = 'stopped';
    } else if (action === 'remove') {
      // Se permite borrar en cualquier estado, incluido "extracting": si el
      // proceso de 7-Zip quedó colgado (p. ej. esperando una contraseña por
      // stdin), el usuario no debe quedar bloqueado sin poder limpiar la fila.
      if (downloader) {
        downloader.stop();
        this.active.delete(task.id);
      }
      this.tasks.delete(task.id);
    } else return false;
    return true;
  }
  control(id, action) {
    const task = this.tasks.get(id);
    if (!task) return false;
    const applied = this.applyControl(task, action);
    if (applied) {
      this.emit();
      this.process();
    }
    return applied;
  }
  controlMany(ids, action) {
    let applied = false;
    for (const id of ids) {
      const task = this.tasks.get(id);
      if (task && this.applyControl(task, action)) applied = true;
    }
    if (applied) {
      this.emit();
      this.process();
    }
    return applied;
  }
  clearCompleted() {
    for (const [id, task] of this.tasks) if (task.status === 'completed') this.tasks.delete(id);
    this.emit();
  }
  diskInfo(directory) {
    return diskInfoFor(directory || (process.platform === 'win32' ? 'C:\\' : '/'));
  }
  async recover() {
    for (const task of [...this.tasks.values()]) {
      if (task.status !== 'extracting' || !task.filePath) continue;
      if (!fs.existsSync(task.filePath)) {
        task.status = 'error';
        task.error = 'El archivo descargado ya no existe.';
        this.emit();
        continue;
      }
      try {
        await this.extract(task);
        this.removeArchive(task);
        task.status = 'completed';
        task.error = '';
      } catch (error) {
        task.status = extractionFailureStatus(error);
        task.error = extractionErrorMessage(error);
      }
      this.emit();
    }
  }
  setSettings(settings) {
    this.settings = {
      ...this.settings,
      ...settings,
      concurrency: Math.max(1, Math.min(8, Number(settings.concurrency) || 3)),
    };
    this.emit();
    this.process();
  }
  process() {
    while (this.active.size + this.starting.size < this.settings.concurrency) {
      const task = [...this.tasks.values()]
        .filter((item) => item.status === 'pending' && !this.starting.has(item.id))
        .sort(
          (a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.createdAt - b.createdAt,
        )[0];
      if (!task) break;
      this.starting.add(task.id);
      this.start(task).finally(() => {
        this.starting.delete(task.id);
        // Los inicios que terminan sin lanzar un descargador (por ejemplo un
        // refresco de Drive bloqueado por cuota) necesitan re-trigger de la
        // cola para no dejar pendientes atascados.
        this.process();
      });
    }
  }
  async start(task) {
    if (task.videoFormat) {
      this.startVideo(task);
      return;
    }
    // Los enlaces directos (MediaFire, etc.) expiran; al reanudar una tarea
    // ya iniciada previamente, se vuelve a resolver antes de reintentar. Las
    // URLs de Google Drive sin API key vencen y además la "uc" redirige, así
    // que se resuelven frescas en cada inicio; las URLs firmadas con API key
    // (googleapis.com) no necesitan refresco. MEGA y TeraBox usan descargadores
    // propios o direcciones siempre frescas según el caso.
    if (task.originalUrl) {
      // MEGA: el archivo viaja cifrado y el enlace directo expira, así que se
      // vuelve a resolver (datos + claves) en cada inicio y se descifra al bajar.
      const megaFile = megaProvider.megaFileParts(task.originalUrl);
      if (megaFile) {
        // Importante: hay que ESPERAR a que termine (no solo lanzarlo), porque
        // "start()" no marca la tarea como "downloading" hasta que resuelve la
        // API de MEGA. Si "start()" resolviera antes, process() volvería a
        // recoger esta misma tarea (sigue "pending") en el siguiente tick y
        // lanzaría descargas duplicadas en bucle.
        return this.startMegaFile(task, megaFile);
      }
      const megaFolderFile = megaProvider.megaFolderFileParts(task.originalUrl);
      if (megaFolderFile) {
        return this.startMegaFolderFile(task, megaFolderFile);
      }
      const driveFileId = this.googleDriveFileId(task.originalUrl);
      if (driveFileId) {
        if (!/googleapis\.com\/drive/i.test(task.url)) {
          try {
            const resolved = await this.resolveGoogleDriveUrl(driveFileId);
            if (resolved.error) {
              task.status = 'error';
              task.error = resolved.error;
              this.emit();
              return;
            }
            task.url = resolved.url;
            // Cookie de confirmación (download_warning_<id> y similares) que
            // Google fija en la página de aviso de escaneo de archivos grandes;
            // algunos de esos archivos la exigen al descargar.
            task.driveCookie = resolved.cookie || '';
          } catch {
            // Si falla el refresco, se reintenta con la URL almacenada.
          }
        }
      } else if (task.providerData?.terabox?.fsId) {
        // TeraBox: el dlink firmado caduca; se vuelve a generar para el archivo.
        try {
          const fresh = await teraboxProvider.refreshTeraboxFile(
            task.originalUrl,
            task.providerData.terabox.fsId,
          );
          if (fresh) task.url = fresh;
        } catch {
          // Si falla el refresco, se reintenta con la URL almacenada.
        }
      } else if (task.startedOnce && task.host !== 'drive.google.com') {
        try {
          const resolved = await resolveUrl(task.originalUrl);
          task.url = resolved.finalUrl;
        } catch {
          // Si falla la resolución, se reintenta con la URL almacenada.
        }
      }
    }
    task.startedOnce = true;
    fs.mkdirSync(task.destination, { recursive: true });
    const downloader = new DownloaderHelper(task.url, task.destination, {
      fileName: task.name,
      resumeIfFileExists: true,
      resumeOnIncomplete: true,
      removeOnStop: false,
      removeOnFail: false,
      retry: { maxRetries: 3, delay: 1500 },
      maxRedirects: 0,
      progressThrottle: 500,
      override: false,
      headers: {
        'User-Agent': BROWSER_UA,
        ...(task.driveCookie ? { Cookie: task.driveCookie } : {}),
      },
    });
    task.status = 'downloading';
    this.active.set(task.id, downloader);
    this.emit();
    downloader.on('progress.throttled', (stats) => {
      Object.assign(task, {
        progress: Math.floor(stats.progress || 0),
        speed: stats.speed || 0,
        downloaded: stats.downloaded || 0,
        total: stats.total || 0,
      });
      this.send(this.snapshot());
    });
    downloader.on('pause', () => this.release(task, 'paused'));
    downloader.on('stop', () => this.release(task, 'stopped'));
    downloader.on('error', (error) => this.fail(task, error));
    downloader.on('end', async ({ filePath }) => {
      task.progress = 100;
      task.filePath = filePath;
      await this.finish(task);
    });
    downloader.start().catch((error) => this.fail(task, error));
  }
  // Descarga de un archivo de MEGA con descifrado propio (MegaDownloader).
  async startMegaFile(task, megaFile) {
    let info;
    try {
      info = await megaProvider.resolveMegaFile(megaFile.handle, megaFile.key);
    } catch (error) {
      task.status = 'error';
      task.error = error.message;
      this.emit();
      return;
    }
    this.runMegaDownload(task, info);
  }
  // Descarga de un archivo que vive dentro de una carpeta compartida de MEGA
  // (enlace mega.nz/folder/<fh>#<fk>/file/<h>): necesita re-listar la carpeta
  // con su contexto para obtener la clave del archivo en cada inicio.
  async startMegaFolderFile(task, megaFolderFile) {
    let info;
    try {
      info = await megaProvider.resolveMegaFolderFile(
        megaFolderFile.folderHandle,
        megaFolderFile.folderKey,
        megaFolderFile.fileHandle,
      );
    } catch (error) {
      task.status = 'error';
      task.error = error.message;
      this.emit();
      return;
    }
    this.runMegaDownload(task, info);
  }
  // Construye el MegaDownloader y conecta sus eventos a la tarea; lo comparten
  // startMegaFile y startMegaFolderFile una vez que ambos ya resolvieron la
  // URL de descarga y la clave de descifrado.
  runMegaDownload(task, info) {
    task.url = info.url;
    task.startedOnce = true;
    fs.mkdirSync(task.destination, { recursive: true });
    const downloader = new megaProvider.MegaDownloader({
      downloadUrl: info.url,
      key: info.key,
      size: info.size,
      destination: task.destination,
      fileName: task.name,
    });
    task.status = 'downloading';
    this.active.set(task.id, downloader);
    this.emit();
    downloader.on('progress.throttled', (stats) => {
      Object.assign(task, {
        progress: Math.floor(stats.progress || 0),
        speed: stats.speed || 0,
        downloaded: stats.downloaded || 0,
        total: stats.total || 0,
      });
      this.send(this.snapshot());
    });
    downloader.on('stop', () => this.release(task, 'stopped'));
    downloader.on('error', (error) => this.fail(task, error));
    downloader.on('end', async ({ filePath }) => {
      task.progress = 100;
      task.filePath = filePath;
      await this.finish(task);
    });
    downloader.start();
  }
  // Post-descarga común a todos los descargadores (node-downloader-helper,
  // video, MEGA): revisa que el archivo sea real, extrae comprimidos (incluyendo
  // volúmenes multiparte) y marca la tarea como completada.
  async finish(task) {
    this.active.delete(task.id);
    // Google Drive a veces responde 200 con una página HTML de error (cuota
    // superada, aviso de escaneo) en vez del archivo. Si pasó esto, se borra
    // el archivo y se falla con un mensaje claro en vez de "completar" un
    // archivo de unos KB que en realidad es HTML.
    if (this.isGoogleDriveTask(task)) {
      const driveError = this.googleDriveErrorInFile(task.filePath);
      if (driveError) {
        try {
          fs.unlinkSync(task.filePath);
        } catch {
          // Si no se puede borrar, la descarga queda marcada como error igual.
        }
        task.filePath = '';
        task.status = 'error';
        task.error = driveError;
        this.emit();
        this.process();
        return;
      }
    }
    const volume = archiveVolume(task.filePath);
    if (this.settings.autoExtract && task.extract && ARCHIVE.test(task.filePath)) {
      if (volume) {
        // Multiparte: 7-Zip necesita TODAS las partes presentes para poder
        // extraer el comprimido. Esta parte aún no es suficiente, así que se
        // marca como lista y la extracción real se difiere hasta que el
        // volumen completo esté descargado (ver maybeExtractVolume).
        task.status = 'completed';
        this.emit();
        this.maybeExtractVolume(volume);
        this.process();
        return;
      }
      task.status = 'extracting';
      this.emit();
      try {
        await this.extract(task);
      } catch (error) {
        task.status = extractionFailureStatus(error);
        task.error = extractionErrorMessage(error);
        this.emit();
        this.process();
        return;
      }
      this.removeArchive(task);
    }
    task.status = 'completed';
    this.emit();
    this.process();
  }
  startVideo(task) {
    fs.mkdirSync(task.destination, { recursive: true });
    task.status = 'downloading';
    const controller = videoProvider.downloadVideo({
      url: task.videoUrl || task.originalUrl,
      destination: task.destination,
      name: task.name,
      format: task.videoFormat,
      onProgress: (stats) => {
        Object.assign(task, stats);
        this.send(this.snapshot());
      },
    });
    this.active.set(task.id, controller);
    this.emit();
    controller.result
      .then(({ filePath }) => {
        if (!this.active.has(task.id)) return;
        this.active.delete(task.id);
        task.progress = 100;
        task.filePath = filePath || task.filePath || '';
        task.status = 'completed';
        task.error = '';
        this.emit();
        this.process();
      })
      .catch((error) => {
        if (!this.active.has(task.id)) return;
        this.active.delete(task.id);
        task.status = 'error';
        task.error = error.message;
        this.emit();
        this.process();
      });
  }
  release(task, status) {
    if (!this.active.has(task.id)) return;
    this.active.delete(task.id);
    task.status = status;
    this.emit();
    this.process();
  }
  fail(task, error) {
    if (!this.active.has(task.id)) return;
    this.active.delete(task.id);
    task.status = 'error';
    task.error = error.message;
    this.emit();
    this.process();
  }
  async extract(task) {
    // En un comprimido multiparte la carpeta de salida debe usar el nombre
    // base (sin ".part1"/".001") para que el resultado no dependa de qué parte
    // disparó la extracción.
    const volume = archiveVolume(task.filePath || task.name || '');
    const folderName = volume?.baseName
      ? volume.baseName
      : path.basename(task.filePath, path.extname(task.filePath));
    const output = path.join(task.destination, folderName);
    fs.mkdirSync(output, { recursive: true });
    // Siempre se pasa -p (aunque esté vacía): si no se indica y el archivo
    // requiere contraseña, 7-Zip se queda esperando input por stdin y el
    // proceso nunca termina, dejando la tarea colgada en "extracting".
    const args = ['x', task.filePath, `-o${output}`, '-y', `-p${task.password || ''}`];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('La extracción superó el tiempo máximo de espera.')),
        EXTRACTION_TIMEOUT,
      );
      timer.unref?.();
      sevenZip.cmd(args).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
    task.extractedTo = output;
  }
  // Elimina el comprimido original tras una extracción exitosa si la tarea lo pide.
  removeArchive(task) {
    if (!task.deleteArchive || !task.filePath || !fs.existsSync(task.filePath)) return false;
    try {
      fs.unlinkSync(task.filePath);
      return true;
    } catch {
      return false;
    }
  }
  // Extrae un comprimido multiparte cuando TODAS sus partes están presentes en
  // disco. 7-Zip necesita el conjunto completo (en la misma carpeta) para poder
  // extraer, y solo se abre desde la parte de índice menor. Se invoca con cada
  // parte que termina, pero solo hace algo cuando el volumen está completo; al
  // terminar borra TODAS las partes, no solo la que disparó la extracción.
  async maybeExtractVolume(volume) {
    if (!volume || !volume.key || this.volumeExtracting.has(volume.key)) return;
    const parts = [...this.tasks.values()].filter((task) => {
      const own = archiveVolume(task.filePath || task.name || '');
      return own && own.key === volume.key;
    });
    // Solo cuando TODAS las partes están presentes en disco (status completed
    // y archivo existente) el volumen está listo para extraerse. Con `.some`
    // el conjunto se extraería en cuanto terminara la primera parte, que es
    // justo el fallo que esta lógica multiparte debe evitar.
    const ready = parts.every(
      (task) => task.status === 'completed' && task.filePath && fs.existsSync(task.filePath),
    );
    // Sin partes coincidentes no hay nada que extraer ([].every() es true).
    if (!ready || !parts.length) return;
    this.volumeExtracting.add(volume.key);
    const first = parts
      .slice()
      .sort(
        (a, b) =>
          (archiveVolume(a.filePath || a.name)?.index || 0) -
          (archiveVolume(b.filePath || b.name)?.index || 0),
      )[0];
    try {
      if (this.settings.autoExtract && first?.extract !== false) {
        first.status = 'extracting';
        this.emit();
        await this.extract(first);
        for (const part of parts) this.removeArchive(part);
      }
      for (const part of parts) {
        part.status = 'completed';
        part.error = '';
      }
    } catch (error) {
      first.status = extractionFailureStatus(error);
      first.error = extractionErrorMessage(error);
    } finally {
      this.volumeExtracting.delete(volume.key);
    }
    this.emit();
    this.process();
  }
  async retryExtraction(id, password) {
    const task = this.tasks.get(id);
    if (!task?.filePath) return false;
    task.password = password;
    task.status = 'extracting';
    this.emit();
    try {
      await this.extract(task);
      this.removeArchive(task);
      task.status = 'completed';
      task.error = '';
    } catch (error) {
      task.status = extractionFailureStatus(error);
      task.error = extractionErrorMessage(error);
    }
    this.emit();
    return task.status === 'completed';
  }
}
module.exports = {
  DownloadManager,
  extractLinks,
  // Helpers puros expuestos para pruebas unitarias.
  archiveVolume,
  extractionFailureStatus,
  extractionErrorMessage,
};
