-- Run in Supabase SQL Editor. Enable Anonymous Sign-ins under Authentication > Providers.
create extension if not exists pgcrypto;
create table if not exists public.equipment (
 id uuid primary key default gen_random_uuid(), code text not null unique check(length(trim(code)) between 1 and 80),
 name text not null, model text not null default '', location text not null default '',
 status text not null default 'available' check(status in ('available','borrowed','maintenance')),
 created_at timestamptz not null default now()
);
create table if not exists public.loans (
 id uuid primary key default gen_random_uuid(), equipment_id uuid not null references public.equipment(id),
 borrower text not null, borrowed_by uuid not null references auth.users(id),
 borrowed_at timestamptz not null default now(), due_at timestamptz,
 returned_at timestamptz, returned_by uuid references auth.users(id), returner text,
 note text not null default ''
);
create unique index if not exists one_open_loan_per_equipment on public.loans(equipment_id) where returned_at is null;
create index if not exists loans_equipment_idx on public.loans(equipment_id,borrowed_at desc);
alter table public.equipment enable row level security;
alter table public.loans enable row level security;
-- Public internal catalog. Anonymous sign-ins receive the authenticated role.
create policy "equipment read" on public.equipment for select to authenticated using (true);
create policy "loans read" on public.loans for select to authenticated using (true);
-- No direct INSERT/UPDATE/DELETE grants; only audited RPC mutations.
revoke insert,update,delete on public.equipment from anon,authenticated;
revoke insert,update,delete on public.loans from anon,authenticated;
create or replace function public.add_equipment(p_code text,p_name text,p_model text default '',p_location text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(trim(coalesce(p_code,''))) not between 1 and 80 or length(trim(coalesce(p_name,''))) not between 1 and 200 then raise exception 'Invalid equipment'; end if;
 insert into public.equipment(code,name,model,location) values(trim(p_code),trim(p_name),coalesce(p_model,''),coalesce(p_location,'')) returning id into v_id;
 return v_id;
end $$;
create or replace function public.checkout_equipment(p_equipment uuid,p_person text,p_due timestamptz default null,p_note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_status text; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(trim(coalesce(p_person,''))) not between 1 and 100 then raise exception 'Enter a name'; end if;
 select status into v_status from public.equipment where id=p_equipment for update;
 if v_status is distinct from 'available' then raise exception 'Equipment unavailable'; end if;
 insert into public.loans(equipment_id,borrower,borrowed_by,due_at,note)
 values(p_equipment,trim(p_person),auth.uid(),p_due,left(coalesce(p_note,''),1000)) returning id into v_id;
 update public.equipment set status='borrowed' where id=p_equipment;
 return v_id;
end $$;
create or replace function public.return_equipment(p_equipment uuid,p_person text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(trim(coalesce(p_person,''))) not between 1 and 100 then raise exception 'Enter a name'; end if;
 select status into v_status from public.equipment where id=p_equipment for update;
 if v_status is distinct from 'borrowed' then raise exception 'Equipment is not borrowed'; end if;
 select id into v_id from public.loans where equipment_id=p_equipment and returned_at is null for update;
 if v_id is null then raise exception 'Open loan missing'; end if;
 update public.loans set returned_at=now(),returner=trim(p_person),returned_by=auth.uid() where id=v_id;
 update public.equipment set status='available' where id=p_equipment;
end $$;
revoke all on function public.add_equipment(text,text,text,text) from public;
revoke all on function public.checkout_equipment(uuid,text,timestamptz,text) from public;
revoke all on function public.return_equipment(uuid,text) from public;
grant execute on function public.add_equipment(text,text,text,text) to authenticated;
grant execute on function public.checkout_equipment(uuid,text,timestamptz,text) to authenticated;
grant execute on function public.return_equipment(uuid,text) to authenticated;
