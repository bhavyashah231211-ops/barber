-- CBSystem Barber & Salon — multi-tenant schema (tables prefixed sl_ so it can share a Supabase project).
-- Run once in Supabase > SQL Editor. Safe to re-run.
-- Then: Authentication > Providers > Email: keep "Confirm email" ON (staff invites and customer matching rely on it).
--       Authentication > URL Configuration: add your site URL plus /admin/, /staff/ and /customer/ to Redirect URLs.
-- You (platform owner): insert into sl_platform_admins values ('<your auth user id>');
--       select sl_set_plan('<business id>','pro','active');   -- plans: trial | starter | pro

create extension if not exists btree_gist with schema extensions;
do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net unavailable: webhooks disabled'; end $$;

-- ───────────────────────── tables ─────────────────────────
create table if not exists sl_businesses(
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  name text not null check (length(name) between 2 and 80),
  owner_id uuid not null references auth.users(id) on delete restrict,
  currency text not null default '£' check (length(currency) between 1 and 4),
  timezone text not null default 'Europe/London',
  slot_minutes int not null default 15 check (slot_minutes in (5,10,15,20,30,60)),
  min_notice_minutes int not null default 60 check (min_notice_minutes >= 0),
  cancel_notice_hours int not null default 24 check (cancel_notice_hours >= 0),
  accent text not null default '#2dd4a0' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  phone text, address text,
  plan text not null default 'trial' check (plan in ('trial','starter','pro')),
  sub_status text not null default 'trial' check (sub_status in ('trial','active','past_due','cancelled')),
  trial_ends_at timestamptz not null default now() + interval '30 days',
  max_staff int not null default 3 check (max_staff >= 1),
  max_branches int not null default 1 check (max_branches >= 1),
  created_at timestamptz not null default now());

create table if not exists sl_branches(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references sl_businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 80), address text, phone text,
  active boolean not null default true, created_at timestamptz not null default now(),
  unique (id, business_id));

create table if not exists sl_profiles(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references sl_businesses(id) on delete cascade,
  role text not null check (role in ('admin','staff','customer')),
  full_name text not null default '', email text, phone text,
  created_at timestamptz not null default now(),
  unique (user_id, business_id), unique (id, business_id));

create table if not exists sl_staff(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references sl_businesses(id) on delete cascade,
  branch_id uuid not null,
  profile_id uuid unique,
  name text not null check (length(name) between 1 and 80),
  email text, phone text, title text, bio text,
  color text not null default '#2dd4a0' check (color ~ '^#[0-9a-fA-F]{6}$'),
  active boolean not null default true, created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (branch_id, business_id) references sl_branches(id, business_id),
  foreign key (profile_id, business_id) references sl_profiles(id, business_id) on delete set null (profile_id));
create unique index if not exists sl_staff_email_u on sl_staff(business_id, lower(email)) where email is not null;

create table if not exists sl_customers(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references sl_businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null check (length(full_name) between 1 and 80),
  email text, phone text, notes text,
  created_at timestamptz not null default now(),
  unique (id, business_id));
create unique index if not exists sl_customers_user_u on sl_customers(business_id, user_id) where user_id is not null;
create index if not exists sl_customers_email_i on sl_customers(business_id, lower(email));

create table if not exists sl_services(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references sl_businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 80), category text, description text,
  price numeric(10,2) not null check (price >= 0),
  duration_min int not null check (duration_min between 5 and 720),
  active boolean not null default true, created_at timestamptz not null default now(),
  unique (id, business_id));

create table if not exists sl_staff_services(
  staff_id uuid not null, service_id uuid not null, business_id uuid not null,
  primary key (staff_id, service_id),
  foreign key (staff_id, business_id) references sl_staff(id, business_id) on delete cascade,
  foreign key (service_id, business_id) references sl_services(id, business_id) on delete cascade);

create table if not exists sl_business_hours(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null, branch_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  open_time time not null default '09:00', close_time time not null default '18:00',
  is_closed boolean not null default false,
  unique (branch_id, weekday),
  check (is_closed or close_time > open_time),
  foreign key (branch_id, business_id) references sl_branches(id, business_id) on delete cascade);

create table if not exists sl_staff_availability(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null, staff_id uuid not null,
  kind text not null check (kind in ('work','break','holiday')),
  weekday smallint check (weekday between 0 and 6),            -- null on a break = every day
  start_time time, end_time time, start_date date, end_date date, note text,
  foreign key (staff_id, business_id) references sl_staff(id, business_id) on delete cascade,
  check ((kind in ('work','break') and start_time is not null and end_time > start_time and start_date is null and end_date is null and (kind = 'break' or weekday is not null))
      or (kind = 'holiday' and start_date is not null and end_date >= start_date and weekday is null and start_time is null and end_time is null)));
create index if not exists sl_avail_staff_i on sl_staff_availability(staff_id, kind);

create table if not exists sl_bookings(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null, branch_id uuid not null,
  customer_id uuid, guest_name text,
  staff_id uuid not null, service_id uuid not null,
  starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked','confirmed','in_progress','completed','cancelled','no_show')),
  source text not null default 'staff' check (source in ('online','staff','walk_in')),
  price numeric(10,2) not null check (price >= 0),
  notes text check (length(notes) <= 500), cancel_reason text, cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  check (ends_at > starts_at),
  foreign key (branch_id, business_id) references sl_branches(id, business_id),
  foreign key (staff_id, business_id) references sl_staff(id, business_id),
  foreign key (service_id, business_id) references sl_services(id, business_id),
  foreign key (customer_id, business_id) references sl_customers(id, business_id),
  -- database-level double-booking guard: one staff member cannot have two live bookings that overlap
  constraint sl_no_overlap exclude using gist (staff_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('booked','confirmed','in_progress')));
create index if not exists sl_bookings_biz_time_i on sl_bookings(business_id, starts_at);
create index if not exists sl_bookings_cust_i on sl_bookings(customer_id, starts_at);
create index if not exists sl_bookings_staff_i on sl_bookings(staff_id, starts_at);

create table if not exists sl_payments(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null, booking_id uuid not null,
  kind text not null check (kind in ('payment','deposit','refund')),
  method text not null check (method in ('cash','card')),
  amount numeric(10,2) not null check (amount > 0),
  status text not null default 'paid' check (status in ('paid','pending','void')),
  reference text, note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (booking_id, business_id) references sl_bookings(id, business_id) on delete cascade);
create index if not exists sl_payments_biz_i on sl_payments(business_id, created_at);
create index if not exists sl_payments_booking_i on sl_payments(booking_id);

create table if not exists sl_products(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references sl_businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 80), sku text,
  price numeric(10,2) not null check (price >= 0), cost numeric(10,2) check (cost >= 0),
  stock int not null default 0 check (stock >= 0), low_stock_at int not null default 3 check (low_stock_at >= 0),
  active boolean not null default true, created_at timestamptz not null default now(),
  unique (id, business_id));
create unique index if not exists sl_products_sku_u on sl_products(business_id, sku) where sku is not null;

create table if not exists sl_product_sales(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null, product_id uuid not null,
  booking_id uuid, customer_id uuid,
  qty int not null check (qty > 0), unit_price numeric(10,2) not null check (unit_price >= 0),
  method text not null check (method in ('cash','card')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (product_id, business_id) references sl_products(id, business_id),
  foreign key (booking_id, business_id) references sl_bookings(id, business_id),
  foreign key (customer_id, business_id) references sl_customers(id, business_id));
create index if not exists sl_sales_biz_i on sl_product_sales(business_id, created_at);

create table if not exists sl_integrations(            -- outbound webhook per business (admin only)
  business_id uuid primary key references sl_businesses(id) on delete cascade,
  webhook_url text check (webhook_url ~ '^https://'),
  webhook_secret text,
  events text[] not null default '{booking.created,booking.cancelled,payment.created}',
  active boolean not null default true);

create table if not exists sl_platform_admins(user_id uuid primary key references auth.users(id) on delete cascade);

-- ───────────────────────── helpers ─────────────────────────
create or replace function sl_role(p_biz uuid) returns text language sql stable security definer set search_path = public as
$$ select role from sl_profiles where user_id = auth.uid() and business_id = p_biz $$;
create or replace function sl_is_staff(p_biz uuid) returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(sl_role(p_biz) in ('admin','staff'), false) $$;
create or replace function sl_is_admin(p_biz uuid) returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(sl_role(p_biz) = 'admin', false) $$;
create or replace function sl_my_customer_id(p_biz uuid) returns uuid language sql stable security definer set search_path = public as
$$ select id from sl_customers where business_id = p_biz and user_id = auth.uid() $$;
create or replace function sl_biz_ok(p_biz uuid) returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select sub_status = 'active' or (sub_status = 'trial' and trial_ends_at > now()) from sl_businesses where id = p_biz), false) $$;

-- customers see staff names only (no email/phone)
create or replace view sl_staff_public as
  select id, business_id, branch_id, name, title, color, bio from sl_staff where active and sl_role(business_id) is not null;

-- per-booking payment status (respects RLS of the caller)
create or replace view sl_booking_payments with (security_invoker = on) as
select t.*, case when t.net_paid > 0 and t.net_paid >= t.price then 'paid' when t.net_paid > 0 then 'partial'
                 when t.refunded > 0 then 'refunded' else 'unpaid' end as pay_status
from (select b.id as booking_id, b.business_id, b.price,
        coalesce(sum(case when p.kind = 'refund' then -p.amount else p.amount end) filter (where p.status = 'paid'), 0) as net_paid,
        coalesce(sum(p.amount) filter (where p.kind = 'refund' and p.status = 'paid'), 0) as refunded
      from sl_bookings b left join sl_payments p on p.booking_id = b.id group by b.id) t;

-- ───────────────────────── triggers ─────────────────────────
create or replace function sl_tg_biz_guard() returns trigger language plpgsql as $$
begin perform now() at time zone new.timezone; return new; end $$;
drop trigger if exists sl_biz_guard on sl_businesses;
create trigger sl_biz_guard before insert or update of timezone on sl_businesses for each row execute function sl_tg_biz_guard();

create or replace function sl_tg_limits() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'sl_staff' and new.active and
     (select count(*) from sl_staff where business_id = new.business_id and active and id <> new.id) >= (select max_staff from sl_businesses where id = new.business_id)
  then raise exception 'Staff limit reached for your plan'; end if;
  if tg_table_name = 'sl_branches' and new.active and
     (select count(*) from sl_branches where business_id = new.business_id and active and id <> new.id) >= (select max_branches from sl_businesses where id = new.business_id)
  then raise exception 'Branch limit reached for your plan'; end if;
  return new;
end $$;
drop trigger if exists sl_limit_staff on sl_staff;
create trigger sl_limit_staff before insert or update of active on sl_staff for each row execute function sl_tg_limits();
drop trigger if exists sl_limit_branches on sl_branches;
create trigger sl_limit_branches before insert or update of active on sl_branches for each row execute function sl_tg_limits();

create or replace function sl_tg_cancel_ts() returns trigger language plpgsql as $$
begin new.cancelled_at := case when new.status = 'cancelled' then coalesce(old.cancelled_at, now()) else null end; return new; end $$;
drop trigger if exists sl_cancel_ts on sl_bookings;
create trigger sl_cancel_ts before update of status on sl_bookings for each row execute function sl_tg_cancel_ts();

create or replace function sl_tg_pay_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare net numeric;
begin
  if new.kind = 'refund' and new.status = 'paid' then
    select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) into net from sl_payments where booking_id = new.booking_id and status = 'paid';
    if new.amount > net then raise exception 'Refund exceeds the amount paid (%)', net; end if;
  end if;
  return new;
end $$;
drop trigger if exists sl_pay_guard on sl_payments;
create trigger sl_pay_guard before insert on sl_payments for each row execute function sl_tg_pay_guard();

create or replace function sl_tg_stock() returns trigger language plpgsql security definer set search_path = public as $$
declare p sl_products%rowtype;
begin
  select * into p from sl_products where id = new.product_id and business_id = new.business_id for update;
  if not found or not p.active then raise exception 'Product not available'; end if;
  if p.stock < new.qty then raise exception 'Only % in stock', p.stock; end if;
  update sl_products set stock = stock - new.qty where id = p.id;
  new.unit_price := p.price;
  return new;
end $$;
drop trigger if exists sl_stock on sl_product_sales;
create trigger sl_stock before insert on sl_product_sales for each row execute function sl_tg_stock();

-- outbound webhooks (needs pg_net; failures never block the booking)
create or replace function sl_fire(p_biz uuid, p_event text, p_data jsonb) returns void language plpgsql security definer set search_path = public as $$
declare i sl_integrations%rowtype; body jsonb;
begin
  select * into i from sl_integrations where business_id = p_biz and active;
  if not found or i.webhook_url is null or not (p_event = any(i.events)) then return; end if;
  body := jsonb_build_object('event', p_event, 'business_id', p_biz, 'data', p_data, 'sent_at', now());
  perform net.http_post(url := i.webhook_url, body := body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cbs-secret', coalesce(i.webhook_secret, '')));
exception when others then null;
end $$;

create or replace function sl_tg_fire() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'sl_bookings' then
    if tg_op = 'INSERT' then
      perform sl_fire(new.business_id, 'booking.created', jsonb_build_object('id', new.id, 'staff_id', new.staff_id, 'service_id', new.service_id, 'customer_id', new.customer_id, 'starts_at', new.starts_at, 'ends_at', new.ends_at, 'status', new.status, 'source', new.source, 'price', new.price));
    elsif new.status = 'cancelled' and old.status <> 'cancelled' then
      perform sl_fire(new.business_id, 'booking.cancelled', jsonb_build_object('id', new.id, 'starts_at', new.starts_at, 'reason', new.cancel_reason));
    end if;
  else
    perform sl_fire(new.business_id, 'payment.created', jsonb_build_object('id', new.id, 'booking_id', new.booking_id, 'kind', new.kind, 'method', new.method, 'amount', new.amount));
  end if;
  return null;
end $$;
drop trigger if exists sl_fire_bookings on sl_bookings;
create trigger sl_fire_bookings after insert or update of status on sl_bookings for each row execute function sl_tg_fire();
drop trigger if exists sl_fire_payments on sl_payments;
create trigger sl_fire_payments after insert on sl_payments for each row execute function sl_tg_fire();

-- ───────────────────────── RPCs ─────────────────────────
create or replace function sl_public_business(p_slug text)
returns table(id uuid, name text, accent text, currency text, phone text, address text, open boolean)
language sql stable security definer set search_path = public as
$$ select b.id, b.name, b.accent, b.currency, b.phone, b.address, sl_biz_ok(b.id) from sl_businesses b where b.slug = lower(trim(p_slug)) $$;

create or replace function sl_create_business(p_name text, p_slug text, p_full_name text, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; br uuid; em text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select email into em from auth.users where id = auth.uid();
  begin
    insert into sl_businesses(slug, name, owner_id, phone) values (lower(trim(p_slug)), trim(p_name), auth.uid(), nullif(trim(p_phone), '')) returning id into bid;
  exception when unique_violation then raise exception 'That web address is already taken';
            when check_violation then raise exception 'Use 2-39 lowercase letters, numbers or dashes for the web address';
  end;
  insert into sl_branches(business_id, name) values (bid, 'Main') returning id into br;
  insert into sl_profiles(user_id, business_id, role, full_name, email, phone)
    values (auth.uid(), bid, 'admin', coalesce(nullif(trim(p_full_name), ''), em, 'Owner'), em, nullif(trim(p_phone), ''));
  insert into sl_business_hours(business_id, branch_id, weekday, open_time, close_time, is_closed)
    select bid, br, d, '09:00', '18:00', d = 0 from generate_series(0, 6) d;
  return bid;
end $$;

create or replace function sl_join_business(p_slug text, p_name text, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid; em text; ok boolean; r text; cid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select id into b from sl_businesses where slug = lower(trim(p_slug));
  if b is null then raise exception 'Business not found'; end if;
  select email, email_confirmed_at is not null into em, ok from auth.users where id = auth.uid();
  insert into sl_profiles(user_id, business_id, role, full_name, email, phone)
    values (auth.uid(), b, 'customer', left(coalesce(nullif(trim(p_name), ''), em, 'Customer'), 80), em, left(nullif(trim(p_phone), ''), 30))
    on conflict (user_id, business_id) do nothing;
  select role into r from sl_profiles where user_id = auth.uid() and business_id = b;
  if r = 'customer' and not exists (select 1 from sl_customers where business_id = b and user_id = auth.uid()) then
    if ok then select id into cid from sl_customers where business_id = b and user_id is null and lower(email) = lower(em) limit 1; end if;
    if cid is not null then update sl_customers set user_id = auth.uid() where id = cid;
    else insert into sl_customers(business_id, user_id, full_name, email, phone)
         values (b, auth.uid(), left(coalesce(nullif(trim(p_name), ''), em, 'Customer'), 80), em, left(nullif(trim(p_phone), ''), 30)); end if;
  end if;
  return b;
end $$;

create or replace function sl_claim_staff() returns int language plpgsql security definer set search_path = public as $$
declare em text; n int := 0; s record; pid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select lower(email) into em from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if em is null then raise exception 'Confirm your email address first'; end if;
  for s in select id, business_id, name from sl_staff where lower(email) = em and profile_id is null and active loop
    insert into sl_profiles(user_id, business_id, role, full_name, email) values (auth.uid(), s.business_id, 'staff', s.name, em)
      on conflict (user_id, business_id) do update set role = case when sl_profiles.role = 'customer' then 'staff' else sl_profiles.role end
      returning id into pid;
    update sl_staff set profile_id = pid where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function sl_update_my_profile(p_business uuid, p_name text, p_phone text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if sl_role(p_business) is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) < 1 then raise exception 'Name is required'; end if;
  update sl_profiles set full_name = left(trim(p_name), 80), phone = left(nullif(trim(p_phone), ''), 30) where user_id = auth.uid() and business_id = p_business;
  update sl_customers set full_name = left(trim(p_name), 80), phone = left(nullif(trim(p_phone), ''), 30) where user_id = auth.uid() and business_id = p_business;
end $$;

-- free start times for a service on a date (business time zone). Customers never see other people's bookings.
create or replace function sl_available_slots(p_business uuid, p_service uuid, p_date date, p_staff uuid default null, p_branch uuid default null, p_exclude uuid default null)
returns table(staff_id uuid, slot_start timestamptz) language plpgsql stable security definer set search_path = public as $$
declare b sl_businesses%rowtype; dur int; br uuid; dow int; earliest timestamptz;
begin
  if sl_role(p_business) is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into b from sl_businesses where id = p_business;
  select duration_min into dur from sl_services where id = p_service and business_id = p_business and active;
  if dur is null then return; end if;
  br := coalesce(p_branch, (select id from sl_branches where business_id = p_business and active order by created_at limit 1));
  dow := extract(dow from p_date)::int;
  earliest := now() + make_interval(mins => b.min_notice_minutes);
  return query
  with hrs as (
    select (p_date + h.open_time) at time zone b.timezone as o, (p_date + h.close_time) at time zone b.timezone as c
    from sl_business_hours h where h.branch_id = br and h.weekday = dow and not h.is_closed),
  st as (
    select s.id from sl_staff s join sl_staff_services ss on ss.staff_id = s.id and ss.service_id = p_service
    where s.business_id = p_business and s.branch_id = br and s.active and (p_staff is null or s.id = p_staff)
      and not exists (select 1 from sl_staff_availability a where a.staff_id = s.id and a.kind = 'holiday' and p_date between a.start_date and a.end_date)),
  win as (
    select st.id as sid, greatest(w.o, hrs.o) as ws, least(w.c, hrs.c) as we
    from st cross join hrs cross join lateral (
      select (p_date + a.start_time) at time zone b.timezone as o, (p_date + a.end_time) at time zone b.timezone as c
        from sl_staff_availability a where a.staff_id = st.id and a.kind = 'work' and a.weekday = dow
      union all
      select hrs.o, hrs.c where not exists (select 1 from sl_staff_availability a where a.staff_id = st.id and a.kind = 'work')) w),
  cand as (
    select win.sid, g as t from win, generate_series(win.ws, win.we - make_interval(mins => dur), make_interval(mins => b.slot_minutes)) g where win.we > win.ws)
  select c.sid, c.t from cand c
  where c.t >= earliest
    and not exists (select 1 from sl_bookings k where k.staff_id = c.sid and k.status in ('booked','confirmed','in_progress')
        and (p_exclude is null or k.id <> p_exclude)
        and tstzrange(k.starts_at, k.ends_at, '[)') && tstzrange(c.t, c.t + make_interval(mins => dur), '[)'))
    and not exists (select 1 from sl_staff_availability a where a.staff_id = c.sid and a.kind = 'break' and (a.weekday is null or a.weekday = dow)
        and tstzrange((p_date + a.start_time) at time zone b.timezone, (p_date + a.end_time) at time zone b.timezone, '[)') && tstzrange(c.t, c.t + make_interval(mins => dur), '[)'))
  order by c.t, c.sid;
end $$;

create or replace function sl_book(p_business uuid, p_service uuid, p_start timestamptz, p_staff uuid default null, p_customer uuid default null,
                                   p_guest text default null, p_notes text default null, p_walk_in boolean default false, p_branch uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r text := sl_role(p_business); b sl_businesses%rowtype; s sl_services%rowtype; cust uuid; stf uuid; br uuid; bid uuid; src text; d date;
begin
  if r is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not sl_biz_ok(p_business) then raise exception 'Bookings are paused for this business'; end if;
  select * into b from sl_businesses where id = p_business;
  select * into s from sl_services where id = p_service and business_id = p_business and active;
  if s.id is null then raise exception 'That service is not available'; end if;
  if p_start > now() + interval '180 days' then raise exception 'Too far ahead'; end if;
  if r = 'customer' then
    cust := sl_my_customer_id(p_business); p_walk_in := false; src := 'online';
    if cust is null then raise exception 'Customer profile not found'; end if;
  else
    cust := p_customer; src := case when p_walk_in then 'walk_in' else 'staff' end;
    if cust is not null and not exists (select 1 from sl_customers where id = cust and business_id = p_business) then raise exception 'Customer not found'; end if;
  end if;
  if p_walk_in then
    if p_staff is null then raise exception 'Choose a staff member'; end if;
    select st.id, st.branch_id into stf, br from sl_staff st join sl_staff_services ss on ss.staff_id = st.id and ss.service_id = p_service
      where st.id = p_staff and st.business_id = p_business and st.active;
    if stf is null then raise exception 'That staff member does not do this service'; end if;
  else
    br := coalesce(p_branch, (select branch_id from sl_staff where id = p_staff and business_id = p_business));
    d := (p_start at time zone b.timezone)::date;
    select a.staff_id into stf from sl_available_slots(p_business, p_service, d, p_staff, br) a where a.slot_start = p_start order by a.staff_id limit 1;
    if stf is null then raise exception 'That time is no longer available'; end if;
    br := (select branch_id from sl_staff where id = stf);
  end if;
  begin
    insert into sl_bookings(business_id, branch_id, customer_id, guest_name, staff_id, service_id, starts_at, ends_at, status, source, price, notes, created_by)
    values (p_business, br, cust, left(nullif(trim(p_guest), ''), 80), stf, p_service, p_start, p_start + make_interval(mins => s.duration_min),
            case src when 'online' then 'booked' when 'walk_in' then 'in_progress' else 'confirmed' end, src, s.price, left(nullif(trim(p_notes), ''), 500), auth.uid())
    returning id into bid;
  exception when exclusion_violation then raise exception 'That time was just taken. Please pick another.';
  end;
  return bid;
end $$;

create or replace function sl_reschedule(p_booking uuid, p_start timestamptz, p_staff uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare k sl_bookings%rowtype; b sl_businesses%rowtype; r text; stf uuid; d date; dur int;
begin
  select * into k from sl_bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  r := sl_role(k.business_id);
  if r is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into b from sl_businesses where id = k.business_id;
  if r = 'customer' then
    if k.customer_id is distinct from sl_my_customer_id(k.business_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
    if k.starts_at - make_interval(hours => b.cancel_notice_hours) < now() then raise exception 'Too late to change online. Please contact us.'; end if;
  end if;
  if k.status not in ('booked','confirmed') then raise exception 'Only upcoming bookings can be moved'; end if;
  if not sl_biz_ok(k.business_id) then raise exception 'Bookings are paused for this business'; end if;
  select duration_min into dur from sl_services where id = k.service_id;
  d := (p_start at time zone b.timezone)::date;
  select a.staff_id into stf from sl_available_slots(k.business_id, k.service_id, d, coalesce(p_staff, k.staff_id), k.branch_id, k.id) a where a.slot_start = p_start limit 1;
  if stf is null and p_staff is null then
    select a.staff_id into stf from sl_available_slots(k.business_id, k.service_id, d, null, k.branch_id, k.id) a where a.slot_start = p_start order by a.staff_id limit 1;
  end if;
  if stf is null then raise exception 'That time is no longer available'; end if;
  begin
    update sl_bookings set starts_at = p_start, ends_at = p_start + make_interval(mins => dur), staff_id = stf where id = p_booking;
  exception when exclusion_violation then raise exception 'That time was just taken. Please pick another.';
  end;
end $$;

create or replace function sl_cancel(p_booking uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare k sl_bookings%rowtype; b sl_businesses%rowtype; r text;
begin
  select * into k from sl_bookings where id = p_booking;
  if not found then raise exception 'Booking not found'; end if;
  r := sl_role(k.business_id);
  if r is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into b from sl_businesses where id = k.business_id;
  if r = 'customer' then
    if k.customer_id is distinct from sl_my_customer_id(k.business_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
    if k.starts_at - make_interval(hours => b.cancel_notice_hours) < now() then raise exception 'Too late to cancel online. Please contact us.'; end if;
  end if;
  if k.status in ('completed','cancelled','no_show') then raise exception 'This booking can no longer be cancelled'; end if;
  update sl_bookings set status = 'cancelled', cancel_reason = left(nullif(trim(p_reason), ''), 200) where id = p_booking;
end $$;

create or replace function sl_set_plan(p_business uuid, p_plan text, p_status text default 'active', p_trial_ends timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from sl_platform_admins where user_id = auth.uid()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update sl_businesses set plan = p_plan, sub_status = p_status,
    max_staff = case p_plan when 'pro' then 25 when 'starter' then 5 else 3 end,
    max_branches = case p_plan when 'pro' then 5 else 1 end,
    trial_ends_at = coalesce(p_trial_ends, trial_ends_at)
  where id = p_business;
end $$;

create or replace function sl_report(p_business uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tz text; f timestamptz; t timestamptz;
begin
  if not sl_is_admin(p_business) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 366 then raise exception 'Invalid date range'; end if;
  select timezone into tz from sl_businesses where id = p_business;
  f := p_from::timestamp at time zone tz; t := (p_to + 1)::timestamp at time zone tz;
  return jsonb_build_object(
    'services_by_day', (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]') from (
        select (created_at at time zone tz)::date as day, sum(case when kind = 'refund' then -amount else amount end) as amount
        from sl_payments where business_id = p_business and status = 'paid' and created_at >= f and created_at < t group by 1) x),
    'products_by_day', (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]') from (
        select (created_at at time zone tz)::date as day, sum(qty * unit_price) as amount
        from sl_product_sales where business_id = p_business and created_at >= f and created_at < t group by 1) x),
    'by_method', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
        select method, sum(case when kind = 'refund' then -amount else amount end) as amount
        from sl_payments where business_id = p_business and status = 'paid' and created_at >= f and created_at < t group by method) x),
    'refunds', (select coalesce(sum(amount), 0) from sl_payments where business_id = p_business and status = 'paid' and kind = 'refund' and created_at >= f and created_at < t),
    'bookings_by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (
        select status, count(*) as n from sl_bookings where business_id = p_business and starts_at >= f and starts_at < t group by status) x),
    'top_services', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
        select s.name, count(*) as n, sum(k.price) as amount from sl_bookings k join sl_services s on s.id = k.service_id
        where k.business_id = p_business and k.status = 'completed' and k.starts_at >= f and k.starts_at < t group by s.name order by 3 desc limit 8) x),
    'top_staff', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (
        select s.name, count(*) as n, sum(k.price) as amount from sl_bookings k join sl_staff s on s.id = k.staff_id
        where k.business_id = p_business and k.status = 'completed' and k.starts_at >= f and k.starts_at < t group by s.name order by 3 desc limit 8) x),
    'new_customers', (select count(*) from sl_customers where business_id = p_business and created_at >= f and created_at < t));
end $$;

-- ───────────────────────── RLS ─────────────────────────
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'sl\_%' loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- readable by any member of the business (customers included), written by admins
do $$ declare t text; begin
  foreach t in array array['sl_branches','sl_services','sl_staff_services','sl_business_hours'] loop
    execute format('drop policy if exists %I on %I', t || '_r', t);
    execute format('create policy %I on %I for select to authenticated using (sl_role(business_id) is not null)', t || '_r', t);
  end loop;
  -- readable by staff/admin only, written by admins
  foreach t in array array['sl_staff','sl_staff_availability'] loop
    execute format('drop policy if exists %I on %I', t || '_r', t);
    execute format('create policy %I on %I for select to authenticated using (sl_is_staff(business_id))', t || '_r', t);
  end loop;
  foreach t in array array['sl_branches','sl_services','sl_staff_services','sl_business_hours','sl_staff','sl_staff_availability','sl_products','sl_integrations'] loop
    execute format('drop policy if exists %I on %I', t || '_w', t);
    execute format('create policy %I on %I for all to authenticated using (sl_is_admin(business_id)) with check (sl_is_admin(business_id))', t || '_w', t);
  end loop;
end $$;

drop policy if exists sl_businesses_r on sl_businesses;
create policy sl_businesses_r on sl_businesses for select to authenticated using (sl_role(id) is not null);
drop policy if exists sl_businesses_u on sl_businesses;
create policy sl_businesses_u on sl_businesses for update to authenticated using (sl_is_admin(id)) with check (sl_is_admin(id));

drop policy if exists sl_profiles_r on sl_profiles;
create policy sl_profiles_r on sl_profiles for select to authenticated using (user_id = auth.uid() or sl_is_admin(business_id));

drop policy if exists sl_customers_r on sl_customers;
create policy sl_customers_r on sl_customers for select to authenticated using (sl_is_staff(business_id));
drop policy if exists sl_customers_i on sl_customers;
create policy sl_customers_i on sl_customers for insert to authenticated with check (sl_is_staff(business_id) and user_id is null);
drop policy if exists sl_customers_u on sl_customers;
create policy sl_customers_u on sl_customers for update to authenticated using (sl_is_staff(business_id)) with check (sl_is_staff(business_id));

drop policy if exists sl_products_r on sl_products;
create policy sl_products_r on sl_products for select to authenticated using (sl_is_staff(business_id));

drop policy if exists sl_bookings_r on sl_bookings;
create policy sl_bookings_r on sl_bookings for select to authenticated using (sl_is_staff(business_id) or customer_id = sl_my_customer_id(business_id));
drop policy if exists sl_bookings_u on sl_bookings;
create policy sl_bookings_u on sl_bookings for update to authenticated using (sl_is_staff(business_id)) with check (sl_is_staff(business_id));

drop policy if exists sl_payments_r on sl_payments;
create policy sl_payments_r on sl_payments for select to authenticated using (sl_is_staff(business_id));
drop policy if exists sl_payments_i on sl_payments;
create policy sl_payments_i on sl_payments for insert to authenticated with check (sl_is_staff(business_id) and created_by = auth.uid() and sl_biz_ok(business_id));
drop policy if exists sl_payments_u on sl_payments;
create policy sl_payments_u on sl_payments for update to authenticated using (sl_is_admin(business_id)) with check (sl_is_admin(business_id));

drop policy if exists sl_sales_r on sl_product_sales;
create policy sl_sales_r on sl_product_sales for select to authenticated using (sl_is_staff(business_id));
drop policy if exists sl_sales_i on sl_product_sales;
create policy sl_sales_i on sl_product_sales for insert to authenticated with check (sl_is_staff(business_id) and created_by = auth.uid() and sl_biz_ok(business_id));

-- ───────────────────────── grants ─────────────────────────
grant select on sl_businesses, sl_branches, sl_profiles, sl_staff, sl_customers, sl_services, sl_staff_services, sl_business_hours,
                sl_staff_availability, sl_bookings, sl_payments, sl_products, sl_product_sales, sl_integrations to authenticated;
grant select on sl_staff_public, sl_booking_payments to authenticated;
grant update (name, currency, timezone, slot_minutes, min_notice_minutes, cancel_notice_hours, accent, phone, address) on sl_businesses to authenticated;
grant insert, update on sl_branches to authenticated;
grant insert, update, delete on sl_staff, sl_services, sl_business_hours, sl_staff_availability, sl_products, sl_integrations to authenticated;
grant insert, delete on sl_staff_services to authenticated;
grant insert on sl_customers, sl_product_sales to authenticated;
grant update (full_name, email, phone, notes) on sl_customers to authenticated;
grant update (status, notes) on sl_bookings to authenticated;
grant insert on sl_payments to authenticated;
grant update (status, note) on sl_payments to authenticated;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sl\_%' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if f::text not like 'sl\_tg\_%' then execute format('grant execute on function %s to authenticated', f); end if;
  end loop;
  grant execute on function sl_public_business(text) to anon;
end $$;
