export type FileType = 'video' | 'audio' | 'image' | 'document' | 'archive';
export type ScannedFile = {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  size: number;
};
export type MoveRecord = { originalPath: string; movedPath: string };
export type DownloadPriority = 'urgent' | 'high' | 'medium' | 'low';
export type DownloadCandidate = {
  id: string;
  originalUrl: string;
  url: string;
  name: string;
  host: string;
  online: boolean;
  mode?: string;
  error?: string;
  selected: boolean;
  destination?: string;
  priority?: DownloadPriority;
  password?: string;
  extract?: boolean;
  deleteArchive?: boolean;
  collection?: string;
  folderLink?: boolean;
  videoUrl?: string;
  videoFormat?: string;
  providerData?: DownloadProviderData;
};
export type DownloadProviderData = {
  terabox?: {
    host: string;
    surl: string;
    uk: string;
    shareid: string;
    fsId: string;
  };
};
export type VideoQualityOption = { label: string; videoFormat: string };
export type DownloadTask = {
  id: string;
  originalUrl: string;
  url: string;
  name: string;
  destination: string;
  priority: DownloadPriority;
  password: string;
  extract: boolean;
  deleteArchive: boolean;
  host: string;
  collection: string;
  status: string;
  progress: number;
  speed: number;
  downloaded: number;
  total: number;
  filePath?: string;
  extractedTo?: string;
  error?: string;
  videoUrl?: string;
  videoFormat?: string;
  providerData?: DownloadProviderData;
};
export type DownloadSettings = {
  defaultDirectory: string;
  defaultDeleteArchive?: boolean;
  concurrency: number;
  autoExtract: boolean;
  clipboard: boolean;
  googleDriveApiKey: string;
};
export type DownloadsState = { settings: DownloadSettings; tasks: DownloadTask[] };
export type DownloadDiskInfo = { drive: string; total: number; free: number };
export type VideoTrack = {
  index: number;
  codec: string;
  language: string;
  title: string;
  default: boolean;
};
export type VideoInfo = {
  file: string;
  path: string;
  audio: VideoTrack[];
  subtitles: VideoTrack[];
  processed: boolean;
  probeError?: string;
};
export type VideoFolder = { folder: string; videos: VideoInfo[]; processed: boolean };
export type VideoProgress = {
  type: string;
  folder?: string;
  file?: string;
  message?: string;
  current?: number;
  total?: number;
  percent?: number;
};
export type VideoState = {
  running: boolean;
  codec: 'h264' | 'h265';
  folders: VideoFolder[];
  trackSelections: Record<string, { audio: number[]; subtitles: number[] }>;
  globalProgress: number;
  fileProgress: number;
  activeFile: string;
  activeFolder: string;
  logs: { text: string; tone?: string }[];
  normalizeAudio: boolean;
  normalizeTarget: number;
};
export type NormalizeFile = {
  path: string;
  name: string;
  folder: string;
  size: number;
  processed: boolean;
  lufs?: number | null;
};
export type NormalizeProgress = {
  type: string;
  file?: string;
  path?: string;
  message?: string;
  current?: number;
  total?: number;
  completed?: number;
  percent?: number;
  measuredLufs?: number | null;
};
export type NormalizeState = {
  running: boolean;
  globalProgress: number;
  fileProgress: number;
  activeFile: string;
  message: string;
  targetDb?: number;
  folders: string[];
  type: 'audio' | 'video';
  files: NormalizeFile[];
  selected: string[];
  processed: string[];
  logs: { text: string; tone?: string }[];
  activeFolder?: string;
};
export type TrimMode = 'keep' | 'remove';
export type TrimFile = {
  path: string;
  name: string;
  folder: string;
  size: number;
  duration: number;
};
export type TrimSettings = { mode: TrimMode; start: number; end: number; split: boolean };
export type TrimJob = {
  path: string;
  name: string;
  folder: string;
  mode: TrimMode;
  start: number;
  end: number;
  split: boolean;
};
export type TrimProgress = {
  type: string;
  file?: string;
  path?: string;
  message?: string;
  current?: number;
  total?: number;
  completed?: number;
  percent?: number;
  outputs?: string[];
};
export type TrimState = {
  running: boolean;
  globalProgress: number;
  fileProgress: number;
  activeFile: string;
  message: string;
  folders: string[];
  type: 'audio' | 'video';
  files: TrimFile[];
  selected: string[];
  processed: string[];
  settings: Record<string, TrimSettings>;
  logs: { text: string; tone?: string }[];
  activeFolder?: string;
};
export type CollectionColumnType = 'string' | 'number' | 'boolean' | 'date' | 'url' | 'tags';
export type CollectionColumn = {
  name: string;
  label: string;
  type: CollectionColumnType;
  required: boolean;
};
export type Collection = {
  id: number;
  name: string;
  description: string;
  type: string;
  columns: CollectionColumn[];
  position: number;
  createdAt: string;
  updatedAt: string;
};
export type CollectionItem = {
  id: number;
  collectionId: number;
  name: string;
  values: Record<string, unknown>;
  imageUrl: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};
export type ImageSearchEngine = 'google' | 'bing' | 'duckduckgo' | 'wikimedia' | 'openverse';
export type ImageSearchResult = {
  imageUrl: string;
  thumbnailUrl: string;
  title: string;
  source: string;
  pageUrl: string;
  width?: number;
  height?: number;
};
export type AnalogChannel = {
  id: string | number;
  uuid?: string;
  name: string;
  number: number;
  description?: string;
  isEnabled: boolean;
};
export type AnalogEpisode = {
  episode: number;
  title: string;
  duration: string;
  fileName?: string;
  fileNames?: string[];
};
export type AnalogSeason = {
  season: number;
  year: number;
  episodes: AnalogEpisode[];
  contentPath?: string;
  contentPaths?: string[];
};
export type AnalogShow = {
  id: number;
  uuid?: string;
  name: string;
  channel: string[];
  seasons: AnalogSeason[];
  airYears?: number[];
  airUntilToDate?: boolean;
  episodeAiringMode?: 'daily-repeat' | 'once-per-day';
};
export type AnalogScheduleEntry = {
  id: string;
  showId: string;
  showName: string;
  season: number;
  episode: number;
  episodeTitle?: string;
  channelId: string;
  channelName: string;
  startTime: string;
  endTime: string;
  duration?: string;
  type: 'show' | 'commercial' | 'filler';
};
export type AnalogMonthSchedule = {
  year: number;
  month: number;
  monthName: string;
  entries: AnalogScheduleEntry[];
  generated: string;
  primaryYear: number;
};
export type AnalogScheduleConfig = {
  primaryYear: number;
  secondaryYears: number[];
  lastGenerated: string;
  currentYear: number;
  generatedMonths: string[];
};
export type AnalogScheduleStatus = {
  status: 'needs_year_selection' | 'ready';
  config: AnalogScheduleConfig;
  error?: string;
};
export type AnalogFolderVideo = {
  episode: number;
  title: string;
  duration: string;
  fileName: string;
};
export type WishlistPrice = {
  id: number;
  wishlistId: number;
  store: string;
  url: string;
  price: number | null;
  currency: string | null;
  checkedAt: string | null;
  error: string | null;
};
export type WishlistItem = {
  id: number;
  name: string;
  manufacturer: string;
  year: number | null;
  prices: WishlistPrice[];
  createdAt: string;
  updatedAt: string;
};
export type HddCategory = 'folder' | 'video' | 'image' | 'audio' | 'document' | 'other';
export type HddDrive = {
  id: number;
  code: string;
  label: string;
  volumeId: string | null;
  volumeLabel: string;
  totalBytes: number;
  lastMountPoint: string;
  lastScannedAt: string | null;
  createdAt: string;
  updatedAt: string;
  connected: boolean;
  mountPoint: string;
  stats: { files: number; bytes: number };
};
export type HddEntry = {
  id: number;
  driveId: number;
  relativePath: string;
  parentPath: string;
  name: string;
  isDirectory: boolean;
  category: HddCategory;
  extension: string;
  size: number;
  modifiedAt: string | null;
  mediaProperties: Record<string, unknown>;
  hasThumbnail: boolean;
  thumbnailPath: string | null;
  createdAt: string;
  updatedAt: string;
};
export type HddVolume = {
  mountPoint: string;
  volumeId: string | null;
  label: string;
  totalBytes: number;
};
export type HddScanState = {
  running: boolean;
  driveId: number | null;
  processed: number;
  thumbnails: number;
  current: string;
  error: string;
};
export type MediaOrigin = 'hdd' | null;
export type NowPlaying = { drive: HddDrive; entry: HddEntry };
declare global {
  interface Window {
    tools: {
      selectDirectory(): Promise<string | null>;
      scan(data: {
        source: string;
        destination?: string;
        types: FileType[];
        customExtensions: string[];
      }): Promise<ScannedFile[]>;
      move(data: {
        source: string;
        destination: string;
        files: ScannedFile[];
        deleteChildFolders: boolean;
        returnToSource: boolean;
        deleteCreatedDestination: boolean;
      }): Promise<{
        moved: number;
        returned: number;
        deletedFolders: number;
        deletedDestination: boolean;
        errors: string[];
        moves: MoveRecord[];
      }>;
      undoMove(data: {
        source: string;
        destination: string;
        moves: MoveRecord[];
      }): Promise<{ moved: number; errors: string[] }>;
      createDestination(data: { source: string; name: string }): Promise<{
        path: string;
        created: boolean;
      }>;
      openUrl(url: string): Promise<boolean>;
      getDownloads(): Promise<DownloadsState>;
      analyzeDownloads(text: string): Promise<DownloadCandidate[]>;
      getVideoQualityOptions(url: string): Promise<VideoQualityOption[]>;
      addDownloads(items: DownloadCandidate[]): Promise<void>;
      updateDownload(id: string, changes: Partial<DownloadTask>): Promise<boolean>;
      controlDownload(id: string, action: string): Promise<boolean>;
      controlDownloads(ids: string[], action: string): Promise<boolean>;
      clearCompletedDownloads(): Promise<void>;
      setDownloadSettings(settings: Partial<DownloadSettings>): Promise<void>;
      retryExtraction(id: string, password: string): Promise<boolean>;
      selectDownloadDirectory(): Promise<string | null>;
      showDownloadedFile(filePath: string): Promise<boolean>;
      showDownloadDirectory(directory: string): Promise<boolean>;
      getDownloadDiskInfo(directory?: string): Promise<DownloadDiskInfo>;
      getCollections(): Promise<Collection[]>;
      createCollection(data: {
        name: string;
        description: string;
        type: string;
        columns: CollectionColumn[];
      }): Promise<Collection>;
      updateCollection(id: number, patch: Partial<Collection>): Promise<Collection>;
      deleteCollection(id: number): Promise<boolean>;
      reorderCollections(ids: number[]): Promise<Collection[]>;
      getCollectionColumnTypes(): Promise<CollectionColumnType[]>;
      getCollectionItems(collectionId: number, q?: string): Promise<CollectionItem[]>;
      createCollectionItem(data: {
        collectionId: number;
        name: string;
        values: Record<string, unknown>;
        imageUrl: string | null;
        tags: string[];
      }): Promise<CollectionItem>;
      updateCollectionItem(id: number, patch: Partial<CollectionItem>): Promise<CollectionItem>;
      deleteCollectionItem(id: number): Promise<boolean>;
      exportCollection(id: number): Promise<boolean>;
      importCollection(): Promise<Collection | null>;
      searchImages(data: {
        query: string;
        engine: ImageSearchEngine;
        page?: number;
      }): Promise<ImageSearchResult[]>;
      analogListChannels(): Promise<AnalogChannel[]>;
      analogCreateChannel(data: {
        name: string;
        number: number;
        description?: string;
        isEnabled?: boolean;
      }): Promise<AnalogChannel>;
      analogUpdateChannel(
        id: string | number,
        patch: Partial<AnalogChannel>,
      ): Promise<AnalogChannel>;
      analogDeleteChannel(id: string | number): Promise<boolean>;
      analogListShows(): Promise<AnalogShow[]>;
      analogCreateShow(data: Omit<AnalogShow, 'id'>): Promise<AnalogShow>;
      analogUpdateShow(id: string | number, patch: Partial<AnalogShow>): Promise<AnalogShow>;
      analogDeleteShow(id: string | number): Promise<boolean>;
      analogSelectJson(): Promise<string | null>;
      analogImportChannels(filePath: string): Promise<number>;
      analogImportShows(filePath: string): Promise<AnalogShow[]>;
      analogSelectFolder(): Promise<string | null>;
      analogFolderVideos(folderPath: string): Promise<AnalogFolderVideo[]>;
      analogFolderMatch(
        folderPath: string,
        episodes: { episode: number; fileNames: string[] }[],
      ): Promise<Record<number, string | null>>;
      analogScheduleStatus(): Promise<AnalogScheduleStatus>;
      analogScheduleConfig(): Promise<AnalogScheduleConfig | null>;
      analogScheduleGenerate(year: number): Promise<{ success: boolean; error?: string }>;
      analogScheduleMonth(year: number, month: number): Promise<AnalogMonthSchedule | null>;
      analogScheduleReset(): Promise<{ success: boolean; error?: string }>;
      getWishlist(q?: string): Promise<WishlistItem[]>;
      createWishlistItem(data: {
        name: string;
        manufacturer: string;
        year: number | null;
      }): Promise<WishlistItem>;
      updateWishlistItem(id: number, patch: Partial<WishlistItem>): Promise<WishlistItem>;
      deleteWishlistItem(id: number): Promise<boolean>;
      addWishlistPrice(
        wishlistId: number,
        data: { store: string; url: string },
      ): Promise<WishlistPrice>;
      deleteWishlistPrice(id: number): Promise<boolean>;
      refreshWishlistPrice(id: number): Promise<WishlistPrice>;
      refreshWishlist(): Promise<{
        updated: number;
        failed: number;
        items: WishlistItem[];
      }>;
      onDownloadsState(callback: (state: DownloadsState) => void): () => void;
      onClipboardLinks(callback: (text: string) => void): () => void;
      list(directories: string[]): Promise<{ folder: string; name: string }[]>;
      listFolders(directories: string[]): Promise<{ folder: string; name: string }[]>;
      rename(data: { folder: string; oldName: string; newName: string }): Promise<boolean>;
      selectRenameFolders(): Promise<string[]>;
      selectVideoFolders(): Promise<string[]>;
      inspectVideoFolders(data: {
        folders: string[];
        codec: 'h264' | 'h265';
      }): Promise<VideoFolder[]>;
      getVideoState(): Promise<VideoState>;
      startVideoConversion(data: {
        folders: string[];
        codec: 'h264' | 'h265';
        trackSelections: Record<string, { audio: number[]; subtitles: number[] }>;
        normalizeAudio: boolean;
        normalizeTarget: number;
      }): Promise<void>;
      cancelVideoConversion(): Promise<boolean>;
      skipVideoFolder(folder: string): Promise<boolean>;
      appendVideoFolders(data: { folders: string[]; codec: 'h264' | 'h265' }): Promise<boolean>;
      clearVideoState(): Promise<boolean>;
      setVideoNormalize(
        data: Partial<{ normalizeAudio: boolean; normalizeTarget: number }>,
      ): Promise<boolean>;
      onVideoProgress(callback: (data: VideoProgress) => void): () => void;
      onVideoState(callback: (state: VideoState) => void): () => void;
      selectNormalizeFolders(): Promise<string[]>;
      scanNormalizeFiles(data: {
        folders: string[];
        type: 'audio' | 'video';
      }): Promise<NormalizeFile[]>;
      measureNormalizeLufs(filePath: string): Promise<number | null>;
      cancelLufsScan(): Promise<boolean>;
      resumeLufsScan(): Promise<boolean>;
      getNormalizeConfig(): Promise<{
        lufsTolerance: number;
        excerptDuration: number;
        excerptMinDuration: number;
      }>;
      startNormalization(data: {
        files: NormalizeFile[];
        type: 'audio' | 'video';
        targetDb: number;
      }): Promise<void>;
      setNormalizeTarget(targetDb: number): Promise<boolean>;
      setNormalizeUi(data: Partial<NormalizeState>): Promise<boolean>;
      skipNormalizeFolder(folder: string): Promise<boolean>;
      cancelNormalization(): Promise<boolean>;
      getNormalizeState(): Promise<NormalizeState>;
      onNormalizeProgress(callback: (data: NormalizeProgress) => void): () => void;
      onNormalizeState(callback: (state: NormalizeState) => void): () => void;
      selectTrimFolders(): Promise<string[]>;
      scanTrimFiles(data: { folders: string[]; type: 'audio' | 'video' }): Promise<TrimFile[]>;
      getTrimState(): Promise<TrimState>;
      setTrimUi(data: Partial<TrimState>): Promise<boolean>;
      startTrim(data: { jobs: TrimJob[]; type: 'audio' | 'video' }): Promise<void>;
      skipTrimFolder(folder: string): Promise<boolean>;
      cancelTrim(): Promise<boolean>;
      onTrimProgress(callback: (data: TrimProgress) => void): () => void;
      onTrimState(callback: (state: TrimState) => void): () => void;
      hddSelectRoot(): Promise<string | null>;
      hddListVolumes(): Promise<HddVolume[]>;
      hddList(): Promise<HddDrive[]>;
      hddRegister(data: { rootPath: string; code: string; label?: string }): Promise<HddDrive>;
      hddUpdate(id: number, patch: { code?: string; label?: string }): Promise<HddDrive>;
      hddRemove(id: number): Promise<boolean>;
      hddEntries(driveId: number, parentPath?: string): Promise<HddEntry[]>;
      hddEntry(id: number): Promise<HddEntry | null>;
      hddSearch(driveId: number, query: string): Promise<HddEntry[]>;
      hddDescendantCount(driveId: number, entryId: number): Promise<number>;
      hddShowInFolder(driveId: number, entryId: number): Promise<boolean>;
      hddThumbnail(entryId: number): Promise<string | null>;
      hddRename(data: {
        driveId: number;
        entryId: number;
        newName: string;
        applyToDisk: boolean;
      }): Promise<{ entry: HddEntry; affected: number }>;
      hddScanState(): Promise<HddScanState>;
      hddStartScan(driveId: number): Promise<boolean>;
      hddCancelScan(): Promise<boolean>;
      onHddScanState(callback: (state: HddScanState) => void): () => void;
      mediaDocumentText(driveId: number, entryId: number): Promise<{ text: string }>;
    };
  }
}
