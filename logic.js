export const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const uid = () => crypto.randomUUID();
export const nowLocal = () => {const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export const fieldTypes = {number:'數字量測',text:'文字備註',checkbox:'勾選',radio:'單選',datetime:'日期時間'};
export function validateTemplate(t){
  if(!t.name?.trim())throw new Error('請輸入樣板名稱');
  if(!Array.isArray(t.fields)||!t.fields.length)throw new Error('至少新增一個欄位');
  for(const f of t.fields){if(!f.label?.trim())throw new Error('所有欄位都需要名稱');if(!fieldTypes[f.type])throw new Error('欄位類型錯誤');if(f.type==='number'&&f.min!=null&&f.max!=null&&Number(f.min)>Number(f.max))throw new Error(`「${f.label}」下限不可大於上限`);if(f.type==='radio'&&(!Array.isArray(f.options)||f.options.filter(Boolean).length<2))throw new Error(`「${f.label}」至少需要兩個選項`);}
}
export function validateJob(fields,values){for(const f of fields){const v=values[f.id];if(f.required&&(v===undefined||v===null||v===''||(f.type==='checkbox'&&!v)))throw new Error(`請填寫必填欄位：「${f.label}」`);if(f.type==='number'&&v!==''&&v!==undefined&&v!==null){if(!Number.isFinite(Number(v)))throw new Error(`「${f.label}」必須是數字`);if(f.min!=null&&Number(v)<Number(f.min))throw new Error(`「${f.label}」不可低於 ${f.min}`);if(f.max!=null&&Number(v)>Number(f.max))throw new Error(`「${f.label}」不可高於 ${f.max}`);}}}
export function csvDownload(rows,name){
  const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
