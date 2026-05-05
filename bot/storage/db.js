import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');

const cache = {};
const timers = {};
const DEBOUNCE_MS = 1500;

async function ensureDir(dir) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

function filePath(name) {
  return join(DATA_DIR, `${name}.json`);
}

export async function loadAll() {
  await ensureDir(DATA_DIR);
  const files = ['guilds', 'panels', 'tickets', 'cooldowns', 'plans', 'reviews', 'orders', 'suggestions', 'autoresponses', 'faqs', 'commandlocks'];
  await Promise.all(files.map(f => load(f)));
  logger.success(`Storage loaded (${files.length} collections)`);
}

async function load(name) {
  const fp = filePath(name);
  try {
    const raw = await readFile(fp, 'utf8');
    cache[name] = JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') {
      cache[name] = {};
      await flush(name);
    } else {
      logger.warn(`Corrupt file ${name}.json — backing up and resetting`);
      try { await writeFile(fp + '.bak', await readFile(fp, 'utf8')); } catch {}
      cache[name] = {};
      await flush(name);
    }
  }
}

async function flush(name) {
  await ensureDir(DATA_DIR);
  await writeFile(filePath(name), JSON.stringify(cache[name], null, 2), 'utf8');
}

function debouncedSave(name) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => flush(name).catch(e => logger.error(`Save ${name} failed`, e)), DEBOUNCE_MS);
}

export function getAll(name) {
  return cache[name] ?? {};
}

export function get(name, key) {
  return (cache[name] ?? {})[key] ?? null;
}

export function set(name, key, value) {
  if (!cache[name]) cache[name] = {};
  cache[name][key] = value;
  debouncedSave(name);
}

export function del(name, key) {
  if (cache[name]) {
    delete cache[name][key];
    debouncedSave(name);
  }
}

export function saveNow(name) {
  clearTimeout(timers[name]);
  return flush(name);
}
