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
    pool_btn_feedback: '反馈给开发者',
    pool_empty: '暂无可用邀请码，请在下方分享新码。',
    pool_empty_cta: '去分享',
    limit_hint: '每人最多使用 2 个码 · 每人限分享 1 个码',

    // 极简发码条
    publish_title: '分享你的邀请码',
    publish_code_placeholder: '输入邀请码 (如 DEMO-9NF4F6)',
    publish_spots_label: '剩余次数',
    publish_submit_btn: '立即分享',
    publish_demo_hint: '按入池先后排队 · 每人限分享 1 个、最多使用 2 个码',
    publish_success: '已入池排队：{code}（管理密钥已保存在本浏览器）',

    // 校验错误
    err_code_required: '请输入邀请码',
    err_code_length: '长度需为 4–48 位字符',
    err_code_format: '仅支持字母、数字或连字符(-)',
    err_code_duplicate: '该邀请码已在池中',
    err_spots_range: '剩余次数需为 1–30',
    err_publish_limit: '每人只能分享 1 个邀请码',
    err_claim_limit: '每人最多使用 2 个邀请码',

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
    search_placeholder: '搜索邀请码…',
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
    card_copy: '复制',
    card_copied: '已复制',
    card_used_btn: '我已用(-1)',
    card_status_btn: '状态',
    card_feedback_btn: '反馈',

    // 向开发者反馈状态
    feedback_title: '反馈邀请码状态',
    feedback_desc: '选择状态并补充说明，开发者会据此处理该邀请码。',
    feedback_reason_label: '反馈类型',
    feedback_reason_invalid: '已失效 / 无法兑换',
    feedback_reason_used: '已被使用',
    feedback_reason_wrong: '信息有误',
    feedback_reason_other: '其他',
    feedback_note_label: '补充说明（可选，最多 300 字）',
    feedback_note_placeholder: '可补充错误提示、兑换时间等',
    feedback_submit: '提交反馈',
    feedback_submitting: '提交中…',
    feedback_success: '已提交给开发者，状态不会自动改变',
    feedback_hint: '反馈只提交给开发者，不会自动改变邀请码状态。',
    err_feedback_reason: '请选择有效的反馈类型',
    err_feedback_note_long: '补充说明最多 300 字',
    err_feedback_duplicate: '你已经提交过相同类型的反馈',
    err_feedback_rate: '反馈过于频繁，请稍后再试',

    empty_list: '当前分类下暂无邀请码记录',
    empty_reset: '查看全部',

    // 状态切换弹窗
    modal_title: '切换邀请码状态',
    modal_desc: '只有持有管理密钥的人可以切换状态；没有密钥时可在下方导入通用密钥。其他访客可使用「我已使用」或失效反馈。',
    modal_has_token: '本浏览器已保存管理密钥（通用或该码专用）。',
    modal_no_token: '本浏览器没有这个邀请码的管理密钥。可以导入通用管理密钥，一次管理所有邀请码。',
    modal_token_placeholder: '粘贴 48 位通用管理密钥',
    modal_import_token: '导入通用密钥',
    modal_clear_token: '清除本机密钥',
    err_manage_token_format: '管理密钥格式不正确（应为 48 位十六进制字符）',
    toast_manage_token_saved: '通用管理密钥已保存，可以管理所有邀请码',

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
    pool_btn_feedback: 'Report to Developer',
    pool_empty: 'No active codes right now. Share one below.',
    pool_empty_cta: 'Share a code',
    limit_hint: 'Up to 2 codes per person · 1 share per person',

    // Quick publish bar
    publish_title: 'Share Your Invite Code',
    publish_code_placeholder: 'Enter invite code (e.g. DEMO-9NF4F6)',
    publish_spots_label: 'Uses left',
    publish_submit_btn: 'Add to Queue',
    publish_demo_hint: 'FIFO queue · 1 share and up to 2 codes per person',
    publish_success: 'Added to queue: {code} (management key saved in this browser)',

    // Errors
    err_code_required: 'Please enter an invite code',
    err_code_length: 'Must be 4–48 characters',
    err_code_format: 'Alphanumeric characters or hyphens (-) only',
    err_code_duplicate: 'This code is already in the queue',
    err_spots_range: 'Uses left must be between 1 and 30',
    err_publish_limit: 'You can share only one invite code.',
    err_claim_limit: 'You can use up to two invite codes.',

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
    search_placeholder: 'Search code…',
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
    card_copy: 'Copy',
    card_copied: 'Copied',
    card_used_btn: 'Used (-1)',
    card_status_btn: 'Status',
    card_feedback_btn: 'Report',

    // Developer feedback
    feedback_title: 'Report an Invite Code',
    feedback_desc: 'Choose a status and add an optional note. The developer will review it.',
    feedback_reason_label: 'Feedback type',
    feedback_reason_invalid: 'Invalid / cannot redeem',
    feedback_reason_used: 'Already used',
    feedback_reason_wrong: 'Incorrect information',
    feedback_reason_other: 'Other',
    feedback_note_label: 'Additional note (optional, up to 300 characters)',
    feedback_note_placeholder: 'Error message, redemption time, etc.',
    feedback_submit: 'Submit feedback',
    feedback_submitting: 'Submitting…',
    feedback_success: 'Sent to the developer; the status will not change automatically.',
    feedback_hint: 'Feedback is sent to the developer and never changes the code status automatically.',
    err_feedback_reason: 'Choose a valid feedback type',
    err_feedback_note_long: 'Additional note must be 300 characters or fewer',
    err_feedback_duplicate: 'You already submitted this feedback type',
    err_feedback_rate: 'Too many feedback submissions. Try again later.',

    empty_list: 'No invite codes in this category',
    empty_reset: 'Show All',

    // Modal
    modal_title: 'Switch Code Status',
    modal_desc: 'Only someone holding a management key can switch the status. If no key is saved, import the universal key below. Other visitors can use “I used this” or the failure feedback.',
    modal_has_token: 'A management key (universal or code-specific) is saved in this browser.',
    modal_no_token: 'This browser does not have a management key for this code. Import the universal management key to manage every code at once.',
    modal_token_placeholder: 'Paste the 48-character universal management key',
    modal_import_token: 'Import universal key',
    modal_clear_token: 'Forget keys on this browser',
    err_manage_token_format: 'Invalid management key (expected 48 hex characters)',
    toast_manage_token_saved: 'Universal management key saved. You can manage every code.',

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
