const fs = require('fs/promises');
const path = require('path');
const parser = require('@babel/parser');

const SUPPORTED_EXTENSIONS = [
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.cts',
  '.mts'
];

const COMMON_PLUGINS = [
  'classProperties',
  'classPrivateProperties',
  'classPrivateMethods',
  'dynamicImport',
  'optionalCatchBinding',
  'optionalChaining',
  'nullishCoalescingOperator',
  'objectRestSpread',
  'topLevelAwait',
  'throwExpressions',
  'numericSeparator',
  'importMeta',
  'exportDefaultFrom',
  'doExpressions',
  'functionBind'
];

const LANGUAGE_PLUGIN_SETS = [
  ['jsx', 'typescript'],
  ['jsx', 'flow', 'flowComments'],
  ['jsx'],
  []
];

const DECORATOR_PLUGINS = [
  ['decorators', { decoratorsBeforeExport: true }],
  'decorators-legacy'
];

const DEFAULT_PLUGIN_SETS = buildDefaultPluginSets();

function buildDefaultPluginSets() {
  const sets = [];
  for (const decoratorPlugin of DECORATOR_PLUGINS) {
    for (const languagePlugins of LANGUAGE_PLUGIN_SETS) {
      sets.push([...languagePlugins, decoratorPlugin, ...COMMON_PLUGINS]);
    }
  }
  sets.push([...COMMON_PLUGINS]);
  return sets;
}

async function stripPath(targetPath, options = {}) {
  const {
    dryRun = false,
    overwrite = false,
    outPath,
    extensions,
    parserPlugins
  } = options;

  if (!targetPath) {
    throw new Error('A file or directory path is required.');
  }

  if (!dryRun && !overwrite && !outPath) {
    throw new Error('Refusing to modify files. Pass --overwrite or provide an output path, or add --dry-run.');
  }

  const resolvedTarget = path.resolve(targetPath);
  let stats;
  try {
    stats = await fs.stat(resolvedTarget);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Path not found: ${resolvedTarget}`);
    }
    throw error;
  }
  const extensionSet = buildExtensionSet(extensions);
  const outputBase = outPath ? path.resolve(outPath) : undefined;
  const summary = createEmptySummary(resolvedTarget, outputBase);

  if (stats.isDirectory()) {
    await processDirectory({
      dirPath: resolvedTarget,
      outputBase,
      dryRun,
      overwrite,
      extensionSet,
      summary,
      parserPlugins
    });
  } else if (stats.isFile()) {
    if (!hasSupportedExtension(resolvedTarget, extensionSet)) {
      throw new Error(`Unsupported file extension for ${resolvedTarget}. Pass --extensions to override.`);
    }

    const outInfo = await resolveOutputForFile(resolvedTarget, outputBase);
    await processFile({
      inputPath: resolvedTarget,
      outputPath: outInfo.outputPath,
      dryRun,
      overwrite,
      summary,
      parserPlugins,
      alwaysWrite: outInfo.alwaysWrite
    });
  } else {
    throw new Error(`Path is neither a file nor a directory: ${resolvedTarget}`);
  }

  return summary;
}

async function processDirectory({
  dirPath,
  outputBase,
  dryRun,
  overwrite,
  extensionSet,
  summary,
  parserPlugins
}) {
  if (outputBase) {
    const existing = await statIfExists(outputBase);
    if (existing && !existing.isDirectory()) {
      throw new Error('Output path must be a directory when processing a directory.');
    }
  }

  const files = await gatherFiles(dirPath, extensionSet);
  for (const filePath of files) {
    const relative = path.relative(dirPath, filePath);
    const destination = outputBase ? path.join(outputBase, relative) : filePath;
    const alwaysWrite = Boolean(outputBase && path.resolve(destination) !== path.resolve(filePath));
    await processFile({
      inputPath: filePath,
      outputPath: destination,
      dryRun,
      overwrite,
      summary,
      parserPlugins,
      alwaysWrite
    });
  }
}

async function gatherFiles(dirPath, extensionSet) {
  const collected = [];
  const queue = [dirPath];

  while (queue.length) {
    const current = queue.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const resolved = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        queue.push(resolved);
      } else if (entry.isFile() && hasSupportedExtension(entry.name, extensionSet)) {
        collected.push(resolved);
      }
    }
  }

  return collected;
}

async function processFile({
  inputPath,
  outputPath,
  dryRun,
  overwrite,
  summary,
  parserPlugins,
  alwaysWrite = false
}) {
  summary.filesScanned += 1;
  const source = await fs.readFile(inputPath, 'utf8');
  const { code, commentCount, removedChars, removedRanges } = stripCommentsFromCode(source, {
    filename: inputPath,
    plugins: parserPlugins
  });
  const changed = code !== source;
  const destPath = outputPath ?? inputPath;
  const sameDestination = path.resolve(destPath) === path.resolve(inputPath);
  const willWrite = !dryRun && (!sameDestination || changed || alwaysWrite);

  if (willWrite) {
    const destinationExists = await pathExists(destPath);
    if (destinationExists && !overwrite) {
      if (sameDestination) {
        throw new Error(
          `Refusing to overwrite ${destPath}. Pass the overwrite option when calling the API or CLI.`
        );
      }

      throw new Error(`Destination file already exists: ${destPath}. Pass --overwrite to replace it.`);
    }

    await ensureDir(path.dirname(destPath));
    await fs.writeFile(destPath, code, 'utf8');
  }

  if (commentCount > 0) {
    summary.filesChanged += 1;
    summary.commentsRemoved += commentCount;
    summary.bytesRemoved += removedChars;
  }

  summary.results.push({
    inputPath,
    outputPath: destPath,
    commentCount,
    removedChars,
    removedRanges,
    changed,
    wroteFile: Boolean(willWrite)
  });
}

function stripCommentsFromCode(code, parserOptions = {}) {
  if (typeof code !== 'string') {
    throw new TypeError('Code must be a string.');
  }

  const filename = parserOptions.filename ?? 'unknown';
  const customPlugins = parserOptions.plugins;
  const pluginSets = customPlugins ? [customPlugins] : DEFAULT_PLUGIN_SETS;
  let ast;
  let lastError;

  for (const plugins of pluginSets) {
    try {
      ast = parser.parse(code, {
        sourceType: 'unambiguous',
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
        allowImportExportEverywhere: true,
        ranges: true,
        plugins
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!ast) {
    const error = new Error(`Failed to parse ${filename}: ${lastError?.message ?? 'Unknown parser error'}`);
    error.cause = lastError;
    throw error;
  }

  const comments = Array.isArray(ast.comments) ? ast.comments : [];
  if (!comments.length) {
    return {
      code,
      commentCount: 0,
      removedChars: 0,
      removedRanges: []
    };
  }

  const ranges = comments
    .map(({ start, end }) => ({ start, end }))
    .filter(({ start, end }) => typeof start === 'number' && typeof end === 'number' && start < end)
    .sort((a, b) => a.start - b.start);

  const { output, removed } = removeRanges(code, ranges);

  return {
    code: output,
    commentCount: ranges.length,
    removedChars: removed,
    removedRanges: ranges
  };
}

function removeRanges(source, ranges) {
  let cursor = 0;
  let removed = 0;
  let output = '';

  for (const range of ranges) {
    if (range.start < cursor) {
      continue;
    }

    output += source.slice(cursor, range.start);
    removed += range.end - range.start;
    cursor = range.end;
  }

  output += source.slice(cursor);
  return { output, removed };
}

async function resolveOutputForFile(filePath, outPath) {
  if (!outPath) {
    return { outputPath: filePath, alwaysWrite: false };
  }

  const resolvedOut = path.resolve(outPath);
  const outStats = await statIfExists(resolvedOut);
  const treatAsDirectory = outStats ? outStats.isDirectory() : path.extname(resolvedOut) === '';

  if (treatAsDirectory) {
    return {
      outputPath: path.join(resolvedOut, path.basename(filePath)),
      alwaysWrite: true
    };
  }

  return {
    outputPath: resolvedOut,
    alwaysWrite: false
  };
}

function hasSupportedExtension(filePath, extensionSet) {
  const ext = path.extname(filePath).toLowerCase();
  return extensionSet.has(ext);
}

function buildExtensionSet(extensions) {
  if (!extensions) {
    return new Set(SUPPORTED_EXTENSIONS);
  }

  if (extensions instanceof Set) {
    return extensions;
  }

  const normalized = (Array.isArray(extensions) ? extensions : String(extensions).split(','))
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));

  if (!normalized.length) {
    throw new Error('At least one extension must be provided when overriding supported extensions.');
  }

  return new Set(normalized);
}

function createEmptySummary(target, outputBase) {
  return {
    target,
    outputBase: outputBase ?? null,
    filesScanned: 0,
    filesChanged: 0,
    commentsRemoved: 0,
    bytesRemoved: 0,
    results: []
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function statIfExists(fsPath) {
  try {
    return await fs.stat(fsPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function pathExists(fsPath) {
  return Boolean(await statIfExists(fsPath));
}

module.exports = {
  stripPath,
  stripCommentsFromCode,
  SUPPORTED_EXTENSIONS
};
