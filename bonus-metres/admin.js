// ─────────────────────────────────────────────
// admin.js — shared auth, sidebar, utilities
// All admin pages include this script
// ─────────────────────────────────────────────

const SUPABASE_URL  = 'https://oxgehlmalbvppjmdaswn.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_43D7ggkEiM_OpKpakPVxSQ_uHN35QbN';
const GITHUB_REPO   = 'HeWearsSpandex/apps';
const GITHUB_BRANCH = 'main';

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
  return true;
}

// ── Sign out ──────────────────────────────────

async function adminSignOut() {
  await sb.auth.signOut();
  sessionStorage.removeItem('gh_token');
  window.location.href = 'dashboard.html';
}

// ── GitHub token helper ───────────────────────
// Returns cached token immediately, or shows a
// styled modal and resolves when user confirms.

function getGithubToken() {
  const cached = sessionStorage.getItem('gh_token') || '';
  if (cached) return Promise.resolve(cached);
  return _promptGithubTokenModal();
}

function _promptGithubTokenModal() {
  return new Promise(resolve => {
    if (!document.getElementById('ghTokenModal')) {
      const el = document.createElement('div');
      el.id = 'ghTokenModal';
      el.style.cssText = [
        'position:fixed;inset:0;background:rgba(0,0,0,0.45);',
        'z-index:9999;display:flex;align-items:center;',
        'justify-content:center;padding:16px;'
      ].join('');
      el.innerHTML = `
        <div style="background:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.18);width:100%;max-width:420px;padding:28px 28px 24px;font-family:'Segoe UI',system-ui,sans-serif;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <span style="font-size:22px;">🔑</span>
            <h2 style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0;">GitHub Token</h2>
          </div>
          <p style="font-size:13px;color:#888;margin:0 0 18px;line-height:1.5;">Required for leaderboard sync and photo uploads.<br>Leave blank to skip — employee data will still save.</p>
          <input id="ghTokenInput" type="password" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            style="width:100%;padding:10px 12px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:14px;outline:none;margin-bottom:6px;font-family:monospace;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:20px;">
            <input type="checkbox" id="ghTokenShow" style="cursor:pointer;">
            <label for="ghTokenShow" style="font-size:12px;color:#888;cursor:pointer;">Show token</label>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="ghTokenSkip" style="padding:9px 18px;border-radius:8px;border:1px solid #e0e0e0;background:#f4f5f7;color:#888;font-size:13px;font-weight:600;cursor:pointer;">Skip</button>
            <button id="ghTokenSave" style="padding:9px 18px;border-radius:8px;border:none;background:#c00;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">Save &amp; Sync</button>
          </div>
        </div>`;
      document.body.appendChild(el);
      document.getElementById('ghTokenShow').addEventListener('change', function() {
        document.getElementById('ghTokenInput').type = this.checked ? 'text' : 'password';
      });
      const inp = document.getElementById('ghTokenInput');
      inp.addEventListener('focus', () => inp.style.borderColor = '#c00');
      inp.addEventListener('blur',  () => inp.style.borderColor = '#e0e0e0');
    }

    const modal   = document.getElementById('ghTokenModal');
    const input   = document.getElementById('ghTokenInput');
    const saveBtn = document.getElementById('ghTokenSave');
    const skipBtn = document.getElementById('ghTokenSkip');

    input.value = '';
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 50);

    function confirm() {
      const token = input.value.trim();
      modal.style.display = 'none';
      if (token) sessionStorage.setItem('gh_token', token);
      resolve(token);
    }
    function skip() {
      modal.style.display = 'none';
      resolve('');
    }

    saveBtn.onclick = confirm;
    skipBtn.onclick = skip;
    input.onkeydown = e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') skip(); };
    modal.onclick   = e => { if (e.target === modal) skip(); };
  });
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
