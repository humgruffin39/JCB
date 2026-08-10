import { readFileSync, writeFileSync } from 'node:fs';
import { renderLitestreamConfig } from '@jcb/config';
import { readBackupRetentionDaysFromPath } from './litestream-config.js';

const [templatePath, outputPath, databasePath] = process.argv.slice(2);
if (templatePath === undefined || outputPath === undefined || databasePath === undefined) {
  throw new Error('Usage: render-litestream-config <template-path> <output-path> <database-path>');
}

const retentionDays = readBackupRetentionDaysFromPath(databasePath);
const template = readFileSync(templatePath, 'utf8');
writeFileSync(outputPath, renderLitestreamConfig(template, retentionDays), {
  encoding: 'utf8',
  mode: 0o600,
});
process.stdout.write(`Litestream snapshot retention: ${retentionDays} days\n`);
