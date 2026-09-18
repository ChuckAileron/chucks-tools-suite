export type FileType = 'video' | 'audio' | 'image' | 'document' | 'archive';
export type ScannedFile = {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  size: number;
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
    };
  }
}
