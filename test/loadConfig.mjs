import { readFile } from 'node:fs/promises';
import { ConfigLoader } from '../src/core/ConfigLoader.js';

export const loadConfig = () =>
  new ConfigLoader(async (n) => JSON.parse(await readFile(new URL(`../config/${n}.json`, import.meta.url)))).loadAll();
