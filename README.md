## strip-js-comments

Remove every comment from modern JavaScript and TypeScript files with a single command. The CLI understands JSX, decorators, Flow, TypeScript, and the file extensions used across React, Next.js, and Node.js projects.

### Highlights
- Works with `.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, `.tsx`, `.cts`, `.mts` (configurable via `--extensions`)
- Accepts individual files or entire directories (recursively)
- Safe by default: dry-run mode plus explicit `--overwrite` gating for in-place edits
- Write stripped sources somewhere else via `--out <file|dir>`
- JSON summaries for scripting plus a programmatic Node API
- Built on top of `@babel/parser`, so it keeps pace with the latest language features

---

## Installation

```bash
npm install --global strip-js-comments
# or
npx strip-js-comments --help
```

---

## CLI Usage

```
Usage: strip-js-comments [options] <targets...>

Remove comments from modern JavaScript / TypeScript sources.

Arguments:
  targets                   File(s) or directories to process.

Options:
  -o, --out <path>          Write stripped files to this path (file or directory).
      --dry-run             Preview the files that would be written without modifying anything.
      --overwrite           Allow overwriting the input files or existing outputs.
  -e, --extensions <list>   Comma-separated list of file extensions to include.
      --json                Emit a machine-readable JSON summary.
      --silent              Suppress human-readable logs (useful when piping JSON).
  -h, --help                Display help for command

Supported extensions: .js, .cjs, .mjs, .jsx, .ts, .tsx, .cts, .mts
```

### Common examples

```bash
# Preview what would change
strip-js-comments src --dry-run

# Overwrite files in place (requires explicit flag)
strip-js-comments src --overwrite

# Output to a sibling directory (creates it if needed)
strip-js-comments src --out dist/stripped

# Process a single file and write to another file
strip-js-comments component.jsx --out component.strip.jsx

# Emit JSON for scripting
strip-js-comments app --overwrite --json --silent > report.json

# Limit processed extensions
strip-js-comments src --extensions .js,.jsx --overwrite
```

### Operational details
- Directories are traversed recursively; symbolic links are skipped to avoid accidental loops.
- Only files whose extension matches the allowlist are read or written.
- When `--out` is set:
  - Directories mirror the source tree structure.
  - Files are written even if no comments were removed so the output tree is complete.
- Without `--out`, the tool requires `--overwrite` to avoid accidental mutation.
- `--json` returns `{ summaries: [...], totals: { ... } }`, mirroring the CLI stats.

---

## Node.js API

```js
const { stripCommentsFromCode, stripPath } = require('strip-js-comments');
```

### `stripCommentsFromCode(code, parserOptions?)`

Removes every comment node from the provided string.

Returns:

```ts
{
  code: string;          // comment-free source
  commentCount: number;  // number of removed comments
  removedChars: number;  // total character count removed
  removedRanges: Array<{ start: number; end: number }>;
}
```

You can pass any `@babel/parser` option (for example a custom `plugins` array) via `parserOptions`.

### `stripPath(targetPath, options?)`

Strips an individual file or an entire directory tree.

Options:

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `dryRun` | boolean | `false` | Collect stats without writing files. |
| `overwrite` | boolean | `false` | Required for in-place edits or when replacing existing outputs. |
| `outPath` | string | `undefined` | Write results to this file or directory. Required if `overwrite` is false and you’re not in dry-run mode. |
| `extensions` | string \| string[] \| Set | built-in list | Override the extension allowlist (provide `.js`-style entries). |
| `parserPlugins` | string[] | internal presets | Override the parser plugin list. |

Result:

```ts
{
  target: string;
  outputBase: string | null;
  filesScanned: number;
  filesChanged: number;
  commentsRemoved: number;
  bytesRemoved: number;
  results: Array<{
    inputPath: string;
    outputPath: string;
    commentCount: number;
    removedChars: number;
    changed: boolean;
    wroteFile: boolean;
  }>;
}
```

---

## Development

```bash
git clone <repo>
cd strip-js-comments
npm install
npm test
```

The test suite performs both unit-level (`stripCommentsFromCode`) and integration (`stripPath`) checks using temporary files.

---

## License

[MIT](./LICENSE)
