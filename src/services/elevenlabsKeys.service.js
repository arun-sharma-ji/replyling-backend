import crypto from "crypto";
import ElevenLabsKeyState from "../models/ElevenLabsKeyState.js";

// ElevenLabs API key rotation.
//
// Keys come from the environment only (nothing is stored in the repo):
//   ELEVENLABS_API_KEY            the original key (kept so existing deploys work unchanged)
//   eleven1 ... eleven8           extra keys (ELEVEN1..ELEVEN8 also accepted)
//
// Behaviour:
//  - Only one key configured (today's setup) => exactly the old behaviour: that
//    key is used, no database access, no rotation.
//  - Several keys => requests use the key that last worked. When ElevenLabs says
//    that key is out of credits (or invalid/blocked/rate limited) the request
//    moves on to the next key, and the next requests start from there instead
//    of from the first key. The state lives in MongoDB (ElevenLabsKeyState) so
//    all server instances agree; if the database is unreachable an in-memory
//    copy is used instead. A key that was skipped is retried after a cool-down
//    (credits reset monthly), so the rotation recovers on its own.
//  - Errors that are not about the key (ElevenLabs outage, bad request, network)
//    are NOT rotated: they are thrown straight away, as before.

const MAX_NUMBERED_KEYS = 8;

const COOLDOWN_QUOTA_MS = 6 * 60 * 60 * 1000; // out of credits: retry in 6h
const COOLDOWN_BAD_KEY_MS = 24 * 60 * 60 * 1000; // invalid / blocked / unpaid key: retry in 24h
const COOLDOWN_RATE_LIMIT_MS = 60 * 1000; // too many requests: skip for a minute

const fingerprint = (apiKey) => crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 10);

export function getElevenLabsKeys() {
  const raw = [process.env.ELEVENLABS_API_KEY];
  for (let i = 1; i <= MAX_NUMBERED_KEYS; i += 1) {
    raw.push(process.env[`eleven${i}`] ?? process.env[`ELEVEN${i}`]);
  }
  const seen = new Set();
  const keys = [];
  raw.forEach((value) => {
    const apiKey = typeof value === "string" ? value.trim() : "";
    if (!apiKey || seen.has(apiKey)) return;
    seen.add(apiKey);
    keys.push({ apiKey, fp: fingerprint(apiKey), label: keys.length + 1 });
  });
  return keys;
}

export function hasElevenLabsKeys() {
  return getElevenLabsKeys().length > 0;
}

// What did ElevenLabs say? Works for axios errors whose body is an arraybuffer.
function readErrorInfo(error) {
  const status = error?.response?.status ?? null;
  let body = error?.response?.data;
  let detail = null;
  try {
    if (body && !Buffer.isBuffer(body) && body.byteLength !== undefined) body = Buffer.from(body);
    const text = Buffer.isBuffer(body) ? body.toString("utf8") : typeof body === "string" ? body : null;
    const parsed = text ? JSON.parse(text) : body;
    detail = parsed?.detail ?? parsed ?? null;
  } catch {
    detail = null;
  }
  const code = String(detail?.status ?? detail?.code ?? "").toLowerCase();
  const message = String(detail?.message ?? (typeof detail === "string" ? detail : "") ?? "").toLowerCase();
  return { status, code, message };
}

// "quota" | "rate" | "badKey" | null (null => not a key problem, don't rotate)
export function classifyElevenLabsError(error) {
  const { status, code, message } = readErrorInfo(error);
  if (code.includes("quota") || message.includes("quota") || message.includes("credits")) return "quota";
  if (status === 429 || code.includes("too_many") || code.includes("rate_limit") || code === "system_busy") {
    return "rate";
  }
  if (
    status === 401 ||
    status === 402 ||
    code.includes("invalid_api_key") ||
    code.includes("unusual_activity") ||
    code.includes("payment")
  ) {
    return "badKey";
  }
  return null;
}

const COOLDOWNS = { quota: COOLDOWN_QUOTA_MS, badKey: COOLDOWN_BAD_KEY_MS, rate: COOLDOWN_RATE_LIMIT_MS };

// In-memory copy: used when MongoDB can't be reached, and as a cache.
const memory = { activeFp: null, until: {} };

async function loadState() {
  try {
    const doc = await ElevenLabsKeyState.findOne({ key: "main" }).maxTimeMS(2000).lean();
    if (doc) {
      memory.activeFp = doc.activeFingerprint || null;
      const until = {};
      Object.entries(doc.unavailableUntil || {}).forEach(([fp, date]) => {
        until[fp] = new Date(date).getTime();
      });
      memory.until = until;
    }
  } catch (error) {
    console.warn("[elevenlabs] Key state unavailable, using in-memory state:", error.message);
  }
  return memory;
}

async function saveState(update) {
  try {
    await ElevenLabsKeyState.updateOne({ key: "main" }, update, { upsert: true }).maxTimeMS(2000);
  } catch (error) {
    console.warn("[elevenlabs] Could not save key state:", error.message);
  }
}

async function markUnavailable(entry, kind) {
  const until = Date.now() + COOLDOWNS[kind];
  memory.until[entry.fp] = until;
  await saveState({ $set: { [`unavailableUntil.${entry.fp}`]: new Date(until) } });
}

async function markActive(entry) {
  if (memory.activeFp === entry.fp) return;
  memory.activeFp = entry.fp;
  await saveState({ $set: { activeFingerprint: entry.fp } });
}

/**
 * Runs `task(apiKey)` with the right ElevenLabs key, switching keys when one is
 * out of credits. Throws the task's own error when it isn't a key problem, or
 * the last error if every key failed.
 */
export async function withElevenLabsKey(task) {
  const keys = getElevenLabsKeys();
  if (keys.length === 0) {
    throw new Error("No ElevenLabs API key is configured.");
  }
  // Single key: identical to the pre-rotation behaviour (no DB, no rotation).
  if (keys.length === 1) return task(keys[0].apiKey);

  const state = await loadState();
  const now = Date.now();

  // Start at the key that last worked, wrap around, skip keys cooling down.
  let startIndex = Math.max(0, keys.findIndex((k) => k.fp === state.activeFp));
  const ordered = keys.map((_, i) => keys[(startIndex + i) % keys.length]);
  let candidates = ordered.filter((k) => !(state.until[k.fp] > now));
  if (candidates.length === 0) {
    // Everything is cooling down: try the key that frees up first, once.
    candidates = [ordered.reduce((a, b) => ((state.until[a.fp] ?? 0) <= (state.until[b.fp] ?? 0) ? a : b))];
  }

  let lastError;
  for (const entry of candidates) {
    try {
      const result = await task(entry.apiKey);
      await markActive(entry);
      return result;
    } catch (error) {
      lastError = error;
      const kind = classifyElevenLabsError(error);
      if (!kind) throw error; // not about the key
      console.warn(`[elevenlabs] Key #${entry.label} unavailable (${kind}), trying the next key.`);
      await markUnavailable(entry, kind);
    }
  }
  console.error(`[elevenlabs] All ${candidates.length} available key(s) failed.`);
  throw lastError;
}
