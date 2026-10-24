/**
 * @fileoverview 浏览器端的 Supabase 客户端。
 * 只读取 VITE_ 前缀的公开配置；service_role / secret key 永远不会进入前端。
 */

import { createClient } from '@supabase/supabase-js';

// Accept both the project URL and a pasted .../rest/v1/ URL.
const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '');
const supabaseKey = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    ''
).trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

let client = null;

export function getSupabaseClient() {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return client;
}
