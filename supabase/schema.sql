-- Ejecutar una vez en Supabase: SQL Editor > New query > pegar > Run.

create table if not exists people (
  id bigint generated always as identity primary key,
  name text not null,
  key text not null unique,          -- nombre sin tildes y en minúsculas
  filename text not null,
  uploaded_at timestamptz not null default now()
);

create table if not exists blocks (
  id bigint generated always as identity primary key,
  person_id bigint not null references people(id) on delete cascade,
  day smallint not null,             -- 0 = lunes ... 6 = domingo
  start_min integer not null,        -- minutos desde medianoche
  end_min integer not null,
  subject text not null,
  room text not null,
  tags text not null
);
create index if not exists blocks_person_idx on blocks(person_id);

-- Solo la API (service_role) toca los datos: RLS activado y sin políticas.
alter table people enable row level security;
alter table blocks enable row level security;

-- Reemplaza el horario de una persona de forma atómica. Devuelve true si ya existía.
create or replace function replace_person(
  p_name text, p_key text, p_filename text, p_blocks jsonb
) returns boolean
language plpgsql as $$
declare
  existed boolean;
  pid bigint;
begin
  select exists(select 1 from people where key = p_key) into existed;
  delete from people where key = p_key;
  insert into people (name, key, filename) values (p_name, p_key, p_filename)
    returning id into pid;
  insert into blocks (person_id, day, start_min, end_min, subject, room, tags)
    select pid, (b->>'day')::int, (b->>'start')::int, (b->>'end')::int,
           b->>'subject', b->>'room', b->>'tags'
    from jsonb_array_elements(p_blocks) b;
  return existed;
end $$;

revoke execute on function replace_person(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function replace_person(text, text, text, jsonb) to service_role;
