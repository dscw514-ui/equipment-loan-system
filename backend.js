import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
const missing = /YOUR_|YOUR_PROJECT_ID/.test(SUPABASE_URL + SUPABASE_ANON_KEY);
let client;
export async function backend() {
  if (missing) throw new Error('請先設定 js/config.js 的 Supabase URL 與公開金鑰');
  if (!client) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm');
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  const sb = client;
  const call = async (fn, args={}) => {
    const {data,error} = await sb.rpc(fn,args);
    if(error) throw new Error(error.message);
    if(!data?.ok) throw new Error(data?.error || '資料庫作業失敗');
    return data;
  };
  return {
    async templates(){ const {data,error}=await sb.from('em_templates').select('id,name,description,fields,updated_at').order('name'); if(error)throw new Error(error.message); return data||[]; },
    async session(){const {data,error}=await sb.auth.getUser(); if(error && error.name!=='AuthSessionMissingError')return null;return data?.user||null;},
    async login(email,password){const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)throw new Error(error.message);return data.user;},
    async logout(){const {error}=await sb.auth.signOut();if(error)throw new Error(error.message);},
    adminCheck:()=>call('em_admin_check'),
    saveTemplate:(template)=>call('em_template_save',{p_template:template}),
    deleteTemplate:(id)=>call('em_template_delete',{p_id:id}),
    createJob:(payload)=>call('em_job_create',{p_job:payload}),
    saveJob:(id,token,payload,finish)=>call('em_job_save',{p_id:id,p_token:token,p_job:payload,p_finish:finish}),
    history:()=>call('em_history'),
    workList:()=>call('em_work_list'),
    workJob:(id)=>call('em_work_get',{p_id:id}),
    adminJob:(id)=>call('em_admin_job',{p_id:id}),
    adminSaveJob:(id,payload)=>call('em_admin_job_save',{p_id:id,p_job:payload}),
    async emailJob(id,to){const {data,error}=await sb.functions.invoke('email-maintenance',{body:{job_id:id,to}});if(error)throw new Error(error.message);if(!data?.ok)throw new Error(data?.error||'寄信失敗');return data;},
  };
}
