/**
 * @fileoverview 浏览器本地令牌。
 * - visitor token：随机生成，仅用于数据库限流与“重复领取/重复反馈”去重。
 * - universal admin token：由网站所有者导入一次，可管理所有邀请码。
 * - published ids：本浏览器发布过的记录 id，仅用于显示“我发布的”标记。
 * 都不是账号身份，也不会被发送到第三方。
 */

const VISITOR_KEY = 'muse_invite_hub_visitor_token_v1';
const ADMIN_KEY = 'muse_invite_hub_admin_token_v1';
const PUBLISHED_KEY = 'muse_invite_hub_published_ids_v1';
const LEGACY_MANAGE_KEY = 'muse_invite_hub_manage_tokens_v1';
const MAX_PUBLISHED = 200;

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_err) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_err) {
    // Storage may be unavailable (private mode / quota).
  }
}

function randomToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${crypto.randomUUID()}${crypto.randomUUID()}`;
  }
  let token = '';
  for (let i = 0; i < 64; i += 1) {
    token += Math.floor(Math.random() * 16).toString(16);
  }
  return `${token}${Date.now().toString(16)}`;
}

let memoryVisitorToken = null;

export function getVisitorToken() {
  const stored = readStorage(VISITOR_KEY);
  if (stored && stored.length >= 16) return stored;
  if (memoryVisitorToken) return memoryVisitorToken;
  memoryVisitorToken = randomToken();
  writeStorage(VISITOR_KEY, memoryVisitorToken);
  return memoryVisitorToken;
}

/** Remove the old per-code management token store (universal key only now). */
export function clearLegacyManageTokens() {
  try {
    window.localStorage.removeItem(LEGACY_MANAGE_KEY);
  } catch (_err) {
    // ignore storage errors
  }
}

function readPublishedIds() {
  const raw = readStorage(PUBLISHED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id) : [];
  } catch (_err) {
    return [];
  }
}

function writePublishedIds(ids) {
  writeStorage(PUBLISHED_KEY, JSON.stringify(ids.slice(-MAX_PUBLISHED)));
}

export function markPublished(recordId) {
  if (!recordId) return;
  const ids = readPublishedIds();
  if (!ids.includes(recordId)) {
    ids.push(recordId);
    writePublishedIds(ids);
  }
}

export function isPublished(recordId) {
  if (!recordId) return false;
  return readPublishedIds().includes(recordId);
}

export function getAdminToken() {
  const token = readStorage(ADMIN_KEY);
  return typeof token === 'string' && /^[a-f0-9]{48}$/.test(token) ? token : null;
}

export function importAdminToken(token) {
  const normalized = String(token || '').trim().toLowerCase();
  if (!/^[a-f0-9]{48}$/.test(normalized)) return false;
  writeStorage(ADMIN_KEY, normalized);
  return true;
}

export function removeAdminToken() {
  try {
    window.localStorage.removeItem(ADMIN_KEY);
  } catch (_err) {
    // ignore storage errors
  }
}