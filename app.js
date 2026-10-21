import {backend} from './backend.js';
import {esc,uid,nowLocal,fieldTypes,validateTemplate,validateJob,csvDownload} from './logic.js';
const $=id=>document.getElementById(id);
const state={api:null,user:null,admin:false,tab:'work',templates:[],template:null,job:null,editingTemplate:null,history:[],historyJob:null,busy:false,workList:[],jobReadOnly:false};
const toast=(msg,bad=false)=>{const e=document.createElement('div');e.className='toast'+(bad?' bad':'');e.textContent=msg;$('toasts').append(e);setTimeout(()=>e.remove(),5500);};
const err=e=>{console.error(e);toast(e.message||String(e),true);};
async function run(btn,fn){if(state.busy)return;state.busy=true;if(btn)btn.disabled=true;try{await fn();}catch(e){err(e);}finally{state.busy=false;if(btn&&btn.isConnected)btn.disabled=false;}}
function view(){
 const nav=[['work','建立／填寫保養作業'],['admin','樣板管理'],['history','歷史紀錄']];
 $('app').innerHTML=`<header><div><h1>🔧 設備保養作業管理系統</h1><span class="muted small">多人共用 · 保養人員免登入</span></div><div class="actions"><span>${state.admin?'管理者已登入':'一般人員模式'}</span><button id="authBtn">${state.admin?'管理者登出':'管理者登入'}</button></div></header><nav class="tabs">${nav.filter(([key])=>key==='work'||state.admin).map(([key,title])=>`<button data-tab="${key}" class="${state.tab===key?'active':''}">${title}</button>`).join('')}</nav><main id="main"></main>`;
 $('authBtn').onclick=()=>state.admin?logout():loginForm();
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;view();});
 if(state.tab==='work')workView();else if(state.tab==='admin')templateView();else historyView();
}
function loginForm(){
 $('main').innerHTML=`<section class="card"><h2>管理者登入</h2><p class="muted">僅管理者需要 Email 與密碼；一般人員不需登入。</p><form id="loginForm" novalidate><label>電子郵件<input id="email" type="email" autocomplete="username" required></label><label>密碼<input id="password" type="password" autocomplete="current-password" required></label><div class="actions"><button class="primary" type="submit">登入</button><button type="button" id="cancelLogin">取消</button></div></form></section>`;
 $('cancelLogin').onclick=view;
 $('loginForm').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{await state.api.login($('email').value.trim(),$('password').value);try{await state.api.adminCheck();state.admin=true;state.user=await state.api.session();toast('管理者登入成功');view();}catch(error){await state.api.logout();throw error;}});};
}
async function logout(){await run($('authBtn'),async()=>{await state.api.logout();state.admin=false;state.user=null;state.tab='work';state.historyJob=null;toast('已登出');view();});}
function workView(){
 const job=state.job;
 const available=state.workList;
 const options=available.map(j=>`<option value="${esc(j.id)}" ${job?.id===j.id?'selected':''}>${j.status==='completed'?'✅ 已完成':'🟡 進行中'}｜${esc(j.equipment)}｜${esc(j.inspector)}｜${esc((j.work_date||'').replace('T',' ').slice(0,16))}</option>`).join('');
 $('main').innerHTML=`<section class="card"><h2>查詢／繼續保養作業</h2><div class="grid"><div><label>已建立作業（已完成／進行中）</label><select id="existingJob"><option value="">請選擇既有作業</option>${options}</select></div><div class="actions" style="align-items:end"><button id="refreshWork">重新整理作業清單</button><button id="openExisting" class="primary">開啟選取作業</button></div></div><p class="muted small">可查看及匯出既有作業。進行中作業僅建立時的同一瀏覽器工作階段可繼續修改；已完成作業僅能查看與匯出。此清單對開啟網站的人可見，請勿存放機密資料。</p></section><section class="card"><h2>新增／填寫保養作業</h2><div class="grid"><div><label>選擇保養樣板</label><select id="templatePick"><option value="">請選擇</option>${state.templates.map(t=>`<option value="${esc(t.id)}" ${(job?.template_id||state.template?.id)===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div><div><label>保養人員姓名</label><input id="inspector" maxlength="80" placeholder="請輸入姓名" value="${esc(job?.inspector||'')}"></div><div><label>設備名稱／編號</label><input id="equipment" maxlength="160" placeholder="例如：冷卻水泵 P-101" value="${esc(job?.equipment||'')}"></div><div><label>保養日期時間</label><input type="datetime-local" id="workDate" value="${esc(job?.work_date||nowLocal())}"></div></div><div class="actions"><button id="newJob">新增作業／清空表單</button></div></section><section id="workFields"></section>`;
 $('refreshWork').onclick=e=>run(e.currentTarget,async()=>{if(!confirm('重新整理清單不會儲存目前尚未儲存的輸入，確定？'))return;await refreshWorkList();workView();});
 $('openExisting').onclick=e=>run(e.currentTarget,async()=>{const id=$('existingJob').value;if(!id)throw new Error('請先選擇一筆作業');await openWorkJob(id);});
 $('templatePick').onchange=()=>{if(state.job?.id&&!confirm('切換樣板會清除目前作業，確定？')){$('templatePick').value=state.job.template_id;return;}state.job=null;state.jobReadOnly=false;const t=state.templates.find(t=>t.id===$('templatePick').value);state.template=t||null;workView();};
 $('newJob').onclick=()=>{if(state.job?.id&&!confirm('目前作業尚在畫面上，確定要新增？'))return;state.job=null;state.jobReadOnly=false;state.template=state.templates.find(t=>t.id===$('templatePick').value)||null;workView();};
 if(!state.template&&job)state.template=state.templates.find(t=>t.id===job.template_id)||null;
 const t=state.template;if(!t){$('workFields').innerHTML='<div class="notice">請先選擇保養樣板。</div>';return;}
 const values=job?.values||{};
 $('workFields').innerHTML=`<section class="card"><h2>${esc(t.name)}</h2><p class="muted">${esc(t.description||'')}</p>${renderFields(t.fields,values)}<div class="actions">${state.jobReadOnly?'':`<button id="saveDraft" class="primary">儲存作業</button><button id="finishJob" class="primary">結束作業</button>`}<button id="exportCurrent" ${!job?.id?'disabled':''}>手動匯出 CSV</button><button id="emailCurrent" ${!job?.id?'disabled':''}>發送 Mail</button></div><p class="muted small">結束作業不會自動匯出檔案。關閉頁面前請確認儲存成功。</p><div id="jobStatus" class="notice ${job?.status==='completed'?'success':''}">${job?.id?`作業編號：${esc(job.id)}　狀態：${job.status==='completed'?'已完成':'草稿'}`:'尚未儲存'}</div></section>`;
 if(!state.jobReadOnly){$('saveDraft').onclick=e=>run(e.currentTarget,()=>saveWork(false));$('finishJob').onclick=e=>run(e.currentTarget,()=>saveWork(true));}else{$('workFields').querySelectorAll('input,textarea,select').forEach(el=>el.disabled=true);$('jobStatus').textContent+='｜唯讀：可匯出 CSV；進行中作業需原瀏覽器編輯權杖才能續填';}$('exportCurrent').onclick=()=>exportJob(state.job,t);$('emailCurrent').onclick=e=>run(e.currentTarget,()=>emailJob(state.job,t));
}
function renderFields(fields,values={}){
 let previous=null,html='<div class="template-grid">';
 for(const f of fields){const section=(f.section||'').trim();
  if(section&&section!==previous){html+=`<h3 class="template-section">${esc(section)}</h3>`;previous=section;}
  html+=fieldHtml(f,values[f.id]);
 }
 return html+'</div>';
}
function fieldHtml(f,v){const req=f.required?' <span style="color:#b91c1c">*</span>':'';let ctrl='';const id=esc(f.id);
 if(f.type==='checkbox')ctrl=`<label class="inline"><input type="checkbox" data-field="${id}" ${v?'checked':''}> 是／已完成</label>`;
 else if(f.type==='radio')ctrl=(f.options||[]).map((opt,i)=>`<label class="inline"><input type="radio" name="field_${id}" data-field="${id}" value="${esc(opt)}" ${v===opt?'checked':''}>${esc(opt)}</label>`).join('');
 else if(f.type==='datetime')ctrl=`<input type="datetime-local" data-field="${id}" value="${esc(v||'')}">`;
 else if(f.type==='number')ctrl=`<input type="number" step="any" data-field="${id}" value="${esc(v??'')}" ${f.min!=null?`min="${esc(f.min)}"`:''} ${f.max!=null?`max="${esc(f.max)}"`:''} placeholder="${esc(f.placeholder||'請輸入量測值')}">`;
 else ctrl=`<textarea rows="2" data-field="${id}" placeholder="${esc(f.placeholder||'請輸入內容')}">${esc(v||'')}</textarea>`;
 return `<div class="field ${f.width==='half'?'field-half':'field-full'}"><label>${esc(f.label)}${req} ${f.unit?`<small>(${esc(f.unit)})</small>`:''}</label>${f.description?`<p class="muted small">${esc(f.description)}</p>`:''}${ctrl}</div>`;}
function getValues(fields){const out={};for(const f of fields){const nodes=[...document.querySelectorAll(`[data-field="${CSS.escape(f.id)}"]`)];if(f.type==='checkbox')out[f.id]=!!nodes[0]?.checked;else if(f.type==='radio')out[f.id]=nodes.find(n=>n.checked)?.value||'';else out[f.id]=nodes[0]?.value??'';}return out;}
async function saveWork(finish){const t=state.template;if(!t)throw new Error('請選擇樣板');const inspector=$('inspector').value.trim(),equipment=$('equipment').value.trim(),work_date=$('workDate').value;
 if(!inspector)throw new Error('請輸入保養人員姓名');if(!equipment)throw new Error('請輸入設備名稱／編號');const values=getValues(t.fields);if(finish)validateJob(t.fields,values);
 const payload={template_id:t.id,inspector,equipment,work_date,values};
 let result;if(state.job?.id){result=await state.api.saveJob(state.job.id,state.job.token,payload,finish);}else{result=await state.api.createJob({...payload,finish});}
 state.job={...payload,id:result.id,token:result.token||state.job?.token,status:result.status};
 if(state.job.token)sessionStorage.setItem('em_edit_'+state.job.id,state.job.token);state.jobReadOnly=finish;await refreshWorkList();
 toast(finish?'作業已成功結束並儲存（不自動匯出）':'作業已儲存');workView();}
async function refreshWorkList(){const data=await state.api.workList();state.workList=data.jobs||[];}
async function openWorkJob(id){
 const data=await state.api.workJob(id),j=data.job;
 const token=sessionStorage.getItem('em_edit_'+id)||null;
 state.job={...j,token};state.jobReadOnly=j.status==='completed'||!token;
 state.template={id:j.template_id,name:j.template_name,description:'',fields:j.fields||[]};
 toast(state.jobReadOnly?'已開啟作業（唯讀，可匯出）':'已開啟進行中作業，可繼續填寫');workView();
}
function jobRows(job,t){if(!job)return;const rows=[['項目','內容'],['作業編號',job.id],['樣板',t?.name||job.template_name],['保養人員',job.inspector],['設備',job.equipment],['日期',job.work_date],['狀態',job.status],...((t?.fields||job.fields||[]).map(f=>[f.label,job.values?.[f.id]??'']))];return rows;}
function exportJob(job,t){if(job)csvDownload(jobRows(job,t),`設備保養_${job.equipment||'作業'}.csv`);}

function downloadTemplates(templates){
 if(!templates.length){toast('目前沒有可匯出的樣板',true);return;}
 const rows=[['樣板名稱','樣板說明','欄位順序','欄位名稱','欄位類型','單位','必填','單選選項']];
 for(const t of templates)for(const [i,f] of (t.fields||[]).entries())rows.push([
  t.name,t.description||'',i+1,f.label||'',f.type||'',f.unit||'',f.required?'是':'否',(f.options||[]).join(' | ')
 ]);
 csvDownload(rows,`保養樣板_${templates.length===1?templates[0].name:'全部'}_${new Date().toISOString().slice(0,10)}.csv`);
}

// RFC 4180 CSV reader: quoted commas, quotes, CRLF and multiline cells.
function parseTemplateCsv(text){
 const input=String(text).replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quoted){if(c==='"'&&input[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
  else if(c==='"'){if(cell!=='')throw new Error(`CSV 第 ${rows.length+1} 列引號格式錯誤`);quoted=true;}
  else if(c===','){row.push(cell);cell='';}
  else if(c==='\r'||c==='\n'){if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()!==''))rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(quoted)throw new Error('CSV 引號未正確結束');row.push(cell);if(row.some(x=>x.trim()!==''))rows.push(row);
 if(rows.length<2)throw new Error('CSV 沒有樣板欄位資料');
 const columns=['樣板名稱','樣板說明','欄位順序','欄位名稱','欄位類型','單位','必填','單選選項'];
 const header=rows.shift().map(x=>x.trim());
 if(header.length!==columns.length||columns.some((x,i)=>header[i]!==x))throw new Error('CSV 標題必須依序為：'+columns.join('、'));
 const expected=columns.length;
 if(rows.length>1000)throw new Error('一次最多匯入 1000 個欄位');
 const grouped=new Map();
 rows.forEach((cells,index)=>{
  const line=index+2;
  if(cells.length!==expected)throw new Error(`CSV 第 ${line} 列應有 ${expected} 欄，實際 ${cells.length} 欄`);
  const [nameRaw,descriptionRaw,orderRaw,labelRaw,typeRaw,unitRaw,requiredRaw,optionsRaw]=cells;
  const name=nameRaw.trim(),description=descriptionRaw.trim(),label=labelRaw.trim(),type=typeRaw.trim(),requiredText=requiredRaw.trim();
  if(!name||!label)throw new Error(`CSV 第 ${line} 列樣板名稱與欄位名稱不可空白`);
  if(!fieldTypes[type])throw new Error(`CSV 第 ${line} 列欄位類型「${type}」無效`);
  if(!/^[1-9]\d*$/.test(orderRaw.trim()))throw new Error(`CSV 第 ${line} 列欄位順序必須是正整數`);
  if(!['是','否','true','false','1','0'].includes(requiredText.toLowerCase()))throw new Error(`CSV 第 ${line} 列必填欄位只能填「是」或「否」`);
  const required=['是','true','1'].includes(requiredText.toLowerCase());
  const options=type==='radio'?optionsRaw.split('|').map(x=>x.trim()).filter(Boolean):[];
  const field={id:uid(),label,description:'',type,unit:unitRaw.trim(),required,options};
  if(!grouped.has(name))grouped.set(name,{id:null,name,description,ordered:[],seen:new Set()});
  const template=grouped.get(name),order=Number(orderRaw.trim());
  if(template.description!==description)throw new Error(`CSV 第 ${line} 列「${name}」的樣板說明不一致`);
  if(template.seen.has(order))throw new Error(`CSV 第 ${line} 列「${name}」的欄位順序重複`);
  template.seen.add(order);template.ordered.push({order,field});
 });
 if(grouped.size>50)throw new Error('一次最多匯入 50 個樣板');
 return [...grouped.values()].map(t=>{const result={id:null,name:t.name,description:t.description,fields:t.ordered.sort((a,b)=>a.order-b.order).map(x=>x.field)};validateTemplate(result);return result;});
}
async function importTemplatesCsv(file){
 if(!file)return;
 if(!/\.csv$/i.test(file.name))throw new Error('請選擇 .csv 檔案');
 if(file.size>1024*1024)throw new Error('CSV 檔案不得超過 1MB');
 const items=parseTemplateCsv(await file.text());
 if(!confirm(`將匯入 ${items.length} 個樣板、共 ${items.reduce((n,t)=>n+t.fields.length,0)} 個欄位。\n匯入會建立新樣板，不覆蓋現有樣板。是否繼續？`))return;
 let count=0;
 try{for(const t of items){await state.api.saveTemplate(t);count++;}}
 catch(error){await reloadTemplates();templateView();throw new Error(`已匯入 ${count} 個樣板，其後失敗：${error.message}`);}
 await reloadTemplates();templateView();toast(`已成功匯入 ${count} 個 CSV 樣板`);
}

async function emailJob(job,t){
 if(!job?.id)throw new Error('請先儲存作業');
 const recipient=prompt('請輸入收件者 Email（管理者登入後由伺服器寄送；一般人員會開啟郵件程式）');
 if(recipient===null)return;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim()))throw new Error('收件者 Email 格式不正確');
 if(state.admin){
  // Only server can read a job for emailing. Prevent client-side content tampering.
  await state.api.emailJob(job.id,recipient.trim());toast('Mail 已由伺服器寄送');
 }else{
  const lines=jobRows(job,t).map(row=>row.map(v=>String(v??'')).join('：')).join('\n');
  const subject=`設備保養紀錄 - ${job.equipment||'作業'}`;
  const link=`mailto:${encodeURIComponent(recipient.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines)}`;
  if(link.length>1800)throw new Error('內容過長，請改由管理者登入後寄送，或先匯出 CSV');
  window.location.href=link;toast('已開啟郵件程式，請確認並按寄送（尚未自動寄出）');
 }
}

function templateView(){if(!state.admin){state.tab='work';view();return;}
 const t=state.editingTemplate||{id:null,name:'',description:'',fields:[]};
 $('main').innerHTML=`<section class="card"><h2>表單樣板管理</h2><p class="muted">樣板 CSV 固定 8 欄，不包含欄位 ID；匯入時會自動產生欄位 ID，並建立新樣板。</p><div class="actions"><button id="newTemplate" class="primary">新增空白樣板</button><button id="exportAllTemplates">匯出全部樣板 CSV</button><button id="importTemplate">匯入樣板 CSV</button><input id="templateFile" type="file" accept=".csv,text/csv" hidden></div><div class="grid">${state.templates.map(x=>`<div class="item"><b>${esc(x.name)}</b><p class="muted small">${x.fields?.length||0} 個欄位</p><button data-edit="${esc(x.id)}">編輯</button> <button data-export="${esc(x.id)}">匯出 CSV</button> <button class="danger" data-delete="${esc(x.id)}">刪除</button></div>`).join('')}</div></section><section class="card"><h2>${t.id?'編輯樣板':'建立新樣板'}</h2><label>樣板名稱<input id="tplName" value="${esc(t.name)}" placeholder="例如：SVC 冷卻泵定期保養"></label><label>說明<textarea id="tplDesc" rows="2">${esc(t.description)}</textarea></label><h3>保養欄位</h3><div id="fieldEditor">${t.fields.map((f,i)=>editorField(f,i)).join('')}</div><div class="actions"><button id="addField">＋ 新增欄位</button><button id="saveTemplate" class="primary" type="button">儲存樣板</button></div><div id="templateStatus" class="notice">等待編輯</div></section>`;
 $('exportAllTemplates').onclick=()=>downloadTemplates(state.templates);document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>downloadTemplates([state.templates.find(t=>t.id===b.dataset.export)]));$('importTemplate').onclick=()=>$('templateFile').click();$('templateFile').onchange=e=>{const file=e.target.files?.[0];e.target.value='';if(file)run($('importTemplate'),()=>importTemplatesCsv(file));};$('newTemplate').onclick=()=>{state.editingTemplate={id:null,name:'',description:'',fields:[]};templateView();};
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{state.editingTemplate=structuredClone(state.templates.find(t=>t.id===b.dataset.edit));templateView();});
 document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=e=>run(e.currentTarget,async()=>{if(!confirm('確定刪除樣板？已有作業使用的樣板不可刪除。'))return;await state.api.deleteTemplate(b.dataset.delete);await reloadTemplates();toast('樣板已刪除');templateView();}));
 $('addField').onclick=()=>{const draft=collectTemplate();draft.fields.push({id:uid(),label:'',description:'',type:'text',required:false,options:[],unit:'',section:'',width:'full',placeholder:'',min:null,max:null});state.editingTemplate=draft;templateView();};
 document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{const draft=collectTemplate();draft.fields.splice(Number(b.dataset.remove),1);state.editingTemplate=draft;templateView();});
 document.querySelectorAll('[data-type]').forEach(s=>s.onchange=()=>{state.editingTemplate=collectTemplate();templateView();});
 $('saveTemplate').onclick=e=>run(e.currentTarget,async()=>{const draft=collectTemplate();validateTemplate(draft);$('templateStatus').textContent='儲存中…';try{const result=await state.api.saveTemplate(draft);await reloadTemplates();state.editingTemplate=structuredClone(state.templates.find(x=>x.id===result.id));toast('樣板儲存成功');templateView();$('templateStatus').textContent='樣板已成功寫入 Supabase';}catch(error){$('templateStatus').className='notice error';$('templateStatus').textContent='儲存失敗：'+error.message;throw error;}});
}
function editorField(f,i){return `<div class="item" data-editor="${i}"><div class="item-head"><b>欄位 ${i+1}</b><button type="button" data-remove="${i}" class="danger">移除</button></div><div class="grid"><div><label>欄位名稱<input data-prop="label" value="${esc(f.label)}" placeholder="例如：出口壓力"></label></div><div><label>欄位說明<input data-prop="description" value="${esc(f.description||'')}" placeholder="例如：量測設備運轉時的出口壓力"></label></div><div><label>欄位類型<select data-prop="type" data-type="1">${Object.entries(fieldTypes).map(([key,name])=>`<option value="${key}" ${f.type===key?'selected':''}>${name}</option>`).join('')}</select></label></div><div><label>單位<input data-prop="unit" value="${esc(f.unit||'')}" placeholder="例如：bar、A、℃"></label></div><div><label>分區標題（同分區首個欄位填寫）<input data-prop="section" value="${esc(f.section||'')}" placeholder="例如：一、運轉檢查"></label></div><div><label>欄位寬度<select data-prop="width"><option value="full" ${(f.width||'full')==='full'?'selected':''}>full：整列</option><option value="half" ${f.width==='half'?'selected':''}>half：半列（雙欄）</option></select></label></div><div><label>輸入提示<input data-prop="placeholder" value="${esc(f.placeholder||'')}" placeholder="例如：請輸入量測值"></label></div><div><label>數字下限（選填）<input data-prop="min" type="number" step="any" value="${esc(f.min??'')}"></label></div><div><label>數字上限（選填）<input data-prop="max" type="number" step="any" value="${esc(f.max??'')}"></label></div></div>${f.type==='radio'?`<label>選項（每行一項）<textarea data-prop="options" rows="3">${esc((f.options||[]).join('\n'))}</textarea></label>`:''}<label class="inline"><input data-prop="required" type="checkbox" ${f.required?'checked':''}>必填欄位</label><input type="hidden" data-prop="id" value="${esc(f.id)}"></div>`;}
function collectTemplate(){const base=state.editingTemplate||{id:null};return {id:base.id||null,name:$('tplName').value.trim(),description:$('tplDesc').value.trim(),fields:[...document.querySelectorAll('[data-editor]')].map(div=>{const prop=k=>div.querySelector(`[data-prop="${k}"]`);return {id:prop('id').value,label:prop('label').value.trim(),description:prop('description').value.trim(),type:prop('type').value,unit:prop('unit').value.trim(),required:prop('required').checked,options:prop('options')?.value.split('\n').map(x=>x.trim()).filter(Boolean)||[],section:prop('section').value.trim(),width:prop('width').value,placeholder:prop('placeholder').value.trim(),min:prop('min').value===''?null:Number(prop('min').value),max:prop('max').value===''?null:Number(prop('max').value)};})};}
async function reloadTemplates(){state.templates=await state.api.templates();if(state.template)state.template=state.templates.find(t=>t.id===state.template.id)||null;}
async function loadHistory(){const data=await state.api.history();state.history=data.jobs||[];}
function historyView(){if(!state.admin){state.tab='work';view();return;}
 $('main').innerHTML=`<section class="card"><div class="item-head"><h2>歷史保養紀錄</h2><button id="refreshHistory">重新整理</button></div><div class="scroll"><table><thead><tr><th>日期</th><th>設備</th><th>樣板</th><th>人員</th><th>狀態</th><th>操作</th></tr></thead><tbody>${state.history.map(j=>`<tr><td>${esc(j.work_date||'')}</td><td>${esc(j.equipment)}</td><td>${esc(j.template_name)}</td><td>${esc(j.inspector)}</td><td>${j.status==='completed'?'已完成':'草稿'}</td><td><button data-open="${esc(j.id)}">檢視／編輯</button></td></tr>`).join('')||'<tr><td colspan="6">尚無紀錄，請按重新整理。</td></tr>'}</tbody></table></div></section><section id="historyDetail"></section>`;
 $('refreshHistory').onclick=e=>run(e.currentTarget,async()=>{await loadHistory();historyView();});document.querySelectorAll('[data-open]').forEach(b=>b.onclick=e=>run(e.currentTarget,async()=>{const data=await state.api.adminJob(b.dataset.open);state.historyJob=data.job;historyDetail();}));if(state.historyJob)historyDetail();}
function historyDetail(){const j=state.historyJob;if(!j)return;const fields=j.fields||[];$('historyDetail').innerHTML=`<section class="card"><h2>編輯歷史作業</h2><p class="muted">作業編號：${esc(j.id)} · 樣板：${esc(j.template_name)}</p><div class="grid"><div><label>人員<input id="hInspector" value="${esc(j.inspector)}"></label></div><div><label>設備<input id="hEquipment" value="${esc(j.equipment)}"></label></div><div><label>日期<input type="datetime-local" id="hDate" value="${esc((j.work_date||'').slice(0,16))}"></label></div><div><label>狀態<select id="hStatus"><option value="draft" ${j.status==='draft'?'selected':''}>草稿</option><option value="completed" ${j.status==='completed'?'selected':''}>已完成</option></select></label></div></div>${renderFields(fields,j.values||{})}<div class="actions"><button id="saveHistory" class="primary">儲存修改</button><button id="exportHistory">手動匯出 CSV</button><button id="emailHistory">發送 Mail</button></div></section>`;
 $('saveHistory').onclick=e=>run(e.currentTarget,async()=>{const payload={inspector:$('hInspector').value.trim(),equipment:$('hEquipment').value.trim(),work_date:$('hDate').value,status:$('hStatus').value,values:getValues(fields)};if(!payload.inspector||!payload.equipment)throw new Error('人員與設備不得空白');if(payload.status==='completed')validateJob(fields,payload.values);await state.api.adminSaveJob(j.id,payload);toast('歷史紀錄已更新');state.historyJob=(await state.api.adminJob(j.id)).job;await loadHistory();historyView();});$('exportHistory').onclick=()=>exportJob(j,null);$('emailHistory').onclick=e=>run(e.currentTarget,()=>emailJob(j,null));
}
async function init(){try{state.api=await backend();state.user=await state.api.session();if(state.user){try{await state.api.adminCheck();state.admin=true;}catch{state.admin=false;}}
 await reloadTemplates();await refreshWorkList();view();}catch(e){console.error(e);$('app').innerHTML=`<section class="card"><h1>無法啟動系統</h1><div class="notice error">${esc(e.message)}</div><p>請確認 js/config.js 設定、Supabase SQL 是否已執行，以及網路連線。</p></section>`;}}
init();
