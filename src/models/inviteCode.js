/**
 * @fileoverview Muse 邀请码互助站 - 数据模型与校验
 * 核心规则：
 * 1. 严格按入池时间升序排列（FIFO：越早入池的邀请码排在越上面，优先被看到和消化）。
 * 2. 剩余次数用完（remaining_spots <= 0）、累计 3 次失效反馈或到了 expires_at 时，
 *    自动归入「已失效 (expired)」。
 */

export const INVITE_STATUS = Object.freeze({
  AVAILABLE: 'available',
  USED: 'used',
  EXPIRED: 'expired'
});

export const FILTER_STATUS = Object.freeze({
  AVAILABLE: 'available',
  ALL: 'all',
  USED: 'used',
  EXPIRED: 'expired'
});

const MAX_DESCRIPTION_LENGTH = 280;
const MAX_EXPIRY_DAYS = 90;

export function resolveEffectiveStatus(record) {
  if (!record) return INVITE_STATUS.EXPIRED;
  if (record.status === INVITE_STATUS.EXPIRED) return INVITE_STATUS.EXPIRED;
  if (record.expires_at) {
    const expiresAt = Date.parse(record.expires_at);
    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      return INVITE_STATUS.EXPIRED;
    }
  }
  if (typeof record.fail_reports === 'number' && record.fail_reports >= 3) {
    return INVITE_STATUS.EXPIRED;
  }
  // 次数用完后自动放入“已失效”
  if (typeof record.remaining_spots === 'number' && record.remaining_spots <= 0) {
    return INVITE_STATUS.EXPIRED;
  }
  if (record.status === INVITE_STATUS.USED) {
    return INVITE_STATUS.USED;
  }
  return INVITE_STATUS.AVAILABLE;
}

/**
 * 发布表单校验。前端校验只用于即时提示，数据库 RPC 会做同样的校验。
 */
export function validateInviteSubmission(input, existingRecords = []) {
  const errors = {};
  const rawCode = typeof input?.code === 'string' ? input.code.trim() : '';
  const normalizedCode = rawCode.replace(/\s+/g, '-').toUpperCase();

  let spots = 30;
  if (input?.remainingSpots !== undefined && input?.remainingSpots !== '') {
    spots = Number(input.remainingSpots);
    if (!Number.isInteger(spots) || spots < 1 || spots > 30) {
      errors.remainingSpots = 'err_spots_range';
    }
  }

  const rawDescription = typeof input?.description === 'string' ? input.description : '';
  const normalizedDescription = rawDescription.replace(/\s+/g, ' ').trim();
  if (normalizedDescription.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = 'err_desc_too_long';
  }

  let normalizedExpiresAt = null;
  if (input?.expiresAt) {
    const parsed = new Date(input.expiresAt);
    const now = Date.now();
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getTime() <= now + 60 * 1000 ||
      parsed.getTime() > now + MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    ) {
      errors.expiresAt = 'err_expiry_invalid';
    } else {
      normalizedExpiresAt = parsed.toISOString();
    }
  }

  if (!rawCode) {
    errors.code = 'err_code_required';
  } else if (normalizedCode.length < 4 || normalizedCode.length > 48) {
    errors.code = 'err_code_length';
  } else if (!/^[A-Z0-9][A-Z0-9-_]{2,46}[A-Z0-9]$/.test(normalizedCode)) {
    errors.code = 'err_code_format';
  } else {
    const duplicate = existingRecords.some(
      (item) => String(item.code || '').toUpperCase() === normalizedCode
    );
    if (duplicate) {
      errors.code = 'err_code_duplicate';
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalizedCode,
    normalizedSpots: Number.isInteger(spots) && spots >= 1 && spots <= 30 ? spots : 30,
    normalizedDescription,
    normalizedExpiresAt
  };
}
