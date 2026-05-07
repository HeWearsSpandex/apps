// ============================================================
// DepotIQ — Supabase Client & Auth Helpers
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

export const supabase = createClient(
  DEPOTIQ_CONFIG.SUPABASE_URL,
  DEPOTIQ_CONFIG.SUPABASE_ANON_KEY
);

// ── Auth ──────────────────────────────────────────────────

export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/depotiq/login.html';
    return null;
  }
  return session;
}

export async function getCurrentUser() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const { data: profile } = await supabase
    .from('depotiq_user_profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  return { ...session.user, profile };
}

export async function requireRole(roles = []) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (roles.length && !roles.includes(user.profile?.role)) {
    window.location.href = '/depotiq/index.html';
    return null;
  }
  return user;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = '/depotiq/login.html';
}

// ── Storage helpers ───────────────────────────────────────

export async function uploadDeliveryNote(file, deliveryId) {
  // Validate size
  if (file.size > DEPOTIQ_CONFIG.MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
    throw new Error(`File must be under ${DEPOTIQ_CONFIG.MAX_UPLOAD_SIZE_MB}MB`);
  }
  // Validate mime type
  if (!DEPOTIQ_CONFIG.ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error('File must be a JPEG, PNG, WebP image or PDF');
  }

  const ext      = file.name.split('.').pop();
  const path     = `${deliveryId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(DEPOTIQ_CONFIG.DELIVERY_NOTES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) throw error;
  return path;
}

export async function getDeliveryNoteUrl(path) {
  const { data, error } = await supabase.storage
    .from(DEPOTIQ_CONFIG.DELIVERY_NOTES_BUCKET)
    .createSignedUrl(path, DEPOTIQ_CONFIG.SIGNED_URL_EXPIRY_SECONDS);

  if (error) throw error;
  return data.signedUrl;
}

// ── Stock helpers ─────────────────────────────────────────

export async function getStockLevels() {
  const { data, error } = await supabase
    .from('depotiq_stock_levels')
    .select('*')
    .order('store_name')
    .order('item_name');
  if (error) throw error;
  return data;
}

export async function getLowStockSummary() {
  const { data, error } = await supabase
    .from('depotiq_low_stock_summary')
    .select('*')
    .order('alert_status')
    .order('item_name');
  if (error) throw error;
  return data;
}

// ── Formatting helpers ────────────────────────────────────

export function formatQty(value, unit) {
  const n = parseFloat(value) || 0;
  return `${n % 1 === 0 ? n : n.toFixed(2)} ${unit}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

export function statusBadge(status) {
  const map = {
    ok:      { label: 'OK',         cls: 'badge-ok'      },
    low:     { label: 'Low Stock',  cls: 'badge-low'     },
    ordered: { label: 'Ordered',    cls: 'badge-ordered' },
  };
  return map[status] || { label: status, cls: '' };
}
