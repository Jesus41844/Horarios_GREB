-- Ejecutar una vez en Supabase (SQL Editor) o con psql contra DATABASE_URL.
-- Todo vive en el esquema `greb`, así no toca las tablas de otros proyectos.

create schema if not exists greb;

create table if not exists greb.people (
  id bigint generated always as identity primary key,
  name text not null,
  key text not null unique,          -- nombre sin tildes y en minúsculas
  filename text not null,
  uploaded_at timestamptz not null default now()
);

create table if not exists greb.blocks (
  id bigint generated always as identity primary key,
  person_id bigint not null references greb.people(id) on delete cascade,
  day smallint not null,             -- 0 = lunes ... 6 = domingo
  start_min integer not null,        -- minutos desde medianoche
  end_min integer not null,
  subject text not null,
  room text not null,
  tags text not null
);
create index if not exists blocks_person_idx on greb.blocks(person_id);

-- La API se conecta como dueño de la base; RLS activado por si algún día se expone `greb`.
alter table greb.people enable row level security;
alter table greb.blocks enable row level security;
