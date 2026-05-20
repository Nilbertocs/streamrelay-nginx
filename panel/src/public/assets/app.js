/* =====================================================
   StreamRelay Panel - Shared Application JS
   ===================================================== */

'use strict';

/* ── Toast Notifications ──────────────────────────── */

(function () {
  const container = document.createElement('div');
  container.className = 'toast-container-sr';
  document.body.appendChild(container);
  window._toastContainer = container;
})();

/**
 * Display a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration  milliseconds before auto-dismiss
 */
function showToast(message, type = 'success', duration = 4000) {
  const icons = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info:    'fa-circle-info',
  };

  const toast = document.createElement('div');
  toast.className = `toast-sr ${type === 'error' ? 'error' : type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;

  window._toastContainer.appendChild(toast);

  const remove = () => {
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  const timer = setTimeout(remove, duration);
  toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

/* ── API Helper ───────────────────────────────────── */

/**
 * Centralised fetch wrapper.
 * - Sets Content-Type: application/json
 * - Parses JSON response
 * - On 401 redirects to /login.html
 * - On error shows toast and throws
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
 * @param {string} path  e.g. '/api/streams'
 * @param {object|null} body
 * @returns {Promise<any>}  parsed response data
 */
async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== null) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(path, opts);
  } catch (networkErr) {
    showToast('Erro de rede. Verifique sua conexão.', 'error');
    throw networkErr;
  }

  // Redirect on unauthorised
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }

  // Try to parse JSON regardless of status
  let data = null;
  const contentType = res.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    try { data = await res.json(); } catch (_) { data = null; }
  }

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `Erro ${res.status}`;
    showToast(msg, 'error');
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/* ── Copy to Clipboard ────────────────────────────── */

/**
 * Copy text to clipboard and show a brief toast.
 * @param {string} text
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copiado para a área de transferência!', 'success', 2000);
  } catch (_) {
    // Fallback for older browsers / insecure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Copiado!', 'success', 2000);
  }
}

/* ── Format Bytes ─────────────────────────────────── */

/**
 * Convert a byte count to a human-readable string.
 * @param {number} bytes
 * @param {number} decimals
 * @returns {string}
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/* ── Format Date ──────────────────────────────────── */

/**
 * Format an ISO 8601 date string into a localised date/time string.
 * @param {string} isoString
 * @returns {string}
 */
function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    return new Date(isoString).toLocaleString('pt-BR', {
      day:    '2-digit',
      month:  '2-digit',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (_) {
    return isoString;
  }
}

/**
 * Format an ISO date string as relative time (e.g. "há 2 min").
 * @param {string} isoString
 * @returns {string}
 */
function formatRelative(isoString) {
  if (!isoString) return '—';
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 10)   return 'agora mesmo';
  if (diff < 60)   return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  return formatDate(isoString);
}

/* ── Sidebar Active Link ──────────────────────────── */

(function highlightSidebarLink() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
    const href = (link.getAttribute('href') || '').split('/').pop();
    if (href === page || (page === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
})();

/* ── Logout Handler ───────────────────────────────── */

(function attachLogout() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="logout"]');
    if (!btn) return;
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (_) { /* ignore */ }
    window.location.href = '/login.html';
  });
})();

/* ── Load User Info ───────────────────────────────── */

(async function loadUserInfo() {
  const nameEl   = document.getElementById('navbar-user-name');
  const avatarEl = document.getElementById('navbar-user-avatar');
  if (!nameEl) return;

  try {
    const data = await api('GET', '/auth/me');
    const name = data?.name || data?.email || 'Usuário';
    nameEl.textContent = name;
    if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
  } catch (_) {
    // 401 already redirects; swallow other errors
  }
})();

/* ── Confirmation Dialog Helper ───────────────────── */

/**
 * Simple confirm wrapper that returns a Promise<boolean>.
 * Can be swapped for a custom modal if desired.
 * @param {string} message
 * @returns {Promise<boolean>}
 */
function confirmDialog(message) {
  return Promise.resolve(window.confirm(message));
}

/* ── Debounce Utility ─────────────────────────────── */

function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ── Expose globals ───────────────────────────────── */
window.showToast     = showToast;
window.api           = api;
window.copyText      = copyText;
window.formatBytes   = formatBytes;
window.formatDate    = formatDate;
window.formatRelative = formatRelative;
window.confirmDialog = confirmDialog;
window.debounce      = debounce;
