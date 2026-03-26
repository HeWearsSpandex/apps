// ─────────────────────────────────────────────
// admin.js — shared auth, sidebar, utilities
// All admin pages include this script
// ─────────────────────────────────────────────

const SUPABASE_URL  = 'https://oxgehlmalbvppjmdaswn.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_43D7ggkEiM_OpKpakPVxSQ_uHN35QbN';
const STORAGE_URL   = `${SUPABASE_URL}/storage/v1/object/public/images/`;

// Set to true temporarily when diagnosing auth issues — flip to false for production
const DEBUG_AUTH = false;
const dbg = (...args) => DEBUG_AUTH && console.debug('[requireAuth]', ...args);

// Storage adapter using cookies — not blocked by Edge tracking prevention
// Important: Supabase passes pre-serialised JSON strings to storage adapters
// (matching the Web Storage API contract). Do NOT JSON.stringify/parse — that
// causes double-encoding and loses the user object on getSession() reads.
const cookieStorage = {
  getItem: (key) => {
    const name = 'sb_' + btoa(key).replace(/[^a-zA-Z0-9]/g, '');
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    if (!match) return null;
    try { return decodeURIComponent(match[2]); } catch { return null; }
  },
  setItem: (key, value) => {
    const name = 'sb_' + btoa(key).replace(/[^a-zA-Z0-9]/g, '');
    // value is already a JSON string — just encode for cookie transport
    document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=86400;SameSite=Lax`;
  },
  removeItem: (key) => {
    const name = 'sb_' + btoa(key).replace(/[^a-zA-Z0-9]/g, '');
    document.cookie = `${name}=;path=/;max-age=0`;
  }
};

// Shared Supabase client — available to all pages
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: cookieStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit'
  }
});

let currentUser  = null;
let currentAdmin = null;

// ── Sidebar loader ────────────────────────────

async function loadSidebar() {
  const r    = await fetch('admin-sidebar.html');
  const html = await r.text();

  // Parse into a temp element — don't use innerHTML on mount directly
  // as script tags won't execute
  const mount = document.getElementById('sidebarMount');
  const tmp   = document.createElement('div');
  tmp.innerHTML = html;

  // Append all non-script children first
  Array.from(tmp.children).forEach(child => {
    if (child.tagName !== 'SCRIPT') mount.appendChild(child.cloneNode(true));
  });

  // Execute script tags manually
  tmp.querySelectorAll('script').forEach(oldScript => {
    const s = document.createElement('script');
    s.textContent = oldScript.textContent;
    document.body.appendChild(s);
  });

  // Set active nav item based on current page
  const page = location.pathname.split('/').pop().replace('.html', '');
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    if (el.dataset.page === page) el.classList.add('active');
  });
}

// Handle OAuth callback if code is in URL
if (location.search.includes('code=')) {
  sb.auth.exchangeCodeForSession(location.search);
}

// ── Auth guard ────────────────────────────────
// Call this on every admin page — redirects to
// dashboard.html (login) if not authenticated

async function requireAuth() {
  dbg('called — waiting for session...');
  await new Promise(resolve => setTimeout(resolve, 300));

  const { data, error: sessionError } = await sb.auth.getSession();
  const session = data?.session;

  dbg(
    'session result →',
    session ? `user=${session.user.email}` : 'no session',
    sessionError ? `error=${sessionError.message}` : ''
  );

  if (!session || !session.user) {
    dbg('no valid session — redirecting to dashboard.html');
    window.location.href = 'dashboard.html';
    return false;
  }

  currentUser = session.user;
  dbg('user authenticated →', currentUser.email);

  const { data: adminData, error } = await sb
    .from('admin_users')
    .select('*')
    .eq('id', currentUser.id)
    .eq('active', true)
    .single();

  dbg(
    'admin_users lookup →',
    adminData ? `found: ${adminData.name} (${adminData.role})` : 'not found',
    error ? `error=${error.message}` : ''
  );

  if (error || !adminData) {
    dbg('admin check failed — signing out and redirecting');
    await sb.auth.signOut();
    window.location.href = 'dashboard.html';
    return false;
  }

  currentAdmin = adminData;

  await loadSidebar();
  dbg('sidebar loaded');

  // Apply saved collapsed state to main content area
  if (localStorage.getItem('sb_collapsed') === 'true') {
    document.querySelector('.main')?.classList.add('sb-collapsed');
  }

  // Calculate and show task badge on every page
  updateTaskBadge();

  const initials = currentAdmin.name
    ? currentAdmin.name.split(' ').map(n => n[0]).join('').toUpperCase()
    : (currentUser?.email?.[0] ?? '?').toUpperCase();

  const avatarEl = document.getElementById('userAvatar');
  const nameEl   = document.getElementById('userName');
  const roleEl   = document.getElementById('userRole');

  if (avatarEl) avatarEl.textContent = initials;
  if (nameEl)   nameEl.textContent   = currentAdmin.name || currentUser.email;
  if (roleEl)   roleEl.textContent   = currentAdmin.role.replace(/_/g, ' ');

  dbg('auth complete — user ready');

  // Log login once per actual auth session (keyed on access token, not just tab)
  const { data: { session: authSession } } = await sb.auth.getSession();
  const sessionKey = authSession?.access_token?.slice(-16);
  if (sessionKey && !localStorage.getItem(`logged_${sessionKey}`)) {
    localStorage.setItem(`logged_${sessionKey}`, '1');
    auditLog('user_login', 'user', currentUser.id, currentAdmin?.name || currentUser.email, null).catch(() => {});
  }
  return true;
}

// ── Sign out ──────────────────────────────────

async function adminSignOut() {
  await auditLog('user_logout', 'user', currentUser?.id, currentAdmin?.name || currentUser?.email, null).catch(() => {});
  await sb.auth.signOut();
  window.location.href = 'dashboard.html';
}

// ── Supabase Storage helper ───────────────────
// Upload a base64 image to the images bucket
async function uploadToStorage(base64, fileName, contentType = 'image/jpeg') {
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: contentType });
  const { error } = await sb.storage.from('images').upload(fileName, blob, {
    upsert: true,
    contentType
  });
  if (error) throw new Error(error.message);
  return `${STORAGE_URL}${fileName}`;
}

// ── Supabase helpers ──────────────────────────

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json'
};

async function sbFetch(table, params = '') {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=*&order=full_name.asc${params ? '&' + params : ''}`,
    { headers: sbHeaders }
  );
  if (!r.ok) throw new Error(`Supabase read failed: ${r.status}`);
  return r.json();
}

async function sbInsert(table, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(data)
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.message || `Insert failed: ${r.status}`); }
  return r.json();
}

async function sbUpdate(table, id, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ ...data, updated_at: new Date().toISOString() })
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.message || `Update failed: ${r.status}`); }
  return r.json();
}

// ── Shared toast ──────────────────────────────

function showToast(msg, type = 'info') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = `
      position:fixed;bottom:24px;right:24px;
      padding:12px 18px;border-radius:10px;
      font-size:13px;font-weight:500;
      box-shadow:0 8px 32px rgba(0,0,0,0.14);
      z-index:999;display:none;
      align-items:center;gap:8px;color:#fff;
    `;
    document.body.appendChild(t);
  }
  const colors = { success: '#2a9d2a', error: '#c00', info: '#1a73e8', warning: '#e65100' };
  t.style.background  = colors[type] || colors.info;
  t.style.display     = 'flex';
  t.textContent       = msg;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 4000);
}


// ── Task badge — runs on every page ──────────────
async function updateTaskBadge() {
  try {
    const today = new Date().toISOString().split('T')[0];
    let count = 0;

    // Fetch active employees
    const { data: emps } = await sb
      .from('employees')
      .select('id, full_name, status, email, leaving_date')
      .in('status', ['active', 'probation', 'inactive']);

    if (!emps) return;

    const active = emps.filter(e => e.status === 'active' || e.status === 'probation');

    // Missing emails
    const missingEmails = active.filter(e => !e.email);
    if (missingEmails.length) count++;

    // Upcoming leavers (within 7 days)
    const urgent = emps.filter(e =>
      e.status === 'inactive' && e.leaving_date &&
      e.leaving_date >= today &&
      Math.ceil((new Date(e.leaving_date) - new Date(today)) / 86400000) <= 7
    );
    if (urgent.length) count++;

    // Missing photos — check Supabase Storage
    let missingPhotos = 0;
    await Promise.all(active.map(async e => {
      try {
        const r = await fetch(`${STORAGE_URL}${encodeURIComponent(e.full_name)}_cvface1.jpg`, { method: 'HEAD' });
        if (!r.ok) {
          // Also try GitHub fallback
          const r2 = await fetch(`/img/${encodeURIComponent(e.full_name)}_cvface1.png`, { method: 'HEAD' });
          if (!r2.ok) missingPhotos++;
        }
      } catch { missingPhotos++; }
    }));
    if (missingPhotos > 0) count++;

    const badge = document.getElementById('taskBadge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent    = count;
      badge.style.display  = 'inline-block';
    } else {
      badge.style.display  = 'none';
    }
  } catch(e) {
    console.warn('Task badge error:', e.message);
  }
}

// ── Audit log helper ──────────────────────────
// Call auditLog(action, entityType, entityId, entityLabel, details)
// from any page to record an action.

async function auditLog(action, entityType, entityId = null, entityLabel = null, details = null) {
  try {
    await sb.from('audit_log').insert({
      user_id:      currentUser?.id      || null,
      user_name:    currentAdmin?.name   || currentUser?.email || 'Unknown',
      action,
      entity_type:  entityType,
      entity_id:    entityId,
      entity_label: entityLabel,
      details:      details ? JSON.parse(JSON.stringify(details)) : null
    });
  } catch(e) {
    console.warn('Audit log failed:', e.message);
  }
}
