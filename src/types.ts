export type FileType = 'video' | 'audio' | 'image' | 'document' | 'archive';
export type ScannedFile = {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  size: number;
};
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
declare global {
  interface Window {
    tools: {
      selectDirectory(): Promise<string | null>;
      scan(data: {
        source: string;
        types: FileType[];
        customExtensions: string[];
      }): Promise<ScannedFile[]>;
      move(data: {
        source: string;
        destination: string;
        files: ScannedFile[];
        deleteChildFolders: boolean;
      }): Promise<{ moved: number; deletedFolders: number; errors: string[] }>;
      list(directory: string): Promise<string[]>;
      rename(data: { directory: string; oldName: string; newName: string }): Promise<boolean>;
      selectVideoFolders(): Promise<string[]>;
      inspectVideoFolders(data: {
        folders: string[];
        codec: 'h264' | 'h265';
      }): Promise<VideoFolder[]>;
      startVideoConversion(data: {
        folders: string[];
        codec: 'h264' | 'h265';
        trackSelections: Record<string, { audio: number[]; subtitles: number[] }>;
      }): Promise<void>;
      cancelVideoConversion(): Promise<boolean>;
      onVideoProgress(callback: (data: VideoProgress) => void): () => void;
    };
  }
}
