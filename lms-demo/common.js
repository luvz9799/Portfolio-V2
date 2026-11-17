// ===== Fill these two from Supabase → Project Settings → API =====
const SUPABASE_URL = 'https://demo.invalid'; // portfolio demo: see demo/supabase-shim.js
const SUPABASE_ANON_KEY = 'demo';
// ==================================================================

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'pkce' } });
const $app = document.getElementById('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

// Lucide icon paths (MIT)
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  left: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  retry: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  cap: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  funnel: '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  pie: '<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>',
  whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  phone: '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
};
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const GOOGLE_G = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>`;

// raw: html already contains its own <main> (admin layout)
function show(html, name, raw = false) {
  $app.innerHTML = `
    <a class="skip" href="#main">Skip to content</a>
    <header class="top"><div class="top-in">
      <a class="brand" href="#/"><span class="logo">A</span><span>Akshardham <b>Academy</b></span></a>
      ${name ? `<div class="user">
        <span class="avatar" aria-hidden="true">${esc(initials(name))}</span>
        <span class="user-name">${esc(name)}</span>
        <button class="icon-btn" onclick="logout()" aria-label="Logout" title="Logout">${icon('logout')}</button>
      </div>` : ''}
    </div></header>
    ${raw ? html : `<main id="main" class="fade-in">${html}</main>`}`;
  scrollTo(0, 0);
}

function toast(msg, type = '') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = Object.assign(document.createElement('div'), { id: 'toasts' });
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const t = Object.assign(document.createElement('div'), { className: `toast ${type}` });
  t.innerHTML = `${icon(type === 'err' ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
  box.append(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3500);
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#2457C5', '#C5A15B', '#0E9384', '#C27C0E'];
  const box = Object.assign(document.createElement('div'), { className: 'confetti' });
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % 4]};animation-delay:${Math.random() * 0.7}s;animation-duration:${2.2 + Math.random() * 1.5}s`;
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4500);
}

// one shared tooltip for every [data-tip] mark (hover or keyboard focus)
function initTips() {
  const tip = Object.assign(document.createElement('div'), { id: 'tip' });
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  const on = e => {
    const el = e.target.closest?.('[data-tip]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    tip.textContent = el.dataset.tip;
    tip.style.left = `${Math.min(innerWidth - 90, Math.max(90, r.left + r.width / 2))}px`;
    tip.style.top = `${r.top + scrollY - 8}px`;
    tip.classList.add('on');
  };
  const off = () => tip.classList.remove('on');
  addEventListener('pointerover', on); addEventListener('focusin', on);
  addEventListener('pointerout', off); addEventListener('focusout', off);
}

function fail(err) {
  show(`<div class="card narrow empty">
    ${icon('alert')}
    <h2>Something went wrong</h2>
    <p>${esc(err?.message || err)}</p>
    <button class="btn btn-primary" onclick="location.reload()">${icon('retry')} Try again</button>
  </div>`);
}

async function getSessionProfile() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return {};
  const { data: profile, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error) throw error;
  return { user: session.user, profile };
}

function viewLogin(admin = false) {
  const perks = admin
    ? [['users', 'Every learner\'s progress and test results in one place'], ['layers', 'Manage trainings, chapters and the question bank'], ['download', 'Build shortlists and export to CSV']]
    : [['video', 'Chapter-by-chapter training videos'], ['clipboard', 'A short test after each chapter, pass at 80%'], ['award', 'Clear every chapter to move ahead']];
  show(`
    <div class="auth"><div class="auth-grid">
      <section class="hero">
        <span class="eyebrow">${icon(admin ? 'shield' : 'cap', 'sm')} Akshardham Associates</span>
        <h1>${admin ? 'Admin Panel' : 'Training & Assessment Portal'}</h1>
        <p>${admin ? 'Run training, tests and selection from one place.' : 'Learn, take tests and track your own progress.'}</p>
        <ul class="perks">${perks.map(([i, t]) => `<li>${icon(i)}<span>${t}</span></li>`).join('')}</ul>
      </section>
      <section class="card">
        <span class="logo" aria-hidden="true">A</span>
        <h2>Sign in</h2>
        <p class="muted">Sign in with your Google (Gmail) account in one click. No password to remember.</p>
        <button class="btn btn-google" onclick="login(this)">${GOOGLE_G} Continue with Google</button>
        <p class="help" style="margin-top:16px">By signing in you agree to our <a href="privacy.html">Privacy Policy</a>.</p>
      </section>
    </div></div>`, null, true);
}

function login(btn) {
  if (btn) { btn.disabled = true; btn.lastChild.textContent = ' Opening Google…'; }
  sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
}

async function logout() {
  await sb.auth.signOut();
  location.hash = '';
  location.reload();
}
