const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  isPlaylistUrl,
  parsePlaylistInfo,
  formatIdFor,
  resolveYtDlp,
  isVideoLink,
  isExtractionError,
  parseSize,
  collectVideoHeights,
  hasAudioOnlyFormat,
} = require('../electron/videoProvider.cjs');

test('detecta enlaces de listas de YouTube', () => {
  assert.equal(isPlaylistUrl('https://www.youtube.com/playlist?list=PL123xyz'), true);
  assert.equal(isPlaylistUrl('https://www.youtube.com/watch?v=abc&list=PL123xyz'), true);
  assert.equal(isPlaylistUrl('https://youtu.be/abc?list=PL123xyz'), true);
  assert.equal(isPlaylistUrl('https://m.youtube.com/playlist?list=PL123xyz'), true);
  assert.equal(isPlaylistUrl('https://www.youtube.com/watch?v=abc'), false);
  assert.equal(isPlaylistUrl('https://www.youtube.com/@canal'), false);
  assert.equal(isPlaylistUrl('https://youtu.be/abc'), false);
  assert.equal(isPlaylistUrl('https://vimeo.com/123?list=x'), false);
});

test('convierte una lista de YouTube en videos con el nombre de la lista', () => {
  const playlist = parsePlaylistInfo(
    JSON.stringify({
      _type: 'playlist',
      title: '  Mi   Mezcla Musical ',
      entries: [
        { id: 'v1', title: '  Video Uno  ' },
        { id: 'v2', title: 'Café con leche' },
        { id: 'v3' },
        { id: 'v-roto' },
      ],
    }),
  );
  assert.equal(playlist.title, 'Mi Mezcla Musical');
  assert.equal(playlist.videos.length, 4);
  assert.deepEqual(playlist.videos[0], {
    id: 'v1',
    title: 'Video Uno',
    url: 'https://www.youtube.com/watch?v=v1',
  });
  assert.equal(playlist.videos[1].title, 'Café con leche');
  assert.equal(playlist.videos[2].title, 'v3');
});

test('ignora videos sin id y entradas no disponibles en una lista', () => {
  const playlist = parsePlaylistInfo(
    JSON.stringify({
      _type: 'playlist',
      title: 'Playlist',
      entries: [
        { id: 'ok', title: 'Disponible' },
        { title: '[Private video]' },
        { id: null, title: '[Deleted video]' },
        {},
      ],
    }),
  );
  assert.deepEqual(playlist.videos, [
    { id: 'ok', title: 'Disponible', url: 'https://www.youtube.com/watch?v=ok' },
  ]);
});

test('devuelve listado vacío cuando la URL no corresponde a una lista', () => {
  const playlist = parsePlaylistInfo(
    JSON.stringify({ _type: 'video', title: 'Un solo video', entries: [] }),
  );
  assert.deepEqual(playlist, { title: '', videos: [] });
});

test('resuelve formatos de descarga de video', () => {
  assert.equal(formatIdFor('audio'), 'ba/b');
  assert.equal(formatIdFor('video:1080'), 'bv*[height<=1080]+ba/b[height<=1080]/b');
  assert.equal(formatIdFor('video:best'), 'bv*+ba/b');
  assert.equal(formatIdFor('video:'), 'bv*+ba/b');
});

test('detecta enlaces de video por dominio', () => {
  assert.equal(isVideoLink('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(isVideoLink('https://music.youtube.com/watch?v=abc'), true);
  assert.equal(isVideoLink('https://m.youtube.com/watch?v=abc'), true);
  assert.equal(isVideoLink('https://youtu.be/abc'), true);
  assert.equal(isVideoLink('https://vimeo.com/123'), true);
  assert.equal(isVideoLink('https://www.dailymotion.com/video/x123'), true);
  assert.equal(isVideoLink('https://www.tiktok.com/@u/video/1'), true);
  assert.equal(isVideoLink('https://www.facebook.com/watch/?v=1'), true);
  assert.equal(isVideoLink('https://www.instagram.com/reel/abc'), true);
  assert.equal(isVideoLink('https://www.twitch.tv/videos/1'), true);
  assert.equal(isVideoLink('https://twitter.com/u/status/1'), true);
  assert.equal(isVideoLink('https://x.com/u/status/1'), true);
  assert.equal(isVideoLink('https://soundcloud.com/u/track'), true);
  assert.equal(isVideoLink('https://rutube.ru/video/1'), true);
  assert.equal(isVideoLink('https://vk.ru/video1'), true);
  assert.equal(isVideoLink('https://ok.ru/video/1'), true);
  assert.equal(isVideoLink('https://vk.com/video1'), false);
  assert.equal(isVideoLink('https://www.mediafire.com/file/a/b/file'), false);
  assert.equal(isVideoLink('https://drive.google.com/file/d/1/view'), false);
  assert.equal(isVideoLink('no-es-una-url'), false);
  assert.equal(isVideoLink(''), false);
});

test('rechaza URLs inválidas como listas', () => {
  assert.equal(isPlaylistUrl('no-es-una-url'), false);
  assert.equal(isPlaylistUrl(''), false);
});

test('clasifica errores de extracción de yt-dlp', () => {
  assert.equal(isExtractionError('ERROR: Unsupported URL'), true);
  assert.equal(isExtractionError('Unable to extract video data'), true);
  assert.equal(isExtractionError('No video formats found!'), true);
  assert.equal(isExtractionError('Failed to extract any player response'), true);
  assert.equal(isExtractionError('Sign in to confirm your age'), true);
  assert.equal(isExtractionError('HTTP Error 403: Forbidden'), true);
  assert.equal(isExtractionError('Precondition check failed'), true);
  assert.equal(isExtractionError('yt-dlp falló con código 1.'), false);
  assert.equal(isExtractionError('El análisis del video tardó demasiado.'), false);
  assert.equal(isExtractionError(''), false);
  assert.equal(isExtractionError(null), false);
  assert.equal(isExtractionError(undefined), false);
});

test('convierte tamaños de progreso a bytes', () => {
  assert.equal(parseSize('10 MB'), 10 * 1024 ** 2);
  assert.equal(parseSize('1.5GB'), Math.round(1.5 * 1024 ** 3));
  assert.equal(parseSize('512'), 512);
  assert.equal(parseSize('2K'), 2 * 1024);
  assert.equal(parseSize('100 B'), 100);
  assert.equal(parseSize('3.2 MiB'), Math.round(3.2 * 1024 ** 2));
  assert.equal(parseSize('1T'), 1024 ** 4);
  assert.equal(parseSize(''), 0);
  assert.equal(parseSize(null), 0);
  assert.equal(parseSize('0'), 0);
  assert.equal(parseSize('abc'), 0);
  assert.equal(parseSize('12 XB'), 0);
});

test('parsePlaylistInfo cae al título genérico sin título de lista', () => {
  const playlist = parsePlaylistInfo(
    JSON.stringify({
      _type: 'playlist',
      title: '',
      entries: [
        { id: 'v1', title: '   ' },
        { id: 'v2', title: 'Disponible' },
      ],
    }),
  );
  assert.equal(playlist.title, 'Lista de YouTube');
  assert.equal(playlist.videos[0].title, 'v1');
  assert.equal(playlist.videos[1].title, 'Disponible');
});

test('agrupa formatos de video por altura priorizando audio integrado', () => {
  const rows = collectVideoHeights([
    { height: 720, vcodec: 'avc1', acodec: 'none' },
    { height: 720, vcodec: 'avc1', acodec: 'mp4a' },
    { height: 1080, vcodec: 'vp9', acodec: 'none' },
    { height: null, vcodec: 'avc1', acodec: 'mp4a' },
    { vcodec: 'none', acodec: 'mp4a' },
    { acodec: 'mp4a' },
  ]);
  assert.deepEqual(
    rows.map(([height]) => height),
    ['1080', '720', '0'],
  );
  assert.equal(rows.find(([height]) => height === '720')[1].acodec, 'mp4a');
  assert.deepEqual(collectVideoHeights([]), []);
});

test('detecta si hay pista solo-audio disponible', () => {
  assert.equal(hasAudioOnlyFormat([{ vcodec: 'avc1' }]), false);
  assert.equal(hasAudioOnlyFormat([{ vcodec: 'none', acodec: 'opus' }]), true);
  assert.equal(hasAudioOnlyFormat([{ acodec: 'mp3' }]), true);
  assert.equal(hasAudioOnlyFormat([]), false);
});

test('resuelve el binario vendored de yt-dlp', () => {
  const resolved = resolveYtDlp();
  assert.equal(typeof resolved, 'string');
  assert.ok(resolved.length > 0);
  // En desarrollo el binario vendored existe en el repo.
  if (resolved !== 'yt-dlp') assert.equal(fs.existsSync(resolved), true);
});
