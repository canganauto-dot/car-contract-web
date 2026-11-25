create table public.ownership_qr (
  id uuid primary key,
  buyer text not null,
  vin text not null,
  company text not null,
  issued_by uuid,
  issued_at timestamptz not null default now()
);
alter table public.ownership_qr enable row level security;
revoke all on public.ownership_qr from public, anon, authenticated;
grant select, insert on public.ownership_qr to service_role;
