const { Directory, File, Paths } = require('expo-file-system');

const DEFAULT_MODEL_CACHE_PATH_SEGMENTS = Object.freeze([
  'automatalabs-react-native-transformers',
  'models',
]);

function hashString(value) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeSegment(value) {
  const normalized = encodeURIComponent(String(value))
    .replace(/%/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized.slice(0, 120) || 'index';
}

function getRequestPathSegments(request) {
  const value = String(request ?? '');

  try {
    const url = new URL(value);
    const segments = [sanitizeSegment(url.protocol.replace(/:$/, '')), sanitizeSegment(url.host)];
    const pathnameSegments = url.pathname.split('/').filter(Boolean).map((segment) => sanitizeSegment(segment));

    segments.push(...pathnameSegments);

    if (segments.length === 2) {
      segments.push('index');
    }

    if (url.search) {
      segments[segments.length - 1] = `${segments[segments.length - 1]}__q_${hashString(url.search)}`;
    }

    return segments;
  } catch {
    const segments = value.split('/').filter(Boolean).map((segment) => sanitizeSegment(segment));
    return segments.length > 0 ? segments : ['index'];
  }
}

function ensureDirectory(directory) {
  if (!directory.exists) {
    directory.create({
      intermediates: true,
      idempotent: true,
    });
  }
}

function deleteIfExists(file) {
  if (file?.exists) {
    try {
      file.delete();
    } catch {
      // ignore cleanup failures
    }
  }
}

function getCachePaths(rootDirectory, request) {
  const requestPathSegments = getRequestPathSegments(request);
  const directorySegments = requestPathSegments.slice(0, -1);
  const leafSegment = requestPathSegments.at(-1) ?? 'index';
  const requestHash = hashString(String(request ?? ''));
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

async function readMetadata(metadataFile) {
  if (!metadataFile.exists) {
    return null;
  }

  try {
    return JSON.parse(await metadataFile.text());
  } catch {
    return null;
  }
}

function createResponseHeaders(dataFile, metadata) {
  const headers = new Headers(metadata?.headers ?? {});

  if (!headers.has('content-length')) {
    headers.set('content-length', String(dataFile.size ?? 0));
  }

  return headers;
}

async function writeMetadata(metadataFile, tempMetadataFile, metadata) {
  deleteIfExists(tempMetadataFile);
  tempMetadataFile.create({
    intermediates: true,
    overwrite: true,
  });
  tempMetadataFile.write(JSON.stringify(metadata));
  deleteIfExists(metadataFile);
  tempMetadataFile.move(metadataFile);
}

async function writeResponseToFile(file, response, progressCallback) {
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

function normalizeCacheRootDirectory(directory) {
  if (directory instanceof Directory) {
    return directory;
  }

  if (typeof directory === 'string') {
    return new Directory(directory);
  }

  return new Directory(Paths.cache, ...DEFAULT_MODEL_CACHE_PATH_SEGMENTS);
}

function getDefaultExpoFileSystemModelCacheDirectory() {
  return normalizeCacheRootDirectory();
}

function createExpoFileSystemCache(options = {}) {
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

    async put(request, response, progressCallback = undefined) {
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
          request: String(request ?? ''),
          status: response.status ?? 200,
          headers: Object.fromEntries(response.headers.entries()),
          cachedAt: Date.now(),
        });
      } catch (error) {
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

module.exports = {
  createExpoFileSystemCache,
  getDefaultExpoFileSystemModelCacheDirectory,
};
