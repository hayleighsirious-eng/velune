

// ============================================================
//  VELUNE — ADMIN DASHBOARD  (admin.js)
// ============================================================

let allStudents      = [];
let allPayments      = [];
let currentFilter    = 'all';
let searchTerm       = '';
let ownerProfile     = null;
let currentUserId    = null;
let paymentSubmitting = false;

(async function boot() {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { window.location.href = './index.html'; return; }
  currentUserId = session.user.id;

  const access = await checkAccess(currentUserId);
  if (!access.allowed) { window.location.href = './activate.html'; return; }

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

  const { data: profile } = await _supabase.from('profiles').select('*').eq('id', currentUserId).single();
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

async function logout() {
  await _supabase.auth.signOut();
  localStorage.clear();
  window.location.href = './index.html';
}

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

// FIX 1: parse cycle_start as LOCAL time (not UTC) so expiry hits at midnight Nigeria time
// FIX 2: clears serial when cycle expires so student doesn't keep a stale serial number
async function runAutoExpire() {
  const now = new Date();
  const toExpire = allStudents.filter(s => {
    if (!s.vip_active || s.paused || !s.cycle_start) return false;
    const due = new Date(new Date(s.cycle_start + 'T00:00:00').getTime() + CYCLE_DAYS * 86400000);
    return now >= due;
  });
  for (const s of toExpire) {
    await _supabase.from('students').update({
      vip_active: false,
      temp_vip:   false,
      is_vip:     false,
      vip_type:   null,
      serial:     null
    }).eq('id', s.id).eq('owner_id', currentUserId);
  }
  if (toExpire.length) await loadAll();
}

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

function renderRecentPayments() {
  const tbody = document.getElementById('recentPaymentsBody');
  const last5 = allPayments.filter(p => !p.voided).slice(0, 5);
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
    const cycle = isRecurring ? calcCycle(s) : null;
    let expText = '—';
    if (isRecurring && s.cycle_start) {
      if (cycle.expired && !s.vip_active && s.balance > 0) {
        expText = '<span class="badge badge-red">Cycle Ended — payment overdue</span>';
      } else if (cycle.expired && !s.vip_active && s.balance <= 0) {
        expText = `<span class="badge badge-orange">Month ${s.month_number || 1} ended — register new month</span>`;
      } else {
        expText = `Month ${s.month_number || 1} — ${cycle.daysLeft}d left (${fmtDate(cycle.due)})`;
      }
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
  if (s.paused) return '<span class="badge badge-orange">Paused</span>';
  if (ownerProfile.mode === 'recurring' && s.cycle_start) {
    const cycle = calcCycle(s);
    if (cycle.expired && !s.vip_active && s.balance > 0)
      return '<span class="badge badge-red">Cycle Ended</span>';
    if (cycle.expired && !s.vip_active && s.balance <= 0)
      return '<span class="badge badge-orange">New Month Due</span>';
  }
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

function renderPaymentsTable() {
  const tbody = document.getElementById('paymentsTableBody');
  if (!allPayments.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No payments recorded.</td></tr>';
    return;
  }
  tbody.innerHTML = allPayments.map(p => {
    const st = allStudents.find(s => s.id === p.student_id);
    const isVoided = p.voided;
    return `<tr style="${isVoided ? 'opacity:0.45;text-decoration:line-through' : ''}">
      <td>${st ? st.name : '—'}</td>
      <td>${formatNaira(p.amount)}</td>
      <td>${p.method || '—'}</td>
      <td>${fmtDate(p.payment_date)}</td>
      <td>${p.serial_at_time || '—'}</td>
      <td>
        ${isVoided
          ? '<span class="badge badge-red">Voided</span>'
          : `<button class="btn-xs btn-red" onclick="confirmVoidPayment('${p.id}','${st ? st.name : 'this student'}',${p.amount})">Void</button>`
        }
      </td>
    </tr>`;
  }).join('');
}

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
            : ``
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

function renderAlerts() {
  if (ownerProfile.mode !== 'recurring') return;
  const now = new Date();
  const alerts = allStudents.filter(s => {
    if (!s.vip_active || !s.cycle_start || s.paused) return false;
    const due = new Date(new Date(s.cycle_start + 'T00:00:00').getTime() + CYCLE_DAYS * 86400000);
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
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn-xs btn-blue" onclick="openRecordPayment('${s.id}')">Record Pay</button>
          ${ownerProfile.whatsapp && s.balance > 0 ? `<button class="btn-xs btn-green" onclick="sendWhatsAppReminder('${s.id}')">WhatsApp</button>` : ''}
        </div>
      </div>`;
  }).join('') : '<div class="empty-state">No urgent alerts. All cycles have more than 5 days remaining.</div>';

  if (document.getElementById('alertsList'))
    document.getElementById('alertsList').innerHTML = alertsHtml;
  if (document.getElementById('dashAlerts'))
    document.getElementById('dashAlerts').innerHTML = alertsHtml;
}

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
  const serial      = fullPaid ? await getNextSerialSafe() : null;

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
    const { error: payErr } = await _supabase.from('payments').insert([{
      owner_id:       currentUserId,
      student_id:     newStudent.id,
      amount:         amtPaid,
      method:         method,
      payment_date:   today,
      serial_at_time: serial || null,
      month_number:   1,
      voided:         false
    }]);
    if (payErr) showToast('Student added but payment failed to record: ' + payErr.message, 'error');
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
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:18px">Share these login details with <strong>${name}</strong>:</p>
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
  paymentSubmitting = false;
  const submitBtn = document.getElementById('recordPaySubmitBtn');
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Record Payment'; }
  openModal('recordPaymentModal');
}

async function recordPayment() {
  if (paymentSubmitting) return;
  paymentSubmitting = true;
  const submitBtn = document.getElementById('recordPaySubmitBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }

  const studentId = document.getElementById('payStudentId').value;
  const amount    = parseFloat(document.getElementById('payAmount').value) || 0;
  const method    = document.getElementById('payMethod').value;
  const payDate   = document.getElementById('payDate').value;
  const errEl     = document.getElementById('recordPayError');

  if (amount <= 0) {
    showErr(errEl, 'Amount must be greater than 0.');
    paymentSubmitting = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Record Payment'; }
    return;
  }

  const s = allStudents.find(x => x.id === studentId);
  if (!s) { paymentSubmitting = false; return; }

  const isRecurring = ownerProfile.mode === 'recurring';
  const newPaid     = (s.amount_paid || 0) + amount;
  const newBalance  = Math.max(0, (s.total_fee || 0) - newPaid);
  const fullPaid    = newBalance <= 0;

  let updates = { amount_paid: newPaid, balance: newBalance };

  if (fullPaid) {
    const newSerial    = await getNextSerialSafe();
    updates.serial     = newSerial;
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

  const { error: stuErr } = await _supabase.from('students')
    .update(updates).eq('id', studentId).eq('owner_id', currentUserId);
  if (stuErr) {
    showErr(errEl, 'Error updating student: ' + stuErr.message);
    paymentSubmitting = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Record Payment'; }
    return;
  }

  const { error: payErr } = await _supabase.from('payments').insert([{
    owner_id:       currentUserId,
    student_id:     studentId,
    amount:         amount,
    method:         method,
    payment_date:   payDate,
    serial_at_time: fullPaid ? updates.serial : null,
    month_number:   s.month_number || 1,
    voided:         false
  }]);
  if (payErr) showToast('Payment saved but history log failed: ' + payErr.message, 'error');

  paymentSubmitting = false;
  closeModal('recordPaymentModal');
  showToast(fullPaid ? `Payment complete! Serial #${updates.serial} issued. VIP active.` : 'Payment recorded successfully.', 'success');
  await loadAll();
}

function confirmVoidPayment(paymentId, studentName, amount) {
  if (!confirm(`Void ${formatNaira(amount)} payment for ${studentName}?\n\nThis will reverse the amount from their balance.\nThis cannot be undone.`)) return;
  voidPayment(paymentId);
}

async function voidPayment(paymentId) {
  const p = allPayments.find(x => x.id === paymentId);
  if (!p || p.voided) return;
  const s = allStudents.find(x => x.id === p.student_id);
  if (!s) return;

  const { error: voidErr } = await _supabase.from('payments')
    .update({ voided: true }).eq('id', paymentId).eq('owner_id', currentUserId);
  if (voidErr) { showToast('Error voiding payment: ' + voidErr.message, 'error'); return; }

  const newPaid    = Math.max(0, (s.amount_paid || 0) - p.amount);
  const newBalance = Math.max(0, (s.total_fee || 0) - newPaid);
  const stillFull  = newBalance <= 0;
  const studentUpdates = { amount_paid: newPaid, balance: newBalance, status: stillFull ? 'paid' : 'partial' };

  if (!stillFull && s.vip_active && s.vip_type === 'paid') {
    studentUpdates.vip_active = false;
    studentUpdates.is_vip     = false;
    studentUpdates.vip_type   = null;
    studentUpdates.serial     = null;
  }

  const { error: stuErr } = await _supabase.from('students')
    .update(studentUpdates).eq('id', s.id).eq('owner_id', currentUserId);
  if (stuErr) { showToast('Error updating student after void: ' + stuErr.message, 'error'); return; }

  showToast(`Payment voided. ${s.name}'s balance updated to ${formatNaira(newBalance)}.`, 'success');
  await loadAll();
}

async function registerNewMonth(studentId) {
  const s = allStudents.find(x => x.id === studentId);
  if (!s) return;
  if (s.balance > 0) { showToast('Student must complete previous month payment before starting a new cycle.', 'error'); return; }
  const newMonth = (s.month_number || 1) + 1;
  if (!confirm(`Register Month ${newMonth} for ${s.name}?\n\nThis will:\n• Reset their balance to ${formatNaira(s.total_fee)}\n• Clear their current serial\n• Turn off VIP until they pay again\n\nThis cannot be undone.`)) return;

  const cycle    = calcCycle(s);
  const dueDate  = cycle.due ? new Date(cycle.due) : new Date();
  const today    = new Date();
  const newStart = dueDate > today ? dueDate.toISOString().split('T')[0] : today.toISOString().split('T')[0];

  const { error } = await _supabase.from('students').update({
    amount_paid:  0,
    balance:      s.total_fee,
    status:       'partial',
    vip_active:   false,
    is_vip:       false,
    vip_type:     null,
    temp_vip:     false,
    serial:       null,
    cycle_start:  newStart,
    month_number: newMonth,
    paused:       false,
    pause_reason: null
  }).eq('id', s.id).eq('owner_id', currentUserId);

  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast(`Month ${newMonth} started! Cycle begins ${fmtDate(newStart)}. Payment now due.`, 'success');
  closeModal('viewStudentModal');
  await loadAll();
}

async function grantTempVIP(studentId) {
  const s = allStudents.find(x => x.id === studentId);
  if (!s) return;
  if (ownerProfile.mode === 'recurring' && s.cycle_start) {
    const cycle = calcCycle(s);
    if (cycle.expired) { showToast('Cannot grant Temp VIP — cycle has ended. Register new month first.', 'error'); return; }
  }
  const tempSerial = getNextTempSerial();
  const updates = { temp_vip: true, vip_active: true, is_vip: true, vip_type: 'temp', serial: tempSerial };
  if (ownerProfile.mode === 'recurring' && !s.cycle_start) {
    updates.cycle_start = new Date().toISOString().split('T')[0];
  }
  const { error } = await _supabase.from('students').update(updates).eq('id', studentId).eq('owner_id', currentUserId);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast(`Temp VIP granted. Serial: ${tempSerial}`, 'success');
  closeModal('viewStudentModal');
  await loadAll();
}

async function removeTempVIP(studentId) {
  if (!confirm('Remove temporary VIP access for this student?')) return;
  const { error } = await _supabase.from('students').update({
    temp_vip: false, vip_active: false, is_vip: false, serial: null, vip_type: null
  }).eq('id', studentId).eq('owner_id', currentUserId);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Temporary VIP removed.', 'success');
  await loadAll();
}

function viewStudent(studentId) {
  const s = allStudents.find(x => x.id === studentId);
  if (!s) return;
  const isRecurring  = ownerProfile.mode === 'recurring';
  const cycle        = isRecurring ? calcCycle(s) : null;
  const stuPayments  = allPayments.filter(p => p.student_id === studentId);
  const cycleExpired = isRecurring && s.cycle_start && cycle.expired && !s.vip_active;
  const fullyPaid    = s.balance <= 0;
  const canRegisterNewMonth = cycleExpired && fullyPaid;

  let timerHtml = '';
  if (isRecurring) {
    if (s.paused) {
      timerHtml = `<div class="pause-banner" style="margin:16px 0"><strong>Cycle Paused</strong> — ${s.pause_reason || ''}</div>`;
    } else if (s.cycle_start && !cycle.expired) {
      const pctClass = cycle.pct > 40 ? '' : cycle.pct > 15 ? 'warn' : 'danger';
      timerHtml = `
        <div style="margin:12px 0;padding:14px;background:var(--off-white);border-radius:var(--radius-sm);border:1px solid var(--border)">
          <div class="info-row"><span>Cycle Start</span><strong>${fmtDate(s.cycle_start)}</strong></div>
          <div class="info-row"><span>Due Date</span><strong>${fmtDate(cycle.due)}</strong></div>
          <div class="info-row"><span>Days Left</span><strong>${cycle.daysLeft} days</strong></div>
          <div style="margin-top:10px"><div class="timer-bar-wrap"><div class="timer-bar ${pctClass}" style="width:${cycle.pct}%"></div></div></div>
        </div>`;
    } else if (cycleExpired) {
      timerHtml = `<div class="alert-item ${fullyPaid ? 'alert-warning' : 'alert-danger'}" style="margin:12px 0">
        <strong>Month ${s.month_number || 1} ended — ${fmtDate(cycle.due)}</strong><br>
        ${fullyPaid
          ? '<em style="color:var(--success)">✓ Fully paid. Ready to begin next cycle.</em>'
          : `<em style="color:var(--danger)">Outstanding balance of ${formatNaira(s.balance)} must be paid before next cycle can begin.</em>`
        }
      </div>`;
    }
  }

  const waBtn = (s.balance > 0 && ownerProfile.whatsapp)
    ? `<button class="btn-xs btn-green" onclick="sendWhatsAppReminder('${s.id}')" style="margin-top:8px;width:100%">📱 Send WhatsApp Reminder</button>`
    : '';

  const histHtml = stuPayments.length ? `
    <div style="margin-top:16px"><strong>Payment History (All Months)</strong>
    <table class="data-table" style="margin-top:8px">
      <thead><tr><th>Month</th><th>Amount</th><th>Method</th><th>Date</th><th>Serial</th><th></th></tr></thead>
      <tbody>
        ${stuPayments.map(p => `<tr style="${p.voided ? 'opacity:0.45;text-decoration:line-through' : ''}">
          <td>Month ${p.month_number || 1}</td>
          <td>${formatNaira(p.amount)}</td>
          <td>${p.method || '—'}</td>
          <td>${fmtDate(p.payment_date)}</td>
          <td>${p.serial_at_time || '—'}</td>
          <td>${p.voided
            ? '<span class="badge badge-red" style="font-size:0.65rem">Voided</span>'
            : `<button class="btn-xs btn-red" onclick="confirmVoidPayment('${p.id}','${s.name}',${p.amount})">Void</button>`
          }</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`
    : '<div style="margin-top:12px;font-size:0.85rem;color:var(--text-muted)">No payments recorded yet.</div>';

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
    ${waBtn}
    ${histHtml}
  `;

  document.getElementById('viewPayBtn').onclick = () => { closeModal('viewStudentModal'); openRecordPayment(studentId); };

  const vipBtn = document.getElementById('viewVIPBtn');
  if (isRecurring && cycleExpired) {
    vipBtn.style.display = 'none';
  } else if (s.vip_active && !s.temp_vip) {
    // Fully paid permanent VIP — hide button entirely
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

  const footer   = document.querySelector('#viewStudentModal .modal-footer');
  const existing = document.getElementById('regNewMonthBtn');
  if (existing) existing.remove();

  if (isRecurring && cycleExpired) {
    const btn = document.createElement('button');
    btn.id          = 'regNewMonthBtn';
    btn.className   = canRegisterNewMonth ? 'btn-primary' : 'btn-secondary';
    btn.textContent = canRegisterNewMonth
      ? `Register Month ${(s.month_number || 1) + 1}`
      : `Complete Payment to Register Month ${(s.month_number || 1) + 1}`;
    btn.disabled = !canRegisterNewMonth;
    btn.title    = canRegisterNewMonth ? '' : 'Student must fully pay before registering next month';
    btn.onclick  = canRegisterNewMonth ? () => registerNewMonth(studentId) : null;
    footer.insertBefore(btn, footer.firstChild);
  }

  openModal('viewStudentModal');
}

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
  const s = allStudents.find(x => x.id === studentId);
  await _supabase.from('students')
    .update({ paused: false, pause_reason: null, paused_at: null })
    .eq('id', studentId).eq('owner_id', currentUserId);
  closeModal('pauseModal');
  if (s) {
    const cycle = calcCycle(s);
    if (cycle && cycle.expired) {
      showToast(`Cycle resumed — note: ${s.name}'s cycle ended on ${fmtDate(cycle.due)}. Register a new month when ready.`, 'warning');
    } else {
      showToast('Cycle resumed.', 'success');
    }
  } else {
    showToast('Cycle resumed.', 'success');
  }
  await loadAll();
}

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

async function deleteStudent(studentId) {
  if (!confirm('Delete this student and all their payment records? This cannot be undone.')) return;
  await _supabase.from('payments').delete().eq('student_id', studentId).eq('owner_id', currentUserId);
  await _supabase.from('students').delete().eq('id', studentId).eq('owner_id', currentUserId);
  showToast('Student deleted.', 'success');
  await loadAll();
}

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

async function getNextSerialSafe() {
  const [{ data: stuData }, { data: payData }] = await Promise.all([
    _supabase.from('students').select('serial').eq('owner_id', currentUserId).not('serial', 'is', null),
    _supabase.from('payments').select('serial_at_time').eq('owner_id', currentUserId).not('serial_at_time', 'is', null)
  ]);
  const fromStudents = (stuData || []).map(r => r.serial).filter(s => s && /^\d+$/.test(s)).map(s => parseInt(s));
  const fromPayments = (payData || []).map(r => r.serial_at_time).filter(s => s && /^\d+$/.test(s)).map(s => parseInt(s));
  const allUsed = [...new Set([...fromStudents, ...fromPayments])];
  let next = 1;
  while (allUsed.includes(next)) next++;
  return String(next).padStart(3, '0');
}

function getNextTempSerial() {
  const used = allStudents
    .filter(s => s.serial && s.serial.toUpperCase().startsWith('TEMP-'))
    .map(s => parseInt(s.serial.replace(/TEMP-/i, '')))
    .filter(n => !isNaN(n));
  let next = 1;
  while (used.includes(next)) next++;
  return 'TEMP-' + String(next).padStart(4, '0');
}

function sendWhatsAppReminder(studentId) {
  const s = allStudents.find(x => x.id === studentId);
  if (!s || !ownerProfile.whatsapp) return;
  const centre  = ownerProfile.centre_name || 'the centre';
  const due     = ownerProfile.mode === 'recurring' ? calcCycle(s).due : null;
  const message = encodeURIComponent(
    `Hello, this is a reminder from ${centre}.\n\n` +
    `Student: ${s.name}\n` +
    `Outstanding Balance: ${formatNaira(s.balance)}\n` +
    (s.month_number ? `Month: ${s.month_number}\n` : '') +
    (due ? `Due Date: ${fmtDate(due)}\n` : '') +
    `\nPlease make payment${due ? ` by ${fmtDate(due)}` : ''} to keep VIP access active.\n\n` +
    `Payment Details:\n` +
    (ownerProfile.bank_name      ? `Bank: ${ownerProfile.bank_name}\n`         : '') +
    (ownerProfile.account_number ? `Account: ${ownerProfile.account_number}\n` : '') +
    (ownerProfile.account_name   ? `Name: ${ownerProfile.account_name}\n`      : '') +
    `\nThank you.`
  );
  const phone = ownerProfile.whatsapp.replace(/\D/g, '');
  window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
}

function exportPaymentsCSV() {
  const activePayments = allPayments.filter(p => !p.voided);
  if (!activePayments.length) { showToast('No payments to export.', 'error'); return; }
  const headers = ['Student Name', 'Class', 'Amount', 'Method', 'Date', 'Month', 'Serial', 'Login ID / PIN'];
  const rows = activePayments.map(p => {
    const s = allStudents.find(x => x.id === p.student_id);
    return [s ? `"${s.name}"` : '—', s ? (s.class || '—') : '—', p.amount || 0, p.method || '—', p.payment_date || '—', p.month_number || 1, p.serial_at_time || '—', s ? (s.login_id || s.student_pin || '—') : '—'].join(',');
  });
  const csv    = [headers.join(','), ...rows].join('\n');
  const blob   = new Blob([csv], { type: 'text/csv' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  const centre = (ownerProfile.centre_name || 'velune').replace(/\s+/g, '_');
  const today  = new Date().toISOString().split('T')[0];
  a.href = url; a.download = `${centre}_payments_${today}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${activePayments.length} payment records.`, 'success');
}

function exportStudentsCSV() {
  if (!allStudents.length) { showToast('No students to export.', 'error'); return; }
  const isRecurring = ownerProfile.mode === 'recurring';
  const headers = isRecurring
    ? ['Name', 'Class', 'Login ID', 'Total Fee', 'Amount Paid', 'Balance', 'Status', 'VIP', 'Serial', 'Month', 'Cycle Start', 'Due Date']
    : ['Name', 'Class', 'PIN', 'Total Fee', 'Amount Paid', 'Balance', 'Status', 'VIP', 'Serial'];
  const rows = allStudents.map(s => {
    const cycle = isRecurring ? calcCycle(s) : null;
    const base  = [`"${s.name}"`, s.class || '—', s.login_id || s.student_pin || '—', s.total_fee || 0, s.amount_paid || 0, s.balance || 0, s.status || '—', s.vip_active ? (s.temp_vip ? 'Temp' : 'Active') : 'No', s.serial || '—'];
    if (isRecurring) { base.push(s.month_number || 1); base.push(s.cycle_start || '—'); base.push(cycle ? cycle.due : '—'); }
    return base.join(',');
  });
  const csv    = [headers.join(','), ...rows].join('\n');
  const blob   = new Blob([csv], { type: 'text/csv' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  const centre = (ownerProfile.centre_name || 'velune').replace(/\s+/g, '_');
  const today  = new Date().toISOString().split('T')[0];
  a.href = url; a.download = `${centre}_students_${today}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${allStudents.length} student records.`, 'success');
}

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

function showAdminWelcome(adminName, stats) {
  const sessionKey = 'velune_welcomed_admin';
  const onboardKey = 'velune_onboarding_done_' + currentUserId;

  // Show onboarding if no students yet AND not previously dismissed
  const isFirstTime = stats.total === 0

  if (isFirstTime) {
    showOnboarding(adminName);
    return;
  }

  // Regular returning-user welcome (existing logic)
  if (sessionStorage.getItem(sessionKey)) return;
  sessionStorage.setItem(sessionKey, '1');
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (adminName || 'Admin').split(' ')[0];
  const overlay = document.createElement('div');
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






function showOnboarding(adminName) {
  if (document.getElementById('onboardingOverlay')) return;
  const firstName = (adminName || 'Admin').split(' ')[0];
  const centreSet = ownerProfile?.centre_name && ownerProfile.centre_name !== 'My Centre';

  const overlay = document.createElement('div');
  overlay.className = 'welcome-modal-overlay';
  overlay.id = 'onboardingOverlay';
  overlay.innerHTML = `
    <div class="onboarding-modal">
      <div class="onboarding-header">
        <div class="onboarding-logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C9960C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          Velune
        </div>
        <button class="onboarding-skip" onclick="dismissOnboarding(true)">Skip setup</button>
      </div>

      <!-- STEP 1 -->
      <div class="ob-phase" id="ob-phase-1">
        <div class="onboarding-welcome">
          <div class="onboarding-emoji">⚙️</div>
          <h2>Step 1 of 3</h2>
          <p>First, set up your centre name, default fee, and bank details.</p>
        </div>
        <div class="onboarding-steps">
          <div class="onboarding-step">
            <div class="ob-step-num">1</div>
            <div class="ob-step-body">
              <div class="ob-step-title">Set up your centre</div>
              <div class="ob-step-desc">Go to Settings, fill in your details, then hit <strong>Save Settings</strong>. Come back here when done.</div>
              <button class="ob-step-btn" onclick="onboardingGoToSettings()">Open Settings →</button>
            </div>
          </div>
        </div>
        <div class="onboarding-footer">
          <div class="ob-progress"><span class="ob-dot ob-dot-active"></span><span class="ob-dot"></span><span class="ob-dot"></span></div>
          <div class="onboarding-hint">Click "Open Settings", save your details, then this will update automatically.</div>
        </div>
      </div>

      <!-- STEP 2 -->
      <div class="ob-phase" id="ob-phase-2" style="display:none">
        <div class="onboarding-welcome">
          <div class="onboarding-emoji">🎉</div>
          <h2>Step 2 of 3</h2>
          <p>Great! Now add your first student to get started.</p>
        </div>
        <div class="onboarding-steps">
          <div class="onboarding-step">
            <div class="ob-step-num">2</div>
            <div class="ob-step-body">
              <div class="ob-step-title">Add your first student</div>
              <div class="ob-step-desc">Register a student with their name, class, and fee. Their login ID or PIN is generated automatically.</div>
              <button class="ob-step-btn" onclick="onboardingAddStudent()">Add First Student →</button>
            </div>
          </div>
        </div>
        <div class="onboarding-footer">
          <div class="ob-progress"><span class="ob-dot ob-dot-done"></span><span class="ob-dot ob-dot-active"></span><span class="ob-dot"></span></div>
          <div class="onboarding-hint">After adding the student, come back here for the final step.</div>
        </div>
      </div>

      <!-- STEP 3 -->
      <div class="ob-phase" id="ob-phase-3" style="display:none">
        <div class="onboarding-welcome">
          <div class="onboarding-emoji">💳</div>
          <h2>Step 3 of 3</h2>
          <p>Almost there! Record your first payment to activate VIP for that student.</p>
        </div>
        <div class="onboarding-steps">
          <div class="onboarding-step">
            <div class="ob-step-num">3</div>
            <div class="ob-step-body">
              <div class="ob-step-title">Record their first payment</div>
              <div class="ob-step-desc">Go to the <strong>Students</strong> tab, find the student, and click the <strong>Pay</strong> button next to their name.</div>
              <button class="ob-step-btn" onclick="onboardingGoToStudents()">Go to Students →</button>
            </div>
          </div>
        </div>
        <div class="onboarding-footer">
          <div class="ob-progress"><span class="ob-dot ob-dot-done"></span><span class="ob-dot ob-dot-done"></span><span class="ob-dot ob-dot-active"></span></div>
          <div class="onboarding-hint">Once payment is recorded, setup is complete!</div>
        </div>
      </div>

      <!-- DONE -->
      <div class="ob-phase" id="ob-phase-done" style="display:none">
        <div class="onboarding-welcome" style="padding-bottom:24px">
          <div class="onboarding-emoji">✅</div>
          <h2>You're all set!</h2>
          <p>Your centre is live. Students are registered and payments are being tracked.</p>
        </div>
        <div class="onboarding-footer">
          <div class="ob-progress"><span class="ob-dot ob-dot-done"></span><span class="ob-dot ob-dot-done"></span><span class="ob-dot ob-dot-done"></span></div>
          <button class="onboarding-done-btn" onclick="dismissOnboarding(true)">Go to Dashboard →</button>
        </div>
      </div>

    </div>`;

  document.body.appendChild(overlay);

  // Start on correct phase
  if (centreSet) {
    onboardingSetPhase(2);
  }
}

function onboardingSetPhase(num) {
  [1, 2, 3, 'done'].forEach(p => {
    const el = document.getElementById('ob-phase-' + p);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById('ob-phase-' + num);
  if (target) target.style.display = '';
}

function onboardingGoToSettings() {
  document.getElementById('onboardingOverlay').remove();
  showSection('settings', document.querySelector('.nav-item.danger-nav'));

  const originalSave = window.saveSettings;
  window.saveSettings = async function() {
    await originalSave();
    window.saveSettings = originalSave;
    showToast('✓ Centre settings saved! Moving to next step…', 'success');
    showOnboarding(ownerProfile?.centre_name || 'Admin');
    onboardingSetPhase(2);
  };
}

function onboardingAddStudent() {
  // Close overlay, open add student modal, watch for student being added
  document.getElementById('onboardingOverlay').remove();
  openModal('addStudentModal');

  const originalAdd = window.addStudent;
  window.addStudent = async function() {
    await originalAdd();
    window.addStudent = originalAdd; // restore original
    // Only advance if a student was actually added
    if (allStudents.length > 0) {
      showOnboarding(ownerProfile?.centre_name || 'Admin');
      onboardingSetPhase(3);
    }
  };
}

function onboardingGoToStudents() {
  dismissOnboarding(true);
  showSection('students', document.querySelector('.nav-item[onclick*="students"]'));
}

function dismissOnboarding(permanent = false) {
  if (permanent) {
    localStorage.setItem('velune_onboarding_done_' + currentUserId, '1');
  }
  const el = document.getElementById('onboardingOverlay');
  if (el) {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s ease';
    setTimeout(() => el.remove(), 260);
  }
}

function dismissOnboarding() {
  localStorage.setItem('velune_onboarding_done_' + currentUserId, '1');
  const el = document.getElementById('onboardingOverlay');
  if (el) {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s ease';
    setTimeout(() => el.remove(), 260);
  }
}

function showAccessBanner(html, bgColor) {
  const banner = document.createElement('div');
  banner.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9999;background:${bgColor};color:white;text-align:center;padding:10px 20px;font-size:0.85rem;font-weight:600;display:flex;align-items:center;justify-content:center;gap:12px;font-family:'DM Sans',sans-serif;box-shadow:0 2px 12px rgba(0,0,0,0.2);`;
  banner.innerHTML = html + `<button onclick="this.parentElement.remove();document.body.style.paddingTop=''" style="background:none;border:none;color:white;cursor:pointer;margin-left:8px;font-size:1rem;flex-shrink:0">✕</button>`;
  document.body.style.paddingTop = '44px';
  document.body.insertBefore(banner, document.body.firstChild);
}





















































