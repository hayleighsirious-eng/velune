-- ============================================================
--  EDULEDGER — MULTI-TENANT DATABASE SETUP
--  Run this in: Supabase Dashboard → SQL Editor → New Query
--
--  This supports BOTH modes:
--    recurring  = 360 Academy style (monthly cycles + countdown)
--    one_time   = Zenith style (one-time payment, no countdown)
--
--  Each admin gets their OWN isolated data via owner_id (RLS).
-- ============================================================

-- ============================================================
--  1. USER PROFILES TABLE
--  Stores each admin's centre settings (name, mode, fee, etc.)
-- ============================================================
create table if not exists profiles (
  id            uuid references auth.users(id) on delete cascade primary key,
  centre_name   text not null default 'My Tutorial Centre',
  mode          text not null default 'recurring',  -- 'recurring' | 'one_time'
  default_fee   numeric default 0,
  whatsapp      text,
  bank_name     text,
  account_number text,
  account_name  text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, centre_name, mode)
  values (new.id, 'My Tutorial Centre', coalesce(new.raw_user_meta_data->>'mode', 'recurring'))
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ============================================================
--  2. STUDENTS TABLE
-- ============================================================
create table if not exists students (
  id                 uuid default gen_random_uuid() primary key,
  owner_id           uuid references auth.users(id) on delete cascade not null,
  name               text not null,
  class              text,
  email              text,
  total_fee          numeric default 0,
  amount_paid        numeric default 0,
  balance            numeric default 0,
  payment_method     text,
  status             text default 'partial',   -- 'paid' | 'partial'
  serial             text,
  serial_active      boolean default false,
  login_id           text unique,              -- STU-XXXXXX for recurring mode
  student_pin        text,                     -- 4-digit PIN for one-time mode
  vip_active         boolean default false,
  temp_vip           boolean default false,
  cycle_start        date,
  month_number       integer default 1,
  paused             boolean default false,
  pause_reason       text,
  paused_at          timestamptz,
  is_vip             boolean default false,
  vip_type           text,
  temp_serial        text,
  name_lower         text,
  photo_url          text,
  notes              text,
  enrollment_date    date,
  first_payment_date date,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- ============================================================
--  3. PAYMENTS TABLE
-- ============================================================
create table if not exists payments (
  id              uuid default gen_random_uuid() primary key,
  owner_id        uuid references auth.users(id) on delete cascade not null,
  student_id      uuid references students(id) on delete cascade,
  amount          numeric not null,
  method          text,
  payment_date    date,
  serial_at_time  text,
  month_number    integer,
  created_at      timestamptz default now()
);

-- ============================================================
--  4. SERIAL HISTORY TABLE
-- ============================================================
create table if not exists serial_history (
  id          uuid default gen_random_uuid() primary key,
  owner_id    uuid references auth.users(id) on delete cascade not null,
  student_id  uuid references students(id) on delete cascade,
  old_serial  text,
  new_serial  text,
  revoked_at  timestamptz default now()
);


-- ============================================================
--  5. AUTO-UPDATE updated_at
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists students_updated_at on students;
create trigger students_updated_at
  before update on students
  for each row execute function update_updated_at();

drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at();


-- ============================================================
--  6. ROW LEVEL SECURITY — Each user sees ONLY their own data
-- ============================================================
alter table profiles       enable row level security;
alter table students       enable row level security;
alter table payments       enable row level security;
alter table serial_history enable row level security;

-- Drop old policies first
drop policy if exists "Users manage own profile"   on profiles;
drop policy if exists "Users manage own students"  on students;
drop policy if exists "Users manage own payments"  on payments;
drop policy if exists "Users manage own serial_history" on serial_history;
drop policy if exists "Allow anon select"          on students;
drop policy if exists "Allow anon select payments" on payments;
drop policy if exists "Allow authenticated users"  on students;
drop policy if exists "Allow authenticated users"  on payments;
drop policy if exists "Allow authenticated users"  on serial_history;

-- Profiles: owner only
create policy "Users manage own profile" on profiles
  for all using (auth.uid() = id);

-- Students: owner only (for admin dashboard)
create policy "Users manage own students" on students
  for all using (auth.uid() = owner_id);

-- Payments: owner only
create policy "Users manage own payments" on payments
  for all using (auth.uid() = owner_id);

-- Serial history: owner only
create policy "Users manage own serial_history" on serial_history
  for all using (auth.uid() = owner_id);

-- Student portal (anon) — can only read their own row by login_id / student_pin
-- We allow anon reads on students; JS code filters by login_id or name+pin
create policy "Allow anon student read" on students
  for select using (true);

create policy "Allow anon payment read" on payments
  for select using (true);

create policy "Allow anon profile read" on profiles
  for select using (true);


-- ============================================================
--  DONE!
--  Next steps:
--  1. Go to supabase.com → Authentication → Users → Invite user
--     (this is NO LONGER needed — users register themselves now)
--  2. Open supabase.js and paste your Project URL + Anon Key
--  3. Deploy your files and open index.html
-- ============================================================
