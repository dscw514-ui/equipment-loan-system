-- 僅新增 equipmgr_ 物件；不更動任何既有 em_ 或其他資料表／政策。
-- 首次安裝專用：如果已存在同名表或函式，請停止並先檢查。
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.equipmgr_equipment') IS NOT NULL OR to_regclass('public.equipmgr_loans') IS NOT NULL THEN
  RAISE EXCEPTION 'equipmgr_ 資料表已存在，停止首次安裝以免覆蓋';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'equipmgr_%') THEN
  RAISE EXCEPTION 'equipmgr_ 函式已存在，停止首次安裝';
 END IF;
END $$;
CREATE TABLE public.equipmgr_equipment(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE CHECK(length(code) BETWEEN 1 AND 60),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160), model text NOT NULL DEFAULT '',
 location text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','borrowed')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.equipmgr_loans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), equipment_id uuid NOT NULL REFERENCES public.equipmgr_equipment(id) ON DELETE RESTRICT,
 borrower text NOT NULL CHECK(length(borrower) BETWEEN 1 AND 80), borrowed_at timestamptz NOT NULL DEFAULT now(),
 due_at date, note text NOT NULL DEFAULT '', returned_by text, returned_at timestamptz, return_note text NOT NULL DEFAULT '',
 CHECK((returned_at IS NULL AND returned_by IS NULL) OR (returned_at IS NOT NULL AND returned_by IS NOT NULL))
);
CREATE UNIQUE INDEX equipmgr_one_active_loan ON public.equipmgr_loans(equipment_id) WHERE returned_at IS NULL;
CREATE INDEX equipmgr_loan_time ON public.equipmgr_loans(borrowed_at DESC);
ALTER TABLE public.equipmgr_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipmgr_loans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.equipmgr_equipment,public.equipmgr_loans FROM PUBLIC,anon,authenticated;
-- RPC 由資料庫擁有者執行，權限只開放必要的函式；不直接開放表格。
CREATE FUNCTION public.equipmgr_list() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('ok',true,'items',coalesce(jsonb_agg(jsonb_build_object('code',e.code,'name',e.name,'model',e.model,'location',e.location,'notes',e.notes,'status',e.status,'borrower',l.borrower,'due_at',l.due_at) ORDER BY e.code),'[]'::jsonb))
 FROM public.equipmgr_equipment e LEFT JOIN public.equipmgr_loans l ON l.equipment_id=e.id AND l.returned_at IS NULL;
$$;
CREATE FUNCTION public.equipmgr_get(p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 SELECT jsonb_build_object('code',e.code,'name',e.name,'model',e.model,'location',e.location,'notes',e.notes,'status',e.status,'borrower',l.borrower,'due_at',l.due_at)
 INTO result FROM public.equipmgr_equipment e LEFT JOIN public.equipmgr_loans l ON l.equipment_id=e.id AND l.returned_at IS NULL WHERE e.code=p_code;
 IF result IS NULL THEN RETURN jsonb_build_object('ok',false,'error','找不到設備'); END IF;
 RETURN jsonb_build_object('ok',true,'item',result);
END $$;
CREATE FUNCTION public.equipmgr_transact(p_code text,p_person text,p_action text,p_note text DEFAULT '',p_due date DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.equipmgr_equipment%ROWTYPE; l_id uuid; v_person text:=btrim(coalesce(p_person,'')); v_note text:=coalesce(p_note,'');
BEGIN
 IF length(v_person) NOT BETWEEN 1 AND 80 OR length(v_note)>500 THEN RETURN jsonb_build_object('ok',false,'error','姓名或備註長度不正確'); END IF;
 IF p_action NOT IN ('borrow','return') OR p_action IS NULL THEN RETURN jsonb_build_object('ok',false,'error','操作不正確'); END IF;
 SELECT * INTO e FROM public.equipmgr_equipment WHERE code=p_code FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','找不到設備'); END IF;
 IF p_action='borrow' THEN
  IF e.status<>'available' THEN RETURN jsonb_build_object('ok',false,'error','設備已借出'); END IF;
  IF p_due IS NOT NULL AND (p_due<CURRENT_DATE OR p_due>CURRENT_DATE+3650) THEN RETURN jsonb_build_object('ok',false,'error','預計歸還日期不正確'); END IF;
  INSERT INTO public.equipmgr_loans(equipment_id,borrower,due_at,note) VALUES(e.id,v_person,p_due,v_note) RETURNING id INTO l_id;
  UPDATE public.equipmgr_equipment SET status='borrowed',updated_at=now() WHERE id=e.id;
 ELSE
  IF e.status<>'borrowed' THEN RETURN jsonb_build_object('ok',false,'error','設備目前沒有借出'); END IF;
  UPDATE public.equipmgr_loans SET returned_at=now(),returned_by=v_person,return_note=v_note
  WHERE equipment_id=e.id AND returned_at IS NULL RETURNING id INTO l_id;
  IF l_id IS NULL THEN RAISE EXCEPTION '借出狀態不一致，請聯絡管理員'; END IF;
  UPDATE public.equipmgr_equipment SET status='available',updated_at=now() WHERE id=e.id;
 END IF;
 RETURN jsonb_build_object('ok',true,'loan_id',l_id);
END $$;
CREATE FUNCTION public.equipmgr_admin_upsert(p_item jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_code text:=btrim(coalesce(p_item->>'code',''));v_name text:=btrim(coalesce(p_item->>'name',''));
BEGIN
 IF NOT public.em__is_admin() THEN RETURN jsonb_build_object('ok',false,'error','需要管理員權限'); END IF;
 IF length(v_code) NOT BETWEEN 1 AND 60 OR length(v_name) NOT BETWEEN 1 AND 160 OR length(coalesce(p_item->>'model',''))>160 OR length(coalesce(p_item->>'location',''))>160 OR length(coalesce(p_item->>'notes',''))>1000 THEN
  RETURN jsonb_build_object('ok',false,'error','設備欄位長度不正確'); END IF;
 INSERT INTO public.equipmgr_equipment(code,name,model,location,notes) VALUES(v_code,v_name,coalesce(p_item->>'model',''),coalesce(p_item->>'location',''),coalesce(p_item->>'notes',''))
 ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,model=EXCLUDED.model,location=EXCLUDED.location,notes=EXCLUDED.notes,updated_at=now();
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.equipmgr_admin_import(p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb; v_result jsonb; n int:=0;
BEGIN
 IF NOT public.em__is_admin() THEN RETURN jsonb_build_object('ok',false,'error','需要管理員權限'); END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)>200 THEN RETURN jsonb_build_object('ok',false,'error','CSV 每批最多 200 筆'); END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  v_result:=public.equipmgr_admin_upsert(v);
  IF coalesce((v_result->>'ok')::boolean,false)=false THEN RAISE EXCEPTION '匯入第 % 筆失敗：%',n+1,v_result->>'error'; END IF;
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'count',n);
END $$;
CREATE FUNCTION public.equipmgr_admin_history() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.em__is_admin() THEN RETURN jsonb_build_object('ok',false,'error','需要管理員權限'); END IF;
 RETURN jsonb_build_object('ok',true,'items',coalesce((SELECT jsonb_agg(row_to_json(x) ORDER BY x.borrowed_at DESC) FROM (
 SELECT e.code,l.borrower,l.borrowed_at,l.due_at,l.returned_by,l.returned_at,l.note,l.return_note
 FROM public.equipmgr_loans l JOIN public.equipmgr_equipment e ON e.id=l.equipment_id ORDER BY l.borrowed_at DESC LIMIT 5000
 ) x),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.equipmgr_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.equipmgr_get(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.equipmgr_transact(text,text,text,text,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.equipmgr_admin_upsert(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.equipmgr_admin_import(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.equipmgr_admin_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.equipmgr_list(),public.equipmgr_get(text),public.equipmgr_transact(text,text,text,text,date) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.equipmgr_admin_upsert(jsonb),public.equipmgr_admin_import(jsonb),public.equipmgr_admin_history() TO authenticated;
COMMIT;
