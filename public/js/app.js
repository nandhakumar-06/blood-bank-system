/* Lifeline - blood bank management frontend (vanilla JS single-page app) */
(() => {
  'use strict';

  const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const root = document.getElementById('root');

  // ---------- helpers ----------
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el = document) => el.querySelector(sel);
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fmtDate = (s) => {
    if (!s) return '-';
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtDateTime = (s) => {
    if (!s) return '-';
    // SQLite datetime('now') is UTC
    const d = new Date(String(s).replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  };
  const groupTag = (g) => `<span class="group">${esc(g)}</span>`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const store = {
    get token() { try { return localStorage.getItem('bb_token'); } catch { return null; } },
    set token(v) { try { v ? localStorage.setItem('bb_token', v) : localStorage.removeItem('bb_token'); } catch { /* ignore */ } },
    user: null,
  };

  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(store.token ? { Authorization: 'Bearer ' + store.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && path !== '/auth/login') {
      store.token = null;
      store.user = null;
      location.hash = '#/login';
      throw new Error('Your session has ended. Sign in again.');
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Something went wrong');
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- modal ----------
  function openModal({ title, body, submitLabel = 'Save', wide = false, onSubmit, hideSubmit = false }) {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal' + (wide ? ' wide' : '');
    dlg.innerHTML = `
      <form method="dialog" novalidate>
        <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">&times;</button></header>
        <div class="modal-body">${body}</div>
        <div class="form-error" hidden role="alert"></div>
        <footer>
          <button type="button" class="btn secondary" data-close>${hideSubmit ? 'Close' : 'Cancel'}</button>
          ${hideSubmit ? '' : `<button type="submit" class="btn primary">${esc(submitLabel)}</button>`}
        </footer>
      </form>`;
    document.body.appendChild(dlg);
    const form = $('form', dlg);
    const errBox = $('.form-error', dlg);
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit) return;
      errBox.hidden = true;
      const btn = $('button[type=submit]', dlg);
      btn.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        form.querySelectorAll('input[type=checkbox]').forEach((c) => { data[c.name] = c.checked; });
        await onSubmit(data, close);
      } catch (err) {
        let msg = err.message;
        if (err.data && err.data.reasons) msg += ' ' + err.data.reasons.join(' ');
        errBox.textContent = msg;
        errBox.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
    dlg.showModal();
    const first = dlg.querySelector('input:not([type=hidden]), select, textarea');
    if (first) first.focus();
    return dlg;
  }

  function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
    const dlg = openModal({
      title,
      body: `<p style="margin-bottom:14px">${esc(message)}</p>`,
      submitLabel: confirmLabel,
      onSubmit: async (_d, close) => { await onConfirm(); close(); },
    });
    if (danger) $('button[type=submit]', dlg).classList.replace('primary', 'danger');
  }

  const groupOptions = (selected, withAll) =>
    (withAll ? `<option value="">All blood groups</option>` : '') +
    BLOOD_GROUPS.map((g) => `<option value="${g}" ${g === selected ? 'selected' : ''}>${g}</option>`).join('');

  const icons = {
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
    stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3c-4 5.5-7 8.5-7 12a7 7 0 0 0 14 0c0-3.500-3-6.500-7-12z"/></svg>',
    donors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c.5-3.500 3-5.500 6.500-5.500s6 2 6.500 5.500"/><path d="M17 5a3.500 3.500 0 0 1 0 7M18.500 14.800c2 .6 3.200 2.400 3.500 5.200"/></svg>',
    donations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-8-5.500-8-11a4.500 4.500 0 0 1 8-2.800A4.500 4.500 0 0 1 20 10c0 5.500-8 11-8 11z"/></svg>',
    requests: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3"/><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 13h8M8 17h5"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.500"/><path d="M5 20c.5-4 3-6 7-6s6.500 2 7 6"/></svg>',
  };
  const dropLogo = (size = 30) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3C11 10 6 14.500 6 20a10 10 0 0 0 20 0C26 14.500 21 10 16 3z" fill="#ff5a73"/><path d="M11 20.500a5 5 0 0 0 4 4.400" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none" opacity=".7"/></svg>`;

  // blood-bag graphic: fill level relative to a "comfortable" level of 10 units
  function bagHtml(g, units, i, threshold, extra = '') {
    const pct = Math.min(100, Math.round((units / 10) * 100));
    const cls = units === 0 ? 'empty' : units < threshold ? 'low' : '';
    const note = units === 0 ? '<div class="bag-note empty">Out of stock</div>' : units < threshold ? '<div class="bag-note low">Running low</div>' : '<div class="bag-note"></div>';
    return `<div class="bag-item">
      <div class="bag-wrap"><div class="bag ${cls}" style="--h:${pct}%;--i:${i}"><div class="fill"></div></div></div>
      <div class="bag-group">${esc(g)}</div>
      <div class="bag-units num">${plural(units, 'unit', 'units')}</div>
      ${note}${extra}
    </div>`;
  }

  // ---------- layout ----------
  const NAV = [
    { href: '#/dashboard', label: 'Dashboard', icon: icons.dash },
    { href: '#/inventory', label: 'Blood stock', icon: icons.stock },
    { href: '#/donors', label: 'Donors', icon: icons.donors },
    { href: '#/donations', label: 'Donations', icon: icons.donations },
    { href: '#/requests', label: 'Requests', icon: icons.requests },
    { href: '#/users', label: 'Staff accounts', icon: icons.users, admin: true },
  ];

  function shell(activeHref, content) {
    const u = store.user;
    root.innerHTML = `
      <div class="app">
        <aside class="sidebar">
          <div class="brand">${dropLogo()}<div><div class="brand-name">Lifeline</div><div class="brand-sub">Blood bank</div></div></div>
          <nav class="nav" aria-label="Main">
            ${NAV.filter((n) => !n.admin || u.role === 'admin')
              .map((n) => `<a href="${n.href}" ${n.href === activeHref ? 'aria-current="page"' : ''}>${n.icon}<span>${n.label}</span></a>`)
              .join('')}
          </nav>
          <div class="sidebar-foot">
            <div class="who">${esc(u.name)}</div>
            <div class="role">${u.role === 'admin' ? 'Administrator' : 'Staff'}</div>
            <button class="link-btn" id="pw-btn">Change password</button>
            <button class="link-btn" id="logout-btn">Sign out</button>
          </div>
        </aside>
        <main class="main" id="main">${content}</main>
      </div>`;
    $('#logout-btn').onclick = () => { store.token = null; store.user = null; location.hash = '#/login'; };
    $('#pw-btn').onclick = changePasswordDialog;
  }

  function changePasswordDialog() {
    openModal({
      title: 'Change password',
      submitLabel: 'Update password',
      body: `
        <label class="field"><span>Current password</span><input type="password" name="currentPassword" autocomplete="current-password" required></label>
        <label class="field"><span>New password</span><input type="password" name="newPassword" autocomplete="new-password" minlength="6" required><small>At least 6 characters.</small></label>`,
      onSubmit: async (d, close) => {
        await api('/auth/password', { method: 'PUT', body: d });
        close();
        toast('Password updated');
      },
    });
  }

  const loading = () => `<p class="muted">Loading...</p>`;
  const errorBlock = (e) => `<div class="empty"><strong>Could not load this page</strong>${esc(e.message)}</div>`;

  // ---------- pages ----------
  async function loginPage() {
    root.innerHTML = `
      <div class="login">
        <section class="login-art">
          <div class="brand">${dropLogo(36)}<div class="brand-name">Lifeline</div></div>
          <div>
            <h1>Every unit counted, every request answered.</h1>
            <p>Track donors, donations, stock levels and hospital requests in one place.</p>
          </div>
          <div class="bags" aria-hidden="true">
            ${['O-', 'A+', 'B+', 'AB-'].map((g, i) => bagHtml(g, [3, 7, 5, 9][i], i, 0).replace(/<div class="bag-units[\s\S]*$/, '</div>')).join('')}
          </div>
        </section>
        <section class="login-form-wrap">
          <form class="login-form" id="login-form" novalidate>
            <h2>Sign in</h2>
            <label class="field"><span>Username</span><input type="text" name="username" autocomplete="username" required autofocus></label>
            <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
            <div class="form-error" id="login-error" hidden role="alert" style="margin:0 0 12px"></div>
            <button class="btn primary" type="submit">Sign in</button>
            <p class="hint">Demo accounts: <code>admin</code> / <code>admin123</code> (full access) or <code>staff</code> / <code>staff123</code>. Change these before real use.</p>
          </form>
        </section>
      </div>`;
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const errBox = $('#login-error');
      errBox.hidden = true;
      try {
        const res = await api('/auth/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
        store.token = res.token;
        store.user = res.user;
        location.hash = '#/dashboard';
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      }
    });
  }

  async function dashboardPage() {
    shell('#/dashboard', `<div class="page-head"><div><h1>Dashboard</h1><p class="lede">Where the blood bank stands today.</p></div></div>${loading()}`);
    try {
      const d = await api('/dashboard');
      const t = d.totals;
      const alerts = [];
      if (t.critical_pending) alerts.push(`<div class="alert crit"><span><strong>${plural(t.critical_pending, 'critical request', 'critical requests')}</strong> waiting for blood.</span><a class="btn sm secondary" href="#/requests">Review requests</a></div>`);
      if (d.low_stock.length) alerts.push(`<div class="alert"><span>Low on <strong>${d.low_stock.map(esc).join(', ')}</strong> (fewer than ${d.low_stock_threshold} units).</span><a class="btn sm secondary" href="#/donors">Find eligible donors</a></div>`);
      if (t.expired_units) alerts.push(`<div class="alert"><span><strong>${plural(t.expired_units, 'expired unit', 'expired units')}</strong> still on the shelf.</span><a class="btn sm secondary" href="#/inventory">Go to blood stock</a></div>`);
      const maxMonthly = Math.max(1, ...d.monthly.map((m) => m.units));

      $('#main').innerHTML = `
        <div class="page-head"><div><h1>Dashboard</h1><p class="lede">Where the blood bank stands today.</p></div>
          <div class="actions"><a class="btn primary" href="#/donations?new=1">Record donation</a><a class="btn secondary" href="#/requests?new=1">New request</a></div></div>
        ${alerts.length ? `<div class="alerts">${alerts.join('')}</div>` : ''}
        <div class="strip">
          <div><div class="big num">${t.units_in_stock}</div><div class="label">Units in stock</div>${t.expiring_soon ? `<div class="note warn">${t.expiring_soon} expiring within 7 days</div>` : '<div class="note muted">None expiring soon</div>'}</div>
          <div><div class="big num">${t.pending_requests}</div><div class="label">Pending requests</div>${t.critical_pending ? `<div class="note bad">${t.critical_pending} critical</div>` : '<div class="note muted">None critical</div>'}</div>
          <div><div class="big num">${t.donors}</div><div class="label">Registered donors</div><div class="note muted">${t.donations} donations recorded</div></div>
          <div><div class="big num">${t.fulfilled_requests}</div><div class="label">Requests fulfilled</div><div class="note muted">All time</div></div>
        </div>
        <section class="section"><div class="section-head"><h2>Stock by blood group</h2><a href="#/inventory">See details</a></div>
          <div class="bags">${d.stock.map((s, i) => bagHtml(s.blood_group, s.units, i, d.low_stock_threshold)).join('')}</div></section>
        <div class="cols section">
          <section><div class="section-head"><h2>Pending requests</h2><a href="#/requests">All requests</a></div>
            ${d.pending_requests.length ? `<ul class="list">${d.pending_requests.map((r) => `<li><div><strong>${esc(r.patient_name)}</strong> <span class="sub">${esc(r.hospital)}</span><div class="sub">${plural(r.units, 'unit', 'units')} of ${esc(r.blood_group)}</div></div>${urgencyTag(r.urgency)}</li>`).join('')}</ul>` : `<div class="empty"><strong>No pending requests</strong>New hospital requests will appear here.</div>`}</section>
          <section><div class="section-head"><h2>Recent donations</h2><a href="#/donations">All donations</a></div>
            ${d.recent_donations.length ? `<ul class="list">${d.recent_donations.map((r) => `<li><div><strong>${esc(r.donor_name)}</strong><div class="sub">${fmtDate(r.donation_date)}</div></div><div>${groupTag(r.blood_group)} <span class="num">${plural(r.units, 'unit', 'units')}</span></div></li>`).join('')}</ul>` : `<div class="empty"><strong>No donations yet</strong>Record the first donation to start tracking stock.</div>`}</section>
        </div>
        <section class="section"><div class="section-head"><h2>Units donated, last 6 months</h2></div>
          <div class="chart" role="img" aria-label="Units donated per month">${d.monthly.map((m) => `<div class="col"><div class="val num">${m.units}</div><div class="bar" style="height:${Math.round((m.units / maxMonthly) * 100)}px"></div><div class="lbl">${esc(m.label)}</div></div>`).join('')}</div></section>`;
    } catch (e) { $('#main').innerHTML = errorBlock(e); }
  }

  const urgencyTag = (u) => `<span class="tag ${u === 'critical' ? 'crit' : u === 'urgent' ? 'warn' : ''}">${esc(u[0].toUpperCase() + u.slice(1))}</span>`;

  async function inventoryPage() {
    shell('#/inventory', `<div class="page-head"><div><h1>Blood stock</h1></div></div>${loading()}`);
    try {
      const [inv, units] = await Promise.all([api('/inventory'), api('/inventory/units')]);
      const expiredTotal = inv.groups.reduce((s, g) => s + g.expired, 0);
      $('#main').innerHTML = `
        <div class="page-head"><div><h1>Blood stock</h1><p class="lede">${plural(inv.total_available, 'usable unit', 'usable units')} as of ${fmtDate(inv.as_of)}. Whole blood keeps for 42 days.</p></div>
          <div class="actions">${expiredTotal ? `<button class="btn danger" id="discard-btn">Discard ${plural(expiredTotal, 'expired unit', 'expired units')}</button>` : ''}<a class="btn primary" href="#/donations?new=1">Record donation</a></div></div>
        <div class="bags">${inv.groups.map((g, i) => bagHtml(g.blood_group, g.available, i, inv.low_stock_threshold, g.expiring_soon ? `<div class="bag-note low">${g.expiring_soon} expiring soon</div>` : '')).join('')}</div>
        <section class="section"><div class="section-head"><h2>Units on the shelf</h2><span class="legend">Soonest expiry first, so older blood is issued first.</span></div>
          ${units.length ? `<div class="table-wrap"><table><thead><tr><th>Group</th><th>Units</th><th>Donor</th><th>Collected</th><th>Expires</th></tr></thead><tbody>
            ${units.map((u) => `<tr><td>${groupTag(u.blood_group)}</td><td class="num">${u.units_remaining}</td><td>${esc(u.donor_name)}</td><td>${fmtDate(u.donation_date)}</td>
              <td>${fmtDate(u.expiry_date)} ${u.days_to_expiry <= 7 ? `<span class="tag warn">${u.days_to_expiry === 0 ? 'today' : `in ${plural(u.days_to_expiry, 'day', 'days')}`}</span>` : `<span class="muted">(${u.days_to_expiry} days)</span>`}</td></tr>`).join('')}
            </tbody></table></div>` : `<div class="empty"><strong>Shelves are empty</strong>Record a donation to add units to stock.</div>`}</section>`;
      const dBtn = $('#discard-btn');
      if (dBtn) dBtn.onclick = () => confirmDialog({
        title: 'Discard expired units', danger: true, confirmLabel: 'Discard units',
        message: `This removes ${plural(expiredTotal, 'expired unit', 'expired units')} from the records. It cannot be undone.`,
        onConfirm: async () => { const r = await api('/inventory/discard-expired', { method: 'POST' }); toast(r.message); inventoryPage(); },
      });
    } catch (e) { $('#main').innerHTML = errorBlock(e); }
  }

  // ----- donors -----
  const donorForm = (d = {}) => `
    <label class="field"><span>Full name</span><input type="text" name="name" value="${esc(d.name)}" required></label>
    <div class="row2">
      <label class="field"><span>Date of birth</span><input type="date" name="dob" value="${esc(d.dob)}" max="${todayStr()}" required></label>
      <label class="field"><span>Gender</span><select name="gender">${['Male', 'Female', 'Other'].map((g) => `<option ${d.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
    </div>
    <div class="row2">
      <label class="field"><span>Blood group</span><select name="blood_group">${groupOptions(d.blood_group)}</select></label>
      <label class="field"><span>Phone</span><input type="tel" name="phone" value="${esc(d.phone)}" required></label>
    </div>
    <label class="field"><span>Email <small>(optional)</small></span><input type="email" name="email" value="${esc(d.email)}"></label>
    <label class="field"><span>Address <small>(optional)</small></span><textarea name="address">${esc(d.address)}</textarea></label>`;

  function donorDialog(donor, done) {
    openModal({
      title: donor ? 'Edit donor' : 'Add donor',
      body: donorForm(donor || {}),
      submitLabel: donor ? 'Save changes' : 'Add donor',
      onSubmit: async (data, close) => {
        await api(donor ? `/donors/${donor.id}` : '/donors', { method: donor ? 'PUT' : 'POST', body: data });
        close();
        toast(donor ? 'Donor updated' : 'Donor added');
        done();
      },
    });
  }

  function donationDialog(preDonorId, done) {
    api('/donors').then((donors) => {
      const eligible = donors.filter((d) => d.eligible);
      if (!eligible.length) return toast('No donors are eligible to donate right now.', 'error');
      openModal({
        title: 'Record donation',
        submitLabel: 'Record donation',
        body: `
          <label class="field"><span>Donor</span><select name="donor_id" required>
            ${eligible.map((d) => `<option value="${d.id}" ${Number(preDonorId) === d.id ? 'selected' : ''}>${esc(d.name)} (${esc(d.blood_group)})</option>`).join('')}
          </select><small>Only donors who are currently eligible are listed.</small></label>
          <div class="row2">
            <label class="field"><span>Units</span><select name="units"><option>1</option><option>2</option></select></label>
            <label class="field"><span>Date</span><input type="date" name="donation_date" value="${todayStr()}" max="${todayStr()}" required></label>
          </div>
          <label class="field"><span>Hemoglobin (g/dL) <small>(optional)</small></span><input type="number" name="hemoglobin" step="0.1" min="5" max="25"><small>Minimum 12.5 g/dL to donate.</small></label>
          <label class="field"><span>Notes <small>(optional)</small></span><textarea name="notes"></textarea></label>`,
        onSubmit: async (data, close) => {
          await api('/donations', { method: 'POST', body: data });
          close();
          toast('Donation recorded');
          done();
        },
      });
    }).catch((e) => toast(e.message, 'error'));
  }

  async function donorsPage(query) {
    shell('#/donors', `<div class="page-head"><div><h1>Donors</h1></div></div>${loading()}`);
    const state = { q: '', blood_group: '', eligible: '' };
    const render = async () => {
      const params = new URLSearchParams(Object.entries(state).filter(([, v]) => v));
      const rows = await api('/donors?' + params);
      $('#donor-results').innerHTML = rows.length
        ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Group</th><th>Age</th><th>Phone</th><th>Last donation</th><th>Status</th><th></th></tr></thead><tbody>
          ${rows.map((d) => `<tr><td><a href="#/donors/${d.id}"><strong>${esc(d.name)}</strong></a></td><td>${groupTag(d.blood_group)}</td><td class="num">${d.age}</td><td>${esc(d.phone)}</td>
            <td>${fmtDate(d.last_donation_date)}</td>
            <td>${d.eligible ? '<span class="tag ok">Can donate</span>' : `<span class="tag warn" title="${esc(d.ineligible_reasons.join(' '))}">${d.next_eligible_date ? 'From ' + fmtDate(d.next_eligible_date) : 'Not eligible'}</span>`}</td>
            <td class="actions-cell"><a class="btn sm secondary" href="#/donors/${d.id}">View</a></td></tr>`).join('')}
          </tbody></table></div>`
        : `<div class="empty"><strong>No donors found</strong>Try a different search, or add a new donor.</div>`;
    };
    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Donors</h1><p class="lede">People who have registered to give blood. Donors must be 18-65 and wait 90 days between donations.</p></div>
        <div class="actions"><button class="btn primary" id="add-donor">Add donor</button></div></div>
      <div class="toolbar">
        <input type="search" id="f-q" placeholder="Search by name, phone or email" aria-label="Search donors">
        <select id="f-group" aria-label="Filter by blood group">${groupOptions('', true)}</select>
        <select id="f-elig" aria-label="Filter by eligibility"><option value="">All donors</option><option value="true">Can donate now</option><option value="false">Not eligible yet</option></select>
      </div>
      <div id="donor-results">${loading()}</div>`;
    let timer;
    $('#f-q').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value.trim(); render().catch(showErr); }, 250); };
    $('#f-group').onchange = (e) => { state.blood_group = e.target.value; render().catch(showErr); };
    $('#f-elig').onchange = (e) => { state.eligible = e.target.value; render().catch(showErr); };
    $('#add-donor').onclick = () => donorDialog(null, render);
    const showErr = (e) => { $('#donor-results').innerHTML = errorBlock(e); };
    render().catch(showErr);
    if (query.get('new')) donorDialog(null, render);
  }

  async function donorDetailPage(id) {
    shell('#/donors', loading());
    try {
      const d = await api('/donors/' + id);
      $('#main').innerHTML = `
        <a class="back" href="#/donors">Back to donors</a>
        <div class="page-head"><div><h1>${esc(d.name)}</h1><p class="lede">${groupTag(d.blood_group)} ${d.eligible ? '<span class="tag ok">Can donate now</span>' : `<span class="tag warn">${esc(d.ineligible_reasons[0] || 'Not eligible')}</span>`}</p></div>
          <div class="actions">
            <button class="btn primary" id="rec-btn" ${d.eligible ? '' : 'disabled'}>Record donation</button>
            <button class="btn secondary" id="edit-btn">Edit</button>
            ${store.user.role === 'admin' ? '<button class="btn danger" id="del-btn">Delete</button>' : ''}
          </div></div>
        <dl class="profile">
          <div><dt>Age</dt><dd>${d.age} (born ${fmtDate(d.dob)})</dd></div>
          <div><dt>Gender</dt><dd>${esc(d.gender)}</dd></div>
          <div><dt>Phone</dt><dd>${esc(d.phone)}</dd></div>
          <div><dt>Email</dt><dd>${esc(d.email || '-')}</dd></div>
          <div><dt>Address</dt><dd>${esc(d.address || '-')}</dd></div>
          <div><dt>Last donation</dt><dd>${fmtDate(d.last_donation_date)}</dd></div>
          <div><dt>Next eligible</dt><dd>${d.eligible ? 'Now' : fmtDate(d.next_eligible_date)}</dd></div>
        </dl>
        <section class="section"><div class="section-head"><h2>Donation history</h2></div>
          ${d.donations.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Units</th><th>Hemoglobin</th><th>Expires</th><th>Remaining</th></tr></thead><tbody>
            ${d.donations.map((x) => `<tr><td>${fmtDate(x.donation_date)}</td><td class="num">${x.units}</td><td class="num">${x.hemoglobin ?? '-'}</td><td>${fmtDate(x.expiry_date)}</td><td class="num">${x.units_remaining}</td></tr>`).join('')}</tbody></table></div>`
            : `<div class="empty"><strong>No donations yet</strong>This donor has not given blood here.</div>`}</section>`;
      $('#rec-btn').onclick = () => donationDialog(d.id, () => donorDetailPage(id));
      $('#edit-btn').onclick = () => donorDialog(d, () => donorDetailPage(id));
      const del = $('#del-btn');
      if (del) del.onclick = () => confirmDialog({
        title: 'Delete donor', danger: true, confirmLabel: 'Delete donor',
        message: `Delete ${d.name}? Donors with donation records cannot be deleted.`,
        onConfirm: async () => { await api('/donors/' + id, { method: 'DELETE' }); toast('Donor deleted'); location.hash = '#/donors'; },
      });
    } catch (e) { $('#main').innerHTML = `<a class="back" href="#/donors">Back to donors</a>${errorBlock(e)}`; }
  }

  async function donationsPage(query) {
    shell('#/donations', loading());
    const state = { blood_group: '', status: '' };
    const render = async () => {
      const params = new URLSearchParams(Object.entries(state).filter(([, v]) => v));
      const rows = await api('/donations?' + params);
      const tagFor = (s) => ({ available: '<span class="tag ok">In stock</span>', expired: '<span class="tag crit">Expired</span>', used: '<span class="tag">Issued</span>' }[s]);
      $('#don-results').innerHTML = rows.length
        ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Donor</th><th>Group</th><th>Units</th><th>Hb (g/dL)</th><th>Expires</th><th>Remaining</th><th>Status</th>${store.user.role === 'admin' ? '<th></th>' : ''}</tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${fmtDate(r.donation_date)}</td><td><a href="#/donors/${r.donor_id}">${esc(r.donor_name)}</a></td><td>${groupTag(r.blood_group)}</td><td class="num">${r.units}</td><td class="num">${r.hemoglobin ?? '-'}</td><td>${fmtDate(r.expiry_date)}</td><td class="num">${r.units_remaining}</td><td>${tagFor(r.status)}</td>
            ${store.user.role === 'admin' ? `<td class="actions-cell">${r.units_remaining === r.units ? `<button class="btn sm danger" data-del="${r.id}">Delete</button>` : ''}</td>` : ''}</tr>`).join('')}
          </tbody></table></div>`
        : `<div class="empty"><strong>No donations found</strong>Change the filters or record a new donation.</div>`;
      document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => confirmDialog({
        title: 'Delete donation', danger: true, confirmLabel: 'Delete donation',
        message: 'Delete this donation record? Use this only for entries made by mistake.',
        onConfirm: async () => { await api('/donations/' + b.dataset.del, { method: 'DELETE' }); toast('Donation deleted'); render(); },
      })));
    };
    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Donations</h1><p class="lede">Every unit collected, with its expiry date and what is left.</p></div>
        <div class="actions"><button class="btn primary" id="add-don">Record donation</button></div></div>
      <div class="toolbar">
        <select id="f-group" aria-label="Filter by blood group">${groupOptions('', true)}</select>
        <select id="f-status" aria-label="Filter by status"><option value="">All statuses</option><option value="available">In stock</option><option value="expired">Expired</option><option value="used">Fully issued</option></select>
      </div>
      <div id="don-results">${loading()}</div>`;
    const showErr = (e) => { $('#don-results').innerHTML = errorBlock(e); };
    $('#f-group').onchange = (e) => { state.blood_group = e.target.value; render().catch(showErr); };
    $('#f-status').onchange = (e) => { state.status = e.target.value; render().catch(showErr); };
    $('#add-don').onclick = () => donationDialog(null, render);
    render().catch(showErr);
    if (query.get('new')) donationDialog(null, render);
  }

  // ----- requests -----
  function requestDialog(done) {
    openModal({
      title: 'New blood request',
      submitLabel: 'Create request',
      body: `
        <div class="row2">
          <label class="field"><span>Patient name</span><input type="text" name="patient_name" required></label>
          <label class="field"><span>Hospital</span><input type="text" name="hospital" required></label>
        </div>
        <div class="row2">
          <label class="field"><span>Blood group</span><select name="blood_group">${groupOptions('')}</select></label>
          <label class="field"><span>Units needed</span><input type="number" name="units" min="1" max="20" value="1" required></label>
        </div>
        <div class="row2">
          <label class="field"><span>Urgency</span><select name="urgency"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="critical">Critical</option></select></label>
          <label class="field"><span>Contact phone <small>(optional)</small></span><input type="tel" name="contact"></label>
        </div>
        <label class="field"><span>Notes <small>(optional)</small></span><textarea name="notes"></textarea></label>`,
      onSubmit: async (data, close) => {
        await api('/requests', { method: 'POST', body: data });
        close();
        toast('Request created');
        done();
      },
    });
  }

  function fulfillDialog(r, done) {
    const run = async (allowCompatible, close) => {
      const res = await api(`/requests/${r.id}/fulfill`, { method: 'POST', body: { allowCompatible } });
      close();
      toast(`Issued ${plural(r.units, 'unit', 'units')} of blood to ${r.hospital}`);
      done(res);
    };
    openModal({
      title: 'Fulfil request',
      submitLabel: 'Issue blood',
      body: `
        <p style="margin-bottom:12px">Issue <strong>${plural(r.units, 'unit', 'units')} of ${esc(r.blood_group)}</strong> for ${esc(r.patient_name)} at ${esc(r.hospital)}. Units closest to expiry are used first.</p>
        <label class="check"><input type="checkbox" name="allowCompatible"><span>Use compatible blood groups if ${esc(r.blood_group)} runs short<br><small class="muted">Exact matches are always used first.</small></span></label>`,
      onSubmit: (d, close) => run(d.allowCompatible, close),
    });
  }

  async function requestsPage(query) {
    shell('#/requests', loading());
    const state = { status: 'pending' };
    const render = async () => {
      const rows = await api('/requests' + (state.status ? '?status=' + state.status : ''));
      const stTag = (s) => `<span class="tag ${s === 'fulfilled' ? 'ok' : s === 'rejected' ? 'crit' : 'warn'}">${s[0].toUpperCase() + s.slice(1)}</span>`;
      $('#req-results').innerHTML = rows.length
        ? `<div class="table-wrap"><table><thead><tr><th>Patient</th><th>Hospital</th><th>Need</th><th>Urgency</th><th>Requested</th><th>Status</th><th></th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td><strong>${esc(r.patient_name)}</strong>${r.notes ? `<div class="muted" style="font-size:.86rem">${esc(r.notes)}</div>` : ''}</td><td>${esc(r.hospital)}${r.contact ? `<div class="muted" style="font-size:.86rem">${esc(r.contact)}</div>` : ''}</td>
            <td>${groupTag(r.blood_group)} <span class="num">&times; ${r.units}</span></td><td>${urgencyTag(r.urgency)}</td><td>${fmtDateTime(r.requested_at)}</td>
            <td>${stTag(r.status)}${r.resolved_by_name ? `<div class="muted" style="font-size:.86rem">by ${esc(r.resolved_by_name)}</div>` : ''}</td>
            <td class="actions-cell">${r.status === 'pending' ? `<button class="btn sm primary" data-ful="${r.id}">Fulfil</button><button class="btn sm danger" data-rej="${r.id}">Reject</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>`
        : `<div class="empty"><strong>${state.status === 'pending' ? 'No pending requests' : 'No requests found'}</strong>${state.status === 'pending' ? 'Everything has been handled.' : 'Try another filter.'}</div>`;
      document.querySelectorAll('[data-ful]').forEach((b) => (b.onclick = () => fulfillDialog(rows.find((r) => r.id === Number(b.dataset.ful)), render)));
      document.querySelectorAll('[data-rej]').forEach((b) => (b.onclick = () => openModal({
        title: 'Reject request', submitLabel: 'Reject request',
        body: `<label class="field"><span>Reason</span><textarea name="reason" placeholder="For example: duplicate request, patient transferred"></textarea></label>`,
        onSubmit: async (d, close) => { await api(`/requests/${b.dataset.rej}/reject`, { method: 'POST', body: d }); close(); toast('Request rejected'); render(); },
      })));
    };
    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Requests</h1><p class="lede">Hospital requests for blood. Critical and urgent ones come first.</p></div>
        <div class="actions"><button class="btn primary" id="add-req">New request</button></div></div>
      <div class="toolbar"><select id="f-status" aria-label="Filter by status">
        <option value="pending">Pending</option><option value="fulfilled">Fulfilled</option><option value="rejected">Rejected</option><option value="">All requests</option></select></div>
      <div id="req-results">${loading()}</div>`;
    const showErr = (e) => { $('#req-results').innerHTML = errorBlock(e); };
    $('#f-status').onchange = (e) => { state.status = e.target.value; render().catch(showErr); };
    $('#add-req').onclick = () => requestDialog(render);
    render().catch(showErr);
    if (query.get('new')) requestDialog(render);
  }

  async function usersPage() {
    if (store.user.role !== 'admin') { location.hash = '#/dashboard'; return; }
    shell('#/users', loading());
    const render = async () => {
      const rows = await api('/auth/users');
      $('#user-results').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Created</th><th></th></tr></thead><tbody>
        ${rows.map((u) => `<tr><td><strong>${esc(u.full_name)}</strong></td><td>${esc(u.username)}</td><td>${u.role === 'admin' ? '<span class="tag crit">Administrator</span>' : '<span class="tag">Staff</span>'}</td><td>${fmtDateTime(u.created_at)}</td>
          <td class="actions-cell">${u.id !== store.user.id ? `<button class="btn sm danger" data-del="${u.id}" data-name="${esc(u.full_name)}">Delete</button>` : '<span class="muted">You</span>'}</td></tr>`).join('')}</tbody></table></div>`;
      document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => confirmDialog({
        title: 'Delete account', danger: true, confirmLabel: 'Delete account', message: `Delete the account for ${b.dataset.name}?`,
        onConfirm: async () => { await api('/auth/users/' + b.dataset.del, { method: 'DELETE' }); toast('Account deleted'); render(); },
      })));
    };
    $('#main').innerHTML = `
      <div class="page-head"><div><h1>Staff accounts</h1><p class="lede">Administrators can manage accounts and delete records. Staff can record donations and handle requests.</p></div>
        <div class="actions"><button class="btn primary" id="add-user">Add account</button></div></div><div id="user-results">${loading()}</div>`;
    $('#add-user').onclick = () => openModal({
      title: 'Add account', submitLabel: 'Create account',
      body: `
        <label class="field"><span>Full name</span><input type="text" name="full_name" required></label>
        <label class="field"><span>Username</span><input type="text" name="username" autocomplete="off" required><small>3-30 characters: letters, numbers, . _ -</small></label>
        <label class="field"><span>Password</span><input type="password" name="password" autocomplete="new-password" minlength="6" required></label>
        <label class="field"><span>Role</span><select name="role"><option value="staff">Staff</option><option value="admin">Administrator</option></select></label>`,
      onSubmit: async (d, close) => { await api('/auth/users', { method: 'POST', body: d }); close(); toast('Account created'); render(); },
    });
    render().catch((e) => { $('#user-results').innerHTML = errorBlock(e); });
  }

  // ---------- router ----------
  async function route() {
    document.querySelectorAll('dialog.modal').forEach((d) => d.remove());
    const [path, qs] = (location.hash.slice(1) || '/dashboard').split('?');
    const query = new URLSearchParams(qs || '');
    const parts = path.split('/').filter(Boolean);

    if (parts[0] === 'login') {
      if (store.token) { location.hash = '#/dashboard'; return; }
      return loginPage();
    }
    if (!store.token) { location.hash = '#/login'; return; }
    if (!store.user) {
      try { store.user = (await api('/auth/me')).user; } catch { store.token = null; location.hash = '#/login'; return; }
    }
    // Strip "?new=1" so refreshing doesn't reopen the dialog
    if (query.get('new')) history.replaceState(null, '', '#/' + parts.join('/'));

    switch (parts[0]) {
      case 'dashboard': return dashboardPage();
      case 'inventory': return inventoryPage();
      case 'donors': return parts[1] ? donorDetailPage(parts[1]) : donorsPage(query);
      case 'donations': return donationsPage(query);
      case 'requests': return requestsPage(query);
      case 'users': return usersPage();
      default: location.hash = '#/dashboard';
    }
  }

  window.addEventListener('hashchange', route);
  route();
})();
