// Validates config/*.json (cross references, mass balance). Exit code 1 on errors.
import { readFile } from 'node:fs/promises';
import { ConfigLoader } from '../src/core/ConfigLoader.js';
import { ConfigValidator } from '../src/chemistry/ConfigValidator.js';

const cfg = await new ConfigLoader(async (n) => JSON.parse(await readFile(new URL(`../config/${n}.json`, import.meta.url)))).loadAll();
const { errors, warnings } = ConfigValidator.validate(cfg);
warnings.forEach((w) => console.warn('warning:', w));
errors.forEach((e) => console.error('error:', e));
console.log(errors.length ? `${errors.length} error(s)` : 'config OK');
process.exit(errors.length ? 1 : 0);
