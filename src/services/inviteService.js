/**
 * @fileoverview Muse 邀请码互助站 - Supabase 数据访问层。
 *
 * 核心规则保持不变：
 * 1. 按入池时间升序（早入池排在最上边，新分享的排在队尾）。
 * 2. 次数用完（remaining_spots === 0）自动放入「已失效 (expired)」。
 *
 * 所有写操作都通过数据库 RPC 完成；前端不直接 INSERT/UPDATE/DELETE，
 * 也不依赖隐藏按钮来保护数据。
 */

import { INVITE_STATUS, resolveEffectiveStatus, validateInviteSubmission } from '../models/inviteCode.js';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js';
import { getManageToken, getVisitorToken, saveManageToken } from './tokenStore.js';

const LIST_LIMIT = 500;

const RPC_ERRORS = {
  duplicate_code: { messageKey: 'err_code_duplicate', fieldErrors: { code: 'err_code_duplicate' } },
  invalid_code: { fieldErrors: { code: 'err_code_format' } },
  invalid_spots: { fieldErrors: { remainingSpots: 'err_spots_range' } },
  rate_limited: { messageKey: 'err_rate_limited' },
  not_authorized: { messageKey: 'err_not_authorized' },
  already_claimed: { messageKey: 'err_already_claimed' },
  already_reported: { messageKey: 'err_already_reported' },
  not_available: { messageKey: 'err_not_available' },
  not_reportable: { messageKey: 'err_not_available' },
  not_found: { messageKey: 'err_not_found' },
  invalid_token: { messageKey: 'err_generic' },
  invalid_status: { messageKey: 'err_generic' }
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRecord(item) {
  const totalSpots = toNumber(item.total_spots, 30);
  const remainingSpots = toNumber(item.remaining_spots, 0);
  const normalized = {
    ...item,
    total_spots: totalSpots,
    remaining_spots: remainingSpots,
    claimed_count: toNumber(item.claimed_count, Math.max(0, totalSpots - remainingSpots)),
    fail_reports: toNumber(item.fail_reports, 0),
    is_local_session: Boolean(getManageToken(item.id))
  };
  normalized.status = resolveEffectiveStatus(normalized);
  return normalized;
}

function computeStats(records) {
  const stats = { available: 0, used: 0, expired: 0, total: records.length };
  records.forEach((record) => {
    if (record.status === INVITE_STATUS.AVAILABLE) stats.available += 1;
    else if (record.status === INVITE_STATUS.USED) stats.used += 1;
    else stats.expired += 1;
  });
  return stats;
}

function networkError() {
  return { code: 'network_error', messageKey: 'err_network' };
}

function mapRpcError(error) {
  if (!error) return null;
  const message = String(error.message || error.error_description || '').toLowerCase();
  const knownKey = Object.keys(RPC_ERRORS).find((key) => message.includes(key));
  if (knownKey) {
    return { code: knownKey, ...RPC_ERRORS[knownKey] };
  }
  if (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('load failed')
  ) {
    return networkError();
  }
  return { code: 'unknown_error', messageKey: 'err_generic' };
}

class InviteCodeService {
  constructor() {
    this._cache = [];
  }

  _clientOrError() {
    const client = getSupabaseClient();
    if (!client) {
      return {
        client: null,
        error: { code: 'not_configured', messageKey: 'err_backend_not_configured' }
      };
    }
    return { client, error: null };
  }

  async listInviteCodes() {
    const { client, error } = this._clientOrError();
    if (error) {
      return { data: [], stats: computeStats([]), error };
    }

    const [listRes, statsRes] = await Promise.all([
      client.rpc('list_invite_codes', {
        p_status: 'all',
        p_query: '',
        p_limit: LIST_LIMIT
      }),
      client.rpc('invite_stats')
    ]);

    if (listRes.error) {
      return { data: [], stats: computeStats([]), error: mapRpcError(listRes.error) };
    }

    const records = (Array.isArray(listRes.data) ? listRes.data : []).map(normalizeRecord);
    this._cache = [...records].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

    let stats = computeStats(records);
    if (!statsRes.error) {
      const row = Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data;
      if (row) {
        stats = {
          available: toNumber(row.available, stats.available),
          used: toNumber(row.used, stats.used),
          expired: toNumber(row.expired, stats.expired),
          total: toNumber(row.total, stats.total)
        };
      }
    }

    return { data: records, stats, error: null };
  }

  /**
   * 抽取可用邀请码：默认优先返回最早入池的可用码；
   * 点击“下一个”时按入池先后顺序轮换下一枚。
   */
  async drawNextAvailableCode(currentId = null) {
    const availablePool = this._cache.filter(
      (r) => r.status === INVITE_STATUS.AVAILABLE && r.remaining_spots > 0
    );

    if (availablePool.length === 0) {
      return { data: null, poolSize: 0 };
    }

    if (!currentId) {
      return { data: availablePool[0], poolSize: availablePool.length };
    }

    const currentIndex = availablePool.findIndex((r) => r.id === currentId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % availablePool.length;
    return {
      data: availablePool[nextIndex],
      poolSize: availablePool.length
    };
  }

  async createInviteCode(payload) {
    if (!isSupabaseConfigured) {
      return {
        data: null,
        error: { code: 'not_configured', messageKey: 'err_backend_not_configured' }
      };
    }

    const check = validateInviteSubmission(payload, this._cache);
    if (!check.valid) {
      return {
        data: null,
        error: { code: 'validation_error', fieldErrors: check.errors }
      };
    }

    const { client, error } = this._clientOrError();
    if (error) return { data: null, error };

    const { data, error: rpcError } = await client.rpc('publish_invite_code', {
      p_code: check.normalizedCode,
      p_remaining: check.normalizedSpots,
      p_client_token: getVisitorToken()
    });

    if (rpcError) {
      return { data: null, error: mapRpcError(rpcError) };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { data: null, error: { code: 'unknown_error', messageKey: 'err_generic' } };
    }

    if (row.manage_token) {
      saveManageToken(row.id, row.manage_token);
    }
    // Never keep the management token in application state/render data.
    const { manage_token: _manageToken, ...safeRow } = row;
    const record = normalizeRecord(safeRow);
    this._cache = [...this._cache.filter((item) => item.id !== record.id), record].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    );

    return { data: record, error: null };
  }

  /**
   * 社区操作与发布者状态管理。
   * - claim_one / report_dead：任何人可用，数据库按 visitor token 去重与限流。
   * - set_status：仅发布者可用，需要发布时保存在本浏览器的管理密钥。
   */
  async previewStatusUpdate({ id, actionType = 'set_status', nextStatus }) {
    const { client, error } = this._clientOrError();
    if (error) return { data: null, error };

    let rpcName;
    let params;

    if (actionType === 'claim_one') {
      rpcName = 'claim_invite_code_use';
      params = { p_id: id, p_reporter_token: getVisitorToken() };
    } else if (actionType === 'report_dead') {
      rpcName = 'report_invite_code_invalid';
      params = { p_id: id, p_reporter_token: getVisitorToken() };
    } else if (actionType === 'set_status') {
      const manageToken = getManageToken(id);
      if (!manageToken) {
        return { data: null, error: { code: 'not_authorized', messageKey: 'err_not_authorized' } };
      }
      rpcName = 'set_invite_code_status';
      params = { p_id: id, p_manage_token: manageToken, p_next_status: nextStatus };
    } else {
      return { data: null, error: { code: 'invalid_action', messageKey: 'err_generic' } };
    }

    const { data, error: rpcError } = await client.rpc(rpcName, params);
    if (rpcError) {
      return { data: null, error: mapRpcError(rpcError) };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { data: null, error: { code: 'not_found', messageKey: 'err_not_found' } };
    }

    return { data: normalizeRecord(row), error: null };
  }
}

export const inviteService = new InviteCodeService();
export { isSupabaseConfigured };
