/**
 * @fileoverview 极简中英双语词典 (zh-CN / en-US)
 */

export const LOCALES = {
  'zh-CN': {
    meta_title: 'Muse 邀请码互助站',
    brand_name: 'Muse 邀请码互助站',
    brand_sub: '按入池时间排队 · 次数用完自动归入已失效',
    nav_contact: '联系开发者',
    nav_refresh: '刷新',
    refresh_done: '列表已刷新',
    lang_current: '中文',
    lang_target: 'EN',
    reset_demo: '重置演示数据',
    reset_done: '已重置演示数据',

    // 首屏队首邀请码卡片
    pool_title: '当前顺位可用邀请码',
    pool_subtitle: '早入池优先展示 · 注册 48 小时内在 Settings → Redeem 输入，双方各领 10 亿词元',
    pool_spots_left: '剩余 {remaining} / {total} 次',
    pool_btn_copy: '复制邀请码',
    pool_btn_copied: '已复制',
    pool_btn_next: '下一个',
    pool_btn_claimed: '我已使用 (-1)',
    pool_btn_dead: '失效反馈 ({count}/3)',
    pool_empty: '暂无可用邀请码，请在下方分享新码。',
    pool_empty_cta: '去分享',

    // 极简发码条
    publish_title: '分享你的邀请码',
    publish_code_placeholder: '输入邀请码 (如 DEMO-9NF4F6)',
    publish_spots_label: '剩余次数',
    publish_submit_btn: '立即分享',
    publish_fill_sample: '填入示例',
    publish_demo_hint: '按入池先后排队，数据实时同步。',
    publish_desc_label: '使用说明（可选）',
    publish_desc_placeholder: '可选：兑换注意事项，最多 280 字',
    publish_expiry_label: '有效期至（可选）',
    publish_success: '已入池排队：{code}（管理密钥已保存在本浏览器）',

    // 校验错误
    err_code_required: '请输入邀请码',
    err_code_length: '长度需为 4–48 位字符',
    err_code_format: '仅支持字母、数字或连字符(-)',
    err_code_duplicate: '该邀请码已在池中',
    err_spots_range: '剩余次数需为 1–30',
    err_desc_too_long: '使用说明最多 280 字',
    err_expiry_invalid: '有效期需在未来 90 天内',

    // 网络与后端错误
    err_network: '网络连接失败，请检查网络后重试',
    err_rate_limited: '操作过于频繁，请稍后再试',
    err_not_authorized: '只有发布者可以在本浏览器切换该码的状态',
    err_already_claimed: '你已经标记过这个邀请码',
    err_already_reported: '你已经反馈过这个邀请码',
    err_not_available: '该邀请码当前不可用',
    err_not_found: '该邀请码已不存在',
    err_generic: '操作失败，请稍后重试',
    err_backend_not_configured: '后端尚未配置，暂时无法读取或发布邀请码',
    err_backend_hint: '请配置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY 后重新构建。',
    loading: '加载中…',
    retry: '重试',
    load_error_title: '邀请码加载失败',

    // 邀请码列表
    list_title: '邀请码队列（早入池排在最上边）',
    search_placeholder: '搜索邀请码或说明…',
    search_clear: '清除',
    filter_available: '可用',
    filter_expired: '已失效',
    filter_used: '已使用',
    filter_all: '全部',

    status_available: '可用',
    status_used: '已使用',
    status_expired: '已失效',
    badge_demo: 'DEMO',
    badge_new: '我发布的',
    queue_prefix: '顺位 #',

    card_spots: '剩余 {remaining}/{total} 次',
    card_spots_exhausted: '次数已用完 (0/{total})',
    card_expires: '有效期至 {date}',
    card_copy: '复制',
    card_copied: '已复制',
    card_used_btn: '我已用(-1)',
    card_status_btn: '状态',

    empty_list: '当前分类下暂无邀请码记录',
    empty_reset: '查看全部',

    // 状态切换弹窗
    modal_title: '切换邀请码状态',
    modal_desc: '只有发布者（本浏览器保存了管理密钥）可以切换状态；其他访客可使用「我已使用」或失效反馈。',

    // 底部说明
    footer_guide: '兑换方法：注册 Muse 48 小时内 → 打开 Settings (设置) → Redeem invite code 输入即可。',
    footer_disclaimer: '免责声明：本网站为独立社区互助项目，与 Muse 官方无隶属关系。邀请码由社区成员公开分享，请自行判断有效性。',
    footer_contact: '联系开发者：3391792088@qq.com',

    toast_copied: '已复制：{code}',
    toast_drew: '已切换至：{code}',
    toast_claimed: '{code} 剩余次数已减至 {remaining}',
    toast_exhausted: '{code} 次数已用完，已自动放入「已失效」',
    toast_reported: '已反馈 {code} 失效 ({reports}/3)',
    toast_updated: '已将 {code} 状态设为：{status}'
  },

  'en-US': {
    meta_title: 'Muse Invite Code Hub',
    brand_name: 'Muse Invite Code Hub',
    brand_sub: 'FIFO Queue (Oldest First) · Auto-Expires at 0 Uses',
    nav_contact: 'Contact',
    nav_refresh: 'Refresh',
    refresh_done: 'List refreshed',
    lang_current: 'EN',
    lang_target: '中文',
    reset_demo: 'Reset Demo',
    reset_done: 'Demo data restored',

    // Top queue card
    pool_title: 'Next Up in Queue',
    pool_subtitle: 'Oldest codes prioritized first · Redeem in Muse Settings → Redeem within 48h for 1B tokens each',
    pool_spots_left: '{remaining} / {total} uses left',
    pool_btn_copy: 'Copy Code',
    pool_btn_copied: 'Copied',
    pool_btn_next: 'Next in Queue',
    pool_btn_claimed: 'I Used This (-1)',
    pool_btn_dead: 'Didn’t Work ({count}/3)',
    pool_empty: 'No active codes right now. Share one below.',
    pool_empty_cta: 'Share a code',

    // Quick publish bar
    publish_title: 'Share Your Invite Code',
    publish_code_placeholder: 'Enter invite code (e.g. DEMO-9NF4F6)',
    publish_spots_label: 'Uses left',
    publish_submit_btn: 'Add to Queue',
    publish_fill_sample: 'Sample',
    publish_demo_hint: 'Ordered by entry time (FIFO). Data is shared in real time.',
    publish_desc_label: 'Description (optional)',
    publish_desc_placeholder: 'Optional note, up to 280 characters',
    publish_expiry_label: 'Valid until (optional)',
    publish_success: 'Added to queue: {code} (management key saved in this browser)',

    // Errors
    err_code_required: 'Please enter an invite code',
    err_code_length: 'Must be 4–48 characters',
    err_code_format: 'Alphanumeric characters or hyphens (-) only',
    err_code_duplicate: 'This code is already in the queue',
    err_spots_range: 'Uses left must be between 1 and 30',
    err_desc_too_long: 'Description must be 280 characters or fewer',
    err_expiry_invalid: 'Choose a date within the next 90 days',

    err_network: 'Network error. Check your connection and try again.',
    err_rate_limited: 'Too many actions. Please try again later.',
    err_not_authorized: 'Only the publisher can change this code’s status on this browser.',
    err_already_claimed: 'You already marked this code as used.',
    err_already_reported: 'You already reported this code.',
    err_not_available: 'This code is no longer available.',
    err_not_found: 'This code no longer exists.',
    err_generic: 'Something went wrong. Please try again.',
    err_backend_not_configured: 'The backend is not configured yet.',
    err_backend_hint: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.',
    loading: 'Loading…',
    retry: 'Retry',
    load_error_title: 'Could not load invite codes',

    // Directory
    list_title: 'Invite Code Queue (Oldest First)',
    search_placeholder: 'Search code or description…',
    search_clear: 'Clear',
    filter_available: 'Available',
    filter_expired: 'Expired',
    filter_used: 'Used',
    filter_all: 'All',

    status_available: 'Available',
    status_used: 'Used',
    status_expired: 'Expired',
    badge_demo: 'DEMO',
    badge_new: 'Your post',
    queue_prefix: 'Queue #',

    card_spots: '{remaining}/{total} left',
    card_spots_exhausted: '0/{total} left (Exhausted)',
    card_expires: 'Valid until {date}',
    card_copy: 'Copy',
    card_copied: 'Copied',
    card_used_btn: 'Used (-1)',
    card_status_btn: 'Status',

    empty_list: 'No invite codes in this category',
    empty_reset: 'Show All',

    // Modal
    modal_title: 'Switch Code Status',
    modal_desc: 'Only the publisher (this browser holds the management key) can switch the status. Other visitors can use “I used this” or the failure feedback.',

    // Footer
    footer_guide: 'How to redeem: Within 48h of joining Muse → Settings → Redeem invite code.',
    footer_disclaimer: 'Disclaimer: independent community mutual-aid project, not affiliated with Muse. Codes are shared publicly; use them at your own discretion.',
    footer_contact: 'Contact Developer: 3391792088@qq.com',

    toast_copied: 'Copied: {code}',
    toast_drew: 'Switched to: {code}',
    toast_claimed: '{code} now has {remaining} uses left',
    toast_exhausted: '{code} reached 0 uses and moved to Expired',
    toast_reported: 'Reported {code} ({reports}/3)',
    toast_updated: 'Set {code} status to {status}'
  }
};
