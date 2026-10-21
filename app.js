import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';
const sb=createClient(SUPABASE_URL,SUPABASE_ANON_KEY), $=id=>document.getElementById(id);
let devices=[],history=[],selected=null,admin=false;
let qrScanner=null,qrStarting=false,qrStopping=false;
function say(s,ok=false){$('msg').textContent=s;$('msg').className=ok?'ok':''}
function safe(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function rpc(fn,args={}){const {data,error}=await sb.rpc(fn,args);if(error)throw Error(error.message);if(!data?.ok)throw Error(data?.error||'操作失敗');return data}
async function run(fn){try{say('');await fn()}catch(e){say(e.message||String(e))}}
function show(tab){if(tab!=='scan')void stopQrScanner();for(const id of ['scan','list','admin'])$(id).hidden=id!==tab;document.querySelectorAll('nav button').forEach(b=>b.disabled=b.dataset.tab===tab)}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{show(b.dataset.tab);if(b.dataset.tab==='list')run(refresh)});
async function refresh(){devices=(await rpc('equipmgr_list')).items;renderList()}
function status(d){return d.status==='borrowed'?(d.due_at&&d.due_at.slice(0,10)<new Date().toISOString().slice(0,10)?'逾期':'借出中'):'在庫'}
function renderList(){$('summary').textContent=`設備總數 ${devices.length} ｜ 在庫 ${devices.filter(x=>x.status==='available').length} ｜ 借出 ${devices.filter(x=>x.status==='borrowed').length}`;$('items').innerHTML=devices.map(d=>`<tr><td>${safe(d.code)}</td><td>${safe(d.name)}</td><td>${status(d)}</td><td>${safe(d.borrower)}</td><td>${safe(d.due_at?.slice(0,10))}</td><td><button data-code="${safe(d.code)}">操作</button></td></tr>`).join('');$('items').querySelectorAll('button').forEach(b=>b.onclick=()=>{show('scan');$('code').value=b.dataset.code;run(findDevice)})}
async function findDevice(){const code=$('code').value.trim();if(!code)throw Error('請輸入設備編碼');const r=await rpc('equipmgr_get',{p_code:code});selected=r.item;$('device').innerHTML=`<h3>${safe(selected.name)}</h3><p>編碼：${safe(selected.code)} ｜ 狀態：${status(selected)}</p><p>型號：${safe(selected.model)} ｜ 位置：${safe(selected.location)}</p>${selected.status==='borrowed'?`<p>借用人：${safe(selected.borrower)} ｜ 預計歸還：${safe(selected.due_at?.slice(0,10))}</p>`:''}`;$('action').hidden=false;$('borrow').hidden=selected.status!=='available';$('return').hidden=selected.status!=='borrowed';$('dueLabel').hidden=selected.status!=='available'}
// QR Code 掃描：支援本系統產生的 ?device=EQ-0001 網址與純設備編碼。
function decodeEquipmentQr(raw){
  const value=String(raw??'').trim();
  if(!value)throw Error('QR Code 沒有內容');
  let code=value;
  try{
    const url=new URL(value);
    // 避免掃描外部網站網址後被當成設備編碼；僅接受本站產生的 QR URL。
    if(url.origin!==location.origin || url.pathname!==location.pathname)throw Error('這不是本設備借還系統的 QR Code');
    code=url.searchParams.get('device')||'';
  }catch(e){
    if(e.message==='這不是本設備借還系統的 QR Code')throw e;
    if(/^https?:\/\//i.test(value))throw Error('QR Code 網址格式不正確');
  }
  code=code.trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(code))throw Error('QR Code 的設備編碼格式不正確');
  return code;
}
async function stopQrScanner(){
  $('qrScannerPanel').hidden=true;
  const instance=qrScanner;
  qrScanner=null;
  if(!instance)return;
  try{await instance.stop()}catch{}
  try{instance.clear()}catch{}
}
$('scanQr').onclick=()=>run(async()=>{
  if(qrStarting||qrScanner)return;
  if(!window.isSecureContext)throw Error('相機功能需要 HTTPS，請使用 GitHub Pages 網址');
  if(!navigator.mediaDevices?.getUserMedia)throw Error('此瀏覽器不支援相機存取，請使用手機 Chrome 或 Safari');
  if(typeof Html5Qrcode==='undefined')throw Error('QR 掃描套件載入失敗，請檢查網路後重新整理');
  qrStarting=true;
  $('qrScannerPanel').hidden=false;
  $('qrScanStatus').textContent='正在啟動相機，請允許相機權限…';
  const scanner=new Html5Qrcode('qrReader',{verbose:false});
  qrScanner=scanner;
  try{
    await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:230,height:230}},async decoded=>{
      if(qrStopping)return;
      qrStopping=true;
      try{
        const code=decodeEquipmentQr(decoded);
        await stopQrScanner();
        $('code').value=code;
        await run(findDevice);
      }catch(e){
        $('qrScanStatus').textContent=e.message||'無法辨識設備 QR Code，請重試';
        if(qrScanner===scanner)qrStopping=false;
        else say(e.message||String(e));
      }
    },()=>{});
    $('qrScanStatus').textContent='請將設備 QR Code 對準掃描框';
  }catch(e){
    await stopQrScanner();
    throw Error('無法開啟相機：'+(e.message||String(e))+'。請確認已允許相機權限。');
  }finally{qrStarting=false}
});
$('stopQr').onclick=()=>{qrStopping=false;void stopQrScanner()};
$('find').onclick=()=>run(async()=>{await stopQrScanner();await findDevice()});
async function transact(kind){if(!selected)throw Error('請先查詢設備');const name=$('person').value.trim();if(!name)throw Error('請填寫操作人員姓名');const r=await rpc('equipmgr_transact',{p_code:selected.code,p_person:name,p_action:kind,p_note:$('note').value.trim(),p_due:$('due').value||null});say(kind==='borrow'?'借出成功':'歸還成功',true);$('note').value='';await findDevice();await refresh()}
$('borrow').onclick=()=>run(()=>transact('borrow'));$('return').onclick=()=>run(()=>transact('return'));
async function checkAdmin(){const {data}=await sb.auth.getUser();admin=false;if(data?.user){try{await rpc('em_admin_check');admin=true}catch{}}$('login').hidden=admin;$('adminTools').hidden=!admin;if(admin){await refresh();await loadHistory()}}
$('signIn').onclick=()=>run(async()=>{const {error}=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw Error(error.message);await checkAdmin();if(!admin)throw Error('此帳號不是保養系統管理員');say('登入成功',true)});
$('signOut').onclick=()=>run(async()=>{await sb.auth.signOut();await checkAdmin();say('已登出',true)});
$('save').onclick=()=>run(async()=>{await rpc('equipmgr_admin_upsert',{p_item:{code:$('aCode').value.trim(),name:$('aName').value.trim(),model:$('aModel').value.trim(),location:$('aLocation').value.trim(),notes:$('aNotes').value.trim()}});await refresh();say('設備已儲存',true)});
function csvCell(v){const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function download(name,rows){const csv='﻿'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$('export').onclick=()=>run(async()=>{await refresh();download('equipment.csv',[['code','name','model','location','notes'],...devices.map(x=>[x.code,x.name,x.model,x.location,x.notes])])});
function parseCSV(text){const rows=[];let row=[],field='',quote=false;for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quote=false;else field+=c}else if(c==='"')quote=true;else if(c===','){row.push(field);field=''}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}else field+=c}if(quote)throw Error('CSV 引號格式錯誤');if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}return rows}
$('import').onclick=()=>run(async()=>{const file=$('csvFile').files[0];if(!file)throw Error('請選擇 CSV');const rows=parseCSV((await file.text()).replace(/^﻿/,''));const header=['code','name','model','location','notes'];if(header.some((x,i)=>rows[0]?.[i]!==x))throw Error('CSV 標題必須為 '+header.join(','));const items=rows.slice(1).filter(r=>r.some(x=>x.trim())).map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]||''])));if(items.length>200)throw Error('每次最多匯入 200 筆');if(!confirm(`確認匯入 ${items.length} 筆設備？同編碼將更新設備基本資料。`))return;await rpc('equipmgr_admin_import',{p_items:items});await refresh();say('匯入完成',true)});
async function loadHistory(){history=(await rpc('equipmgr_admin_history')).items;$('history').innerHTML=history.map(h=>`<tr><td>${safe(h.code)}</td><td>${safe(h.borrower)}</td><td>${safe(h.borrowed_at)}</td><td>${safe(h.due_at)}</td><td>${safe(h.returned_by)}</td><td>${safe(h.returned_at)}</td></tr>`).join('')}
$('historyRefresh').onclick=()=>run(loadHistory);$('historyExport').onclick=()=>run(async()=>{await loadHistory();download('loan_history.csv',[['code','borrower','borrowed_at','due_at','returned_by','returned_at','note','return_note'],...history.map(h=>[h.code,h.borrower,h.borrowed_at,h.due_at,h.returned_by,h.returned_at,h.note,h.return_note])])});
$('print').onclick=()=>run(async()=>{await refresh();const old=$('printArea');if(old)old.remove();const root=document.createElement('div');root.id='printArea';root.style.display='none';document.body.append(root);for(const d of devices){const el=document.createElement('div');el.className='sticker';const url=new URL(location.href);url.searchParams.set('device',d.code);const img=document.createElement('img');img.alt='QR';img.src=await QRCode.toDataURL(url.href,{width:160,margin:1});el.append(img);const p=document.createElement('p');p.textContent=d.code+' '+d.name;el.append(p);root.append(el)}await Promise.all([...root.querySelectorAll('img')].map(img=>new Promise(resolve=>{img.onload=resolve;img.onerror=resolve})));window.print()});
const code=new URLSearchParams(location.search).get('device');show('scan');if(code){$('code').value=code;run(findDevice)}run(async()=>{await refresh();await checkAdmin()});
