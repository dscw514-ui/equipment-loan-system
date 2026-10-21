-- 設備保養系統：獨立 em_ 前綴，不影響原本飲料系統 od_ 資料表。
-- 在 Supabase SQL Editor 以專案管理者身分執行。
create extension if not exists pgcrypto;

create table if not exists public.em_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.em_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.em_jobs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.em_templates(id) on delete restrict,
  template_name text not null,
  fields jsonb not null,
  inspector text not null,
  equipment text not null,
  work_date timestamp without time zone not null,
  values jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check(status in ('draft','completed')),
  edit_token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists em_jobs_created_idx on public.em_jobs(created_at desc);

alter table public.em_admins enable row level security;
alter table public.em_templates enable row level security;
alter table public.em_jobs enable row level security;
-- 明確撤銷匿名直接寫入與歷史讀取權限；僅允許 RPC 執行受控操作。
revoke all on public.em_admins from anon, authenticated;
revoke all on public.em_jobs from anon, authenticated;
revoke all on public.em_templates from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.em_templates to anon, authenticated;
drop policy if exists em_templates_public_read on public.em_templates;
create policy em_templates_public_read on public.em_templates for select to anon, authenticated using(true);

-- 只在 server-side 查 auth.uid() 是否列入 em_admins。
create or replace function public.em__is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.em_admins where user_id = (select auth.uid()));
$$;
revoke all on function public.em__is_admin() from public, anon, authenticated;

create or replace function public.em_admin_check() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if not public.em__is_admin() then return jsonb_build_object('ok',false,'error','此帳號沒有管理者權限，請先在 em_admins 加入使用者'); end if;
 return jsonb_build_object('ok',true);
end;$$;

create or replace function public.em_template_save(p_template jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text; v_fields jsonb; v_desc text;
begin
 if not public.em__is_admin() then return jsonb_build_object('ok',false,'error','需要管理者權限'); end if;
 v_name=btrim(coalesce(p_template->>'name','')); v_desc=left(coalesce(p_template->>'description',''),2000); v_fields=p_template->'fields';
 if v_name='' or length(v_name)>160 then return jsonb_build_object('ok',false,'error','樣板名稱必填（160 字以內）'); end if;
 if jsonb_typeof(v_fields) is distinct from 'array' or jsonb_array_length(v_fields)=0 or jsonb_array_length(v_fields)>150 then return jsonb_build_object('ok',false,'error','樣板欄位必須為 1～150 項'); end if;
 if exists(select 1 from jsonb_array_elements(v_fields) f where coalesce(btrim(f->>'label'),'')='' or coalesce(f->>'type','') not in ('number','text','checkbox','radio','datetime') or coalesce(f->>'id','')='') then return jsonb_build_object('ok',false,'error','欄位設定不完整'); end if;
 if p_template->>'id' is null or p_template->>'id'='' then
   insert into public.em_templates(name,description,fields) values(v_name,v_desc,v_fields) returning id into v_id;
 else
   v_id=(p_template->>'id')::uuid;
   update public.em_templates set name=v_name,description=v_desc,fields=v_fields,updated_at=now() where id=v_id;
   if not found then return jsonb_build_object('ok',false,'error','找不到要修改的樣板'); end if;
 end if;
 return jsonb_build_object('ok',true,'id',v_id);
end;$$;

create or replace function public.em_template_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if not public.em__is_admin() then return jsonb_build_object('ok',false,'error','需要管理者權限'); end if;
 if exists(select 1 from public.em_jobs where template_id=p_id) then return jsonb_build_object('ok',false,'error','此樣板已有保養紀錄，不可刪除'); end if;
 delete from public.em_templates where id=p_id;
 return jsonb_build_object('ok',true);
end;$$;

-- 匿名可建立作業，回傳一次性編輯權杖。僅持有該權杖者能修改該作業。
create or replace function public.em_job_create(p_job jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.em_templates%rowtype; v_token text; v_id uuid; v_inspector text; v_equipment text; v_date timestamp; v_values jsonb; v_finish boolean;
begin
 select * into t from public.em_templates where id=(p_job->>'template_id')::uuid;
 if not found then return jsonb_build_object('ok',false,'error','找不到樣板'); end if;
 v_inspector=left(btrim(coalesce(p_job->>'inspector','')),80);v_equipment=left(btrim(coalesce(p_job->>'equipment','')),160);
 if v_inspector='' or v_equipment='' then return jsonb_build_object('ok',false,'error','請輸入人員姓名與設備名稱'); end if;
 v_date=coalesce(nullif(p_job->>'work_date','')::timestamp,now()::timestamp);
 v_values=coalesce(p_job->'values','{}'::jsonb);v_finish=coalesce((p_job->>'finish')::boolean,false);
 if jsonb_typeof(v_values)<>'object' or length(v_values::text)>50000 then return jsonb_build_object('ok',false,'error','作業欄位資料不正確或過大'); end if;
 v_token=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.em_jobs(template_id,template_name,fields,inspector,equipment,work_date,values,status,edit_token_hash,completed_at)
 values(t.id,t.name,t.fields,v_inspector,v_equipment,v_date,v_values,case when v_finish then 'completed' else 'draft' end,encode(extensions.digest(v_token,'sha256'),'hex'),case when v_finish then now() else null end)
 returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id,'token',v_token,'status',case when v_finish then 'completed' else 'draft' end);
end;$$;

create or replace function public.em_job_save(p_id uuid,p_token text,p_job jsonb,p_finish boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.em_jobs%rowtype; v_inspector text;v_equipment text;v_values jsonb;
begin
 select * into j from public.em_jobs where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'error','找不到作業'); end if;
 if p_token is null or length(p_token)<>64 or j.edit_token_hash<>encode(extensions.digest(p_token,'sha256'),'hex') then return jsonb_build_object('ok',false,'error','沒有此作業的編輯權限'); end if;
 if j.status='completed' then return jsonb_build_object('ok',false,'error','作業已結束，請由管理者修改'); end if;
 if (p_job->>'template_id')::uuid<>j.template_id then return jsonb_build_object('ok',false,'error','不可更換已建立作業的樣板'); end if;
 v_inspector=left(btrim(coalesce(p_job->>'inspector','')),80);v_equipment=left(btrim(coalesce(p_job->>'equipment','')),160);v_values=coalesce(p_job->'values','{}'::jsonb);
 if v_inspector='' or v_equipment='' then return jsonb_build_object('ok',false,'error','人員姓名與設備名稱必填'); end if;
 if jsonb_typeof(v_values)<>'object' or length(v_values::text)>50000 then return jsonb_build_object('ok',false,'error','作業資料不正確'); end if;
 update public.em_jobs set inspector=v_inspector,equipment=v_equipment,work_date=coalesce(nullif(p_job->>'work_date','')::timestamp,work_date),values=v_values,status=case when p_finish then 'completed' else 'draft' end,completed_at=case when p_finish then now() else null end,updated_at=now() where id=p_id;
 return jsonb_build_object('ok',true,'id',p_id,'status',case when p_finish then 'completed' else 'draft' end);
end;$$;

create or replace function public.em_history() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if not public.em__is_admin() then return jsonb_build_object('ok',false,'error','需要管理者權限'); end if;
 return jsonb_build_object('ok',true,'jobs',coalesce((select jsonb_agg(to_jsonb(j) - 'edit_token_hash' - 'fields' - 'values' order by created_at desc) from (select * from public.em_jobs order by created_at desc limit 1000) j),'[]'::jsonb));
end;$$;

create or replace function public.em_admin_job(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j jsonb;
begin
 if not public.em__is_admin() then return jsonb_build_object('ok',false,'error','需要管理者權限'); end if;
 select to_jsonb(x)-'edit_token_hash' into j from public.em_jobs x where x.id=p_id;
 if j is null then return jsonb_build_object('ok',false,'error','找不到作業'); end if;
 return jsonb_build_object('ok',true,'job',j);
end;$$;

create or replace function public.em_admin_job_save(p_id uuid,p_job jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_status text;v_values jsonb;
begin
 if not public.em__is_admin() then return jsonb_build_object('ok',false,'error','需要管理者權限'); end if;
 v_status=coalesce(p_job->>'status','draft');v_values=coalesce(p_job->'values','{}'::jsonb);
 if v_status not in ('draft','completed') or jsonb_typeof(v_values)<>'object' or length(v_values::text)>50000 then return jsonb_build_object('ok',false,'error','資料格式不正確'); end if;
 if btrim(coalesce(p_job->>'inspector',''))='' or btrim(coalesce(p_job->>'equipment',''))='' then return jsonb_build_object('ok',false,'error','人員與設備必填'); end if;
 update public.em_jobs set inspector=left(btrim(p_job->>'inspector'),80),equipment=left(btrim(p_job->>'equipment'),160),work_date=coalesce(nullif(p_job->>'work_date','')::timestamp,work_date),values=v_values,status=v_status,completed_at=case when v_status='completed' then coalesce(completed_at,now()) else null end,updated_at=now() where id=p_id;
 if not found then return jsonb_build_object('ok',false,'error','找不到作業'); end if;
 return jsonb_build_object('ok',true,'id',p_id);
end;$$;

-- PostgreSQL 函式預設可能授權 PUBLIC 執行；明確撤銷後僅授權必要角色。
revoke all on function public.em_admin_check() from public;
revoke all on function public.em_template_save(jsonb) from public;
revoke all on function public.em_template_delete(uuid) from public;
revoke all on function public.em_job_create(jsonb) from public;
revoke all on function public.em_job_save(uuid,text,jsonb,boolean) from public;
revoke all on function public.em_history() from public;
revoke all on function public.em_admin_job(uuid) from public;
revoke all on function public.em_admin_job_save(uuid,jsonb) from public;
grant execute on function public.em_admin_check(),public.em_template_save(jsonb),public.em_template_delete(uuid),public.em_history(),public.em_admin_job(uuid),public.em_admin_job_save(uuid,jsonb) to authenticated;
grant execute on function public.em_job_create(jsonb),public.em_job_save(uuid,text,jsonb,boolean) to anon,authenticated;

-- 建立管理者：先在 Authentication > Users 建立帳號，再單獨執行：
-- insert into public.em_admins(user_id)
-- select id from auth.users where email='你的管理者信箱@example.com'
-- on conflict (user_id) do nothing;
