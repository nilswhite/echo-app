/**
 * Model catalog — live model lists fetched from each provider's `/v1/models` API.
 *
 * Cached to userData/model-cache.json for 24h. Settings UI calls `listModels(provider)`
 * to populate the model dropdown; "Refresh" forces revalidation via `refreshModels()`.
 *
 * If a fetch fails (no key, offline, 4xx), we fall back to a tiny built-in list so the
 * dropdown is never empty.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getOpenAIKey, getAnthropicKey, type StructuringProvider } from './settings-store.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  models: string[];
  fetchedAt: number;
}

interface CacheFile {
  anthropic?: CacheEntry;
  openai?: CacheEntry;
}

const FALLBACK: Record<StructuringProvider, string[]> = {
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'],
};

function cachePath(): string {
  return path.join(app.getPath('userData'), 'model-cache.json');
}

function readCache(): CacheFile {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf-8')) as CacheFile;
  } catch {
    return {};
  }
}

function writeCache(cache: CacheFile): void {
  const file = cachePath();
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, file);
}

function isFresh(entry?: CacheEntry): boolean {
  return !!entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function fetchAnthropicModels(): Promise<string[]> {
  const key = getAnthropicKey();
  if (!key) throw new Error('No Anthropic API key configured.');
  const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
  });
  if (!res.ok) throw new Error(`Anthropic /v1/models ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return (json.data || []).map((m) => m.id).sort();
}

// Filter OpenAI's `/v1/models` (which returns embeddings, audio, image, etc.) down to chat-capable ids.
function isChatCapableOpenAIModel(id: string): boolean {
  if (!/^(gpt-|o1|o3|o4)/.test(id)) return false;
  const denylistFragments = ['embed', 'tts', 'whisper', 'audio', 'realtime', 'instruct', 'dall-e', 'transcribe', 'image'];
  return !denylistFragments.some((frag) => id.includes(frag));
}

async function fetchOpenAIModels(): Promise<string[]> {
  const key = getOpenAIKey();
  if (!key) throw new Error('No OpenAI API key configured.');
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`OpenAI /v1/models ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return (json.data || [])
    .map((m) => m.id)
    .filter(isChatCapableOpenAIModel)
    .sort();
}

async function fetchProvider(provider: StructuringProvider): Promise<string[]> {
  return provider === 'anthropic' ? fetchAnthropicModels() : fetchOpenAIModels();
}

/**
 * Returns the model list for a provider. Uses the cache if fresh; otherwise refreshes.
 * On failure, returns whatever's cached (even if stale) or the built-in fallback.
 */
export async function listModels(provider: StructuringProvider): Promise<{ models: string[]; source: 'cache' | 'live' | 'fallback' }> {
  const cache = readCache();
  const entry = cache[provider];
  if (isFresh(entry)) return { models: entry!.models, source: 'cache' };

  try {
    const models = await fetchProvider(provider);
    cache[provider] = { models, fetchedAt: Date.now() };
    writeCache(cache);
    return { models, source: 'live' };
  } catch (err) {
    console.error(`[model-catalog] live fetch failed for ${provider}:`, (err as Error).message);
    if (entry?.models?.length) return { models: entry.models, source: 'cache' };
    return { models: FALLBACK[provider], source: 'fallback' };
  }
}

/** Force a live refetch, bypassing the cache. */
export async function refreshModels(provider: StructuringProvider): Promise<{ models: string[]; source: 'live' | 'fallback' }> {
  try {
    const models = await fetchProvider(provider);
    const cache = readCache();
    cache[provider] = { models, fetchedAt: Date.now() };
    writeCache(cache);
    return { models, source: 'live' };
  } catch (err) {
    console.error(`[model-catalog] refresh failed for ${provider}:`, (err as Error).message);
    return { models: FALLBACK[provider], source: 'fallback' };
  }
}
