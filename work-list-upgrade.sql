-- V11 增量更新：不需重建資料表，不影響既有樣板或紀錄。
-- 注意：匿名訪客將可看到最近 200 筆作業基本資訊，以及開啟任一作業查看量測值。
-- 若含機密、個資或不應公開的量測資料，請勿部署此公開查詢模式。
create or replace function public.em_work_list() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 return jsonb_build_object('ok',true,'jobs',coalesce((
   select jsonb_agg(jsonb_build_object('id',id,'template_name',template_name,
     'inspector',inspector,'equipment',equipment,'work_date',work_date,
     'status',status,'updated_at',updated_at) order by updated_at desc)
   from (select id,template_name,inspector,equipment,work_date,status,updated_at
     from public.em_jobs order by updated_at desc limit 200) q
 ),'[]'::jsonb));
end;$$;
create or replace function public.em_work_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_job jsonb;
begin
 select jsonb_build_object('id',j.id,'template_id',j.template_id,
   'template_name',j.template_name,'fields',j.fields,'inspector',j.inspector,
   'equipment',j.equipment,'work_date',to_char(j.work_date,'YYYY-MM-DD"T"HH24:MI'),
   'values',j.values,'status',j.status) into v_job
 from public.em_jobs j where j.id=p_id;
 if v_job is null then return jsonb_build_object('ok',false,'error','找不到作業'); end if;
 return jsonb_build_object('ok',true,'job',v_job);
end;$$;
revoke all on function public.em_work_list() from public, anon, authenticated;
revoke all on function public.em_work_get(uuid) from public, anon, authenticated;
grant execute on function public.em_work_list(),public.em_work_get(uuid) to anon,authenticated;
