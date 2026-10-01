import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const bundles = app => readdirSync(`apps/${app}/dist/assets`).filter(name => name.endsWith('.js')).map(name => readFileSync(`apps/${app}/dist/assets/${name}`, 'utf8')).join('\n');
const publicCode = bundles('showcase');
if (!publicCode) throw new Error('Missing public island bundle');
for (const marker of ['/api/v1', '/__dev/host', 'node:sqlite', 'HttpConversationClient', 'D1Repository']) {
  if (publicCode.includes(marker)) throw new Error(`Private adapter marker in public bundle: ${marker}`);
}
if (!bundles('local').includes('/api/v1')) throw new Error('Local UI did not include its real HTTP adapter');
console.log('Public and local generated bundles retain separate adapter graphs.');
