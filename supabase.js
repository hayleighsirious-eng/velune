// ============================================================
//  EDULEDGER — SUPABASE CONFIG  (supabase.js)
//  Paste your Supabase Project URL and anon key below.
//  Get them from: supabase.com → Your Project → Settings → API
// ============================================================

const SUPABASE_URL  = 'https://cbsoztcgnzhetgalalil.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNic296dGNnbnpoZXRnYWxhbGlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODYzNTQsImV4cCI6MjA5MDk2MjM1NH0.PrdwDAJxSs-ygmIT6ew_TpxvAlHqged1V4mmje15CaI';

// Cycle & alert settings (used across the app)
const CYCLE_DAYS = 0.00347; // 5 minutes
const ALERT_DAYS = 0.00247;

// Shared Supabase client — window.supabase must be loaded from CDN before this file
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

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

function calcCycle(student) {
  if (!student || !student.cycle_start) {
    return { daysLeft: 0, pct: 0, due: null, expired: true };
  }
  const start   = new Date(student.cycle_start);
  const due     = new Date(start.getTime() + CYCLE_DAYS * 86400000);
  const now     = new Date();
  const msLeft  = due - now;
  const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));
  const pct     = Math.min(100, Math.max(0, (msLeft / (CYCLE_DAYS * 86400000)) * 100));
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
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(function() { toast.remove(); }, 300);
  }, 3500);
}

function openModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

document.addEventListener('click', function(e) {
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
//  Add this to the BOTTOM of your supabase.js file
// ============================================================

// Your secret salt — CHANGE THIS to something random only you know
// e.g. 'velune2024xk9mq' — just mash your keyboard
const LICENSE_SALT = 'velune2024xk9mq';

// How many days a license code gives (30 days)
const LICENSE_DAYS = 30;

// ── Check if user has access ─────────────────────────────────
// Returns: { allowed: true/false, daysLeft: number, reason: string }
function checkAccess(userId) {
  // 1. Check free trial first
  const trialKey  = 'velune_trial_' + userId;
  const trialData = localStorage.getItem(trialKey);

  if (!trialData) {
    // First time ever — start their 30-day free trial now
    const trialEnd = Date.now() + (300000); // 5 minutes
    localStorage.setItem(trialKey, JSON.stringify({ end: trialEnd, started: Date.now() }));
    const daysLeft = 30;
    return { allowed: true, daysLeft, reason: 'trial' };
  }

  const trial    = JSON.parse(trialData);
  const trialEnd = trial.end;
  const now      = Date.now();

  if (now < trialEnd) {
    const daysLeft = Math.ceil((trialEnd - now) / 86400000);
    return { allowed: true, daysLeft, reason: 'trial' };
  }

  // 2. Trial expired — check for active license
  const licenseKey  = 'velune_license_' + userId;
  const licenseData = localStorage.getItem(licenseKey);

  if (!licenseData) {
    return { allowed: false, daysLeft: 0, reason: 'expired' };
  }

  const license = JSON.parse(licenseData);
  if (now < license.end) {
    const daysLeft = Math.ceil((license.end - now) / 86400000);
    return { allowed: true, daysLeft, reason: 'licensed' };
  }

  return { allowed: false, daysLeft: 0, reason: 'license_expired' };
}

// ── Validate and activate a license code ─────────────────────
// Returns: { success: true/false, message: string }
async function activateLicense(userId, code) {
  code = code.trim().toUpperCase();

  // A valid code looks like: VLN-XXXXXXXX-YYYYMMDD
  // where XXXXXXXX is a hash of (userId + date + salt)
  // and   YYYYMMDD is the issue date

  const parts = code.split('-');
  if (parts.length !== 3 || parts[0] !== 'VLN') {
    return { success: false, message: 'Invalid code format. Codes look like VLN-XXXXXXXX-YYYYMMDD' };
  }

  const hashPart = parts[1];
  const datePart = parts[2];

  // Parse issue date
  if (datePart.length !== 8) {
    return { success: false, message: 'Invalid code. Please check and try again.' };
  }
  const year  = parseInt(datePart.substring(0, 4));
  const month = parseInt(datePart.substring(4, 6)) - 1;
  const day   = parseInt(datePart.substring(6, 8));
  const issueDate = new Date(year, month, day);

  if (isNaN(issueDate.getTime())) {
    return { success: false, message: 'Invalid code date.' };
  }

  // Code expires 7 days after issue (so admin can't reuse old codes)
  const codeExpiry = new Date(issueDate.getTime() + 7 * 86400000);
  if (new Date() > codeExpiry) {
    return { success: false, message: 'This code has expired. Please contact your admin for a new one.' };
  }

  // Verify the hash
  const expectedHash = await makeHash(userId + datePart + LICENSE_SALT);
  if (hashPart !== expectedHash) {
    return { success: false, message: 'Invalid code. Please double-check it and try again.' };
  }

  // Check if already used (store used codes)
  const usedKey   = 'velune_used_codes_' + userId;
  const usedCodes = JSON.parse(localStorage.getItem(usedKey) || '[]');
  if (usedCodes.includes(code)) {
    return { success: false, message: 'This code has already been used.' };
  }

  // All good — activate!
  const now        = Date.now();
  const licenseEnd = now + (LICENSE_DAYS * 86400000);

  localStorage.setItem('velune_license_' + userId, JSON.stringify({
    code, end: licenseEnd, activated: now
  }));

  // Mark code as used
  usedCodes.push(code);
  localStorage.setItem(usedKey, JSON.stringify(usedCodes));

  return { success: true, message: 'Activated! Your access is extended by 30 days.' };
}

// ── Hash function (SHA-256 via Web Crypto) ───────────────────
async function makeHash(str) {
  const buf    = new TextEncoder().encode(str);
  const hash   = await crypto.subtle.digest('SHA-256', buf);
  const arr    = Array.from(new Uint8Array(hash));
  const hex    = arr.map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.substring(0, 8).toUpperCase(); // first 8 chars
}