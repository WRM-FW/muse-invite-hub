/**
 * @fileoverview 浏览器本地令牌。
 * - visitor token：随机生成，仅用于数据库限流与“重复领取/重复反馈”去重。
 * - management token：发布成功后由数据库一次性返回，用于发布者之后切换状态。
 * 两者都不是账号身份，也不会被发送到第三方。
 */

const VISITOR_KEY = 'muse_invite_hub_visitor_token_v1';
const MANAGE_KEY = 'muse_invite_hub_manage_tokens_v1';
const MAX_MANAGE_ENTRIES = 200;

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
    // Storage may be unavailable (private mode / quota). The app still works
    // for reading; publishing falls back to an in-memory token.
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

function readManageTokens() {
  const raw = readStorage(MANAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function writeManageTokens(map) {
  writeStorage(MANAGE_KEY, JSON.stringify(map));
}

export function saveManageToken(recordId, token) {
  if (!recordId || !token) return;
  const map = readManageTokens();
  map[recordId] = token;
  const ids = Object.keys(map);
  if (ids.length > MAX_MANAGE_ENTRIES) {
    ids.slice(0, ids.length - MAX_MANAGE_ENTRIES).forEach((id) => {
      delete map[id];
    });
  }
  writeManageTokens(map);
}

export function getManageToken(recordId) {
  if (!recordId) return null;
  const token = readManageTokens()[recordId];
  return typeof token === 'string' && token.length >= 32 ? token : null;
}

export function importManageToken(recordId, token) {
  const normalized = String(token || '').trim().toLowerCase();
  if (!recordId || !/^[a-f0-9]{48}$/.test(normalized)) return false;
  saveManageToken(recordId, normalized);
  return true;
}

export function removeManageToken(recordId) {
  if (!recordId) return;
  const map = readManageTokens();
  if (!Object.prototype.hasOwnProperty.call(map, recordId)) return;
  delete map[recordId];
  writeManageTokens(map);
}
