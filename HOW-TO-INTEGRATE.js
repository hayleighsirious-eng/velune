// ============================================================
//  STEP 1 — Add this to the BOTTOM of your supabase.js
//  (copy everything from license-system.js and paste it there)
// ============================================================


// ============================================================
//  STEP 2 — In admin.js, REPLACE your boot() function
//  with this one:
// ============================================================

(async function boot() {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { window.location.href = './index.html'; return; }

  currentUserId = session.user.id;

  // ── ACCESS CHECK ──────────────────────────────────────────
  const access = checkAccess(currentUserId);

  if (!access.allowed) {
    // No trial, no valid license → go to activation page
    window.location.href = './activate.html';
    return;
  }

  // Show trial warning banner if trial ends in 5 days or less
  if (access.reason === 'trial' && access.daysLeft <= 5) {
    showAccessBanner(
      `⚠️ Free trial ends in <strong>${access.daysLeft} day${access.daysLeft !== 1 ? 's' : ''}</strong>. ` +
      `<a href="./activate.html" style="color:white;font-weight:800;text-decoration:underline">Get an activation code →</a>`,
      '#B7770D'
    );
  }

  // Show license expiry warning if license ends in 5 days or less
  if (access.reason === 'licensed' && access.daysLeft <= 5) {
    showAccessBanner(
      `⚠️ Your access expires in <strong>${access.daysLeft} day${access.daysLeft !== 1 ? 's' : ''}</strong>. ` +
      `<a href="./activate.html" style="color:white;font-weight:800;text-decoration:underline">Renew now →</a>`,
      '#C0392B'
    );
  }
  // ── END ACCESS CHECK ──────────────────────────────────────

  // Load profile
  const { data: profile } = await _supabase
    .from('profiles').select('*').eq('id', currentUserId).single();

  if (!profile) {
    await _supabase.from('profiles').insert([{ id: currentUserId }]);
    ownerProfile = { id: currentUserId, centre_name: 'My Centre', mode: 'recurring' };
  } else {
    ownerProfile = profile;
  }

  // Set UI
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
    ? '🔄 Recurring (Monthly Cycles)' : '✅ One-Time Payment';

  await loadAll();
  if (ownerProfile.mode === 'recurring') await runAutoExpire();

  showAdminWelcome(centreName, {
    total: allStudents.length,
    vip:   allStudents.filter(s => s.vip_active).length,
    owing: allStudents.filter(s => s.balance > 0).length
  });
})();


// ============================================================
//  STEP 3 — Also add this helper function to admin.js
//  (paste it anywhere near the bottom of the file)
// ============================================================

function showAccessBanner(html, bgColor) {
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: ${bgColor};
    color: white; text-align: center;
    padding: 10px 20px; font-size: 0.85rem; font-weight: 600;
    display: flex; align-items: center; justify-content: center; gap: 12px;
    font-family: 'DM Sans', sans-serif;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
  `;
  banner.innerHTML = html + `
    <button onclick="this.parentElement.remove();document.body.style.paddingTop=''"
      style="background:none;border:none;color:white;cursor:pointer;margin-left:8px;font-size:1rem;flex-shrink:0">✕</button>
  `;
  document.body.style.paddingTop = '44px';
  document.body.insertBefore(banner, document.body.firstChild);
}


// ============================================================
//  STEP 4 — Changes to make in your project:
//
//  1. Add license-system.js contents to BOTTOM of supabase.js
//  2. Replace boot() in admin.js with the one above
//  3. Add showAccessBanner() function to admin.js
//  4. Add activate.html to your project folder
//  5. Add codegen.html to your project folder (keep it private!)
//
//  In codegen.html, change these 3 values:
//    GATE_PASSWORD = 'your-own-secret-password'
//    LICENSE_SALT  = 'velune2024xk9mq'  ← must match supabase.js
//    YOUR_WHATSAPP = 'your-whatsapp-number'
//
//  In activate.html, change:
//    YOUR_WHATSAPP = 'your-whatsapp-number'
//
// ============================================================
