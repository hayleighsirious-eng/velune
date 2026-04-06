// ============================================================
//  VELUNE — ADMIN DASHBOARD  (admin.js)
//  Works for BOTH modes: 'recurring' and 'one_time'
//  Multi-tenant: every query scoped to current user's owner_id
// ============================================================

let allStudents   = [];
let allPayments   = [];
let currentFilter = 'all';
let searchTerm    = '';
let ownerProfile  = null;
let currentUserId = null;

// ── Boot ─────────────────────────────────────────────────────
(async function boot() {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { window.location.href = './index.html'; return; }

  currentUserId = session.user.id;

  // ── ACCESS CHECK (now async — reads from Supabase) ────────
  const access = await checkAccess(currentUserId);

  if (!access.allowed) {
    window.location.href = './activate.html';
    return;
  }

  if (access.reason === 'trial' && access.daysLeft <= 5) {
    showAccessBanner(
      `⚠️ Free trial ends in <strong>${access.daysLeft} day${access.daysLeft !== 1 ? 's' : ''}</strong>. ` +
      `<a href="./activate.html" style="color:white;font-weight:800;text-decoration:underline">Get an activation code →</a>`,
      '#B7770D'
    );
  }

  if (access.reason === 'licensed' && access.daysLeft <= 5) {
    showAccessBanner(
      `⚠️ Your access expires in <strong>${access.daysLeft} day${access.daysLeft !== 1 ? 's' : ''}</strong>. ` +
      `<a href="./activate.html" style="color:white;font-weight:800;text-decoration:underline">Renew now →</a>`,
      '#C0392B'
    );
  }

  // Load profile
  const { data: profile } = await _supabase
    .from('profiles').select('*').eq('id', currentUserId).single();

  if (!profile) {
    await _supabase.from('profiles').insert([{ id: currentUserId }]);
    ownerProfile = { id: currentUserId, centre_name: 'My Centre', mode: 'recurring' };
  } else {
    ownerProfile = profile;
  }

  const centreName = ownerProfile.centre_name || session.user.email;
  document.getElementById('adminNameDisplay').textContent  = centreName;
  document.getElementById('sidebarCentreName').textContent = centreName;
  document.getElementById('topbarTitle').textContent       = 'Dashboard';

  if (ownerProfile.mode === 'one_time') {
    document.getElementById('navAlerts').style.display = 'none';
  }

  document.getElementById('centreName').value    = ownerProfile.centre_name || '';
  document.getElementById('defaultFee').value    = ownerProfile.default_fee || '';
  document.getElementById('whatsappNum').value   = ownerProfile.whatsapp || '';
  document.getElementById('bankName').value      = ownerProfile.bank_name || '';
  document.getElementById('accountNumber').value = ownerProfile.account_number || '';
  document.getElementById('accountName').value   = ownerProfile.account_name || '';
  document.getElementById('modeDisplay').textContent = ownerProfile.mode === 'recurring'
    ? 'Recurring (Monthly Cycles)' : 'One-Time Payment';

  await loadAll();
  if (ownerProfile.mode === 'recurring') await runAutoExpire();

  showAdminWelcome(centreName, {
    total: allStudents.length,
    vip:   allStudents.filter(s => s.vip_active).length,
    owing: allStudents.filter(s => s.balance > 0).length
  });
})();

// ── Logout ────────────────────────────────────────────────────
async function logout() {
  await _supabase.auth.signOut();
  localStorage.clear();
  window.location.href = './index.html';
}

// ── Load everything ───────────────────────────────────────────
async function loadAll() {
  const [{ data: students }, { data: payments }] = await Promise.all([
    _supabase.from('students').select('*').eq('owner_id', currentUserId).order('name'),
    _supabase.from('payments').select('*').eq('owner_id', currentUserId).order('payment_date', { ascending: false })
  ]);
  allStudents = students || [];
  allPayments = payments || [];

  updateStats();
  renderStudentsTable();
  renderPaymentsTable();
  renderRecentPayments();

  if (ownerProfile.mode === 'recurring') {
    renderVIPGrid();
    renderAlerts();
  } else {
    renderVIPGridOneTime();
  }
}

// ── Auto-expire (recurring mode only) ────────────────────────
// Removes VIP from ANY student whose cycle has ended — paid or owing
async function runAutoExpire() {
  const now = new Date();
  const toExpire = allStudents.filter(s => {
    if (!s.vip_active || s.paused || !s.cycle_start) return false;
    const due = new Date(new Date(s.cycle_start).getTime() + CYCLE_DAYS * 86400000);
    return now >= due;
  });
  for (const s of toExpire) {
    await _supabase.from('students').update({
      vip_active: false,
      temp_vip:   false,
      is_vip:     false,
      vip_type:   null
      // NOTE: serial is NOT cleared here — it stays on the record
      // It reactivates when the student completes payment for new month
    }).eq('id', s.id).eq('owner_id', currentUserId);
  }
  if (toExpire.length) await loadAll();
}

// ── Stats ─────────────────────────────────────────────────────
function updateStats() {
  const total  = allStudents.length;
  const paid   = allStudents.filter(s => s.balance <= 0).length;
  const owing  = allStudents.filter(s => s.balance > 0).length;
  const vip    = allStudents.filter(s => s.vip_active).length;
  const revCol = allStudents.reduce((a, s) => a + (s.amount_paid || 0), 0);
  const revOwe = allStudents.reduce((a, s) => a + (s.balance    || 0), 0);

  document.getElementById('statTotal').textContent        = total;
  document.getElementById('statPaid').textContent         = paid;
  document.getElementById('statOwing').textContent        = owing;
  document.getElementById('statVIP').textContent          = vip;
  document.getElementById('statRevCollected').textContent = formatNaira(revCol);
  document.getElementById('statRevOwing').textContent     = formatNaira(revOwe);
}

// ── Recent Payments ───────────────────────────────────────────
function renderRecentPayments() {
  const tbody = document.getElementById('recentPaymentsBody');
  const last5 = allPayments.slice(0, 5);
  if (!last5.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No payments yet.</td></tr>';
    return;
  }
  tbody.innerHTML = last5.map(p => {
    const st = allStudents.find(s => s.id === p.student_id);
    return `<tr>
      <td>${st ? st.name : '—'}</td>
      <td>${formatNaira(p.amount)}</td>
      <td>${fmtDate(p.payment_date)}</td>
      <td>${p.method || '—'}</td>
      <td><span class="badge badge-green">Recorded</span></td>
    </tr>`;
  }).join('');
}

// ── Students Table ────────────────────────────────────────────
function renderStudentsTable() {
  const tbody = document.getElementById('studentsTableBody');
  const isRecurring = ownerProfile.mode === 'recurring';
  let list = [...allStudents];

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.class?.toLowerCase().includes(q) ||
      s.serial?.toLowerCase().includes(q) ||
      s.login_id?.toLowerCase().includes(q)
    );
  }

  if (currentFilter === 'paid')    list = list.filter(s => s.balance <= 0);
  if (currentFilter === 'partial') list = list.filter(s => s.balance > 0);
  if (currentFilter === 'vip')     list = list.filter(s => s.vip_active);
  if (currentFilter === 'expired' && isRecurring) {
    list = list.filter(s => { const c = calcCycle(s); return c.expired && !s.vip_active; });
  }

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No students found.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(s => {
    const cycle  = isRecurring ? calcCycle(s) : null;
    let expText  = '—';
    if (isRecurring && s.cycle_start) {
      expText = (cycle.expired && !s.vip_active)
        ? '<span class="badge badge-red">Cycle Ended</span>'
        : fmtDate(cycle.due);
    }

    const loginInfo = ownerProfile.mode === 'recurring'
      ? `<small style="color:var(--text-muted)">${s.login_id || '—'}</small>`
      : `<small style="color:var(--text-muted)">PIN: ${s.student_pin || '—'}</small>`;

    return `<tr>
      <td><strong>${s.name}</strong><br>${loginInfo}</td>
      <td>${s.class || '—'}</td>
      <td>${formatNaira(s.total_fee)}</td>
      <td>${formatNaira(s.amount_paid)}</td>
      <td class="${s.balance > 0 ? 'text-red' : 'text-green'}">${formatNaira(s.balance)}</td>
      <td>${getStatusBadge(s)}</td>
      <td>${s.vip_active ? '<span class="badge badge-gold">✓ VIP</span>' : (s.temp_vip ? '<span class="badge badge-orange">Temp</span>' : '—')}</td>
      <td>${expText}</td>
      <td class="actions-cell">
        <button class="btn-xs btn-blue"  onclick="viewStudent('${s.id}')">View</button>
        <button class="btn-xs btn-green" onclick="openRecordPayment('${s.id}')">Pay</button>
        <button class="btn-xs btn-grey"  onclick="openEditStudent('${s.id}')">Edit</button>
        <button class="btn-xs btn-red"   onclick="deleteStudent('${s.id}')">Del</button>
      </td>
    </tr>`;
  }).join('');
}

function getStatusBadge(s) {
  const cycle = ownerProfile.mode === 'recurring' ? calcCycle(s) : null;
  if (s.paused) return '<span class="badge badge-orange">Paused</span>';
  if (cycle && cycle.expired && !s.vip_active && s.cycle_start) return '<span class="badge badge-red">Cycle Ended</span>';
  if (s.balance <= 0) return '<span class="badge badge-green">Paid</span>';
  return '<span class="badge badge-orange">Owing</span>';
}

function filterStudents() {
  searchTerm = document.getElementById('studentSearch').value;
  renderStudentsTable();
}

function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderStudentsTable();
}

// ── Payments Table ────────────────────────────────────────────
function renderPaymentsTable() {
  const tbody = document.getElementById('paymentsTableBody');
  if (!allPayments.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No payments recorded.</td></tr>';
    return;
  }
  tbody.innerHTML = allPayments.map(p => {
    const st = allStudents.find(s => s.id === p.student_id);
    return `<tr>
      <td>${st ? st.name : '—'}</td>
      <td>${formatNaira(p.amount)}</td>
      <td>${p.method || '—'}</td>
      <td>${fmtDate(p.payment_date)}</td>
      <td>${p.serial_at_time || '—'}</td>
    </tr>`;
  }).join('');
}

// ── VIP Grid — Recurring mode ─────────────────────────────────
function renderVIPGrid() {
  const grid = document.getElementById('vipGrid');
  const vipStudents = allStudents.filter(s => s.vip_active);

  grid.innerHTML = `
    <div class="vip-search-bar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input type="text" id="vipSearchInput" placeholder="Search by name or serial…" oninput="filterVIP()"/>
    </div>
    <div id="vipCardsContainer"></div>
  `;
  renderVIPCards(vipStudents);
}

function filterVIP() {
  const q = document.getElementById('vipSearchInput')?.value?.toLowerCase() || '';
  const list = allStudents.filter(s => {
    if (!s.vip_active) return false;
    if (!q) return true;
    return s.serial?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q);
  });
  renderVIPCards(list);
}

function renderVIPCards(list) {
  const container = document.getElementById('vipCardsContainer');
  if (!container) return;
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">No active VIP students found.</div>';
    return;
  }
  container.innerHTML = `<div class="vip-cards-grid">${list.map(s => {
    const cycle = calcCycle(s);
    const pctClass = cycle.pct > 40 ? '' : cycle.pct > 15 ? 'warn' : 'danger';
    const urgencyColor = cycle.pct > 40 ? 'var(--success)' : cycle.pct > 15 ? 'var(--warning)' : 'var(--danger)';
    return `
      <div class="vip-card">
        <div class="vip-card-top">
          <div class="vip-avatar">${s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</div>
          <div class="vip-card-info">
            <div class="vip-card-name">${s.name}</div>
            <div class="vip-card-class">${s.class || 'No class'}</div>
            ${s.serial ? `<div class="vip-serial-badge">#${s.serial}</div>` : ''}
            ${s.temp_vip ? '<span class="badge badge-orange" style="font-size:0.7rem;margin-top:4px">Temporary</span>' : ''}
          </div>
        </div>
        <div class="vip-timer">
          <div class="vip-days" style="color:${urgencyColor}">${cycle.daysLeft} <span>days left</span></div>
          <div class="timer-bar-wrap"><div class="timer-bar ${pctClass}" style="width:${cycle.pct}%"></div></div>
          <div class="vip-dates">
            <span>Started ${fmtDate(s.cycle_start)}</span>
            <span>Expires ${fmtDate(cycle.due)}</span>
          </div>
        </div>
        <div class="vip-card-actions">
          <button class="btn-xs btn-blue" onclick="viewStudent('${s.id}')">View</button>
          <button class="btn-xs btn-green" onclick="openRecordPayment('${s.id}')">Record Pay</button>
          ${s.temp_vip
            ? `<button class="btn-xs btn-red" onclick="removeTempVIP('${s.id}')">Remove Temp VIP</button>`
            : `<button class="btn-xs btn-grey" onclick="grantTempVIP('${s.id}')">Grant Temp VIP</button>`
          }
        </div>
      </div>`;
  }).join('')}</div>`;
}

function renderVIPGridOneTime() {
  const grid = document.getElementById('vipGrid');
  const vipStudents = allStudents.filter(s => s.vip_active);

  grid.innerHTML = `
    <div class="vip-search-bar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input type="text" id="vipSearchInputOT" placeholder="Search by name or serial…" oninput="filterVIPOneTime()"/>
    </div>
    <div id="vipCardsContainerOT"></div>
  `;
  renderVIPCardsOneTime(vipStudents);
}

function filterVIPOneTime() {
  const q = document.getElementById('vipSearchInputOT')?.value?.toLowerCase() || '';
  const list = allStudents.filter(s => {
    if (!s.vip_active) return false;
    if (!q) return true;
    return s.serial?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q);
  });
  renderVIPCardsOneTime(list);
}

function renderVIPCardsOneTime(list) {
  const container = document.getElementById('vipCardsContainerOT');
  if (!container) return;
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">No active VIP students yet.</div>';
    return;
  }
  container.innerHTML = `<div class="vip-cards-grid">${list.map(s => `
    <div class="vip-card">
      <div class="vip-card-top">
        <div class="vip-avatar">${s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</div>
        <div class="vip-card-info">
          <div class="vip-card-name">${s.name}</div>
          <div class="vip-card-class">${s.class || '—'}</div>
          ${s.serial ? `<div class="vip-serial-badge">#${s.serial}</div>` : ''}
          ${s.temp_vip ? '<span class="badge badge-orange" style="font-size:0.7rem;margin-top:4px">Temporary</span>' : ''}
        </div>
      </div>
      <div style="padding:10px 0 14px;font-size:0.82rem;color:var(--success);font-weight:600;display:flex;align-items:center;gap:6px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        ${s.temp_vip ? 'Temporary VIP Access' : 'Fully Paid & Cleared'}
      </div>
      <div style="background:var(--gold-pale);border:1px solid rgba(201,150,12,0.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:0.78rem;color:var(--gray-600);display:flex;align-items:center;gap:8px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        One-time payment — no expiry countdown
      </div>
      <div class="vip-card-actions">
        <button class="btn-xs btn-blue" onclick="viewStudent('${s.id}')">View</button>
        <button class="btn-xs btn-green" onclick="openRecordPayment('${s.id}')">Record Pay</button>
        ${s.temp_vip ? `<button class="btn-xs btn-red" onclick="removeTempVIP('${s.id}')">Remove Temp VIP</button>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

// ── Alerts (recurring mode only) ─────────────────────────────
function renderAlerts() {
  if (ownerProfile.mode !== 'recurring') return;
  const now = new Date();
  const alerts = allStudents.filter(s => {
    if (!s.vip_active || !s.cycle_start || s.paused) return false;
    const due = new Date(new Date(s.cycle_start).getTime() + CYCLE_DAYS * 86400000);
    const daysLeft = Math.ceil((due - now) / 86400000);
    return daysLeft >= 0 && daysLeft <= ALERT_DAYS;
  });

  const badge = document.getElementById('alertBadge');
  if (badge) badge.textContent = alerts.length || '';

  const alertsHtml = alerts.length ? alerts.map(s => {
    const cycle   = calcCycle(s);
    const urgency = cycle.pct < 15 ? 'alert-danger' : 'alert-warning';
    return `
      <div class="alert-item ${urgency}">
        <svg class="alert-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <div class="alert-body">
          <div class="alert-title">${s.name} — ${cycle.daysLeft} day${cycle.daysLeft !== 1 ? 's' : ''} remaining</div>
          <div class="alert-desc">VIP cycle expires ${fmtDate(cycle.due)}. ${s.balance > 0 ? `Balance owing: ${formatNaira(s.balance)}` : 'Full payment received.'}</div>
        </div>
        <button class="btn-xs btn-blue" onclick="openRecordPayment('${s.id}')">Record Pay</button>
      </div>`;
  }).join('') : '<div class="empty-state">No urgent alerts. All cycles have more than 5 days remaining.</div>';

  if (document.getElementById('alertsList'))
    document.getElementById('alertsList').innerHTML = alertsHtml;
  if (document.getElementById('dashAlerts'))
    document.getElementById('dashAlerts').innerHTML = alertsHtml;
}

// ── Add Student ───────────────────────────────────────────────
async function addStudent() {
  const name     = document.getElementById('newName').value.trim();
  const cls      = document.getElementById('newClass').value.trim();
  const totalFee = parseFloat(document.getElementById('newTotalFee').value) || 0;
  const amtPaid  = parseFloat(document.getElementById('newAmountPaid').value) || 0;
  const email    = document.getElementById('newEmail').value.trim();
  const method   = document.getElementById('newPayMethod').value;
  const notes    = document.getElementById('newNotes').value.trim();
  const errEl    = document.getElementById('addStudentError');

  if (!name)         { showErr(errEl, 'Name is required.'); return; }
  if (totalFee <= 0) { showErr(errEl, 'Total fee must be greater than 0.'); return; }
  errEl.style.display = 'none';

  const balance     = Math.max(0, totalFee - amtPaid);
  const fullPaid    = balance <= 0;
  const today       = new Date().toISOString().split('T')[0];
  const isRecurring = ownerProfile.mode === 'recurring';

  const login_id    = isRecurring ? ('STU-' + Math.random().toString(36).substr(2, 6).toUpperCase()) : null;
  const student_pin = isRecurring ? null : String(Math.floor(1000 + Math.random() * 9000));
  const serial      = fullPaid ? getNextSerial() : null;

  const studentObj = {
    owner_id:           currentUserId,
    name,
    name_lower:         name.toLowerCase(),
    class:              cls,
    total_fee:          totalFee,
    amount_paid:        amtPaid,
    balance,
    email:              email || null,
    login_id,
    student_pin,
    serial,
    status:             fullPaid ? 'paid' : 'partial',
    vip_active:         fullPaid,
    temp_vip:           false,
    cycle_start:        isRecurring ? today : null,
    month_number:       1,
    notes:              notes || null,
    paused:             false,
    pause_reason:       null,
    is_vip:             fullPaid,
    vip_type:           fullPaid ? 'paid' : null,
    first_payment_date: today
  };

  const { data: newStudent, error } = await _supabase
    .from('students').insert([studentObj]).select().single();
  if (error) { showErr(errEl, 'Error adding student: ' + error.message); return; }

  if (amtPaid > 0) {
    await _supabase.from('payments').insert([{
      owner_id:       currentUserId,
      student_id:     newStudent.id,
      amount:         amtPaid,
      method,
      payment_date:   today,
      serial_at_time: serial || null,
      month_number:   1
    }]);
  }

  closeModal('addStudentModal');
  resetAddForm();

  const identifier = isRecurring ? `Login ID: ${login_id}` : `PIN: ${student_pin}`;
  showToast(`${name} added! ${identifier}${serial ? ' | Serial: #' + serial : ''}`, 'success');
  showCredentialsModal(name, isRecurring ? login_id : student_pin, isRecurring ? 'login_id' : 'pin');
  await loadAll();
}

function showCredentialsModal(name, credential, type) {
  const existing = document.getElementById('credentialsModal');
  if (existing) existing.remove();

  const isLoginId = type === 'login_id';
  const label     = isLoginId ? 'Student Login ID' : '4-Digit PIN';
  const hint      = isLoginId
    ? 'The student enters this ID on the login page to access their dashboard.'
    : 'The student enters their name + this PIN to view their record.';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'credentialsModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modal-header">
        <h3 style="color:var(--success)">✓ Student Added!</h3>
        <button onclick="document.getElementById('credentialsModal').remove()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="modal-body" style="text-align:center;padding:20px">
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:18px">
          Share these login details with <strong>${name}</strong>:
        </p>
        <div style="background:var(--off-white);border:1.5px solid var(--border);border-radius:10px;padding:18px;margin-bottom:12px">
          <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">${label}</div>
          <div style="font-size:${isLoginId ? '1.3rem' : '2rem'};font-weight:800;color:var(--navy);letter-spacing:${isLoginId ? '0.08em' : '0.3em'};font-family:monospace">${credential}</div>
        </div>
        <p style="font-size:0.75rem;color:var(--text-muted);line-height:1.6">⚠️ Write this down now. ${hint}</p>
      </div>
      <div class="modal-footer" style="justify-content:center">
        <button class="btn-primary" onclick="document.getElementById('credentialsModal').remove()">Got it</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function resetAddForm() {
  ['newName', 'newClass', 'newTotalFee', 'newAmountPaid', 'newEmail', 'newNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

// ── Record Payment ────────────────────────────────────────────
function openRecordPayment(studentId) {
  const s = allStudents.find(x => x.id === studentId);
  if (!s) return;
  document.getElementById('payStudentId').value = studentId;
  document.getElementById('payDate').value       = new Date().toISOString().split('T')[0];
  document.getElementById('payAmount').value     = '';
  document.getElementById('payStudentInfo').innerHTML = `
    <div class="pay-student-info-box">
      <strong>${s.name}</strong> — Month ${s.month_number || 1}
      <span>Balance: <b class="text-red">${formatNaira(s.balance)}</b></span>
      <span>${s.login_id ? 'Login ID: <b>' + s.login_id + '</b>' : 'PIN: <b>' + (s.student_pin || '—') + '</b>'}</span>
      ${s.serial ? `<span>Serial: <b>#${s.serial}</b> (will reactivate on full payment)</span>` : ''}
    </div>`;
  document.getElementById('recordPayError').style.display = 'none';
  openModal('recordPaymentModal');
}

async function recordPayment() {
  const studentId = document.getElementById('payStudentId').value;
  const amount    = parseFloat(document.getElementById('payAmount').value) || 0;
  const method    = document.getElementById('payMethod').value;
  const payDate   = document.getElementById('payDate').value;
  const errEl     = document.getElementById('recordPayError');

  if (amount <= 0) { showErr(errEl, 'Amount must be greater than 0.'); return; }

  const s = allStudents.find(x => x.id === studentId);
  if (!s) return;

  const isRecurring = ownerProfile.mode === 'recurring';
  const newPaid     = (s.amount_paid || 0) + amount;
  const newBalance  = Math.max(0, (s.total_fee || 0) - newPaid);
  const fullPaid    = newBalance <= 0;

  let updates = { amount_paid: newPaid, balance: newBalance };

  if (fullPaid) {
    // Use existing serial (reactivate it) or generate new one if somehow missing
    const serial = s.serial || getNextSerial();
    updates.serial     = serial;
    updates.vip_active = true;
    updates.is_vip     = true;
    updates.vip_type   = 'paid';
    updates.status     = 'paid';
    updates.temp_vip   = false;
    if (isRecurring && !s.cycle_start) {
      updates.cycle_start = payDate || new Date().toISOString().split('T')[0];
    }
  } else {
    updates.status = 'partial';
  }

  const { error } = await _supabase.from('students')
    .update(updates).eq('id', studentId).eq('owner_id', currentUserId);
  if (error) { showErr(errEl, 'Error recording payment: ' + error.message); return; }

  await _supabase.from('payments').insert([{
    owner_id:       currentUserId,
    student_id:     studentId,
    amount,
    method,
    payment_date:   payDate,
    serial_at_time: fullPaid ? (updates.serial || s.serial) : null,
    month_number:   s.month_number || 1
  }]);

  closeModal('recordPaymentModal');
  const msg = fullPaid
    ? `Payment complete! Serial #${updates.serial} reactivated. VIP access restored.`
    : 'Payment recorded successfully.';
  showToast(msg, 'success');
  await loadAll();
}

// ── Register New Month (recurring mode only) ──────────────────
// RULES:
// 1. Student must have balance = 0 (fully paid) to register new month
// 2. Cycle starts from original due date — not today
// 3. If due date is in the past (months overdue), start from today to avoid instant expiry
// 4. Balance resets to full total_fee (owing again for new month)
// 5. Serial is preserved — will reactivate once new month is fully paid
// 6. VIP is OFF until new month payment is complete
async function registerNewMonth(studentId) {
  const s = allStudents.find(x => x.id === studentId);
  if (!s) return;

  // RULE 1: Block if still owing
  if (s.balance > 0) {
    showToast('Student must complete their current payment before registering a new month.', 'error');
    return;
  }

  const cycle    = calcCycle(s);
  const newMonth = (s.month_number || 1) + 1;

  // RULE 3: Use due date as new start, but if it's too far in the past use today
  // This prevents the new cycle from being instantly expired
  const dueDate  = cycle.due ? new Date(cycle.due) : new Date();
  const today    = new Date();
  const newStart = dueDate > today
    ? dueDate.toISOString().split('T')[0]   // due date is in future — use it
    : today.toISOString().split('T')[0];    // due date already passed — start fresh today

  const { error } = await _supabase.from('students').update({
    amount_paid:  0,              // reset — owing again for new month
    balance:      s.total_fee,   // full fee due again
    status:       'partial',     // owing
    vip_active:   false,         // VIP OFF until paid
    is_vip:       false,
    vip_type:     null,
    temp_vip:     false,
    // serial stays on the record — reactivates when fully paid
    cycle_start:  newStart,
    month_number: newMonth,
    paused:       false,
    pause_reason: null
  }).eq('id', s.id).eq('owner_id', currentUserId);

  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast(`Month ${newMonth} registered! Cycle starts ${fmtDate(newStart)}. Fee is now owing.`, 'success');
  closeModal('viewStudentModal');
  await loadAll();
}

// ── Temp VIP ──────────────────────────────────────────────────
// RULE: Cannot grant temp VIP if the student's cycle has ended
async function grantTempVIP(studentId) {
  const s = allStudents.find(x => x.id === studentId);
  if (!s) return;

  // Block if cycle has ended
  if (ownerProfile.mode === 'recurring' && s.cycle_start) {
    const cycle = calcCycle(s);
    if (cycle.expired) {
      showToast('Cannot grant Temp VIP — this student\'s cycle has ended. Register a new month first.', 'error');
      return;
    }
  }

  const tempSerial = getNextTempSerial();
  const updates    = {
    temp_vip:   true,
    vip_active: true,
    is_vip:     true,
    vip_type:   'temp',
    serial:     tempSerial
  };
  if (ownerProfile.mode === 'recurring' && !s.cycle_start) {
    updates.cycle_start = new Date().toISOString().split('T')[0];
  }

  const { error } = await _supabase.from('students')
    .update(updates).eq('id', studentId).eq('owner_id', currentUserId);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast(`Temporary VIP granted. Serial: ${tempSerial}`, 'success');
  closeModal('viewStudentModal');
  await loadAll();
}

async function removeTempVIP(studentId) {
  if (!confirm('Remove temporary VIP access for this student?')) return;
  const { error } = await _supabase.from('students').update({
    temp_vip:   false,
    vip_active: false,
    is_vip:     false,
    serial:     null,
    vip_type:   null
  }).eq('id', studentId).eq('owner_id', currentUserId);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Temporary VIP removed.', 'success');
  await loadAll();
}

// ── View Student Modal ────────────────────────────────────────
function viewStudent(studentId) {
  const s           = allStudents.find(x => x.id === studentId);
  if (!s) return;
  const isRecurring  = ownerProfile.mode === 'recurring';
  const cycle        = isRecurring ? calcCycle(s) : null;
  const stuPayments  = allPayments.filter(p => p.student_id === studentId);
  const cycleExpired = isRecurring && s.cycle_start && cycle.expired && !s.vip_active;
  const fullyPaid    = s.balance <= 0;

  // canRegisterNewMonth: cycle ended AND fully paid
  const canRegisterNewMonth = cycleExpired && fullyPaid;

  let timerHtml = '';
  if (isRecurring) {
    if (s.paused) {
      timerHtml = `<div class="pause-banner" style="margin:16px 0">
        <strong>Cycle Paused</strong> — ${s.pause_reason || ''}
      </div>`;
    } else if (s.cycle_start && !cycle.expired) {
      const pctClass = cycle.pct > 40 ? '' : cycle.pct > 15 ? 'warn' : 'danger';
      timerHtml = `
        <div style="margin:12px 0;padding:14px;background:var(--off-white);border-radius:var(--radius-sm);border:1px solid var(--border)">
          <div class="info-row"><span>Cycle Start</span><strong>${fmtDate(s.cycle_start)}</strong></div>
          <div class="info-row"><span>Due Date</span><strong>${fmtDate(cycle.due)}</strong></div>
          <div class="info-row"><span>Days Left</span><strong>${cycle.daysLeft} days</strong></div>
          <div style="margin-top:10px">
            <div class="timer-bar-wrap"><div class="timer-bar ${pctClass}" style="width:${cycle.pct}%"></div></div>
          </div>
        </div>`;
    } else if (cycleExpired) {
      timerHtml = `<div class="alert-item alert-danger" style="margin:12px 0">
        <strong>Cycle ended on ${fmtDate(cycle.due)}.</strong><br>
        ${fullyPaid
          ? '<em style="color:var(--success)">✓ Fully paid — ready to register next month.</em>'
          : `<em style="color:var(--danger)">⚠ Balance of ${formatNaira(s.balance)} must be completed before registering next month.</em>`
        }
      </div>`;
    }
  }

  // Payment history — grouped by month
  const histHtml = stuPayments.length ? `
    <div style="margin-top:16px"><strong>Payment History (All Months)</strong>
    <table class="data-table" style="margin-top:8px">
      <thead><tr><th>Month</th><th>Amount</th><th>Method</th><th>Date</th><th>Serial</th></tr></thead>
      <tbody>
        ${stuPayments.map(p => `<tr>
          <td>Month ${p.month_number || 1}</td>
          <td>${formatNaira(p.amount)}</td>
          <td>${p.method || '—'}</td>
          <td>${fmtDate(p.payment_date)}</td>
          <td>${p.serial_at_time || '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : '';

  const loginInfo = s.login_id
    ? `<div class="info-row"><span>Login ID</span><strong>${s.login_id}</strong></div>`
    : `<div class="info-row"><span>Student PIN</span><strong>${s.student_pin || '—'}</strong></div>`;

  document.getElementById('viewStudentBody').innerHTML = `
    <div class="info-grid">
      <div class="info-row"><span>Name</span><strong>${s.name}</strong></div>
      <div class="info-row"><span>Class</span><strong>${s.class || '—'}</strong></div>
      ${loginInfo}
      <div class="info-row"><span>Serial</span><strong>${s.serial ? '#' + s.serial + (s.vip_active ? ' (Active)' : ' (Inactive — pay to reactivate)') : 'Not assigned'}</strong></div>
      <div class="info-row"><span>Email</span><strong>${s.email || '—'}</strong></div>
      <div class="info-row"><span>Total Fee</span><strong>${formatNaira(s.total_fee)}</strong></div>
      <div class="info-row"><span>Amount Paid</span><strong>${formatNaira(s.amount_paid)}</strong></div>
      <div class="info-row"><span>Balance</span><strong class="${s.balance > 0 ? 'text-red' : 'text-green'}">${formatNaira(s.balance)}</strong></div>
      ${isRecurring ? `<div class="info-row"><span>Month #</span><strong>${s.month_number || 1}</strong></div>` : ''}
      <div class="info-row"><span>Status</span>${getStatusBadge(s)}</div>
      ${s.notes ? `<div class="info-row"><span>Notes</span><strong>${s.notes}</strong></div>` : ''}
    </div>
    ${timerHtml}
    ${histHtml}
  `;

  // Buttons
  document.getElementById('viewPayBtn').onclick = () => { closeModal('viewStudentModal'); openRecordPayment(studentId); };

  // Grant/Remove Temp VIP button — hide if cycle ended
  const vipBtn = document.getElementById('viewVIPBtn');
  if (isRecurring && cycleExpired) {
    // Cycle ended — hide temp VIP button entirely
    vipBtn.style.display = 'none';
  } else {
    vipBtn.style.display = '';
    vipBtn.textContent   = s.temp_vip ? 'Remove Temp VIP' : 'Grant Temp VIP';
    vipBtn.onclick       = s.temp_vip
      ? () => { removeTempVIP(studentId); closeModal('viewStudentModal'); }
      : () => grantTempVIP(studentId);
  }

  const pauseBtn = document.getElementById('viewPauseBtn');
  if (pauseBtn) {
    pauseBtn.style.display = isRecurring ? '' : 'none';
    pauseBtn.onclick = () => openPauseModal(studentId);
  }

  // Register new month button — only if cycle ended AND fully paid
  const footer   = document.querySelector('#viewStudentModal .modal-footer');
  const existing = document.getElementById('regNewMonthBtn');
  if (existing) existing.remove();

  if (isRecurring && cycleExpired) {
    const btn = document.createElement('button');
    btn.id        = 'regNewMonthBtn';
    btn.className = canRegisterNewMonth ? 'btn-primary' : 'btn-secondary';
    btn.textContent = canRegisterNewMonth
      ? `Register Month ${(s.month_number || 1) + 1}`
      : `Complete Payment to Register Month ${(s.month_number || 1) + 1}`;
    btn.disabled  = !canRegisterNewMonth;
    btn.title     = canRegisterNewMonth ? '' : 'Student must fully pay before registering next month';
    btn.onclick   = canRegisterNewMonth ? () => registerNewMonth(studentId) : null;
    footer.insertBefore(btn, footer.firstChild);
  }

  openModal('viewStudentModal');
}

// ── Pause / Resume ────────────────────────────────────────────
function openPauseModal(studentId) {
  const s = allStudents.find(x => x.id === studentId);
  if (!s) return;
  document.getElementById('pauseStudentId').value = studentId;
  document.getElementById('pauseReason').value    = '';
  document.getElementById('pauseError').style.display = 'none';
  const btn = document.querySelector('#pauseModal .btn-warning');
  if (s.paused) { btn.textContent = 'Resume Cycle'; btn.onclick = executeResume; }
  else          { btn.textContent = 'Pause Cycle';  btn.onclick = executePause; }
  openModal('pauseModal');
}

async function executePause() {
  const studentId = document.getElementById('pauseStudentId').value;
  const reason    = document.getElementById('pauseReason').value.trim();
  const errEl     = document.getElementById('pauseError');
  if (!reason) { showErr(errEl, 'Please enter a reason.'); return; }
  await _supabase.from('students')
    .update({ paused: true, pause_reason: reason, paused_at: new Date().toISOString() })
    .eq('id', studentId).eq('owner_id', currentUserId);
  closeModal('pauseModal');
  showToast('Cycle paused.', 'success');
  await loadAll();
}

async function executeResume() {
  const studentId = document.getElementById('pauseStudentId').value;
  await _supabase.from('students')
    .update({ paused: false, pause_reason: null, paused_at: null })
    .eq('id', studentId).eq('owner_id', currentUserId);
  closeModal('pauseModal');
  showToast('Cycle resumed.', 'success');
  await loadAll();
}

// ── Edit Student ──────────────────────────────────────────────
function openEditStudent(studentId) {
  const s = allStudents.find(x => x.id === studentId);
  if (!s) return;
  document.getElementById('editStudentId').value = studentId;
  document.getElementById('editName').value      = s.name || '';
  document.getElementById('editClass').value     = s.class || '';
  document.getElementById('editTotalFee').value  = s.total_fee || '';
  document.getElementById('editNotes').value     = s.notes || '';
  document.getElementById('editStudentError').style.display = 'none';
  openModal('editStudentModal');
}

async function saveEditStudent() {
  const studentId = document.getElementById('editStudentId').value;
  const name      = document.getElementById('editName').value.trim();
  const cls       = document.getElementById('editClass').value.trim();
  const totalFee  = parseFloat(document.getElementById('editTotalFee').value) || 0;
  const notes     = document.getElementById('editNotes').value.trim();
  const errEl     = document.getElementById('editStudentError');
  if (!name) { showErr(errEl, 'Name is required.'); return; }

  const s          = allStudents.find(x => x.id === studentId);
  const newBalance = Math.max(0, totalFee - (s?.amount_paid || 0));

  const { error } = await _supabase.from('students')
    .update({ name, name_lower: name.toLowerCase(), class: cls, total_fee: totalFee, balance: newBalance, notes })
    .eq('id', studentId).eq('owner_id', currentUserId);
  if (error) { showErr(errEl, 'Error: ' + error.message); return; }

  closeModal('editStudentModal');
  showToast('Student updated.', 'success');
  await loadAll();
}

// ── Delete Student ────────────────────────────────────────────
async function deleteStudent(studentId) {
  if (!confirm('Delete this student and all their payment records? This cannot be undone.')) return;
  await _supabase.from('payments').delete().eq('student_id', studentId).eq('owner_id', currentUserId);
  await _supabase.from('students').delete().eq('id', studentId).eq('owner_id', currentUserId);
  showToast('Student deleted.', 'success');
  await loadAll();
}

// ── Settings ──────────────────────────────────────────────────
async function saveSettings() {
  const { error } = await _supabase.from('profiles').update({
    centre_name:    document.getElementById('centreName').value.trim(),
    default_fee:    parseFloat(document.getElementById('defaultFee').value) || 0,
    whatsapp:       document.getElementById('whatsappNum').value.trim(),
    bank_name:      document.getElementById('bankName').value.trim(),
    account_number: document.getElementById('accountNumber').value.trim(),
    account_name:   document.getElementById('accountName').value.trim()
  }).eq('id', currentUserId);

  if (error) { showToast('Error saving settings: ' + error.message, 'error'); return; }

  const { data: p } = await _supabase.from('profiles').select('*').eq('id', currentUserId).single();
  ownerProfile = p;
  document.getElementById('adminNameDisplay').textContent  = p.centre_name;
  document.getElementById('sidebarCentreName').textContent = p.centre_name;
  showToast('Settings saved successfully.', 'success');
}

// ── Change Password ───────────────────────────────────────────
async function changePassword() {
  const np = document.getElementById('newPasswordInput').value;
  const cp = document.getElementById('confirmPasswordInput').value;
  if (!np || !cp)    { showToast('Please fill in both fields.', 'error'); return; }
  if (np !== cp)     { showToast('Passwords do not match.', 'error'); return; }
  if (np.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
  const { error } = await _supabase.auth.updateUser({ password: np });
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Password updated successfully.', 'success');
  document.getElementById('newPasswordInput').value     = '';
  document.getElementById('confirmPasswordInput').value = '';
}

// ── Delete Account ────────────────────────────────────────────
async function deleteAccount() {
  const input = document.getElementById('deleteAccountInput')?.value?.trim();
  if (input !== 'DELETE') {
    showToast('Type DELETE to confirm account deletion.', 'error');
    return;
  }

  // Delete all student data first
  await _supabase.from('payments').delete().eq('owner_id', currentUserId);
  await _supabase.from('students').delete().eq('owner_id', currentUserId);
  await _supabase.from('profiles').delete().eq('id', currentUserId);

  // Sign out and delete auth account
  await _supabase.auth.signOut();
  localStorage.clear();

  showToast('Account deleted. Redirecting...', 'info');
  setTimeout(() => { window.location.href = './index.html'; }, 1500);
}

function confirmDeleteAccount() {
  const existing = document.getElementById('deleteAccountModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'deleteAccountModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <div class="modal-header danger-header">
        <h3>Delete Account</h3>
        <button onclick="document.getElementById('deleteAccountModal').remove()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="danger-warning">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <p>This will permanently delete your <strong>account, all students, and all payment records</strong>. This cannot be undone.</p>
        </div>
        <div class="form-group" style="margin-top:16px">
          <label>Type <strong>DELETE</strong> to confirm</label>
          <input type="text" id="deleteAccountInput" placeholder="Type DELETE here"/>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="document.getElementById('deleteAccountModal').remove()">Cancel</button>
        <button class="btn-danger" onclick="deleteAccount()">Permanently Delete Account</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

// ── Reset System ──────────────────────────────────────────────
function confirmReset() { openModal('resetModal'); }

async function executeReset() {
  const input = document.getElementById('resetConfirmInput').value.trim();
  if (input !== 'RESET') { showToast('Type RESET to confirm.', 'error'); return; }

  await _supabase.from('payments').delete().eq('owner_id', currentUserId);
  await _supabase.from('students').delete().eq('owner_id', currentUserId);

  closeModal('resetModal');
  showToast('System reset complete. All data cleared.', 'success');
  await loadAll();
}

// ── Sidebar ───────────────────────────────────────────────────
function showSection(name, clickedEl) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById('section-' + name);
  if (sec) sec.classList.add('active');
  if (clickedEl) clickedEl.classList.add('active');
  const titles = { dashboard: 'Dashboard', students: 'Students', payments: 'Payments', vip: 'VIP / Active', alerts: 'Alerts', settings: 'Settings' };
  document.getElementById('topbarTitle').textContent = titles[name] || name;
  if (window.innerWidth < 768) closeSidebar();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

// ── Serial number helpers ─────────────────────────────────────
function getNextSerial() {
  const used = allStudents
    .filter(s => s.serial && /^\d+$/.test(s.serial))
    .map(s => parseInt(s.serial));
  let next = 1;
  while (used.includes(next)) next++;
  return String(next).padStart(3, '0');
}

function getNextTempSerial() {
  const used = allStudents
    .filter(s => s.serial && s.serial.startsWith('TEMP-'))
    .map(s => parseInt(s.serial.replace('TEMP-', '')))
    .filter(n => !isNaN(n));
  let next = 1;
  while (used.includes(next)) next++;
  return 'TEMP-' + String(next).padStart(3, '0');
}

// ── Cookie banner ─────────────────────────────────────────────
function initCookieBanner() {
  if (localStorage.getItem('velune_cookies')) return;
  const banner = document.createElement('div');
  banner.className = 'cookie-banner';
  banner.id = 'cookieBanner';
  banner.innerHTML = `
    <div class="cookie-banner-text">
      <strong>🍪 We use cookies</strong>
      Velune uses cookies and local storage to keep you logged in and remember your preferences.
    </div>
    <div class="cookie-banner-actions">
      <button class="cookie-decline-btn" onclick="localStorage.setItem('velune_cookies','declined');document.getElementById('cookieBanner').remove()">Decline</button>
      <button class="cookie-accept-btn"  onclick="localStorage.setItem('velune_cookies','accepted');document.getElementById('cookieBanner').remove()">Accept & Continue</button>
    </div>`;
  document.body.appendChild(banner);
}
document.addEventListener('DOMContentLoaded', initCookieBanner);

// ── Welcome modal ─────────────────────────────────────────────
function showAdminWelcome(adminName, stats) {
  const key = 'velune_welcomed_admin';
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (adminName || 'Admin').split(' ')[0];
  const overlay  = document.createElement('div');
  overlay.className = 'welcome-modal-overlay';
  overlay.id = 'welcomeOverlay';
  overlay.innerHTML = `
    <div class="welcome-modal">
      <div class="welcome-modal-icon">👋</div>
      <div class="welcome-modal-title">${greeting}, ${firstName}!</div>
      <div class="welcome-modal-sub">Welcome back to your <strong>Velune</strong> dashboard.</div>
      <div class="welcome-modal-stats">
        <div class="welcome-modal-stat"><div class="welcome-modal-stat-num">${stats.total}</div><div class="welcome-modal-stat-label">Students</div></div>
        <div class="welcome-modal-stat"><div class="welcome-modal-stat-num">${stats.vip}</div><div class="welcome-modal-stat-label">VIP Active</div></div>
        <div class="welcome-modal-stat"><div class="welcome-modal-stat-num">${stats.owing}</div><div class="welcome-modal-stat-label">Owing</div></div>
      </div>
      <button class="welcome-modal-btn" onclick="document.getElementById('welcomeOverlay').remove()">Go to Dashboard →</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function showAccessBanner(html, bgColor) {
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: ${bgColor}; color: white; text-align: center;
    padding: 10px 20px; font-size: 0.85rem; font-weight: 600;
    display: flex; align-items: center; justify-content: center; gap: 12px;
    font-family: 'DM Sans', sans-serif; box-shadow: 0 2px 12px rgba(0,0,0,0.2);
  `;
  banner.innerHTML = html + `
    <button onclick="this.parentElement.remove();document.body.style.paddingTop=''"
      style="background:none;border:none;color:white;cursor:pointer;margin-left:8px;font-size:1rem;flex-shrink:0">✕</button>
  `;
  document.body.style.paddingTop = '44px';
  document.body.insertBefore(banner, document.body.firstChild);
}