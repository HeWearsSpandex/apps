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

  // ── Sidebar collapse / pin ────────────────────
  initSidebarToggle();

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

// ── Sidebar collapse / pin ────────────────────

function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const main    = document.querySelector('.main');
  if (!sidebar) return;

  // Add toggle button to logo
  const logo = sidebar.querySelector('.sidebar-logo');
  if (logo) {
    const btn = document.createElement('button');
    btn.className = 'sb-toggle';
    btn.title     = 'Toggle sidebar';
    btn.innerHTML = '‹';
    btn.onclick   = () => toggleSidebar();
    logo.appendChild(btn);
  }

  // Wrap nav item text in .nav-label span and set data-label for tooltips
  sidebar.querySelectorAll('.nav-item').forEach(item => {
    // Get the text node (everything after the icon span)
    const icon = item.querySelector('.icon');
    if (!icon) return;
    const labelText = item.textContent.replace(icon.textContent, '').trim().replace(/\s+/g, ' ');
    item.setAttribute('data-label', labelText);
    // Wrap text in nav-label if not already done
    if (!item.querySelector('.nav-label')) {
      Array.from(item.childNodes).forEach(node => {
        if (node.nodeType === 3 && node.textContent.trim()) {
          const span = document.createElement('span');
          span.className = 'nav-label';
          span.textContent = node.textContent.trim();
          item.replaceChild(span, node);
        }
      });
    }
  });

  // Restore saved state
  const isCollapsed = localStorage.getItem('sb_collapsed') === 'true';
  if (isCollapsed) {
    sidebar.classList.add('sb-collapsed');
    main?.classList.add('sb-collapsed');
  }

  // Mobile overlay
  const overlay = document.createElement('div');
  overlay.className = 'sb-overlay';
  overlay.onclick   = () => closeMobile();
  document.body.appendChild(overlay);
}

function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const main     = document.querySelector('.main');
  const collapsed = sidebar.classList.toggle('sb-collapsed');
  main?.classList.toggle('sb-collapsed', collapsed);
  localStorage.setItem('sb_collapsed', collapsed);
}

function closeMobile() {
  document.getElementById('sidebar')?.classList.remove('sb-mobile-open');
  document.querySelector('.sb-overlay')?.classList.remove('active');
}

// ── Shared sidebar CSS ────────────────────────
// Injected once so every page gets consistent sidebar styles

(function injectSidebarStyles() {
  if (document.getElementById('sidebar-styles')) return;
  const style = document.createElement('style');
  style.id = 'sidebar-styles';
  style.textContent = `
    :root {
      --sw: 220px;   /* expanded width */
      --sc: 56px;    /* collapsed width */
    }

    /* ── Sidebar shell ── */
    .sidebar {
      position: fixed; top: 0; left: 0;
      width: var(--sw); height: 100vh;
      background: #fff;
      border-right: 1px solid #e8e8e8;
      box-shadow: 2px 0 8px rgba(0,0,0,0.04);
      display: flex; flex-direction: column;
      z-index: 100;
      overflow: visible;
      transition: width 0.25s cubic-bezier(0.4,0,0.2,1);
      will-change: width;
    }
    /* Background clip so nav has white bg even with overflow:visible */
    .sidebar::before {
      content: ''; position: absolute; inset: 0;
      background: #fff; z-index: -1;
      border-right: 1px solid #e8e8e8;
    }
    .sidebar.sb-collapsed { width: var(--sc); }

    /* ── Logo row ── */
    .sidebar-logo {
      display: flex; align-items: center;
      padding: 0 10px; height: 56px; flex-shrink: 0;
      border-bottom: 1px solid #f0f0f0;
      gap: 8px; overflow: hidden;
    }
    .sidebar-logo img  { height: 26px; flex-shrink: 0; transition: margin 0.25s ease; }
    .sidebar.sb-collapsed .sidebar-logo { justify-content: center; padding: 0; }
    .sidebar.sb-collapsed .sidebar-logo img { margin: 0 auto; }
    .sb-logo-text {
      font-size: 13px; font-weight: 700; color: #1a1a1a;
      white-space: nowrap; flex: 1;
      opacity: 1; transition: opacity 0.15s ease, width 0.25s ease;
      overflow: hidden;
    }
    .sidebar.sb-collapsed .sb-logo-text { opacity: 0; width: 0; pointer-events: none; }

    /* Toggle button — always visible, floats to edge */
    .sb-toggle {
      flex-shrink: 0;
      background: none; border: none; cursor: pointer;
      width: 28px; height: 28px; border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      color: #aaa; font-size: 15px;
      transition: background 0.15s, color 0.15s, transform 0.25s cubic-bezier(0.4,0,0.2,1);
      position: absolute; right: 8px; top: 14px;
    }
    .sb-toggle:hover { background: #fff0f0; color: #c00; }
    .sidebar.sb-collapsed .sb-toggle { transform: rotate(180deg); right: auto; position: relative; }
    .sidebar-logo { position: relative; }

    /* ── Nav ── */
    .sidebar-nav { flex: 1; padding: 8px; overflow-y: auto; overflow-x: visible; }
    .sidebar-nav::-webkit-scrollbar { width: 0; }

    .nav-section {
      font-size: 9px; font-weight: 700; color: #bbb;
      text-transform: uppercase; letter-spacing: 1px;
      padding: 12px 10px 4px; white-space: nowrap;
      opacity: 1; transition: opacity 0.15s ease;
    }
    .sidebar.sb-collapsed .nav-section { opacity: 0; }

    .nav-item {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 10px; border-radius: 8px;
      color: #555; font-size: 13px; font-weight: 500;
      cursor: pointer; text-decoration: none;
      transition: background 0.15s, color 0.15s;
      margin-bottom: 2px; position: relative;
      white-space: nowrap; overflow: hidden;
    }
    .nav-item:hover  { background: #f4f5f7; color: #1a1a1a; }
    .nav-item.active { background: #fff0f0; color: #c00; font-weight: 700; }

    .nav-item .icon {
      font-size: 17px; width: 20px; flex-shrink: 0;
      text-align: center; line-height: 1;
    }
    /* Centre icons when collapsed */
    .sidebar.sb-collapsed .nav-item {
      justify-content: center;
      padding: 9px 0;
    }
    .sidebar.sb-collapsed .nav-item .icon { width: auto; }

    .nav-label {
      opacity: 1; transition: opacity 0.15s ease;
      white-space: nowrap;
    }
    .sidebar.sb-collapsed .nav-label { opacity: 0; }

    .nav-badge {
      margin-left: auto; background: #c00; color: #fff;
      font-size: 10px; font-weight: 700;
      padding: 1px 6px; border-radius: 10px;
      min-width: 18px; text-align: center; flex-shrink: 0;
    }
    .sidebar.sb-collapsed .nav-badge {
      position: absolute; top: 4px; right: 4px;
      font-size: 8px; padding: 1px 4px; min-width: 14px;
    }

    /* Tooltip in collapsed state */
    .sidebar.sb-collapsed .nav-item::before {
      content: attr(data-label);
      position: absolute;
      left: calc(var(--sc) + 10px);
      top: 50%; transform: translateY(-50%);
      background: #1a1a1a; color: #fff;
      font-size: 12px; font-weight: 600;
      padding: 6px 12px; border-radius: 8px;
      white-space: nowrap; pointer-events: none;
      opacity: 0; transition: opacity 0.15s;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .sidebar.sb-collapsed .nav-item:hover::before { opacity: 1; }

    /* ── Footer ── */
    .sidebar-footer {
      padding: 8px; border-top: 1px solid #f0f0f0; flex-shrink: 0;
    }
    .sidebar-user {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 8px; overflow: hidden;
    }
    .sidebar.sb-collapsed .sidebar-user { justify-content: center; padding: 8px 0; }
    .sidebar-user-avatar {
      width: 30px; height: 30px; border-radius: 50%;
      background: #c00; color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; flex-shrink: 0;
    }
    .sidebar-user-info {
      flex: 1; min-width: 0;
      opacity: 1; transition: opacity 0.15s ease;
    }
    .sidebar.sb-collapsed .sidebar-user-info { opacity: 0; pointer-events: none; }
    .sidebar-user-name { font-size: 12px; font-weight: 600; color: #1a1a1a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sidebar-user-role { font-size: 10px; color: #aaa; text-transform: capitalize; }
    .logout-btn {
      background: none; border: none; color: #ccc;
      cursor: pointer; font-size: 16px; padding: 4px;
      border-radius: 4px; transition: color 0.15s; flex-shrink: 0;
      opacity: 1; transition: opacity 0.15s ease;
    }
    .sidebar.sb-collapsed .logout-btn { opacity: 0; pointer-events: none; }
    .logout-btn:hover { color: #c00; }

    /* ── Main content offset ── */
    .main {
      margin-left: var(--sw);
      min-height: 100vh;
      transition: margin-left 0.25s cubic-bezier(0.4,0,0.2,1);
    }
    .main.sb-collapsed { margin-left: var(--sc); }

    /* ── Mobile ── */
    @media (max-width: 768px) {
      .sidebar {
        width: var(--sw) !important;
        transform: translateX(-100%);
        transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
      }
      .sidebar.sb-mobile-open { transform: translateX(0); }
      .main, .main.sb-collapsed { margin-left: 0 !important; }
      .sb-overlay {
        display: none; position: fixed; inset: 0;
        background: rgba(0,0,0,0.3); z-index: 99;
      }
      .sb-overlay.active { display: block; }
    }
  `;
  document.head.appendChild(style);
})();

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
