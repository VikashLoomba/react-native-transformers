declare module 'expo-file-system' {
  export interface DirectoryCreateOptions {
    intermediates?: boolean;
    overwrite?: boolean;
    idempotent?: boolean;
  }

  export interface FileCreateOptions {
    intermediates?: boolean;
    overwrite?: boolean;
  }

  export interface FileHandle {
    writeBytes(chunk: Uint8Array): void;
    close(): void;
  }

  export class Directory {
    constructor(...uris: (string | File | Directory)[]);
    exists: boolean;
    size: number | null;
    create(options?: DirectoryCreateOptions): void;
    delete(): void;
    move(destination: Directory | File): void;
  }

  export class File extends Blob {
    constructor(...uris: (string | File | Directory)[]);
    exists: boolean;
    size: number;
    text(): Promise<string>;
    write(content: string | Uint8Array, options?: unknown): void;
    create(options?: FileCreateOptions): void;
    delete(): void;
    move(destination: Directory | File): void;
    open(): FileHandle;
  }

  export class Paths {
    static readonly cache: Directory;
    static readonly document: Directory;
  }
}
