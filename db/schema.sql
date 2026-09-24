-- Esquema de Horarios (Postgres). Fuente única: SQLite local lo deriva de este archivo.
-- Aplicar con:  python -m scripts.manage migrate   (es idempotente)
-- Las tablas viven en el esquema `horarios`, aparte de las de otros proyectos.

create schema if not exists horarios;

create table if not exists horarios.users (
  id bigint generated always as identity primary key,
  email text not null unique,             -- siempre en minúsculas
  name text not null,
  password_hash text not null,
  is_superadmin integer not null default 0,
  created_at bigint not null              -- epoch, segundos
);

create table if not exists horarios.sessions (
  id text primary key,                    -- sha256 del token de la cookie
  user_id bigint not null references horarios.users(id) on delete cascade,
  expires_at bigint not null
);
create index if not exists sessions_user_idx on horarios.sessions(user_id);

create table if not exists horarios.login_failures (
  email text not null,
  at bigint not null
);
create index if not exists login_failures_idx on horarios.login_failures(email, at);

create table if not exists horarios.groups (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  created_at bigint not null,
  -- Dueño: la cuenta del correo inicial, el primer admin que aprobó el superadmin.
  -- Es la única que gestiona quién entra, quién sale y quién es admin.
  owner_user_id bigint references horarios.users(id) on delete set null
);

create table if not exists horarios.memberships (
  user_id bigint not null references horarios.users(id) on delete cascade,
  group_id bigint not null references horarios.groups(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  primary key (user_id, group_id)
);
create index if not exists memberships_group_idx on horarios.memberships(group_id);

-- Solicitudes de acceso: quien se registra pide entrar a una agrupación y espera
-- a que el superadmin le apruebe. Al aprobar, la fila se convierte en membresía.
create table if not exists horarios.requests (
  id bigint generated always as identity primary key,
  user_id bigint not null references horarios.users(id) on delete cascade,
  group_id bigint not null references horarios.groups(id) on delete cascade,
  created_at bigint not null,
  unique (user_id, group_id)
);
create index if not exists requests_group_idx on horarios.requests(group_id);

create table if not exists horarios.people (
  id bigint generated always as identity primary key,
  group_id bigint not null references horarios.groups(id) on delete cascade,
  name text not null,
  key text not null,                      -- nombre sin tildes y en minúsculas
  filename text not null,
  uploaded_at bigint not null,
  unique (group_id, key)
);

create table if not exists horarios.blocks (
  id bigint generated always as identity primary key,
  person_id bigint not null references horarios.people(id) on delete cascade,
  day smallint not null,                  -- 0 = lunes ... 6 = domingo
  start_min integer not null,             -- minutos desde medianoche
  end_min integer not null,
  subject text not null,
  room text not null,
  tags text not null,
  kind text not null default 'clase'      -- 'clase' (del PDF) o 'trabajo' (a mano)
);
create index if not exists blocks_person_idx on horarios.blocks(person_id);

-- La API se conecta como dueño de la base; RLS activado por si algún día se expone el esquema.
alter table horarios.users enable row level security;
alter table horarios.sessions enable row level security;
alter table horarios.login_failures enable row level security;
alter table horarios.groups enable row level security;
alter table horarios.memberships enable row level security;
alter table horarios.requests enable row level security;
alter table horarios.people enable row level security;
alter table horarios.blocks enable row level security;
