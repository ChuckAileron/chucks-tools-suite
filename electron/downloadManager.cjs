const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DownloaderHelper } = require('node-downloader-helper');
const sevenZip = require('7zip-min');
const { resolveUrl } = require('./urlResolver.cjs');

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
  async analyze(text) {
    const links = extractLinks(text);
    const batchCollection = links.length > 1 ? `Colección ${new Date().toLocaleString('es')}` : '';
    const groups = await Promise.all(
      links.map(async (raw) => {
        const originalUrl = raw.replace(/[),.;]+$/, '');
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
        if (/mega\.(?:nz|io)\/folder\//i.test(originalUrl))
          return [this.unsupportedFolder(originalUrl, 'MEGA')];
        try {
          const result = await resolveUrl(originalUrl);
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
      error: `${provider} requiere un adaptador autenticado para enumerar esta carpeta de forma estable.`,
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
  async expandGoogleDriveFile(fileId, originalUrl) {
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
  async expandGoogleDriveFolder(folderId, originalUrl) {
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
        host: item.host,
        collection: item.collection || item.host || 'Sin colección',
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
    if (!task || this.active.has(id)) return false;
    if (changes.name) changes.name = this.sanitize(changes.name);
    Object.assign(task, changes);
    this.emit();
    return true;
  }
  control(id, action) {
    const task = this.tasks.get(id),
      downloader = this.active.get(id);
    if (!task) return false;
    if (action === 'pause') {
      if (downloader) downloader.pause();
      task.status = 'paused';
    } else if (action === 'resume') {
      task.status = 'pending';
    } else if (action === 'stop') {
      if (downloader) downloader.stop();
      task.status = 'stopped';
    } else if (action === 'remove' && !downloader) this.tasks.delete(id);
    else return false;
    this.emit();
    this.process();
    return true;
  }
  clearCompleted() {
    for (const [id, task] of this.tasks) if (task.status === 'completed') this.tasks.delete(id);
    this.emit();
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
    while (this.active.size < this.settings.concurrency) {
      const task = [...this.tasks.values()]
        .filter((item) => item.status === 'pending')
        .sort(
          (a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.createdAt - b.createdAt,
        )[0];
      if (!task) break;
      this.start(task);
    }
  }
  start(task) {
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
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/140 Safari/537.36' },
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
    downloader.on('end', async (info) => {
      this.active.delete(task.id);
      task.progress = 100;
      task.filePath = info.filePath;
      if (this.settings.autoExtract && task.extract && ARCHIVE.test(info.filePath)) {
        task.status = 'extracting';
        this.emit();
        try {
          await this.extract(task);
        } catch (error) {
          task.status = /password/i.test(error.message) ? 'password-required' : 'error';
          task.error = error.message;
          this.emit();
          this.process();
          return;
        }
      }
      task.status = 'completed';
      this.emit();
      this.process();
    });
    downloader.start().catch((error) => this.fail(task, error));
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
    const output = path.join(
      task.destination,
      path.basename(task.filePath, path.extname(task.filePath)),
    );
    fs.mkdirSync(output, { recursive: true });
    const args = ['x', task.filePath, `-o${output}`, '-y'];
    if (task.password) args.push(`-p${task.password}`);
    await sevenZip.cmd(args);
    task.extractedTo = output;
  }
  async retryExtraction(id, password) {
    const task = this.tasks.get(id);
    if (!task?.filePath) return false;
    task.password = password;
    task.status = 'extracting';
    this.emit();
    try {
      await this.extract(task);
      task.status = 'completed';
      task.error = '';
    } catch (error) {
      task.status = 'password-required';
      task.error = error.message;
    }
    this.emit();
    return task.status === 'completed';
  }
}
module.exports = { DownloadManager, extractLinks };
