#!/usr/bin/env node

const path = require('path');
const { Command } = require('commander');
const { stripPath, SUPPORTED_EXTENSIONS } = require('../src/index.js');

const program = new Command();

program
  .name('decommentjs')
  .description('Remove comments from modern JavaScript / TypeScript sources.')
  .argument('<targets...>', 'File(s) or directories to process.')
  .option('-o, --out <path>', 'Write stripped files to this path (file or directory).')
  .option('--dry-run', 'Preview the files that would be written without modifying anything.')
  .option('--overwrite', 'Allow overwriting the input files or existing outputs.')
  .option('-e, --extensions <list>', 'Comma-separated list of file extensions to include.')
  .option('--json', 'Emit a machine-readable JSON summary.')
  .option('--silent', 'Suppress human-readable logs (useful when piping JSON).')
  .showHelpAfterError('(use --help for usage information)');

program.addHelpText('after', `\nSupported extensions: ${SUPPORTED_EXTENSIONS.join(', ')}`);

program.parse(process.argv);

const options = program.opts();
const targets = program.args;

if (!targets.length) {
  program.help({ error: true });
}

if (options.out && targets.length > 1) {
  console.error('The --out option can only be used with a single target path.');
  process.exit(1);
}

const cliOptions = {
  dryRun: Boolean(options.dryRun),
  overwrite: Boolean(options.overwrite),
  outPath: options.out ? path.resolve(options.out) : undefined,
  extensions: options.extensions
};

const summaries = [];
(async () => {
  for (const target of targets) {
    try {
      const summary = await stripPath(target, cliOptions);
      summaries.push(summary);
      if (!options.silent && !options.json) {
        logSummary(summary);
      }
    } catch (error) {
      handleError(target, error);
    }
  }

  if (options.json) {
    const payload = {
      summaries,
      totals: combineSummaries(summaries)
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (!options.silent) {
    printTotals(summaries);
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

function handleError(target, error) {
  console.error(`Failed to process ${target}: ${error.message}`);
  process.exit(1);
}

function logSummary(summary) {
  const relTarget = path.relative(process.cwd(), summary.target);
  console.log(`\nTarget: ${relTarget || summary.target}`);
  console.log(`  Files scanned : ${summary.filesScanned}`);
  console.log(`  Files changed : ${summary.filesChanged}`);
  console.log(`  Comments gone : ${summary.commentsRemoved}`);
  console.log(`  Bytes removed : ${summary.bytesRemoved}`);
}

function printTotals(summaries) {
  const totals = combineSummaries(summaries);
  if (!summaries.length) {
    console.log('No supported files were found.');
    return;
  }

  console.log('\nDone.');
  console.log(`  Total targets : ${summaries.length}`);
  console.log(`  Files scanned : ${totals.filesScanned}`);
  console.log(`  Files changed : ${totals.filesChanged}`);
  console.log(`  Comments gone : ${totals.commentsRemoved}`);
  console.log(`  Bytes removed : ${totals.bytesRemoved}`);
}

function combineSummaries(summaries) {
  return summaries.reduce(
    (acc, summary) => {
      acc.filesScanned += summary.filesScanned;
      acc.filesChanged += summary.filesChanged;
      acc.commentsRemoved += summary.commentsRemoved;
      acc.bytesRemoved += summary.bytesRemoved;
      return acc;
    },
    {
      filesScanned: 0,
      filesChanged: 0,
      commentsRemoved: 0,
      bytesRemoved: 0
    }
  );
}
