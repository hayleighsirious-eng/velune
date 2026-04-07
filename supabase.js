// ============================================================
//  VELUNE — SUPABASE CONFIG  (supabase.js)
// ============================================================

const SUPABASE_URL  = 'https://cbsoztcgnzhetgalalil.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNic296dGNnbnpoZXRnYWxhbGlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODYzNTQsImV4cCI6MjA5MDk2MjM1NH0.PrdwDAJxSs-ygmIT6ew_TpxvAlHqged1V4mmje15CaI';

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
//  VELUNE — LICENSE ACTIVATION (Secure — via Edge Function)
//  The salt, hash logic and plan types are all on the server.
//  Nothing sensitive is exposed in the browser.
// ============================================================

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
  try {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) return { success: false, message: 'Not logged in.' };

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/validate-license`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ licenseKey: code, userId: userId })
      }
    );

    const result = await response.json();

    if (result.valid) {
      return { success: true, message: result.message };
    }

    return { success: false, message: result.message || 'Invalid code.' };

  } catch (err) {
    return { success: false, message: 'Connection error. Please try again.' };
  }
}