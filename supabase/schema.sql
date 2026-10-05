create table if not exists public.ravenstone_rooms (
  code text primary key,
  state jsonb not null,
  version integer not null default 1,
  status text not null check (status in ('lobby', 'investigation', 'voting', 'results')),
  visibility text not null check (visibility in ('private', 'public')),
  player_count integer not null default 1 check (player_count between 1 and 9),
  updated_at timestamptz not null default now()
);

alter table public.ravenstone_rooms enable row level security;
revoke all on table public.ravenstone_rooms from anon, authenticated;
grant all on table public.ravenstone_rooms to service_role;

create index if not exists ravenstone_public_lobby_idx
  on public.ravenstone_rooms (updated_at desc)
  where visibility = 'public' and status = 'lobby';
