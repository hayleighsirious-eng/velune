// ============================================================
//  VELUNE — SUPABASE CONFIG  (supabase.js)
// ============================================================

const SUPABASE_URL  = 'https://cbsoztcgnzhetgalalil.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNic296dGNnbnpoZXRnYWxhbGlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODYzNTQsImV4cCI6MjA5MDk2MjM1NH0.PrdwDAJxSs-ygmIT6ew_TpxvAlHqged1V4mmje15CaI';

// ── Cycle & alert settings ─────────────────────────────────
// TESTING: set to 1 day so you have time to test without it expiring instantly.
// Change to 30 and 5 for production (real students).
const CYCLE_DAYS = 1;  // ← change to 30 for production
const ALERT_DAYS = 0.5; // ← change to 5 for production

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Utility functions ──────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatNaira(n) {
  const num = parseFloat(n) || 0;
  return '₦' + num.toLocaleString('en-NG', { minimumFractionDigits: 0 });
}

// FIX: parse cycle_start as LOCAL time using 'T00:00:00' suffix
// Without this fix, '2026-04-06' gets parsed as UTC midnight which is
// 1:00 AM Nigeria time — causing cycles to expire 1 hour early
function calcCycle(student) {
  if (!student || !student.cycle_start) {
    return { daysLeft: 0, pct: 0, due: null, expired: true };
  }
  const start    = new Date(student.cycle_start + 'T00:00:00');
  const due      = new Date(start.getTime() + CYCLE_DAYS * 86400000);
  const now      = new Date();
  const msLeft   = due - now;
  const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));
  const pct      = Math.min(100, Math.max(0, (msLeft / (CYCLE_DAYS * 86400000)) * 100));
  return { daysLeft, pct: Math.round(pct), due, expired: msLeft <= 0 };
}

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container') || document.getElementById('toast');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  toast.innerHTML = '<span style="font-size:1rem">' + (icons[type] || 'ℹ') + '</span> ' + message;
  container.appendChild(toast);
  setTimeout(function () {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(function () { toast.remove(); }, 300);
  }, 3500);
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

document.addEventListener('click', function (e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

function showErr(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

// ============================================================
//  VELUNE — LICENSE KEY SYSTEM
// ============================================================

const LICENSE_SALT = 'velune2024xk9mq';
const LICENSE_DAYS = 30;

async function checkAccess(userId) {
  const { data: profile, error } = await _supabase
    .from('profiles')
    .select('trial_end, license_end, lifetime_access')
    .eq('id', userId)
    .single();

  if (error || !profile) return { allowed: false, daysLeft: 0, reason: 'no_profile' };

  const now = Date.now();

  // Lifetime access — never expires
  if (profile.lifetime_access) {
    return { allowed: true, daysLeft: 99999, reason: 'lifetime' };
  }

  if (profile.license_end && now < profile.license_end) {
    const daysLeft = Math.ceil((profile.license_end - now) / 86400000);
    return { allowed: true, daysLeft, reason: 'licensed' };
  }

  if (!profile.trial_end) {
    const trialEnd = now + (1 * 86400000);
    await _supabase.from('profiles').update({ trial_end: trialEnd }).eq('id', userId);
    return { allowed: true, daysLeft: 30, reason: 'trial' };
  }

  if (now < profile.trial_end) {
    const daysLeft = Math.ceil((profile.trial_end - now) / 86400000);
    return { allowed: true, daysLeft, reason: 'trial' };
  }

  return { allowed: false, daysLeft: 0, reason: 'expired' };
}

async function activateLicense(userId, code) {
  code = code.trim().toUpperCase();
  const parts = code.split('-');

  // Support VLN-M/Y/L-HASH-DATE (4 parts) and legacy VLN-HASH-DATE (3 parts)
  let planType, hashPart, datePart;
  if (parts.length === 4 && parts[0] === 'VLN' && ['M','Y','L'].includes(parts[1])) {
    planType = parts[1]; hashPart = parts[2]; datePart = parts[3];
  } else if (parts.length === 3 && parts[0] === 'VLN') {
    planType = 'M'; hashPart = parts[1]; datePart = parts[2]; // legacy = monthly
  } else {
    return { success: false, message: 'Invalid code format.' };
  }

  if (datePart.length !== 8) return { success: false, message: 'Invalid code date.' };

  const year = parseInt(datePart.substring(0,4));
  const month = parseInt(datePart.substring(4,6)) - 1;
  const day = parseInt(datePart.substring(6,8));
  const issueDate = new Date(year, month, day);
  if (isNaN(issueDate.getTime())) return { success: false, message: 'Invalid code date.' };

  const codeExpiry = new Date(issueDate.getTime() + 7 * 86400000);
  if (new Date() > codeExpiry) return { success: false, message: 'This code has expired. Please contact admin for a new one.' };

  const expectedHash = await makeHash(userId + planType + datePart + LICENSE_SALT);
  if (hashPart !== expectedHash) return { success: false, message: 'Invalid code. Please double-check it and try again.' };

  const { data: profile } = await _supabase
    .from('profiles').select('used_codes, license_end, lifetime_access').eq('id', userId).single();

  const usedCodes = profile?.used_codes || [];
  if (usedCodes.includes(code)) return { success: false, message: 'This code has already been used.' };

  const now = Date.now();
  const currentEnd = (profile?.license_end && profile.license_end > now) ? profile.license_end : now;

  let updates = {};
  let successMsg = '';

  if (planType === 'L') {
    updates.lifetime_access = true;
    updates.license_end = null;
    successMsg = 'Lifetime access activated! Your dashboard never expires.';
  } else {
    const days = planType === 'Y' ? 365 : 30;
    updates.license_end = currentEnd + (days * 86400000);
    successMsg = planType === 'Y'
      ? 'Yearly plan activated! Access extended by 365 days.'
      : 'Monthly plan activated! Access extended by 30 days.';
  }

  usedCodes.push(code);
  updates.used_codes = usedCodes;

  await _supabase.from('profiles').update(updates).eq('id', userId);
  return { success: true, message: successMsg };
}

async function makeHash(str) {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const arr  = Array.from(new Uint8Array(hash));
  const hex  = arr.map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.substring(0, 8).toUpperCase();
}