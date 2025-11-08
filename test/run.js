const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { stripCommentsFromCode, stripPath } = require('../src/index.js');

async function run() {
  await testStripCommentsFromCode();
  await testStripPathDryRun();
  await testStripPathWithOutputDir();
  console.log('All tests passed.');
}

async function testStripCommentsFromCode() {
  const source = `
    // header
    const value = 1; /* inline */ const sum = value + 2;
    const jsx = <App title="demo">{/* jsx comment */}</App>;
  `;
  const { code, commentCount } = stripCommentsFromCode(source, { filename: 'sample.tsx' });
  assert.strictEqual(commentCount, 3, 'should remove all comment nodes');
  assert.ok(!code.includes('header'), 'line comment should be removed');
  assert.ok(!code.includes('inline'), 'block comment should be removed');
  assert.ok(!code.includes('jsx comment'), 'JSX block comment should be removed');
}

async function testStripPathDryRun() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'strip-js-comments-'));
  const filePath = path.join(tmpDir, 'example.js');
  await fs.writeFile(filePath, 'const a = 1; // remove me\n', 'utf8');

  const summary = await stripPath(filePath, { dryRun: true });
  assert.strictEqual(summary.filesScanned, 1);
  assert.strictEqual(summary.filesChanged, 1);
  assert.strictEqual(summary.commentsRemoved, 1);
  const original = await fs.readFile(filePath, 'utf8');
  assert.ok(original.includes('// remove me'), 'dry run must not alter files');
}

async function testStripPathWithOutputDir() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'strip-js-comments-src-'));
  const srcDir = path.join(tmpDir, 'src');
  const outDir = path.join(tmpDir, 'out');
  await fs.mkdir(path.join(srcDir, 'nested'), { recursive: true });

  const sourcePath = path.join(srcDir, 'nested', 'example.tsx');
  await fs.writeFile(
    sourcePath,
    'export const Button = () => {\n  return <button>// text{/* comment */}</button>;\n};\n',
    'utf8'
  );

  const summary = await stripPath(srcDir, { outPath: outDir });
  assert.strictEqual(summary.filesScanned, 1);
  const outputPath = path.join(outDir, 'nested', 'example.tsx');
  const stripped = await fs.readFile(outputPath, 'utf8');
  assert.ok(!stripped.includes('comment'), 'comments should be stripped in output directory');
  assert.ok(stripped.includes('// text'), 'content inside JSX text nodes should be preserved');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
