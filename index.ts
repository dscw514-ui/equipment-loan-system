import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const response=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return response(405,{ok:false,error:'Method not allowed'});
 try{
  const jwt=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
  if(!jwt)return response(401,{ok:false,error:'管理者必須登入'});
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${jwt}`}}});
  const {data:auth,error:authError}=await userClient.auth.getUser(jwt);
  if(authError||!auth.user)return response(401,{ok:false,error:'登入驗證失敗'});
  const serviceClient=createClient(url,service);
  const {data:admin,error:adminError}=await serviceClient.from('em_admins').select('user_id').eq('user_id',auth.user.id).maybeSingle();
  if(adminError||!admin)return response(403,{ok:false,error:'只有管理者可使用伺服器寄信'});
  const {job_id,to}=await req.json();
  if(typeof job_id!=='string'||!/^[0-9a-f-]{36}$/i.test(job_id)||typeof to!=='string'||to.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))return response(400,{ok:false,error:'參數格式錯誤'});
  const {data:job,error:jobError}=await serviceClient.from('em_jobs').select('id,template_name,inspector,equipment,work_date,status,fields,values').eq('id',job_id).single();
  if(jobError||!job)return response(404,{ok:false,error:'找不到作業'});
  const fields=Array.isArray(job.fields)?job.fields:[];
  const rows=[['作業編號',job.id],['樣板',job.template_name],['人員',job.inspector],['設備',job.equipment],['日期',job.work_date],['狀態',job.status],...fields.map((f:{id:string,label:string})=>[f.label,job.values?.[f.id]??''])];
  const html='<h2>設備保養作業紀錄</h2><table border="1" cellpadding="7" cellspacing="0">'+rows.map(r=>'<tr><th>'+esc(r[0])+'</th><td>'+esc(r[1])+'</td></tr>').join('')+'</table>';
  const key=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('MAIL_FROM');
  if(!key||!from)return response(500,{ok:false,error:'尚未設定 RESEND_API_KEY 或 MAIL_FROM'});
  const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject:`設備保養紀錄 - ${job.equipment}`,html})});
  if(!result.ok){console.error('Resend error',result.status,await result.text());return response(502,{ok:false,error:'郵件服務寄送失敗，請檢查寄件網域及設定'});}
  return response(200,{ok:true});
 }catch(e){console.error(e);return response(500,{ok:false,error:'伺服器處理失敗'});}
});
