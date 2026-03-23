// ─────────────────────────────────────────────
// admin.js — shared auth, sidebar, utilities
// All admin pages include this script
// ─────────────────────────────────────────────

const SUPABASE_URL  = 'https://oxgehlmalbvppjmdaswn.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_43D7ggkEiM_OpKpakPVxSQ_uHN35QbN';
const GITHUB_REPO   = 'HeWearsSpandex/apps';
const GITHUB_BRANCH = 'main';

// Storage adapter using cookies — not blocked by Edge tracking prevention
const cookieStorage = {
  getItem: (key) => {
    const name = 'sb_' + btoa(key).replace(/[^a-zA-Z0-9]/g, '');
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    try { return match ? JSON.parse(decodeURIComponent(match[2])) : null; } catch { return null; }
  },
  setItem: (key, value) => {
    const name = 'sb_' + btoa(key).replace(/[^a-zA-Z0-9]/g, '');
    document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};path=/;max-age=86400;SameSite=Lax`;
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
  document.getElementById('sidebarMount').innerHTML = html;

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
// Call this on every admin page — redirects to
// dashboard.html (login) if not authenticated

async function requireAuth() {
  // Give Supabase time to process the session from URL hash
  await new Promise(resolve => setTimeout(resolve, 500));

  let session = null;

  // Try getting session normally first
  const { data } = await sb.auth.getSession();
  session = data?.session;

  // If no session, check URL hash for tokens (implicit flow)
  if (!session && location.hash.includes('access_token')) {
    const params = new URLSearchParams(location.hash.substring(1));
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (accessToken) {
      const { data: setData } = await sb.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      session = setData?.session;
      // Clean up URL
      history.replaceState(null, '', location.pathname);
    }
  }

  if (!session) {
    window.location.href = 'dashboard.html';
    return false;
  }

  currentUser = session.user;

  const { data: adminData, error } = await sb
    .from('admin_users')
    .select('*')
    .eq('id', currentUser.id)
    .eq('active', true)
    .single();

  if (error || !adminData) {
    await sb.auth.signOut();
    window.location.href = 'dashboard.html';
    return false;
  }

  currentAdmin = adminData;

  await loadSidebar();

  const initials = currentAdmin.name
    ? currentAdmin.name.split(' ').map(n => n[0]).join('').toUpperCase()
    : currentUser.email[0].toUpperCase();

  const avatarEl = document.getElementById('userAvatar');
  const nameEl   = document.getElementById('userName');
  const roleEl   = document.getElementById('userRole');

  if (avatarEl) avatarEl.textContent = initials;
  if (nameEl)   nameEl.textContent   = currentAdmin.name || currentUser.email;
  if (roleEl)   roleEl.textContent   = currentAdmin.role.replace(/_/g, ' ');

  return true;
}

// ── Sign out ──────────────────────────────────

async function adminSignOut() {
  await sb.auth.signOut();
  sessionStorage.removeItem('gh_token');
  window.location.href = 'dashboard.html';
}

// ── GitHub token helper ───────────────────────
// Prompt once per session — used for photo
// uploads and people.js sync only

function getGithubToken() {
  let token = sessionStorage.getItem('gh_token') || '';
  if (!token) {
    token = prompt(
      'Enter your GitHub token for photo uploads and leaderboard sync:\n' +
      '(Leave blank to skip — employee data will still save)'
    ) || '';
    if (token) sessionStorage.setItem('gh_token', token);
  }
  return token;
}

// ── GitHub API helpers ────────────────────────

async function ghGet(path, token) {
  const r = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`,
    { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
  );
  if (!r.ok) throw new Error(`GitHub GET failed: ${r.status}`);
  return r.json();
}

async function ghPut(path, content, message, sha, token) {
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.message || `GitHub PUT failed: ${r.status}`); }
  return r.json();
}

async function ghPutBinary(path, base64content, message, sha, token) {
  const body = { message, content: base64content, branch: GITHUB_BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.message || `GitHub PUT failed: ${r.status}`); }
  return r.json();
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

// ── Shared sidebar CSS ────────────────────────
// Injected once so every page gets consistent sidebar styles

(function injectSidebarStyles() {
  if (document.getElementById('sidebar-styles')) return;
  const style = document.createElement('style');
  style.id = 'sidebar-styles';
  style.textContent = `
    :root { --sidebar: 220px; }

    .sidebar {
      position: fixed;
      top: 0; left: 0;
      width: var(--sidebar);
      height: 100vh;
      background: #1a1a2e;
      display: flex;
      flex-direction: column;
      z-index: 50;
      overflow: hidden;
    }
    .sidebar-logo {
      padding: 20px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .sidebar-logo img  { height: 28px; }
    .sidebar-logo span { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.9); letter-spacing: 0.3px; }

    .sidebar-nav      { flex: 1; padding: 12px 8px; overflow-y: auto; }
    .nav-section      { font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1px; padding: 12px 8px 6px; }
    .nav-item         { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; color: rgba(255,255,255,0.65); font-size: 13px; font-weight: 500; cursor: pointer; text-decoration: none; transition: all 0.15s; margin-bottom: 2px; }
    .nav-item:hover   { background: rgba(255,255,255,0.08); color: #fff; }
    .nav-item.active  { background: #c00; color: #fff; }
    .nav-item .icon   { font-size: 16px; width: 20px; text-align: center; flex-shrink: 0; }
    .nav-badge        { margin-left: auto; background: #c00; color: #fff; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px; min-width: 18px; text-align: center; }
    .nav-item.active .nav-badge { background: rgba(255,255,255,0.3); }

    .sidebar-footer   { padding: 12px 8px; border-top: 1px solid rgba(255,255,255,0.08); }
    .sidebar-user     { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; }
    .sidebar-user-avatar { width: 32px; height: 32px; border-radius: 50%; background: #c00; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; flex-shrink: 0; }
    .sidebar-user-info   { flex: 1; min-width: 0; }
    .sidebar-user-name   { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sidebar-user-role   { font-size: 10px; color: rgba(255,255,255,0.4); text-transform: capitalize; }
    .logout-btn          { background: none; border: none; color: rgba(255,255,255,0.4); cursor: pointer; font-size: 16px; padding: 4px; border-radius: 4px; transition: color 0.15s; }
    .logout-btn:hover    { color: rgba(255,255,255,0.9); }

    .main { margin-left: var(--sidebar); min-height: 100vh; }

    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); }
      .main    { margin-left: 0; }
    }
  `;
  document.head.appendChild(style);
})();
