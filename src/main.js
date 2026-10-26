/**
 * @fileoverview Muse 邀请码互助站 - 前端控制器
 * 交互与视觉保持原样：FIFO 入池排序、30 次名额、队首抽码、状态弹窗、
 * 中英切换。数据层已替换为 Supabase，写入全部走数据库 RPC。
 */

import { i18n } from './i18n/index.js';
import { inviteService } from './services/inviteService.js';
import {
  clearLegacyManageTokens,
  getAdminToken,
  importAdminToken,
  removeAdminToken
} from './services/tokenStore.js';
import { INVITE_STATUS, FILTER_STATUS, validateInviteSubmission } from './models/inviteCode.js';

export class MuseInviteApp {
  constructor() {
    this.state = {
      records: [],
      stats: { available: 0, used: 0, expired: 0, total: 0 },
      loading: true,
      error: null,
      spotlightId: null,
      searchQuery: '',
      statusFilter: FILTER_STATUS.AVAILABLE,
      copiedId: null,

      form: {
        code: '',
        remainingSpots: '30',
        errors: {},
        lastSubmittedCode: null,
        submitting: false
      },

      statusModal: {
        isOpen: false,
        recordId: null,
        tokenError: null,
        adminRemaining: '',
        adminPosition: '',
        saving: false,
        error: null
      },

      feedbackModal: {
        isOpen: false,
        recordId: null,
        reason: 'invalid',
        note: '',
        submitting: false,
        error: null
      },

      toasts: []
    };

    this._copyTimer = null;
    // Guards against double-clicks racing the same RPC (the database would
    // otherwise reject the second request as an "already claimed" duplicate).
    this._pendingActions = new Set();
  }

  async init() {
    clearLegacyManageTokens();
    document.documentElement.lang = i18n.getLocale();
    document.title = i18n.t('meta_title');

    this._bindGlobalEvents();
    i18n.subscribe(() => {
      this.renderAll();
    });

    this.renderAll();
    await this.loadRecords(true);
  }

  async loadRecords(pickEarliestSpotlight = false) {
    const res = await inviteService.listInviteCodes();

    if (res.error) {
      this.state.loading = false;
      this.state.error = res.error;
      this.state.records = [];
      this.state.stats = res.stats || { available: 0, used: 0, expired: 0, total: 0 };
      this.state.spotlightId = null;
      this.renderAll();
      return;
    }

    this.state.loading = false;
    this.state.error = null;
    this.state.records = res.data || [];
    this.state.stats = res.stats || this.computeStats(this.state.records);

    const currentSpotlight = this.state.records.find(
      (r) => r.id === this.state.spotlightId && r.status === INVITE_STATUS.AVAILABLE && r.remaining_spots > 0
    );
    if (!currentSpotlight || pickEarliestSpotlight) {
      const nextUp = await inviteService.drawNextAvailableCode(null);
      this.state.spotlightId = nextUp.data ? nextUp.data.id : null;
    }

    this.renderAll();
  }

  computeStats(records) {
    const stats = { available: 0, used: 0, expired: 0, total: records.length };
    records.forEach((r) => {
      if (r.status === INVITE_STATUS.AVAILABLE) stats.available += 1;
      else if (r.status === INVITE_STATUS.USED) stats.used += 1;
      else stats.expired += 1;
    });
    return stats;
  }

  async handleDrawNextPoolCode() {
    const nextUp = await inviteService.drawNextAvailableCode(this.state.spotlightId);
    if (nextUp.data) {
      this.state.spotlightId = nextUp.data.id;
      this.renderHeroAndPool();
      this.pushToast(i18n.t('toast_drew', { code: nextUp.data.code }));
    }
  }

  getStats() {
    return this.state.stats || this.computeStats(this.state.records);
  }

  /**
   * 严格按入池时间由早到晚排序（早入池的排在最上面）
   */
  getFilteredRecords() {
    const q = this.state.searchQuery.trim().toLowerCase();
    const filter = this.state.statusFilter;

    const statusWeight = {
      [INVITE_STATUS.AVAILABLE]: 0,
      [INVITE_STATUS.USED]: 1,
      [INVITE_STATUS.EXPIRED]: 2
    };

    return this.state.records
      .filter((record) => {
        const statusMatch = filter === FILTER_STATUS.ALL ? true : record.status === filter;
        if (!statusMatch) return false;
        if (!q) return true;
        return String(record.code || '').toLowerCase().includes(q);
      })
      .sort((a, b) => {
        // 在“全部”视图下可用排在前面，同状态按管理顺位排序；顺位相同再按入池时间。
        const wDiff = (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9);
        if (wDiff !== 0) return wDiff;
        const rankDiff =
          (a.queue_rank || Number.MAX_SAFE_INTEGER) - (b.queue_rank || Number.MAX_SAFE_INTEGER);
        if (rankDiff !== 0) return rankDiff;
        return Date.parse(a.created_at) - Date.parse(b.created_at);
      });
  }

  pushToast(message, type = 'success') {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    this.state.toasts.push({ id, message, type });
    this.renderToasts();

    setTimeout(() => {
      this.state.toasts = this.state.toasts.filter((t) => t.id !== id);
      this.renderToasts();
    }, 3200);
  }

  _showServiceError(error) {
    const key = error?.messageKey || Object.values(error?.fieldErrors || {})[0] || 'err_generic';
    this.pushToast(i18n.t(key), 'error');
  }

  async copyInviteCode(record) {
    if (!record || record.status !== INVITE_STATUS.AVAILABLE) return;
    const text = record.code;

    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (_err) {
      copied = false;
    }

    if (!copied) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch (_e) {
        // ignore
      }
      document.body.removeChild(textarea);
    }

    this.state.copiedId = record.id;
    this.renderHeroAndPool();
    this.renderDirectorySection();
    this.pushToast(i18n.t('toast_copied', { code: text }));

    if (this._copyTimer) clearTimeout(this._copyTimer);
    this._copyTimer = setTimeout(() => {
      this.state.copiedId = null;
      this.renderHeroAndPool();
      this.renderDirectorySection();
    }, 2000);
  }

  async handleQuickPoolFeedback(recordId, actionType) {
    if (!recordId) return;
    const actionKey = `${recordId}:${actionType}`;
    if (this._pendingActions.has(actionKey)) return;
    this._pendingActions.add(actionKey);

    try {
      const res = await inviteService.previewStatusUpdate({
        id: recordId,
        actionType
      });

      if (res.error) {
        this._showServiceError(res.error);
        return;
      }

      if (res.data) {
        await this.loadRecords(false);
        if (actionType === 'claim_one') {
          if (res.data.remaining_spots === 0 || res.data.status === INVITE_STATUS.EXPIRED) {
            this.pushToast(i18n.t('toast_exhausted', { code: res.data.code }));
          } else {
            this.pushToast(
              i18n.t('toast_claimed', {
                code: res.data.code,
                remaining: res.data.remaining_spots
              })
            );
          }
        }
      }
    } finally {
      this._pendingActions.delete(actionKey);
    }
  }

  openStatusModal(recordId) {
    this.state.feedbackModal.isOpen = false;
    const record = this.state.records.find((r) => r.id === recordId);
    this.state.statusModal = {
      isOpen: true,
      recordId,
      tokenError: null,
      adminRemaining: record ? String(record.remaining_spots) : '',
      adminPosition: record ? String(record.queue_rank || 1) : '',
      saving: false,
      error: null
    };
    this.renderModals();
  }

  closeStatusModal() {
    this.state.statusModal = {
      isOpen: false,
      recordId: null,
      tokenError: null,
      adminRemaining: '',
      adminPosition: '',
      saving: false,
      error: null
    };
    this.renderModals();
  }

  async handleAdminCodeSubmit(event) {
    event.preventDefault();
    if (this.state.statusModal.saving) return;

    const recordId = this.state.statusModal.recordId;
    if (!recordId) return;

    const remainingEl = document.getElementById('admin-remaining-input');
    const positionEl = document.getElementById('admin-position-input');
    const remaining = Number(remainingEl ? remainingEl.value : this.state.statusModal.adminRemaining);
    const position = Number(positionEl ? positionEl.value : this.state.statusModal.adminPosition);
    const total = Math.max(this.state.records.length, 1);

    this.state.statusModal.adminRemaining = String(remainingEl ? remainingEl.value : '');
    this.state.statusModal.adminPosition = String(positionEl ? positionEl.value : '');

    if (!Number.isInteger(remaining) || remaining < 0 || remaining > 30) {
      this.state.statusModal.error = 'err_admin_remaining';
      this.renderStatusModal();
      return;
    }
    if (!Number.isInteger(position) || position < 1 || position > total) {
      this.state.statusModal.error = 'err_admin_position';
      this.renderStatusModal();
      return;
    }

    this.state.statusModal.saving = true;
    this.state.statusModal.error = null;
    this.renderStatusModal();

    const res = await inviteService.updateCodeAdmin({
      id: recordId,
      remaining,
      position
    });

    if (res.error) {
      this.state.statusModal.saving = false;
      this.state.statusModal.error = res.error.messageKey || 'err_generic';
      this.renderStatusModal();
      return;
    }

    this.state.statusModal.saving = false;
    this.closeStatusModal();
    await this.loadRecords(true);
    this.pushToast(
      i18n.t('admin_success', {
        code: res.data.code,
        remaining: res.data.remaining_spots,
        position: res.data.queue_rank
      })
    );
  }

  openFeedbackModal(recordId) {
    if (!recordId) return;
    this.state.statusModal = {
      isOpen: false,
      recordId: null,
      tokenError: null
    };
    this.state.feedbackModal = {
      isOpen: true,
      recordId,
      reason: 'invalid',
      note: '',
      submitting: false,
      error: null
    };
    this.renderModals();
  }

  closeFeedbackModal() {
    this.state.feedbackModal = {
      isOpen: false,
      recordId: null,
      reason: 'invalid',
      note: '',
      submitting: false,
      error: null
    };
    this.renderModals();
  }

  async handleFeedbackSubmit(event) {
    event.preventDefault();
    if (this.state.feedbackModal.submitting) return;

    const reasonEl = document.getElementById('feedback-reason-input');
    const noteEl = document.getElementById('feedback-note-input');
    const reason = reasonEl ? reasonEl.value : this.state.feedbackModal.reason;
    const note = noteEl ? noteEl.value : this.state.feedbackModal.note;
    const recordId = this.state.feedbackModal.recordId;
    if (!recordId) return;

    if (note.trim().length > 300) {
      this.state.feedbackModal.error = 'err_feedback_note_long';
      this.renderFeedbackModal();
      return;
    }

    this.state.feedbackModal.reason = reason;
    this.state.feedbackModal.note = note;
    this.state.feedbackModal.submitting = true;
    this.state.feedbackModal.error = null;
    this.renderFeedbackModal();

    const res = await inviteService.submitFeedback({
      codeId: recordId,
      reason,
      note
    });

    if (res.error) {
      this.state.feedbackModal.submitting = false;
      this.state.feedbackModal.error = res.error.messageKey || 'err_generic';
      this.renderFeedbackModal();
      return;
    }

    this.state.feedbackModal = {
      isOpen: false,
      recordId: null,
      reason: 'invalid',
      note: '',
      submitting: false,
      error: null
    };
    this.renderModals();
    this.pushToast(i18n.t('feedback_success'));
  }

  importStatusModalToken() {
    const input = document.getElementById('manage-token-input');
    if (!importAdminToken(input ? input.value : '')) {
      this.state.statusModal.tokenError = 'err_manage_token_format';
      this.renderModals();
      return;
    }
    this.state.statusModal.tokenError = null;
    this.renderModals();
    this.pushToast(i18n.t('toast_manage_token_saved'));
  }

  clearStatusModalToken(recordId) {
    if (!recordId) return;
    removeAdminToken();
    this.state.statusModal.tokenError = null;
    this.renderModals();
  }

  async handleDirectStatusSet(recordId, nextStatus) {
    if (!recordId || !nextStatus) return;
    const actionKey = `${recordId}:set_status`;
    if (this._pendingActions.has(actionKey)) return;
    this._pendingActions.add(actionKey);

    try {
      const res = await inviteService.previewStatusUpdate({
        id: recordId,
        actionType: 'set_status',
        nextStatus
      });

      if (res.error) {
        this._showServiceError(res.error);
      } else if (res.data) {
        await this.loadRecords(false);
        this.pushToast(
          i18n.t('toast_updated', {
            code: res.data.code,
            status: i18n.t(`status_${res.data.status}`)
          })
        );
      }
      this.closeStatusModal();
    } finally {
      this._pendingActions.delete(actionKey);
    }
  }

  async handleFormSubmit(event) {
    event.preventDefault();
    if (this.state.form.submitting) return;

    const payload = {
      code: this.state.form.code,
      remainingSpots: this.state.form.remainingSpots
    };

    const check = validateInviteSubmission(payload, this.state.records);
    if (!check.valid) {
      this.state.form.errors = check.errors;
      this.state.form.lastSubmittedCode = null;
      this.renderPublishSection();
      return;
    }

    this.state.form.submitting = true;
    this.state.form.errors = {};
    this.renderPublishSection();

    const res = await inviteService.createInviteCode(payload);
    if (res.error) {
      this.state.form.submitting = false;
      this.state.form.errors = {
        ...(res.error.fieldErrors || {}),
        ...(res.error.messageKey ? { form: res.error.messageKey } : {})
      };
      if (!res.error.fieldErrors && !res.error.messageKey) {
        this.state.form.errors.form = 'err_generic';
      }
      this.renderPublishSection();
      return;
    }

    this.state.form = {
      code: '',
      remainingSpots: '30',
      errors: {},
      lastSubmittedCode: res.data.code,
      submitting: false
    };
    this.state.statusFilter = FILTER_STATUS.AVAILABLE;
    this.state.searchQuery = '';

    await this.loadRecords(false);
    this.pushToast(i18n.t('publish_success', { code: res.data.code }));
  }

  async handleRefresh() {
    this.state.loading = true;
    this.state.error = null;
    this.renderAll();
    await this.loadRecords(true);
    if (!this.state.error) {
      this.pushToast(i18n.t('refresh_done'));
    }
  }

  scrollToSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  _bindGlobalEvents() {
    document.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;

      const action = actionEl.getAttribute('data-action');
      const id = actionEl.getAttribute('data-id');

      switch (action) {
        case 'toggle-lang':
          e.preventDefault();
          i18n.toggleLocale();
          break;
        case 'scroll-section': {
          e.preventDefault();
          const targetId = actionEl.getAttribute('data-target');
          if (targetId) this.scrollToSection(targetId);
          break;
        }
        case 'refresh-data':
        case 'reload-data':
          e.preventDefault();
          this.handleRefresh();
          break;
        case 'draw-next-code':
          e.preventDefault();
          this.handleDrawNextPoolCode();
          break;
        case 'quick-claim-code':
          e.preventDefault();
          if (id) this.handleQuickPoolFeedback(id, 'claim_one');
          break;
        case 'open-feedback-modal':
          e.preventDefault();
          if (id) this.openFeedbackModal(id);
          break;
        case 'close-feedback-modal':
          e.preventDefault();
          this.closeFeedbackModal();
          break;
        case 'set-filter': {
          e.preventDefault();
          const filterVal = actionEl.getAttribute('data-filter');
          if (filterVal) {
            this.state.statusFilter = filterVal;
            this.renderDirectorySection();
          }
          break;
        }
        case 'clear-search':
          e.preventDefault();
          this.state.searchQuery = '';
          this.renderDirectorySection();
          break;
        case 'reset-search-and-filter':
          e.preventDefault();
          this.state.searchQuery = '';
          this.state.statusFilter = FILTER_STATUS.ALL;
          this.renderDirectorySection();
          break;
        case 'copy-code': {
          e.preventDefault();
          const record = this.state.records.find((r) => r.id === id);
          if (record) this.copyInviteCode(record);
          break;
        }
        case 'open-status-modal':
          e.preventDefault();
          if (id) this.openStatusModal(id);
          break;
        case 'close-status-modal':
          e.preventDefault();
          this.closeStatusModal();
          break;
        case 'set-direct-status': {
          e.preventDefault();
          const nextStatus = actionEl.getAttribute('data-status');
          if (id && nextStatus) {
            this.handleDirectStatusSet(id, nextStatus);
          }
          break;
        }
        case 'import-manage-token':
          e.preventDefault();
          this.importStatusModalToken();
          break;
        case 'clear-manage-token':
          e.preventDefault();
          if (id) this.clearStatusModalToken(id);
          break;
        default:
          break;
      }
    });

    document.addEventListener('input', (e) => {
      const target = e.target;
      if (!target) return;

      if (target.id === 'search-input') {
        this.state.searchQuery = target.value;
        const clearBtn = document.getElementById('clear-search-btn');
        if (clearBtn) clearBtn.hidden = target.value.length === 0;
        this.renderDirectoryResultsOnly();
      } else if (target.id === 'publish-code-input') {
        this.state.form.code = target.value;
        if (this.state.form.errors.code || this.state.form.errors.form) {
          delete this.state.form.errors.code;
          delete this.state.form.errors.form;
          this.renderPublishSection();
        }
      } else if (target.id === 'publish-spots-input') {
        this.state.form.remainingSpots = target.value;
        if (this.state.form.errors.remainingSpots || this.state.form.errors.form) {
          delete this.state.form.errors.remainingSpots;
          delete this.state.form.errors.form;
          this.renderPublishSection();
        }
      } else if (target.id === 'feedback-note-input') {
        this.state.feedbackModal.note = target.value;
        if (this.state.feedbackModal.error) {
          this.state.feedbackModal.error = null;
          const err = document.getElementById('feedback-error');
          if (err) err.remove();
        }
      } else if (target.id === 'admin-remaining-input') {
        this.state.statusModal.adminRemaining = target.value;
        if (this.state.statusModal.error) {
          this.state.statusModal.error = null;
          const err = document.getElementById('admin-edit-error');
          if (err) err.remove();
        }
      } else if (target.id === 'admin-position-input') {
        this.state.statusModal.adminPosition = target.value;
        if (this.state.statusModal.error) {
          this.state.statusModal.error = null;
          const err = document.getElementById('admin-edit-error');
          if (err) err.remove();
        }
      }
    });

    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'feedback-reason-input') {
        this.state.feedbackModal.reason = e.target.value;
        if (this.state.feedbackModal.error) {
          this.state.feedbackModal.error = null;
          const err = document.getElementById('feedback-error');
          if (err) err.remove();
        }
      }
    });

    document.addEventListener('submit', (e) => {
      if (e.target && e.target.id === 'publish-invite-form') {
        this.handleFormSubmit(e);
      } else if (e.target && e.target.id === 'feedback-form') {
        this.handleFeedbackSubmit(e);
      } else if (e.target && e.target.id === 'admin-code-form') {
        this.handleAdminCodeSubmit(e);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.state.feedbackModal.isOpen) {
        this.closeFeedbackModal();
      } else if (this.state.statusModal.isOpen) {
        this.closeStatusModal();
      }
    });
  }

  renderAll() {
    this.renderHeader();
    this.renderHeroAndPool();
    this.renderPublishSection();
    this.renderDirectorySection();
    this.renderFooter();
    this.renderModals();
    this.renderToasts();
  }

  renderModals() {
    if (this.state.feedbackModal.isOpen) {
      this.renderFeedbackModal();
      return;
    }
    if (this.state.statusModal.isOpen) {
      this.renderStatusModal();
      return;
    }
    const el = document.getElementById('modal-mount');
    if (el) el.innerHTML = '';
  }

  renderHeader() {
    const el = document.getElementById('header-mount');
    if (!el) return;

    el.innerHTML = `
      <header class="site-header">
        <div class="header-inner" style="max-width:920px;">
          <a
            href="#section-hero"
            class="brand-group"
            data-action="scroll-section"
            data-target="section-hero"
          >
            <img
              class="brand-mark"
              src="/favicon.ico"
              alt=""
              aria-hidden="true"
              style="object-fit:cover;background:none;padding:0;display:block;"
            />
            <div>
              <div style="font-weight:800;font-size:16.5px;line-height:1.2;">
                ${this._escape(i18n.t('brand_name'))}
              </div>
              <div style="font-size:12px;color:var(--text-muted);">
                ${this._escape(i18n.t('brand_sub'))}
              </div>
            </div>
          </a>

          <nav aria-label="Navigation" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <button
              type="button"
              class="btn btn-outline"
              style="padding:6px 10px;font-size:13px;"
              data-action="refresh-data"
            >
              ↻ ${this._escape(i18n.t('nav_refresh'))}
            </button>

            <a
              href="mailto:3391792088@qq.com?subject=Muse%20Invite%20Code%20Hub%20Feedback"
              class="btn btn-outline"
              style="padding:6px 10px;font-size:13px;"
            >
              ✉️ ${this._escape(i18n.t('nav_contact'))}
            </a>

            <button
              type="button"
              class="btn btn-soft"
              style="padding:6px 12px;font-size:13px;"
              data-action="toggle-lang"
            >
              🌐 ${this._escape(i18n.t('lang_current'))} / ${this._escape(i18n.t('lang_target'))}
            </button>
          </nav>
        </div>
      </header>
    `;
  }

  _renderLoadErrorCard() {
    const messageKey = this.state.error?.messageKey || 'err_generic';
    const hint =
      this.state.error?.code === 'not_configured'
        ? `<p style="margin:8px 0 0 0;font-size:12.5px;color:var(--text-muted);">${this._escape(
            i18n.t('err_backend_hint')
          )}</p>`
        : '';
    return `
      <div role="alert" style="padding:8px 0;">
        <p style="margin:0 0 6px 0;font-weight:700;color:var(--danger-text);">
          ${this._escape(i18n.t('load_error_title'))}
        </p>
        <p style="margin:0 0 12px 0;font-size:13px;color:var(--text-secondary);">
          ${this._escape(i18n.t(messageKey))}
        </p>
        ${hint}
        <button type="button" class="btn btn-primary" data-action="reload-data">
          ${this._escape(i18n.t('retry'))}
        </button>
      </div>
    `;
  }

  _renderSkeletonCard(lines = 4) {
    return `
      <div class="meta-card" style="padding:16px;display:flex;flex-direction:column;gap:10px;">
        ${Array.from({ length: lines })
          .map(
            (_, idx) =>
              `<div class="skeleton" style="height:${idx === 0 ? 18 : 12}px;width:${
                idx === 0 ? 55 : 85 - idx * 8
              }%;"></div>`
          )
          .join('')}
      </div>
    `;
  }

  renderHeroAndPool() {
    const el = document.getElementById('hero-mount');
    if (!el) return;

    if (this.state.loading) {
      el.innerHTML = `
        <section id="section-hero" class="meta-card" style="padding:24px;margin-bottom:16px;">
          <div style="max-width:480px;margin:0 auto;text-align:center;">
            <div class="skeleton" style="height:22px;width:45%;margin:0 auto 12px;"></div>
            <div class="skeleton" style="height:64px;width:100%;margin-bottom:12px;"></div>
            <div class="skeleton" style="height:14px;width:60%;margin:0 auto;"></div>
            <p style="margin:16px 0 0 0;font-size:13px;color:var(--text-muted);">
              ${this._escape(i18n.t('loading'))}
            </p>
          </div>
        </section>
      `;
      return;
    }

    if (this.state.error) {
      el.innerHTML = `
        <section id="section-hero" class="meta-card" style="padding:24px;margin-bottom:16px;">
          <div style="max-width:520px;margin:0 auto;">
            ${this._renderLoadErrorCard()}
          </div>
        </section>
      `;
      return;
    }

    const spotlight = this.state.records.find(
      (r) => r.id === this.state.spotlightId && r.status === INVITE_STATUS.AVAILABLE && r.remaining_spots > 0
    );
    const isCopied = spotlight && this.state.copiedId === spotlight.id;

    if (!spotlight) {
      el.innerHTML = `
        <section id="section-hero" class="meta-card" style="padding:28px 20px;margin-bottom:16px;text-align:center;">
          <p style="margin:0 0 12px 0;font-weight:600;color:var(--text-secondary);">
            ${this._escape(i18n.t('pool_empty'))}
          </p>
          <button
            type="button"
            class="btn btn-primary"
            data-action="scroll-section"
            data-target="section-publish"
          >
            ${this._escape(i18n.t('pool_empty_cta'))}
          </button>
        </section>
      `;
      return;
    }

    const pct = Math.min(100, Math.max(0, Math.round((spotlight.remaining_spots / spotlight.total_spots) * 100)));

    el.innerHTML = `
      <section id="section-hero" class="meta-card" style="padding:24px;margin-bottom:16px;text-align:center;">
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
          <h1 style="margin:0;font-size:20px;font-weight:800;color:var(--text-primary);">
            ${this._escape(i18n.t('pool_title'))}
          </h1>
        </div>
        <p style="margin:0 0 16px 0;font-size:13.5px;color:var(--text-secondary);">
          ${this._escape(i18n.t('pool_subtitle'))}
        </p>

        <div style="max-width:480px;margin:0 auto;">
          <div class="spotlight-code-display" style="font-size:28px;padding:16px;margin-bottom:10px;">
            ${this._escape(spotlight.code)}
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px;margin-bottom:6px;">
            <span style="color:var(--status-available-text);font-weight:700;">
              ● ${this._escape(i18n.t('status_available'))}
            </span>
            <span style="color:var(--text-secondary);font-weight:600;">
              ${this._escape(
                i18n.t('pool_spots_left', {
                  remaining: spotlight.remaining_spots,
                  total: spotlight.total_spots
                })
              )}
            </span>
          </div>

          <div class="quota-bar-track" style="margin-bottom:16px;">
            <div class="quota-bar-fill" style="width:${pct}%;background-color:var(--brand-primary);"></div>
          </div>

          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:10px;">
            <button
              type="button"
              class="btn btn-primary"
              style="flex:1.4;min-width:150px;padding:11px 18px;font-size:15px;"
              data-action="copy-code"
              data-id="${this._escape(spotlight.id)}"
            >
              📋 ${this._escape(isCopied ? i18n.t('pool_btn_copied') : i18n.t('pool_btn_copy'))}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              style="flex:1;min-width:120px;padding:11px 16px;font-size:15px;"
              data-action="draw-next-code"
            >
              ⏭ ${this._escape(i18n.t('pool_btn_next'))}
            </button>
          </div>

          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button
              type="button"
              class="btn btn-success-soft"
              style="flex:1;font-size:13px;padding:8px 12px;"
              data-action="quick-claim-code"
              data-id="${this._escape(spotlight.id)}"
            >
              ✅ ${this._escape(i18n.t('pool_btn_claimed'))}
            </button>
            <button
              type="button"
              class="btn btn-outline"
              style="flex:1;font-size:13px;padding:8px 12px;color:var(--text-secondary);"
              data-action="open-feedback-modal"
              data-id="${this._escape(spotlight.id)}"
            >
              ✉️ ${this._escape(i18n.t('pool_btn_feedback'))}
            </button>
          </div>

          <p style="margin:10px 0 0 0;font-size:11.5px;color:var(--text-muted);">
            ${this._escape(i18n.t('limit_hint'))}
          </p>
        </div>
      </section>
    `;
  }

  renderPublishSection() {
    const el = document.getElementById('publish-mount');
    if (!el) return;

    const { code, remainingSpots, errors, submitting } = this.state.form;
    const errorKeys = [errors.code, errors.remainingSpots, errors.form].filter(Boolean);

    el.innerHTML = `
      <section id="section-publish" class="meta-card" style="padding:18px 20px;margin-bottom:16px;" aria-labelledby="publish-heading">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <h2 id="publish-heading" style="margin:0;font-size:16px;font-weight:700;">
            ➕ ${this._escape(i18n.t('publish_title'))}
          </h2>
          <span style="font-size:12px;color:var(--text-muted);">
            ${this._escape(i18n.t('publish_demo_hint'))}
          </span>
        </div>

        <form id="publish-invite-form" novalidate>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div style="flex:1;min-width:200px;">
              <input
                id="publish-code-input"
                type="text"
                required
                maxlength="48"
                aria-label="${this._escape(i18n.t('publish_code_placeholder'))}"
                class="input-field ${errors.code ? 'has-error' : ''}"
                placeholder="${this._escape(i18n.t('publish_code_placeholder'))}"
                value="${this._escape(code)}"
              />
            </div>

            <div style="display:flex;align-items:center;gap:6px;">
              <label for="publish-spots-input" style="font-size:13px;color:var(--text-secondary);font-weight:600;white-space:nowrap;">
                ${this._escape(i18n.t('publish_spots_label'))}:
              </label>
              <input
                id="publish-spots-input"
                type="number"
                min="1"
                max="30"
                class="input-field ${errors.remainingSpots ? 'has-error' : ''}"
                style="width:74px;text-align:center;"
                value="${this._escape(remainingSpots)}"
              />
            </div>

            <button type="submit" class="btn btn-primary" style="padding:10px 18px;" ${submitting ? 'disabled' : ''}>
              ${this._escape(submitting ? i18n.t('loading') : i18n.t('publish_submit_btn'))}
            </button>
          </div>
        </form>

        ${
          errorKeys.length
            ? `<div role="alert" style="margin-top:8px;font-size:12.5px;color:var(--danger-text);font-weight:600;display:flex;flex-direction:column;gap:2px;">
                ${errorKeys
                  .map((key) => `<div>⚠ ${this._escape(i18n.t(key))}</div>`)
                  .join('')}
              </div>`
            : ''
        }
      </section>
    `;
  }

  renderDirectorySection() {
    const el = document.getElementById('directory-mount');
    if (!el) return;

    const stats = this.getStats();
    const activeFilter = this.state.statusFilter;

    const filterTabs = [
      { key: FILTER_STATUS.AVAILABLE, label: i18n.t('filter_available'), count: stats.available },
      { key: FILTER_STATUS.EXPIRED, label: i18n.t('filter_expired'), count: stats.expired },
      { key: FILTER_STATUS.USED, label: i18n.t('filter_used'), count: stats.used },
      { key: FILTER_STATUS.ALL, label: i18n.t('filter_all'), count: stats.total }
    ];

    el.innerHTML = `
      <section id="section-directory" class="meta-card" style="padding:20px;margin-bottom:16px;" aria-labelledby="directory-heading">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
          <div role="group" aria-label="${this._escape(i18n.t('list_title'))}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${filterTabs
              .map((tab) => {
                const isActive = activeFilter === tab.key;
                return `
                  <button
                    type="button"
                    class="btn ${isActive ? 'btn-primary' : 'btn-outline'}"
                    style="padding:6px 12px;font-size:13px;"
                    data-action="set-filter"
                    data-filter="${tab.key}"
                  >
                    <span>${this._escape(tab.label)}</span>
                    <span style="opacity:0.85;font-size:12px;">(${tab.count})</span>
                  </button>
                `;
              })
              .join('')}
          </div>

          <div style="display:flex;align-items:center;gap:6px;min-width:210px;flex:0.45;">
            <input
              id="search-input"
              type="search"
              aria-label="${this._escape(i18n.t('search_placeholder'))}"
              class="input-field"
              style="padding:7px 12px;font-size:13.5px;"
              placeholder="${this._escape(i18n.t('search_placeholder'))}"
              value="${this._escape(this.state.searchQuery)}"
              autocomplete="off"
            />
            <button
              type="button"
              id="clear-search-btn"
              class="btn btn-secondary"
              style="padding:7px 10px;font-size:12.5px;"
              data-action="clear-search"
              ${this.state.searchQuery ? '' : 'hidden'}
            >
              ${this._escape(i18n.t('search_clear'))}
            </button>
          </div>
        </div>

        <div id="directory-results-container" aria-live="polite"></div>
      </section>
    `;

    this.renderDirectoryResultsOnly();
  }

  renderDirectoryResultsOnly() {
    const container = document.getElementById('directory-results-container');
    if (!container) return;

    if (this.state.loading) {
      container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(265px,1fr));gap:12px;">
          ${this._renderSkeletonCard(4)}
          ${this._renderSkeletonCard(4)}
          ${this._renderSkeletonCard(4)}
        </div>
      `;
      return;
    }

    if (this.state.error) {
      container.innerHTML = this._renderLoadErrorCard();
      return;
    }

    const filtered = this.getFilteredRecords();

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="padding:32px 16px;text-align:center;color:var(--text-secondary);">
          <p style="margin:0 0 10px 0;font-weight:600;">${this._escape(i18n.t('empty_list'))}</p>
          <button type="button" class="btn btn-outline" data-action="reset-search-and-filter">
            ${this._escape(i18n.t('empty_reset'))}
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(265px,1fr));gap:12px;">
        ${filtered.map((item, idx) => this._renderInviteCard(item, idx + 1)).join('')}
      </div>
    `;
  }

  _renderInviteCard(record, queueIndex) {
    const isAvailable = record.status === INVITE_STATUS.AVAILABLE;
    const isUsed = record.status === INVITE_STATUS.USED;
    const isCopied = this.state.copiedId === record.id;
    const displayRank =
      Number.isFinite(record.queue_rank) && record.queue_rank > 0 ? record.queue_rank : queueIndex;

    let statusBadgeHtml = '';
    if (isAvailable) {
      statusBadgeHtml = `<span class="status-badge status-available">● ${this._escape(i18n.t('status_available'))}</span>`;
    } else if (isUsed) {
      statusBadgeHtml = `<span class="status-badge status-used">✓ ${this._escape(i18n.t('status_used'))}</span>`;
    } else {
      statusBadgeHtml = `<span class="status-badge status-expired">✕ ${this._escape(i18n.t('status_expired'))}</span>`;
    }

    const remainingPct = Math.min(
      100,
      Math.max(0, Math.round(((record.remaining_spots || 0) / (record.total_spots || 30)) * 100))
    );
    const barColor = isAvailable
      ? record.remaining_spots <= 5
        ? 'var(--warning-text)'
        : 'var(--status-available-text)'
      : isUsed
      ? 'var(--text-muted)'
      : 'var(--status-expired-text)';

    const spotsText =
      record.remaining_spots <= 0
        ? i18n.t('card_spots_exhausted', { total: record.total_spots || 30 })
        : i18n.t('card_spots', {
            remaining: record.remaining_spots || 0,
            total: record.total_spots || 30
          });

    return `
      <article
        class="meta-card"
        style="padding:14px;display:flex;flex-direction:column;gap:10px;border-left:4px solid ${
          isAvailable ? 'var(--status-available-text)' : isUsed ? 'var(--text-muted)' : 'var(--status-expired-text)'
        };"
      >
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <div style="display:flex;align-items:center;gap:6px;">
            ${statusBadgeHtml}
            ${
              isAvailable
                ? `<span style="font-size:11.5px;font-weight:700;color:var(--brand-primary-text);background:var(--brand-primary-soft);padding:2px 6px;border-radius:4px;">
                    ${this._escape(i18n.t('queue_prefix'))}${displayRank}
                  </span>`
                : ''
            }
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:12px;font-weight:600;color:${
              record.remaining_spots <= 0 ? 'var(--status-expired-text)' : 'var(--text-secondary)'
            };">
              ${this._escape(spotsText)}
            </span>
            ${
              record.is_local_session
                ? `<span style="font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:4px;background:var(--warning-bg);color:var(--warning-text);">
                    ${this._escape(i18n.t('badge_new'))}
                  </span>`
                : ''
            }
          </div>
        </div>

        <div class="code-pill ${isAvailable ? '' : 'is-unavailable'}" style="font-size:16px;padding:8px 10px;">
          <span>${this._escape(record.code)}</span>
        </div>

        <div class="quota-bar-track" style="height:5px;">
          <div class="quota-bar-fill" style="width:${remainingPct}%;background-color:${barColor};"></div>
        </div>

        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;">
          <button
            type="button"
            class="btn ${isAvailable ? 'btn-primary' : 'btn-secondary'}"
            style="flex:1;padding:6px 10px;font-size:13px;"
            ${isAvailable ? '' : 'disabled'}
            data-action="copy-code"
            data-id="${this._escape(record.id)}"
          >
            ${this._escape(isCopied ? i18n.t('card_copied') : i18n.t('card_copy'))}
          </button>

          ${
            isAvailable
              ? `<button
                  type="button"
                  class="btn btn-success-soft"
                  style="padding:6px 9px;font-size:12.5px;"
                  data-action="quick-claim-code"
                  data-id="${this._escape(record.id)}"
                >
                  ${this._escape(i18n.t('card_used_btn'))}
                </button>`
              : ''
          }

          <button
            type="button"
            class="btn btn-outline"
            style="padding:6px 9px;font-size:12.5px;color:var(--text-secondary);"
            data-action="open-status-modal"
            data-id="${this._escape(record.id)}"
          >
            ${this._escape(i18n.t('card_status_btn'))}
          </button>

          <button
            type="button"
            class="btn btn-outline"
            style="padding:6px 9px;font-size:12.5px;color:var(--text-secondary);"
            data-action="open-feedback-modal"
            data-id="${this._escape(record.id)}"
          >
            ${this._escape(i18n.t('card_feedback_btn'))}
          </button>
        </div>
      </article>
    `;
  }

  renderFooter() {
    const el = document.getElementById('footer-mount');
    if (!el) return;

    el.innerHTML = `
      <footer style="padding:12px 4px 32px 4px;color:var(--text-muted);font-size:12.5px;line-height:1.6;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="color:var(--text-secondary);font-weight:600;">
            💡 ${this._escape(i18n.t('footer_guide'))}
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <span>${this._escape(i18n.t('footer_disclaimer'))}</span>
            <a
              href="mailto:3391792088@qq.com"
              style="color:var(--brand-primary);font-weight:600;text-decoration:none;"
            >
              ${this._escape(i18n.t('footer_contact'))}
            </a>
          </div>
        </div>
      </footer>
    `;
  }

  renderFeedbackModal() {
    const el = document.getElementById('modal-mount');
    if (!el) return;

    const { isOpen, recordId, reason, note, submitting, error } = this.state.feedbackModal;
    if (!isOpen || !recordId) {
      el.innerHTML = '';
      return;
    }

    const record = this.state.records.find((r) => r.id === recordId);
    if (!record) {
      el.innerHTML = '';
      return;
    }

    const reasons = [
      ['invalid', 'feedback_reason_invalid'],
      ['used', 'feedback_reason_used'],
      ['wrong_info', 'feedback_reason_wrong'],
      ['other', 'feedback_reason_other']
    ];

    el.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true">
        <div class="modal-panel" style="max-width:440px;padding:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <h3 style="margin:0;font-size:16px;font-weight:700;">
              ${this._escape(i18n.t('feedback_title'))}
            </h3>
            <button type="button" class="btn btn-secondary" style="padding:4px 8px;" data-action="close-feedback-modal">
              ✕
            </button>
          </div>

          <div style="font-family:var(--font-mono);font-weight:700;font-size:15px;margin-bottom:8px;">
            ${this._escape(record.code)}
          </div>
          <p style="margin:0 0 12px 0;font-size:12.5px;color:var(--text-secondary);">
            ${this._escape(i18n.t('feedback_desc'))}
          </p>

          <form id="feedback-form" style="display:flex;flex-direction:column;gap:10px;">
            <label for="feedback-reason-input" style="font-size:13px;color:var(--text-secondary);font-weight:600;">
              ${this._escape(i18n.t('feedback_reason_label'))}
            </label>
            <select id="feedback-reason-input" class="input-field">
              ${reasons
                .map(
                  ([value, key]) =>
                    `<option value="${value}" ${reason === value ? 'selected' : ''}>${this._escape(i18n.t(key))}</option>`
                )
                .join('')}
            </select>

            <label for="feedback-note-input" style="font-size:13px;color:var(--text-secondary);font-weight:600;">
              ${this._escape(i18n.t('feedback_note_label'))}
            </label>
            <textarea
              id="feedback-note-input"
              class="input-field"
              rows="3"
              maxlength="300"
              style="resize:vertical;min-height:78px;"
              placeholder="${this._escape(i18n.t('feedback_note_placeholder'))}"
            >${this._escape(note)}</textarea>

            ${
              error
                ? `<div id="feedback-error" role="alert" style="font-size:12.5px;color:var(--danger-text);font-weight:600;">
                    ⚠ ${this._escape(i18n.t(error))}
                  </div>`
                : ''
            }

            <p style="margin:0;font-size:11.5px;color:var(--text-muted);">
              ${this._escape(i18n.t('feedback_hint'))}
            </p>

            <button type="submit" class="btn btn-primary" style="padding:10px 12px;" ${submitting ? 'disabled' : ''}>
              ${this._escape(submitting ? i18n.t('feedback_submitting') : i18n.t('feedback_submit'))}
            </button>
          </form>
        </div>
      </div>
    `;
  }

  renderStatusModal() {
    const el = document.getElementById('modal-mount');
    if (!el) return;

    const { isOpen, recordId, tokenError, adminRemaining, adminPosition, saving, error } = this.state.statusModal;
    if (!isOpen || !recordId) {
      el.innerHTML = '';
      return;
    }

    const record = this.state.records.find((r) => r.id === recordId);
    if (!record) {
      el.innerHTML = '';
      return;
    }

    const hasToken = Boolean(getAdminToken());
    const totalCodes = Math.max(this.state.records.length, 1);
    const remainingValue = adminRemaining !== '' ? adminRemaining : String(record.remaining_spots);
    const positionValue = adminPosition !== '' ? adminPosition : String(record.queue_rank || 1);
    const statusButtons = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button
          type="button"
          class="btn btn-outline"
          style="justify-content:flex-start;padding:10px 12px;"
          data-action="set-direct-status"
          data-id="${this._escape(record.id)}"
          data-status="${INVITE_STATUS.AVAILABLE}"
        >
          ● ${this._escape(i18n.t('status_available'))}
        </button>
        <button
          type="button"
          class="btn btn-outline"
          style="justify-content:flex-start;padding:10px 12px;"
          data-action="set-direct-status"
          data-id="${this._escape(record.id)}"
          data-status="${INVITE_STATUS.USED}"
        >
          ✓ ${this._escape(i18n.t('status_used'))}
        </button>
        <button
          type="button"
          class="btn btn-outline"
          style="justify-content:flex-start;padding:10px 12px;"
          data-action="set-direct-status"
          data-id="${this._escape(record.id)}"
          data-status="${INVITE_STATUS.EXPIRED}"
        >
          ✕ ${this._escape(i18n.t('status_expired'))}
        </button>
        <button
          type="button"
          class="btn btn-outline"
          style="padding:6px 10px;font-size:12px;color:var(--text-muted);"
          data-action="clear-manage-token"
          data-id="${this._escape(record.id)}"
        >
          ${this._escape(i18n.t('modal_clear_token'))}
        </button>
      </div>
    `;
    const adminPanel = `
      <form id="admin-code-form" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-subtle);display:flex;flex-direction:column;gap:8px;">
        <div style="font-size:13px;font-weight:700;color:var(--text-secondary);">
          ${this._escape(i18n.t('admin_title'))}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-secondary);font-weight:600;">
            ${this._escape(i18n.t('admin_remaining_label'))}
            <input
              id="admin-remaining-input"
              type="number"
              min="0"
              max="30"
              class="input-field"
              style="width:92px;text-align:center;"
              value="${this._escape(remainingValue)}"
            />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-secondary);font-weight:600;">
            ${this._escape(i18n.t('admin_position_label'))}
            <input
              id="admin-position-input"
              type="number"
              min="1"
              max="${totalCodes}"
              class="input-field"
              style="width:92px;text-align:center;"
              value="${this._escape(positionValue)}"
            />
          </label>
        </div>
        <p style="margin:0;font-size:11.5px;color:var(--text-muted);">
          ${this._escape(i18n.t('admin_position_hint'))}
        </p>
        ${
          error
            ? `<div id="admin-edit-error" role="alert" style="font-size:12.5px;color:var(--danger-text);font-weight:600;">
                ⚠ ${this._escape(i18n.t(error))}
              </div>`
            : ''
        }
        <button type="submit" class="btn btn-primary" style="padding:9px 12px;" ${saving ? 'disabled' : ''}>
          ${this._escape(saving ? i18n.t('admin_saving') : i18n.t('admin_save'))}
        </button>
        <p style="margin:0;font-size:11.5px;color:var(--text-muted);">
          ${this._escape(i18n.t('admin_hint'))}
        </p>
      </form>
    `;
    const importPanel = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="padding:10px 12px;border-radius:8px;background:var(--warning-bg);color:var(--warning-text);border:1px solid var(--warning-border);font-size:12.5px;line-height:1.55;">
          ${this._escape(i18n.t('modal_no_token'))}
        </div>
        <input
          id="manage-token-input"
          type="password"
          maxlength="64"
          autocomplete="off"
          spellcheck="false"
          class="input-field"
          aria-label="${this._escape(i18n.t('modal_token_placeholder'))}"
          placeholder="${this._escape(i18n.t('modal_token_placeholder'))}"
        />
        <button
          type="button"
          class="btn btn-primary"
          style="padding:10px 12px;"
          data-action="import-manage-token"
          data-id="${this._escape(record.id)}"
        >
          ${this._escape(i18n.t('modal_import_token'))}
        </button>
        ${
          tokenError
            ? `<div role="alert" style="font-size:12.5px;color:var(--danger-text);font-weight:600;">
                ⚠ ${this._escape(i18n.t(tokenError))}
              </div>`
            : ''
        }
      </div>
    `;

    el.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true">
        <div class="modal-panel" style="max-width:400px;padding:20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <h3 style="margin:0;font-size:16px;font-weight:700;">
              ${this._escape(i18n.t('modal_title'))}
            </h3>
            <button type="button" class="btn btn-secondary" style="padding:4px 8px;" data-action="close-status-modal">
              ✕
            </button>
          </div>

          <div style="font-family:var(--font-mono);font-weight:700;font-size:15px;margin-bottom:8px;">
            ${this._escape(record.code)}
          </div>
          <p style="margin:0 0 12px 0;font-size:12.5px;color:var(--text-secondary);">
            ${this._escape(i18n.t('modal_desc'))}
          </p>

          ${
            hasToken
              ? `<p style="margin:0 0 10px 0;font-size:12px;color:var(--status-available-text);font-weight:600;">
                  ${this._escape(i18n.t('modal_has_token'))}
                </p>${statusButtons}${adminPanel}`
              : importPanel
          }
        </div>
      </div>
    `;
  }

  renderToasts() {
    const el = document.getElementById('toast-mount');
    if (!el) return;
    el.innerHTML = `
      <div class="toast-container" role="status" aria-live="polite">
        ${this.state.toasts
          .map(
            (t) => `
          <div class="toast-item ${t.type === 'error' ? 'is-error' : ''}">
            <span style="color:${t.type === 'error' ? 'var(--toast-error-text)' : 'var(--toast-success-text)'};font-weight:700;">
              ${t.type === 'error' ? '!' : '✓'}
            </span>
            <span>${this._escape(t.message)}</span>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  _escape(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new MuseInviteApp();
  app.init();
});
