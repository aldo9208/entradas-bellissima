/* ===== Toma de inventario — módulo autónomo =====
   <script type="module" src="./inventarios.js?v=1"></script>
   CEDIS crea una "toma" para una sucursal (sube Excel/CSV de SAIT con clave/desc/existencia,
   o la deja libre). La sucursal cuenta A CIEGAS (no ve la existencia del sistema) y sube foto
   por artículo. CEDIS revisa la comparación Sistema vs Físico y cierra la toma.
   El modo (contar vs revisar) depende de window.__adminOK. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, addDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

const CH = 700000;
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const nk = s => String(s==null?'':s).trim().replace(/^0+/,''); // clave sin ceros a la izquierda

let SUCS=[], lastSuc='';
let PREVIEW=[];      // items parseados del archivo antes de crear
let TOMA=null;       // toma abierta en memoria {id, ...}
let filtroTxt='';

async function cargarSucursales(){
  if(SUCS.length) return SUCS;
  try{ const s=await getDocs(collection(db,'traspasos')); const set=new Set(); s.forEach(d=>{const x=d.data().sucDest; if(x) set.add(x);});
    SUCS=[...set].sort((a,b)=>{const na=parseInt(a)||99,nb=parseInt(b)||99;return na-nb;}); }catch(e){ SUCS=[]; }
  if(SUCS.length && !lastSuc) lastSuc=SUCS[0];
  return SUCS;
}

/* ---------- fotos ---------- */
function comprimir(file){
  return new Promise((res,rej)=>{ const img=new Image(); const url=URL.createObjectURL(file);
    img.onload=()=>{ URL.revokeObjectURL(url); let w=img.width,h=img.height; const max=1200;
      if(w>max||h>max){ const s=Math.min(max/w,max/h); w=Math.round(w*s); h=Math.round(h*s); }
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h; cv.getContext('2d').drawImage(img,0,0,w,h);
      res(cv.toDataURL('image/jpeg',0.7)); };
    img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error('img')); }; img.src=url; });
}
async function guardarFoto(dataUrl,nombre){
  const b64=dataUrl.slice(dataUrl.indexOf(',')+1); const n=Math.ceil(b64.length/CH);
  const ref=await addDoc(collection(db,'adjuntos'),{nombre:nombre||'inv.jpg',tipo:'image/jpeg',nChunks:n,ts:Date.now()});
  for(let i=0;i<n;i++) await setDoc(doc(db,'adjuntos',ref.id,'chunks',String(i)),{d:b64.slice(i*CH,(i+1)*CH)});
  return ref.id;
}
async function abrirFoto(id){
  try{ const meta=await getDoc(doc(db,'adjuntos',id)); if(!meta.exists()){alert('No encontré la foto.');return;}
    const m=meta.data(); let s=''; for(let i=0;i<m.nChunks;i++){ const d=await getDoc(doc(db,'adjuntos',id,'chunks',String(i))); if(d.exists()) s+=d.data().d; }
    const bin=atob(s),arr=new Uint8Array(bin.length); for(let k=0;k<bin.length;k++) arr[k]=bin.charCodeAt(k);
    const url=URL.createObjectURL(new Blob([arr],{type:m.tipo||'image/jpeg'})); window.open(url,'_blank'); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(e){ alert('Error: '+e.message); }
}
window.invtVerFoto=function(id){ if(id) abrirFoto(id); };

/* ---------- crear toma (CEDIS) ---------- */
window.invtNueva=async function(){
  await cargarSucursales();
  PREVIEW=[];
  ensureNuevaModal();
  const sel=document.getElementById('invt-suc');
  if(sel) sel.innerHTML=SUCS.map(s=>'<option value="'+esc(s)+'"'+(s===lastSuc?' selected':'')+'>'+esc(s)+'</option>').join('');
  document.getElementById('invt-titulo').value='Toma '+new Date().toLocaleDateString('es-MX');
  document.getElementById('invt-preview').innerHTML='';
  document.getElementById('invt-nueva-status').textContent='';
  document.getElementById('m-invt-nueva').style.display='flex';
};
window.invtCerrarNueva=function(){ const m=document.getElementById('m-invt-nueva'); if(m) m.style.display='none'; };

window.invtParseFile=async function(files){
  const st=document.getElementById('invt-nueva-status'); const pv=document.getElementById('invt-preview');
  if(!files||!files.length) return;
  const file=files[0];
  st.style.color='#555'; st.textContent='Leyendo archivo…';
  try{
    let rows=[];
    const XLSX = window.XLSX;
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    if(ext==='csv' || !XLSX){
      const txt=await file.text();
      rows=txt.split(/\r?\n/).filter(l=>l.trim()).map(l=> l.split(/[,;\t]/).map(c=>c.replace(/^"|"$/g,'').trim()) );
    } else {
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
    }
    if(!rows.length){ st.style.color='#dc2626'; st.textContent='El archivo está vacío.'; return; }
    // detectar columnas por encabezado
    const head=rows[0].map(h=>String(h).toLowerCase());
    const findCol=(cands)=>{ for(let i=0;i<head.length;i++){ if(cands.some(c=>head[i].includes(c))) return i; } return -1; };
    let ci=findCol(['clave','codigo','código','numart','articulo','artículo']);
    let di=findCol(['desc','nombre','producto']);
    let ei=findCol(['exist','existencia','cantidad','stock','inventario','cant']);
    let start=1;
    // si no hay encabezado reconocible, asumir col0=clave, col1=desc, col2=exist y empezar en 0
    if(ci<0){ ci=0; di=rows[0].length>2?1:-1; ei=rows[0].length>2?2:1; start=0; }
    const items=[];
    for(let r=start;r<rows.length;r++){
      const row=rows[r]; if(!row) continue;
      const clave=String(row[ci]==null?'':row[ci]).trim();
      if(!clave) continue;
      const desc = di>=0 ? String(row[di]==null?'':row[di]).trim() : '';
      let ex = ei>=0 ? parseFloat(String(row[ei]).replace(/[^0-9.\-]/g,'')) : NaN;
      if(isNaN(ex)) ex=null;
      items.push({ clave, claveKey:nk(clave), desc, sistema:ex, fisico:null, foto:null, por:'', ts:0 });
    }
    PREVIEW=items;
    st.style.color='#16a34a'; st.textContent='✓ '+items.length+' artículos leídos.';
    pv.innerHTML='<div style="font-size:12px;color:#555;margin-top:8px">Vista previa ('+Math.min(5,items.length)+' de '+items.length+'):</div>'+
      items.slice(0,5).map(it=>'<div style="font-size:12px;padding:3px 0;border-bottom:1px solid #f2f2f2"><b>'+esc(it.clave)+'</b> '+esc(it.desc||'')+' <span style="color:#999">— sist: '+(it.sistema==null?'(s/d)':it.sistema)+'</span></div>').join('');
  }catch(e){ st.style.color='#dc2626'; st.textContent='Error al leer: '+e.message; }
};

window.invtCrear=async function(){
  const suc=document.getElementById('invt-suc').value;
  const titulo=document.getElementById('invt-titulo').value.trim()||('Toma '+new Date().toLocaleDateString('es-MX'));
  const permiteLibre=document.getElementById('invt-libre').checked;
  const st=document.getElementById('invt-nueva-status');
  if(!PREVIEW.length && !permiteLibre){ alert('Sube un archivo o marca "permitir agregar libres".'); return; }
  lastSuc=suc;
  st.style.color='#16a34a'; st.textContent='Creando toma…';
  try{
    const toma={ sucursal:suc, titulo, fecha:new Date().toLocaleDateString('es-MX'), ts:Date.now(),
      estado:'abierta', permiteLibre, items:PREVIEW.map(x=>({clave:x.clave,claveKey:x.claveKey,desc:x.desc,sistema:x.sistema,fisico:null,foto:null,por:'',ts:0})) };
    await addDoc(collection(db,'tomasInv'), toma);
    invtCerrarNueva(); renderTomasList();
  }catch(e){ st.style.color='#dc2626'; st.textContent='Error: '+e.message; }
};

/* ---------- lista de tomas ---------- */
window.renderTomasList=async function(){
  const cont=document.getElementById('invt-lista'); if(!cont) return;
  cont.innerHTML='<p style="color:var(--muted,#777)">Cargando…</p>';
  let arr=[]; try{ const s=await getDocs(collection(db,'tomasInv')); s.forEach(d=>arr.push({id:d.id, ...d.data()})); }catch(e){}
  arr.sort((a,b)=>(b.ts||0)-(a.ts||0));
  const esAdmin=!!window.__adminOK;
  let h='';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
  h+='<span style="font-size:12.5px;color:#777">'+(esAdmin?'Modo CEDIS (revisión)':'Toca tu toma para contar')+'</span>';
  if(esAdmin) h+='<button class="btn btn-sm" onclick="invtNueva()" style="background:#0369a1;color:#fff;border:none">➕ Nueva toma</button>';
  h+='</div>';
  if(!arr.length){ h+='<div style="padding:24px;text-align:center;color:var(--muted,#777)">Aún no hay tomas de inventario.</div>'; cont.innerHTML=h; return; }
  arr.forEach(t=>{
    const total=(t.items||[]).length;
    const contados=(t.items||[]).filter(i=>i.fisico!=null).length;
    const cerrada=t.estado==='cerrada';
    const badge='<span style="background:'+(cerrada?'#16a34a':'#d97706')+';color:#fff;font-size:10.5px;padding:2px 8px;border-radius:99px">'+(cerrada?'Cerrada':'Abierta')+'</span>';
    h+='<div onclick="invtAbrir(\''+t.id+'\')" style="background:#fff;border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:12px 14px;margin-bottom:10px;cursor:pointer">';
    h+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div style="flex:1"><div style="font-weight:600;font-size:14px">📋 '+esc(t.titulo||'Toma')+'</div>';
    h+='<div style="font-size:11.5px;color:var(--muted,#777);margin-top:2px">'+esc(t.sucursal||'')+' · '+esc(t.fecha||'')+' · '+contados+'/'+total+' contados</div></div>'+badge+'</div></div>';
  });
  cont.innerHTML=h;
};

/* ---------- abrir toma: contar (ciego) o revisar (admin) ---------- */
window.invtAbrir=async function(id){
  const cont=document.getElementById('invt-lista');
  cont.innerHTML='<p style="color:var(--muted,#777)">Cargando toma…</p>';
  let t=null; try{ const s=await getDoc(doc(db,'tomasInv',id)); if(s.exists()) t={id, ...s.data()}; }catch(e){}
  if(!t){ cont.innerHTML='<p>No encontré la toma.</p>'; return; }
  TOMA=t; filtroTxt='';
  if(window.__adminOK) pintarRevisar(); else pintarContar();
};
window.invtVolver=function(){ TOMA=null; renderTomasList(); };
window.invtFiltro=function(v){ filtroTxt=(v||'').toLowerCase(); pintarContar(); };

/* modo contar (sucursal, a ciegas) */
function pintarContar(){
  const cont=document.getElementById('invt-lista'); if(!cont||!TOMA) return;
  const t=TOMA; const items=t.items||[];
  const cerrada=t.estado==='cerrada';
  const contados=items.filter(i=>i.fisico!=null).length;
  let h='';
  h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><button class="btn btn-sm" onclick="invtVolver()">←</button>';
  h+='<div style="flex:1"><b style="font-size:15px">'+esc(t.titulo||'Toma')+'</b><div style="font-size:11.5px;color:#777">'+esc(t.sucursal||'')+' · '+contados+'/'+items.length+' contados</div></div></div>';
  if(cerrada) h+='<div style="background:#dcfce7;color:#166534;font-size:12px;padding:6px 10px;border-radius:8px;margin-bottom:10px">Esta toma ya está cerrada. Solo lectura.</div>';
  // agregar libre
  if(t.permiteLibre && !cerrada){
    h+='<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:10px;margin-bottom:10px">'+
       '<div style="font-size:12px;color:#555;margin-bottom:5px">¿Encontraste algo que no está en la lista?</div>'+
       '<div style="display:flex;gap:6px;flex-wrap:wrap"><input id="invt-lib-cod" placeholder="Código" style="flex:1;min-width:80px;padding:7px;border:1px solid #ccc;border-radius:7px;font-size:13px">'+
       '<input id="invt-lib-desc" placeholder="Descripción" style="flex:2;min-width:100px;padding:7px;border:1px solid #ccc;border-radius:7px;font-size:13px">'+
       '<button class="btn btn-sm" onclick="invtAddLibre()" style="background:#0369a1;color:#fff;border:none">➕</button></div></div>';
  }
  // buscador
  if(items.length>8) h+='<input placeholder="🔎 Buscar artículo…" oninput="invtFiltro(this.value)" value="'+esc(filtroTxt)+'" style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;font-size:13px;margin-bottom:10px;box-sizing:border-box">';
  // lista de items (SIN mostrar sistema)
  items.forEach((it,i)=>{
    if(filtroTxt && !((it.clave||'').toLowerCase().includes(filtroTxt) || (it.desc||'').toLowerCase().includes(filtroTxt))) return;
    const hecho=it.fisico!=null;
    h+='<div style="background:#fff;border:1px solid '+(hecho?'#bbf7d0':'#eee')+';border-left:3px solid '+(hecho?'#16a34a':'#ddd')+';border-radius:10px;padding:10px 12px;margin-bottom:8px">';
    h+='<div style="font-weight:600;font-size:13px">'+esc(it.clave)+(it.libre?' <span style="font-size:10px;color:#0369a1">(agregado)</span>':'')+'</div>';
    if(it.desc) h+='<div style="font-size:11.5px;color:#777;margin-bottom:6px">'+esc(it.desc)+'</div>';
    if(cerrada){
      h+='<div style="font-size:13px">Contado: <b>'+(it.fisico==null?'—':it.fisico)+'</b>'+(it.foto?' · <span style="color:#0369a1;cursor:pointer" onclick="invtVerFoto(\''+it.foto.id+'\')">📷 ver</span>':'')+'</div>';
    } else {
      h+='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
      h+='<input type="number" min="0" inputmode="numeric" placeholder="Cantidad" value="'+(it.fisico==null?'':it.fisico)+'" onchange="invtSetFisico('+i+',this.value)" style="width:110px;padding:8px;border:1px solid #ccc;border-radius:8px;font-size:14px">';
      h+='<label style="display:inline-flex;align-items:center;gap:4px;padding:8px 10px;border:1px solid #0369a1;background:'+(it.foto?'#0369a1':'#fff')+';color:'+(it.foto?'#fff':'#0369a1')+';border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">'+(it.foto?'✓ Foto':'📷 Foto')+'<input type="file" accept="image/*" capture="environment" style="display:none" onchange="invtFotoItem('+i+',this.files)"></label>';
      if(it.foto) h+='<span style="color:#0369a1;cursor:pointer;font-size:12px" onclick="invtVerFoto(\''+it.foto.id+'\')">ver</span>';
      h+='</div>';
    }
    h+='</div>';
  });
  if(!cerrada) h+='<button class="btn btn-primary" onclick="invtGuardarConteo()" style="width:100%;margin-top:8px;background:#0369a1">💾 Guardar conteo</button>';
  h+='<div id="invt-conteo-status" style="text-align:center;font-size:12.5px;margin-top:8px;min-height:16px;color:#16a34a"></div>';
  cont.innerHTML=h;
}
window.invtSetFisico=function(i,v){ if(!TOMA) return; const n=(v===''||v==null)?null:(parseInt(v)||0); TOMA.items[i].fisico=n; };
window.invtFotoItem=async function(i,files){
  if(!TOMA||!files||!files.length) return;
  const st=document.getElementById('invt-conteo-status'); if(st){ st.style.color='#555'; st.textContent='Procesando foto…'; }
  try{ const dataUrl=await comprimir(files[0]); const id=await guardarFoto(dataUrl, TOMA.items[i].clave+'.jpg'); TOMA.items[i].foto={id,nombre:TOMA.items[i].clave+'.jpg'}; if(st){ st.style.color='#16a34a'; st.textContent='✓ Foto lista'; } pintarContar(); }
  catch(e){ if(st){ st.style.color='#dc2626'; st.textContent='Error foto: '+e.message; } }
};
window.invtAddLibre=function(){
  if(!TOMA) return;
  const cod=(document.getElementById('invt-lib-cod').value||'').trim();
  const desc=(document.getElementById('invt-lib-desc').value||'').trim();
  if(!cod){ alert('Escribe el código.'); return; }
  TOMA.items.push({ clave:cod, claveKey:nk(cod), desc:desc||'(agregado)', sistema:null, fisico:null, foto:null, por:'', ts:0, libre:true });
  filtroTxt=''; pintarContar();
};
window.invtGuardarConteo=async function(){
  if(!TOMA) return;
  const st=document.getElementById('invt-conteo-status'); if(st){ st.style.color='#16a34a'; st.textContent='Guardando…'; }
  try{ await updateDoc(doc(db,'tomasInv',TOMA.id), { items:TOMA.items }); if(st){ st.style.color='#16a34a'; st.textContent='✓ Conteo guardado. Puedes seguir después.'; } }
  catch(e){ if(st){ st.style.color='#dc2626'; st.textContent='Error: '+e.message; } }
};

/* modo revisar (CEDIS): Sistema vs Físico */
function pintarRevisar(){
  const cont=document.getElementById('invt-lista'); if(!cont||!TOMA) return;
  const t=TOMA; const items=t.items||[];
  let cuadran=0, conDif=0, difTotal=0, sinContar=0;
  items.forEach(it=>{ if(it.fisico==null){ sinContar++; return; } const dif=(it.fisico)-(it.sistema==null?it.fisico:it.sistema); if(it.sistema==null){ return; } if(dif===0) cuadran++; else { conDif++; difTotal+=dif; } });
  let h='';
  h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><button class="btn btn-sm" onclick="invtVolver()">←</button>';
  h+='<div style="flex:1"><b style="font-size:15px">'+esc(t.titulo||'Toma')+'</b><div style="font-size:11.5px;color:#777">'+esc(t.sucursal||'')+' · '+esc(t.fecha||'')+' · '+(t.estado==='cerrada'?'Cerrada':'Abierta')+'</div></div>';
  h+='<button class="btn btn-sm" onclick="invtExport()" style="font-size:11px">⬇ CSV</button></div>';
  // resumen
  h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:12px">';
  h+='<div style="background:#f0fdf4;border-radius:10px;padding:9px;text-align:center"><div style="font-size:18px;font-weight:700;color:#16a34a">'+cuadran+'</div><div style="font-size:10.5px;color:#555">cuadran</div></div>';
  h+='<div style="background:#fef2f2;border-radius:10px;padding:9px;text-align:center"><div style="font-size:18px;font-weight:700;color:#dc2626">'+conDif+'</div><div style="font-size:10.5px;color:#555">con diferencia</div></div>';
  h+='<div style="background:#fffbeb;border-radius:10px;padding:9px;text-align:center"><div style="font-size:18px;font-weight:700;color:#d97706">'+sinContar+'</div><div style="font-size:10.5px;color:#555">sin contar</div></div>';
  h+='<div style="background:#f8fafc;border-radius:10px;padding:9px;text-align:center"><div style="font-size:18px;font-weight:700;color:'+(difTotal===0?'#16a34a':(difTotal>0?'#0369a1':'#dc2626'))+'">'+(difTotal>0?'+':'')+difTotal+'</div><div style="font-size:10.5px;color:#555">dif. neta (pz)</div></div>';
  h+='</div>';
  // tabla
  h+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:380px">';
  h+='<thead><tr style="color:#777;font-size:11px"><th style="text-align:left;padding:6px 6px;border-bottom:1px solid #eee">Clave</th><th style="text-align:right;padding:6px 6px;border-bottom:1px solid #eee">Sist.</th><th style="text-align:right;padding:6px 6px;border-bottom:1px solid #eee">Físico</th><th style="text-align:right;padding:6px 6px;border-bottom:1px solid #eee">Dif.</th><th style="text-align:center;padding:6px 6px;border-bottom:1px solid #eee">Foto</th></tr></thead><tbody>';
  items.forEach(it=>{
    const sis=it.sistema==null?null:it.sistema; const fis=it.fisico;
    let dif=null, cls='#555', txt='—';
    if(fis!=null && sis!=null){ dif=fis-sis; if(dif===0){txt='✓';cls='#16a34a';} else {txt=(dif>0?'+':'')+dif; cls=dif>0?'#0369a1':'#dc2626';} }
    else if(fis!=null && sis==null){ txt='nuevo'; cls='#0369a1'; }
    h+='<tr><td style="padding:6px 6px;border-bottom:1px solid #f4f4f4"><b>'+esc(it.clave)+'</b>'+(it.desc?'<div style="font-size:10px;color:#999;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(it.desc)+'</div>':'')+'</td>'+
       '<td style="text-align:right;padding:6px 6px;border-bottom:1px solid #f4f4f4;color:#777">'+(sis==null?'—':sis)+'</td>'+
       '<td style="text-align:right;padding:6px 6px;border-bottom:1px solid #f4f4f4;font-weight:600">'+(fis==null?'—':fis)+'</td>'+
       '<td style="text-align:right;padding:6px 6px;border-bottom:1px solid #f4f4f4;color:'+cls+';font-weight:600">'+txt+'</td>'+
       '<td style="text-align:center;padding:6px 6px;border-bottom:1px solid #f4f4f4">'+(it.foto?'<span style="color:#0369a1;cursor:pointer" onclick="invtVerFoto(\''+it.foto.id+'\')">📷</span>':'')+'</td></tr>';
  });
  h+='</tbody></table></div>';
  if(t.estado!=='cerrada') h+='<button class="btn btn-primary" onclick="invtCerrar()" style="width:100%;margin-top:12px;background:#16a34a">✓ Cerrar toma</button>';
  h+='<div id="invt-rev-status" style="text-align:center;font-size:12.5px;margin-top:8px;min-height:16px;color:#16a34a"></div>';
  cont.innerHTML=h;
}
window.invtCerrar=async function(){
  if(!TOMA) return;
  const st=document.getElementById('invt-rev-status'); if(st){ st.style.color='#16a34a'; st.textContent='Cerrando…'; }
  try{ await updateDoc(doc(db,'tomasInv',TOMA.id), { estado:'cerrada', tsCierre:Date.now() }); TOMA.estado='cerrada'; pintarRevisar(); }
  catch(e){ if(st){ st.style.color='#dc2626'; st.textContent='Error: '+e.message; } }
};
window.invtExport=function(){
  if(!TOMA) return;
  const rows=[['Clave','Descripcion','Sistema','Fisico','Diferencia']];
  (TOMA.items||[]).forEach(it=>{ const dif=(it.fisico!=null&&it.sistema!=null)?(it.fisico-it.sistema):''; rows.push([it.clave, it.desc||'', it.sistema==null?'':it.sistema, it.fisico==null?'':it.fisico, dif]); });
  const csv=rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=(TOMA.titulo||'toma')+'.csv'; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1500);
};

/* ---------- modal crear ---------- */
function ensureNuevaModal(){
  if(document.getElementById('m-invt-nueva')) return;
  const d=document.createElement('div'); d.id='m-invt-nueva';
  d.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1003;align-items:center;justify-content:center';
  d.innerHTML='<div style="background:#fff;border-radius:12px;padding:18px;max-width:440px;width:92%;max-height:90vh;overflow-y:auto">'+
    '<h3 style="margin:0 0 12px;font-size:18px;color:#0369a1">Nueva toma de inventario</h3>'+
    '<label style="display:block;font-size:12px;color:#555;margin:6px 0 3px">Sucursal</label>'+
    '<select id="invt-suc" style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;font-size:13px;box-sizing:border-box"></select>'+
    '<label style="display:block;font-size:12px;color:#555;margin:8px 0 3px">Título</label>'+
    '<input id="invt-titulo" style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;font-size:13px;box-sizing:border-box">'+
    '<label style="display:block;font-size:12px;color:#555;margin:10px 0 3px">Archivo de SAIT (Excel o CSV con clave, descripción, existencia)</label>'+
    '<input type="file" accept=".xlsx,.xls,.csv" onchange="invtParseFile(this.files)" style="width:100%;font-size:12px">'+
    '<div id="invt-preview"></div>'+
    '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#555;margin:10px 0"><input type="checkbox" id="invt-libre" checked> Permitir que la sucursal agregue artículos no listados</label>'+
    '<div style="display:flex;gap:8px;margin-top:10px"><button onclick="invtCerrarNueva()" class="btn" style="flex:1">Cancelar</button>'+
    '<button onclick="invtCrear()" class="btn btn-primary" style="flex:1;background:#0369a1">Crear toma</button></div>'+
    '<div id="invt-nueva-status" style="font-size:12.5px;margin-top:8px;min-height:16px;text-align:center;color:#16a34a"></div></div>';
  d.addEventListener('click',e=>{ if(e.target.id==='m-invt-nueva') invtCerrarNueva(); });
  document.body.appendChild(d);
}

/* ---------- pantalla + nav ---------- */
const SCREEN_HTML = `
<div id="s-invtoma" class="screen">
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-home');window.renderHome&&window.renderHome()">←</button>
    <h2>📋 Toma de inventario</h2>
  </div>
  <p style="font-size:13px;color:var(--muted,#777);margin-bottom:12px">Cuenta físico con foto de evidencia. El sistema compara contra la existencia de SAIT.</p>
  <div id="invt-lista"></div>
</div>`;

function abrirToma(){ TOMA=null; show('s-invtoma'); renderTomasList(); }
window.invtOpen = abrirToma;

function initUI(intentos){
  intentos=intentos||0;
  const home=document.getElementById('s-home');
  if(!home){ if(intentos<40) setTimeout(()=>initUI(intentos+1),300); return; }
  if(!document.getElementById('s-invtoma')){
    const tmp=document.createElement('div'); tmp.innerHTML=SCREEN_HTML;
    const parent=home.parentNode; while(tmp.firstChild) parent.appendChild(tmp.firstChild);
  }
  if(!document.getElementById('invt-navbtn')){
    let ref=document.getElementById('gar-navbtn')||document.getElementById('cajas-navbtn')||document.getElementById('inv-navbtn')||document.getElementById('pre-navbtn');
    const nb=document.createElement('button');
    nb.id='invt-navbtn'; nb.className=ref?ref.className:'btn btn-sm btn-s';
    nb.textContent='📋 Toma inventario';
    nb.setAttribute('onclick',"invtOpen()");
    if(ref && ref.parentNode) ref.parentNode.insertBefore(nb, ref.nextSibling);
    else home.insertBefore(nb, home.firstChild);
  }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initUI());
else initUI();
