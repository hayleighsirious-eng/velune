# EduLedger — Multi-Tenant Tutorial Centre Payment Manager
## Setup Guide

---

## YOUR FILES:
- `index.html`      — Landing page (Sign Up / Sign In / Student Login)
- `admin.html`      — Admin dashboard
- `student.html`    — Student portal
- `supabase.js`     — **YOUR SUPABASE KEYS GO HERE**
- `style.css`       — Styling (do not edit)
- `student-mobile.css` — Mobile styles
- `admin.js`        — Admin logic
- `database.sql`    — Run this ONCE in your new Supabase project

---

## STEP 1 — Create a New Supabase Project
1. Go to **supabase.com** → Sign in
2. Click **"New project"**
3. Give it a name, set a database password, choose a region
4. Wait ~2 minutes for it to start

---

## STEP 2 — Run the Database Setup
1. In your Supabase project → click **"SQL Editor"** → **"New query"**
2. Open `database.sql`, copy ALL the text
3. Paste it into the SQL editor and click **"Run"**
4. You should see "Success"

---

## STEP 3 — Paste Your API Keys
1. In Supabase → **Settings** (gear icon) → **API**
2. Copy your **Project URL** and **anon public key**
3. Open `supabase.js` in a text editor
4. Replace:
   - `PASTE_YOUR_PROJECT_URL_HERE` → your Project URL
   - `PASTE_YOUR_ANON_KEY_HERE`    → your anon key
5. Save the file

---

## STEP 4 — Enable Email Confirmations (Optional)
By default Supabase requires email confirmation on signup.
To skip this during testing:
- Supabase → **Authentication** → **Email** → Turn OFF **"Confirm email"**

---

## STEP 5 — Deploy
Push all files to GitHub, then:
- Go to **Netlify** or **Vercel** → connect your GitHub repo
- Deploy — your site will be live in minutes

Or just open `index.html` in a browser to test locally.

---

## HOW IT WORKS

### Sign Up (Admin / Centre Owner)
1. Open your deployed site
2. Click **"Create Account"**
3. Enter your centre name, email, password
4. Choose your mode:
   - **Recurring** = monthly cycles with 30-day countdown, VIP access, alerts
   - **One-Time** = single payment tracking, no timers
5. Click Create — you're in!

### Multiple Centres
Every admin who registers gets their own completely isolated data.
Nobody can see another centre's students or payments. Ever.

### Student Login
- **Recurring mode**: Students log in with their Login ID (e.g. STU-AB12CD)
- **One-time mode**: Students log in with their Name + 4-digit PIN
- Both options are shown on the login page with a toggle

### Bank Account Details
Go to **Settings** in your admin dashboard and fill in:
- Bank name, Account number, Account name, WhatsApp number

These will automatically show to your students when they owe money.
No more editing code to change bank details!

---

## TROUBLESHOOTING

**"Invalid login credentials"** → Check your email and password. Use Forgot Password to reset.

**Student can't log in** → Make sure you copied the Login ID/PIN exactly as shown when you added them.

**Bank details not showing to students** → Fill them in under Settings → Save Settings.

**Data not loading** → Check your Supabase URL and anon key in `supabase.js`.
