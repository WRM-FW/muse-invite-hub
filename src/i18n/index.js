/**
 * @fileoverview 轻量级响应式国际化管理器
 * 默认简体中文 ('zh-CN')，支持随时切换为英文 ('en-US') 且不丢失页面任何表单、搜索或筛选状态。
 */

import { LOCALES } from './locales.js';

const LANG_STORAGE_KEY = 'muse_invite_hub_locale_v1';

class I18nManager {
  constructor() {
    this.locale = this._loadInitialLocale();
    this.listeners = new Set();
  }

  _loadInitialLocale() {
    try {
      const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
      if (saved && LOCALES[saved]) return saved;
    } catch (_err) {
      // ignore storage errors
    }
    return 'zh-CN';
  }

  getLocale() {
    return this.locale;
  }

  setLocale(nextLocale) {
    if (!LOCALES[nextLocale] || nextLocale === this.locale) return;
    this.locale = nextLocale;
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, nextLocale);
    } catch (_err) {
      // ignore
    }
    document.documentElement.lang = nextLocale;
    document.title = this.t('meta_title');
    this.listeners.forEach((cb) => cb(this.locale));
  }

  toggleLocale() {
    const next = this.locale === 'zh-CN' ? 'en-US' : 'zh-CN';
    this.setLocale(next);
  }

  /**
   * 翻译键值并支持 `{key}` 占位符插值
   * @param {string} key
   * @param {Record<string, string|number>} [params]
   */
  t(key, params = {}) {
    const dict = LOCALES[this.locale] || LOCALES['zh-CN'];
    let text = dict[key] ?? LOCALES['zh-CN'][key] ?? key;
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    });
    return text;
  }

  /**
   * 格式化日期时间，适配当前所选语言
   * @param {string|null} isoString
   */
  formatDateTime(isoString) {
    if (!isoString) return this.t('card_expires_never');
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    try {
      return new Intl.DateTimeFormat(this.locale, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(date);
    } catch (_err) {
      return isoString.slice(0, 16).replace('T', ' ');
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}

export const i18n = new I18nManager();
