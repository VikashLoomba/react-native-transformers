import { Directory, File, Paths } from 'expo-file-system';

import type {
  CacheLike,
  CacheProgressCallback,
  RequestLike,
} from './types';

const DEFAULT_MODEL_CACHE_PATH_SEGMENTS = Object.freeze([
  'automatalabs-react-native-transformers',
  'models',
] as const);

export interface ExpoFileSystemCacheOptions {
  directory?: Directory | string;
}

export interface ExpoFileSystemCacheMetadata {
  request: string;
  status: number;
  headers: Record<string, string>;
  cachedAt: number;
}

export interface ExpoFileSystemCache extends CacheLike {
  readonly directory: Directory;
}

interface CachePaths {
  directory: Directory;
  dataFile: File;
  metadataFile: File;
  tempDataFile: File;
  tempMetadataFile: File;
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeSegment(value: unknown): string {
  const normalized = encodeURIComponent(String(value))
    .replace(/%/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized.slice(0, 120) || 'index';
}

function serializeRequest(request: RequestLike): string {
  return request instanceof Request ? request.url : String(request);
}

function getRequestPathSegments(request: RequestLike): string[] {
  const value = serializeRequest(request);

  try {
    const url = new URL(value);
    const segments = [sanitizeSegment(url.protocol.replace(/:$/, '')), sanitizeSegment(url.host)];
    const pathnameSegments = url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => sanitizeSegment(segment));

    segments.push(...pathnameSegments);

    if (segments.length === 2) {
      segments.push('index');
    }

    if (url.search) {
      const lastIndex = segments.length - 1;
      const lastSegment = segments[lastIndex];

      if (lastSegment) {
        segments[lastIndex] = `${lastSegment}__q_${hashString(url.search)}`;
      }
    }

    return segments;
  } catch {
    const segments = value
      .split('/')
      .filter(Boolean)
      .map((segment) => sanitizeSegment(segment));

    return segments.length > 0 ? segments : ['index'];
  }
}

function ensureDirectory(directory: Directory): void {
  if (!directory.exists) {
    directory.create({
      intermediates: true,
      idempotent: true,
    });
  }
}

function deleteIfExists(file: File | undefined): void {
  if (file?.exists) {
    try {
      file.delete();
    } catch {
      // ignore cleanup failures
    }
  }
}

function getCachePaths(rootDirectory: Directory, request: RequestLike): CachePaths {
  const requestPathSegments = getRequestPathSegments(request);
  const directorySegments = requestPathSegments.slice(0, -1);
  const leafSegment = requestPathSegments.at(-1) ?? 'index';
  const requestHash = hashString(serializeRequest(request));
  const baseName = `${leafSegment}__${requestHash}`;
  const directory = new Directory(rootDirectory, ...directorySegments);

  return {
    directory,
    dataFile: new File(directory, `${baseName}.data`),
    metadataFile: new File(directory, `${baseName}.meta.json`),
    tempDataFile: new File(directory, `${baseName}.tmp.data`),
    tempMetadataFile: new File(directory, `${baseName}.tmp.meta.json`),
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}

function isCacheMetadata(value: unknown): value is ExpoFileSystemCacheMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const metadata = value as Partial<ExpoFileSystemCacheMetadata>;

  return (
    typeof metadata.request === 'string' &&
    typeof metadata.status === 'number' &&
    typeof metadata.cachedAt === 'number' &&
    isStringRecord(metadata.headers)
  );
}

async function readMetadata(metadataFile: File): Promise<ExpoFileSystemCacheMetadata | null> {
  if (!metadataFile.exists) {
    return null;
  }

  try {
    const parsed = JSON.parse(await metadataFile.text()) as unknown;
    return isCacheMetadata(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function createResponseHeaders(dataFile: File, metadata: ExpoFileSystemCacheMetadata | null): Headers {
  const headers = new Headers(metadata?.headers ?? {});

  if (!headers.has('content-length')) {
    headers.set('content-length', String(dataFile.size));
  }

  return headers;
}

async function writeMetadata(
  metadataFile: File,
  tempMetadataFile: File,
  metadata: ExpoFileSystemCacheMetadata,
): Promise<void> {
  deleteIfExists(tempMetadataFile);
  tempMetadataFile.create({
    intermediates: true,
    overwrite: true,
  });
  tempMetadataFile.write(JSON.stringify(metadata));
  deleteIfExists(metadataFile);
  tempMetadataFile.move(metadataFile);
}

async function writeResponseToFile(
  file: File,
  response: Response,
  progressCallback?: CacheProgressCallback,
): Promise<void> {
  deleteIfExists(file);
  file.create({
    intermediates: true,
    overwrite: true,
  });

  const total = Number.parseInt(response.headers.get('content-length') ?? '0', 10) || 0;
  let loaded = 0;

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const handle = file.open();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (value && value.length > 0) {
          handle.writeBytes(value);
          loaded += value.length;
          progressCallback?.({
            progress: total > 0 ? (loaded / total) * 100 : 0,
            loaded,
            total,
          });
        }
      }
    } finally {
      handle.close();
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    file.write(bytes);
    loaded = bytes.length;
    progressCallback?.({
      progress: 100,
      loaded,
      total: total || loaded,
    });
  }
}

function normalizeCacheRootDirectory(directory?: Directory | string): Directory {
  if (directory instanceof Directory) {
    return directory;
  }

  if (typeof directory === 'string') {
    return new Directory(directory);
  }

  return new Directory(Paths.cache, ...DEFAULT_MODEL_CACHE_PATH_SEGMENTS);
}

export function getDefaultExpoFileSystemModelCacheDirectory(): Directory {
  return normalizeCacheRootDirectory();
}

export function createExpoFileSystemCache(
  options: ExpoFileSystemCacheOptions = {},
): ExpoFileSystemCache {
  const rootDirectory = normalizeCacheRootDirectory(options.directory);
  ensureDirectory(rootDirectory);

  return {
    async match(request) {
      const { dataFile, metadataFile } = getCachePaths(rootDirectory, request);

      if (!dataFile.exists) {
        return undefined;
      }

      const metadata = await readMetadata(metadataFile);
      return new Response(dataFile, {
        headers: createResponseHeaders(dataFile, metadata),
        status: metadata?.status ?? 200,
      });
    },

    async put(request, response, progressCallback) {
      const { directory, dataFile, metadataFile, tempDataFile, tempMetadataFile } = getCachePaths(
        rootDirectory,
        request,
      );

      ensureDirectory(directory);

      try {
        await writeResponseToFile(tempDataFile, response, progressCallback);
        deleteIfExists(dataFile);
        tempDataFile.move(dataFile);

        await writeMetadata(metadataFile, tempMetadataFile, {
          request: serializeRequest(request),
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          cachedAt: Date.now(),
        });
      } catch (error: unknown) {
        deleteIfExists(tempDataFile);
        deleteIfExists(tempMetadataFile);
        throw error;
      }
    },

    async delete(request) {
      const { dataFile, metadataFile } = getCachePaths(rootDirectory, request);
      const hadData = dataFile.exists;
      const hadMetadata = metadataFile.exists;

      deleteIfExists(dataFile);
      deleteIfExists(metadataFile);

      return hadData || hadMetadata;
    },

    get directory() {
      return rootDirectory;
    },
  };
}
