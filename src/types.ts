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
  collection?: string;
  folderLink?: boolean;
  videoUrl?: string;
  videoFormat?: string;
};
export type DownloadTask = {
  id: string;
  originalUrl: string;
  url: string;
  name: string;
  destination: string;
  priority: DownloadPriority;
  password: string;
  extract: boolean;
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
};
export type DownloadSettings = {
  defaultDirectory: string;
  concurrency: number;
  autoExtract: boolean;
  clipboard: boolean;
  googleDriveApiKey: string;
};
export type DownloadsState = { settings: DownloadSettings; tasks: DownloadTask[] };
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
};
export type NormalizeState = {
  running: boolean;
  globalProgress: number;
  fileProgress: number;
  activeFile: string;
  message: string;
  targetDb?: number;
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
      addDownloads(items: DownloadCandidate[]): Promise<void>;
      updateDownload(id: string, changes: Partial<DownloadTask>): Promise<boolean>;
      controlDownload(id: string, action: string): Promise<boolean>;
      clearCompletedDownloads(): Promise<void>;
      setDownloadSettings(settings: Partial<DownloadSettings>): Promise<void>;
      retryExtraction(id: string, password: string): Promise<boolean>;
      selectDownloadDirectory(): Promise<string | null>;
      showDownloadedFile(filePath: string): Promise<boolean>;
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
      startNormalization(data: {
        files: NormalizeFile[];
        type: 'audio' | 'video';
        targetDb: number;
      }): Promise<void>;
      setNormalizeTarget(targetDb: number): Promise<boolean>;
      cancelNormalization(): Promise<boolean>;
      getNormalizeState(): Promise<NormalizeState>;
      onNormalizeProgress(callback: (data: NormalizeProgress) => void): () => void;
      onNormalizeState(callback: (state: NormalizeState) => void): () => void;
    };
  }
}
