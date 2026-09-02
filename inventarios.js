/* ===== Toma de inventario (una lista, todas las sucursales) — módulo autónomo =====
   <script type="module" src="./inventarios.js?v=2"></script>
   CEDIS sube UNA lista con existencia de SAIT por sucursal. Cada sucursal cuenta la
   misma lista A CIEGAS (no ve el sistema), con foto por artículo, y guarda su propio
   conteo. CEDIS revisa por sucursal: Sistema (de esa sucursal) vs Físico.
   Modo (contar vs revisar) según window.__adminOK. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, addDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

const CH = 700000;
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const nk = s => String(s==null?'':s).trim().replace(/^0+/,'');
const sucNum = s => { const m=String(s==null?'':s).match(/\d+/); return m?m[0]:''; };

let SUCS=[], miSuc='';
let PREVIEW=null;        // {articulos:[...], sucs:[nums]} parseado
let TOMA=null, CONTEO=null, sucActiva='';
let filtroTxt='';

async function cargarSucursales(){
  if(SUCS.length) return SUCS;
  try{ const s=await getDocs(collection(db,'traspasos')); const set=new Set(); s.forEach(d=>{const x=d.data().sucDest; if(x) set.add(x);});
    SUCS=[...set].sort((a,b)=>{const na=parseInt(a)||99,nb=parseInt(b)||99;return na-nb;}); }catch(e){ SUCS=[]; }
  if(SUCS.length && !miSuc) miSuc=SUCS[0];
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

/* ---------- crear campaña (CEDIS) ---------- */
window.invtNueva=async function(){
  await cargarSucursales();
  PREVIEW=null;
  ensureNuevaModal();
  document.getElementById('invt-titulo').value='Inventario '+new Date().toLocaleDateString('es-MX');
  document.getElementById('invt-preview').innerHTML='';
  document.getElementById('invt-nueva-status').textContent='';
  document.getElementById('m-invt-nueva').style.display='flex';
};
window.invtCerrarNueva=function(){ const m=document.getElementById('m-invt-nueva'); if(m) m.style.display='none'; };

window.invtParseFile=async function(files){
  const st=document.getElementById('invt-nueva-status'); const pv=document.getElementById('invt-preview');
  if(!files||!files.length) return;
  const file=files[0]; st.style.color='#555'; st.textContent='Leyendo archivo…';
  try{
    let rows=[]; const XLSX=window.XLSX; const ext=(file.name.split('.').pop()||'').toLowerCase();
    if(ext==='csv' || !XLSX){
      const txt=await file.text();
      rows=txt.split(/\r?\n/).filter(l=>l.trim()).map(l=> l.split(/[,;\t]/).map(c=>c.replace(/^"|"$/g,'').trim()) );
    } else {
      const buf=await file.arrayBuffer(); const wb=XLSX.read(buf,{type:'array'});
      rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});
    }
    if(!rows.length){ st.style.color='#dc2626'; st.textContent='Archivo vacío.'; return; }
    // detectar la fila de encabezados real (SAIT mete título y filas vacías arriba)
    let hr=0;
    for(let i=0;i<Math.min(25,rows.length);i++){
      const low=(rows[i]||[]).map(c=>String(c).toLowerCase().trim());
      if(low.some(c=>c==='clave'||c==='codigo'||c==='código'||c==='numart'||c.indexOf('clave')>=0)){ hr=i; break; }
    }
    const head=rows[hr].map(h=>String(h).toLowerCase().trim());
    const findCol=(cands)=>{ for(let i=0;i<head.length;i++){ if(cands.some(c=>head[i]===c||head[i].includes(c))) return i; } return -1; };
    const ci=findCol(['clave','codigo','código','numart','articulo','artículo']);
    const di=findCol(['desc','descripcion','descripción','nombre','producto']);
    const si=findCol(['sucursal','tienda']);
    const xi=findCol(['existencia','exist','cantidad','stock']);
    const cci = ci<0?0:ci;
    const articulos={}; const sucSet=new Set();
    const DR = hr+1; // primera fila de datos

    if(si>=0 && xi>=0 && si!==cci){
      // FORMATO LARGO: clave, sucursal, existencia (una fila por clave-sucursal)
      for(let r=DR;r<rows.length;r++){ const row=rows[r]; if(!row) continue;
        const clave=String(row[cci]==null?'':row[cci]).trim(); if(!clave) continue;
        const num=sucNum(row[si]); if(!num) continue; sucSet.add(num);
        let ex=parseFloat(String(row[xi]).replace(/[^0-9.\-]/g,'')); if(isNaN(ex)) ex=0;
        const k=nk(clave);
        if(!articulos[k]) articulos[k]={clave, claveKey:k, desc: di>=0?String(row[di]||'').trim():'', sistema:{}};
        articulos[k].sistema[num]=ex;
      }
    } else {
      // FORMATO ANCHO: clave, desc, y una columna por sucursal (SUC1, SUC2…). Ignora TOTAL.
      const sucCols=[]; head.forEach((h,idx)=>{ if(idx===cci||idx===di) return; if(h.indexOf('total')>=0) return; const num=sucNum(h); if(num){ sucCols.push({idx,num}); sucSet.add(num);} });
      for(let r=DR;r<rows.length;r++){ const row=rows[r]; if(!row) continue;
        const clave=String(row[cci]==null?'':row[cci]).trim(); if(!clave) continue;
        const k=nk(clave); const sistema={};
        sucCols.forEach(sc=>{ let ex=parseFloat(String(row[sc.idx]).replace(/[^0-9.\-]/g,'')); sistema[sc.num]=isNaN(ex)?0:ex; });
        articulos[k]={clave, claveKey:k, desc: di>=0?String(row[di]||'').trim():'', sistema};
      }
    }
    const arts=Object.values(articulos);
    const sucs=[...sucSet].sort((a,b)=>parseInt(a)-parseInt(b));
    if(!arts.length){ st.style.color='#dc2626'; st.textContent='No detecté artículos. Revisa que haya columna de clave.'; return; }
    PREVIEW={articulos:arts, sucs};
    st.style.color='#16a34a'; st.textContent='✓ '+arts.length+' artículos · existencia para sucursales: '+ (sucs.length?sucs.join(', '):'(no detectada)');
    pv.innerHTML='<div style="font-size:12px;color:#555;margin-top:8px">Vista previa:</div>'+
      arts.slice(0,4).map(it=>'<div style="font-size:11.5px;padding:3px 0;border-bottom:1px solid #f2f2f2"><b>'+esc(it.clave)+'</b> '+esc(it.desc||'')+' <span style="color:#999">— '+Object.keys(it.sistema).map(n=>'S'+n+':'+it.sistema[n]).join(' ')+'</span></div>').join('');
    if(!sucs.length) pv.innerHTML+='<div style="font-size:11.5px;color:#dc2626;margin-top:6px">⚠ No detecté columnas de existencia por sucursal. Aún puedes crear la lista, pero no habrá comparación contra sistema.</div>';
  }catch(e){ st.style.color='#dc2626'; st.textContent='Error al leer: '+e.message; }
};

window.invtCrear=async function(){
  const titulo=document.getElementById('invt-titulo').value.trim()||('Inventario '+new Date().toLocaleDateString('es-MX'));
  const permiteLibre=document.getElementById('invt-libre').checked;
  const st=document.getElementById('invt-nueva-status');
  if(!PREVIEW||!PREVIEW.articulos.length){ alert('Sube un archivo con la lista de artículos.'); return; }
  if(PREVIEW.articulos.length>1500){ if(!confirm2('La lista tiene '+PREVIEW.articulos.length+' artículos. Para que funcione bien, conviene filtrar en SAIT y subir menos. ¿Crear de todos modos?')) return; }
  st.style.color='#16a34a'; st.textContent='Creando…';
  try{
    const toma={ titulo, fecha:new Date().toLocaleDateString('es-MX'), ts:Date.now(), estado:'abierta', permiteLibre,
      sucs:PREVIEW.sucs, articulos:PREVIEW.articulos };
    await addDoc(collection(db,'tomasInv'), toma);
    invtCerrarNueva(); renderTomasList();
  }catch(e){ st.style.color='#dc2626'; st.textContent='Error: '+e.message+' (¿lista muy grande? intenta menos artículos)'; }
};

/* ---------- lista de campañas ---------- */
window.renderTomasList=async function(){
  const cont=document.getElementById('invt-lista'); if(!cont) return;
  TOMA=null; CONTEO=null;
  cont.innerHTML='<p style="color:var(--muted,#777)">Cargando…</p>';
  let arr=[]; try{ const s=await getDocs(collection(db,'tomasInv')); s.forEach(d=>arr.push({id:d.id, ...d.data()})); }catch(e){}
  arr.sort((a,b)=>(b.ts||0)-(a.ts||0));
  const esAdmin=!!window.__adminOK;
  let h='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
  h+='<span style="font-size:12.5px;color:#777">'+(esAdmin?'Modo CEDIS (revisión)':'Toca la lista para contar tu sucursal')+'</span>';
  if(esAdmin) h+='<button class="btn btn-sm" onclick="invtNueva()" style="background:#0369a1;color:#fff;border:none">➕ Nueva toma</button>';
  h+='</div>';
  if(!arr.length){ h+='<div style="padding:24px;text-align:center;color:var(--muted,#777)">Aún no hay tomas de inventario.</div>'; cont.innerHTML=h; return; }
  arr.forEach(t=>{
    const cerrada=t.estado==='cerrada';
    const badge='<span style="background:'+(cerrada?'#16a34a':'#d97706')+';color:#fff;font-size:10.5px;padding:2px 8px;border-radius:99px">'+(cerrada?'Cerrada':'Abierta')+'</span>';
    h+='<div onclick="invtAbrir(\''+t.id+'\')" style="background:#fff;border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:12px 14px;margin-bottom:10px;cursor:pointer">';
    h+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div style="flex:1"><div style="font-weight:600;font-size:14px">📋 '+esc(t.titulo||'Inventario')+'</div>';
    h+='<div style="font-size:11.5px;color:var(--muted,#777);margin-top:2px">'+esc(t.fecha||'')+' · '+((t.articulos||[]).length)+' artículos</div></div>'+badge+'</div></div>';
  });
  cont.innerHTML=h;
};

/* ---------- abrir campaña ---------- */
window.invtAbrir=async function(id){
  const cont=document.getElementById('invt-lista'); cont.innerHTML='<p style="color:var(--muted,#777)">Cargando…</p>';
  let t=null; try{ const s=await getDoc(doc(db,'tomasInv',id)); if(s.exists()) t={id, ...s.data()}; }catch(e){}
  if(!t){ cont.innerHTML='<p>No encontré la toma.</p>'; return; }
  await cargarSucursales();
  TOMA=t; filtroTxt=''; sucActiva = miSuc||SUCS[0]||'';
  if(window.__adminOK) pintarRevisarPicker(); else pintarSelSuc();
};
window.invtVolver=function(){ TOMA=null; CONTEO=null; renderTomasList(); };

/* --- SUCURSAL: elegir mi sucursal, luego contar --- */
function pintarSelSuc(){
  const cont=document.getElementById('invt-lista'); if(!cont||!TOMA) return;
  let h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><button class="btn btn-sm" onclick="invtVolver()">←</button>';
  h+='<b style="font-size:15px;flex:1">'+esc(TOMA.titulo||'')+'</b></div>';
  h+='<label style="display:block;font-size:12.5px;color:#555;margin-bottom:5px">¿Cuál es tu sucursal?</label>';
  h+='<select id="invt-misuc" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:14px;box-sizing:border-box">'+
     SUCS.map(s=>'<option value="'+esc(s)+'"'+(s===sucActiva?' selected':'')+'>'+esc(s)+'</option>').join('')+'</select>';
  h+='<button class="btn btn-primary" onclick="invtEmpezarConteo()" style="width:100%;margin-top:12px;background:#0369a1">Empezar a contar</button>';
  cont.innerHTML=h;
}
window.invtEmpezarConteo=async function(){
  const sel=document.getElementById('invt-misuc'); sucActiva=sel?sel.value:sucActiva; miSuc=sucActiva;
  const num=sucNum(sucActiva);
  const cont=document.getElementById('invt-lista'); cont.innerHTML='<p style="color:var(--muted,#777)">Cargando tu conteo…</p>';
  CONTEO={ sucursal:sucActiva, sucNum:num, items:{}, extras:[] };
  try{ const s=await getDoc(doc(db,'tomasInv',TOMA.id,'conteos',num)); if(s.exists()){ const d=s.data(); CONTEO.items=d.items||{}; CONTEO.extras=d.extras||[]; } }catch(e){}
  filtroTxt=''; pintarContar();
};
window.invtFiltro=function(v){ filtroTxt=(v||'').toLowerCase(); pintarContar(); };

function pintarContar(){
  const cont=document.getElementById('invt-lista'); if(!cont||!TOMA||!CONTEO) return;
  const arts=TOMA.articulos||[]; const cerrada=TOMA.estado==='cerrada';
  const contados=Object.keys(CONTEO.items).filter(k=>CONTEO.items[k] && CONTEO.items[k].fisico!=null).length + CONTEO.extras.length;
  let h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><button class="btn btn-sm" onclick="pintarSelSucBack()">←</button>';
  h+='<div style="flex:1"><b style="font-size:15px">'+esc(TOMA.titulo||'')+'</b><div style="font-size:11.5px;color:#777">'+esc(CONTEO.sucursal)+' · '+contados+'/'+arts.length+' contados</div></div></div>';
  if(cerrada) h+='<div style="background:#dcfce7;color:#166534;font-size:12px;padding:6px 10px;border-radius:8px;margin-bottom:10px">Toma cerrada. Solo lectura.</div>';
  if(TOMA.permiteLibre && !cerrada){
    h+='<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:10px;margin-bottom:10px"><div style="font-size:12px;color:#555;margin-bottom:5px">¿Encontraste algo que no está en la lista?</div>'+
       '<div style="display:flex;gap:6px;flex-wrap:wrap"><input id="invt-lib-cod" placeholder="Código" style="flex:1;min-width:80px;padding:7px;border:1px solid #ccc;border-radius:7px;font-size:13px">'+
       '<input id="invt-lib-desc" placeholder="Descripción" style="flex:2;min-width:100px;padding:7px;border:1px solid #ccc;border-radius:7px;font-size:13px">'+
       '<button class="btn btn-sm" onclick="invtAddLibre()" style="background:#0369a1;color:#fff;border:none">➕</button></div></div>';
  }
  if(arts.length>8) h+='<input placeholder="🔎 Buscar artículo…" oninput="invtFiltro(this.value)" value="'+esc(filtroTxt)+'" style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;font-size:13px;margin-bottom:10px;box-sizing:border-box">';
  const fila=(clave,claveKey,desc,rec,libre)=>{
    const hecho=rec && rec.fisico!=null;
    let s='<div style="background:#fff;border:1px solid '+(hecho?'#bbf7d0':'#eee')+';border-left:3px solid '+(hecho?'#16a34a':'#ddd')+';border-radius:10px;padding:10px 12px;margin-bottom:8px">';
    s+='<div style="font-weight:600;font-size:13px">'+esc(clave)+(libre?' <span style="font-size:10px;color:#0369a1">(agregado)</span>':'')+'</div>';
    if(desc) s+='<div style="font-size:11.5px;color:#777;margin-bottom:6px">'+esc(desc)+'</div>';
    if(cerrada){ s+='<div style="font-size:13px">Contado: <b>'+(rec&&rec.fisico!=null?rec.fisico:'—')+'</b>'+(rec&&rec.foto?' · <span style="color:#0369a1;cursor:pointer" onclick="invtVerFoto(\''+rec.foto.id+'\')">📷 ver</span>':'')+'</div>'; }
    else {
      s+='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
      s+='<input type="number" min="0" inputmode="numeric" placeholder="Cantidad" value="'+(rec&&rec.fisico!=null?rec.fisico:'')+'" onchange="invtSetFisico(\''+esc(claveKey)+'\',this.value,'+(libre?'true':'false')+')" style="width:110px;padding:8px;border:1px solid #ccc;border-radius:8px;font-size:14px">';
      s+='<label style="display:inline-flex;align-items:center;gap:4px;padding:8px 10px;border:1px solid #0369a1;background:'+(rec&&rec.foto?'#0369a1':'#fff')+';color:'+(rec&&rec.foto?'#fff':'#0369a1')+';border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">'+(rec&&rec.foto?'✓ Foto':'📷 Foto')+'<input type="file" accept="image/*" capture="environment" style="display:none" onchange="invtFotoItem(\''+esc(claveKey)+'\','+(libre?'true':'false')+',this.files)"></label>';
      if(rec&&rec.foto) s+='<span style="color:#0369a1;cursor:pointer;font-size:12px" onclick="invtVerFoto(\''+rec.foto.id+'\')">ver</span>';
      s+='</div>';
    }
    return s+'</div>';
  };
  const BIG = arts.length>250;
  let mostrados=0, ocultos=0;
  arts.forEach(it=>{
    if(filtroTxt){ if(!((it.clave||'').toLowerCase().includes(filtroTxt) || (it.desc||'').toLowerCase().includes(filtroTxt))) return; }
    else if(BIG){ const rec=CONTEO.items[it.claveKey]; if(!(rec && rec.fisico!=null)){ ocultos++; return; } } // en listas grandes, sin buscar solo muestra los ya contados
    if(mostrados>=300){ ocultos++; return; }
    h+=fila(it.clave, it.claveKey, it.desc, CONTEO.items[it.claveKey], false); mostrados++;
  });
  if(BIG && !filtroTxt) h+='<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:9px 11px;font-size:12px;color:#92400e;margin-bottom:8px">Esta lista tiene '+arts.length+' artículos. Usa el 🔎 buscador de arriba para encontrar el que vas a contar. Aquí abajo se muestran los que ya contaste.</div>';
  else if(ocultos>0) h+='<div style="font-size:11.5px;color:#999;text-align:center;margin:6px 0">…y '+ocultos+' más. Afina la búsqueda.</div>';
  CONTEO.extras.forEach((ex,i)=>{ h+=fila(ex.clave, 'X'+i, ex.desc, ex, true); });
  if(!cerrada) h+='<button class="btn btn-primary" onclick="invtGuardarConteo()" style="width:100%;margin-top:8px;background:#0369a1">💾 Guardar conteo</button>';
  h+='<div id="invt-conteo-status" style="text-align:center;font-size:12.5px;margin-top:8px;min-height:16px;color:#16a34a"></div>';
  cont.innerHTML=h;
}
window.pintarSelSucBack=function(){ pintarSelSuc(); };
window.invtSetFisico=function(k,v,libre){
  if(!CONTEO) return; const n=(v===''||v==null)?null:(parseInt(v)||0);
  if(libre){ const i=parseInt(k.slice(1)); if(CONTEO.extras[i]) CONTEO.extras[i].fisico=n; }
  else { if(!CONTEO.items[k]) CONTEO.items[k]={}; CONTEO.items[k].fisico=n; }
};
window.invtFotoItem=async function(k,libre,files){
  if(!CONTEO||!files||!files.length) return;
  const st=document.getElementById('invt-conteo-status'); if(st){ st.style.color='#555'; st.textContent='Procesando foto…'; }
  try{ const dataUrl=await comprimir(files[0]); const id=await guardarFoto(dataUrl,'inv.jpg');
    if(libre){ const i=parseInt(k.slice(1)); if(CONTEO.extras[i]) CONTEO.extras[i].foto={id,nombre:'inv.jpg'}; }
    else { if(!CONTEO.items[k]) CONTEO.items[k]={}; CONTEO.items[k].foto={id,nombre:'inv.jpg'}; }
    if(st){ st.style.color='#16a34a'; st.textContent='✓ Foto lista'; } pintarContar();
  }catch(e){ if(st){ st.style.color='#dc2626'; st.textContent='Error foto: '+e.message; } }
};
window.invtAddLibre=function(){
  if(!CONTEO) return; const cod=(document.getElementById('invt-lib-cod').value||'').trim();
  const desc=(document.getElementById('invt-lib-desc').value||'').trim();
  if(!cod){ alert('Escribe el código.'); return; }
  CONTEO.extras.push({ clave:cod, desc:desc||'(agregado)', fisico:null, foto:null }); filtroTxt=''; pintarContar();
};
window.invtGuardarConteo=async function(){
  if(!CONTEO||!TOMA) return;
  const st=document.getElementById('invt-conteo-status'); if(st){ st.style.color='#16a34a'; st.textContent='Guardando…'; }
  try{ await setDoc(doc(db,'tomasInv',TOMA.id,'conteos',CONTEO.sucNum), { sucursal:CONTEO.sucursal, sucNum:CONTEO.sucNum, items:CONTEO.items, extras:CONTEO.extras, ts:Date.now() });
    if(st){ st.style.color='#16a34a'; st.textContent='✓ Conteo guardado. Puedes seguir después.'; }
  }catch(e){ if(st){ st.style.color='#dc2626'; st.textContent='Error: '+e.message; } }
};

/* --- CEDIS: elegir sucursal a revisar --- */
async function pintarRevisarPicker(){
  const cont=document.getElementById('invt-lista'); if(!cont||!TOMA) return;
  cont.innerHTML='<p style="color:var(--muted,#777)">Cargando avance…</p>';
  let hechos={}; try{ const s=await getDocs(collection(db,'tomasInv',TOMA.id,'conteos')); s.forEach(d=>{ const x=d.data(); const n=Object.keys(x.items||{}).filter(k=>x.items[k]&&x.items[k].fisico!=null).length+((x.extras||[]).length); hechos[d.id]=n; }); }catch(e){}
  let h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><button class="btn btn-sm" onclick="invtVolver()">←</button>';
  h+='<div style="flex:1"><b style="font-size:15px">'+esc(TOMA.titulo||'')+'</b><div style="font-size:11.5px;color:#777">'+((TOMA.articulos||[]).length)+' artículos · '+esc(TOMA.fecha||'')+'</div></div>';
  if(TOMA.estado!=='cerrada') h+='<button class="btn btn-sm" onclick="invtCerrar()" style="background:#16a34a;color:#fff;border:none">✓ Cerrar</button>';
  h+='</div><div style="font-size:12.5px;color:#555;margin-bottom:8px">Elige una sucursal para revisar su conteo:</div>';
  SUCS.forEach(s=>{ const num=sucNum(s); const n=hechos[num]||0;
    h+='<div onclick="invtRevisar(\''+num+'\')" style="display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid #eee;border-radius:10px;padding:11px 13px;margin-bottom:7px;cursor:pointer">'+
       '<span style="font-weight:600;font-size:13px">'+esc(s)+'</span>'+
       '<span style="font-size:11.5px;color:'+(n>0?'#16a34a':'#bbb')+'">'+(n>0?n+' contados ▸':'sin contar')+'</span></div>';
  });
  cont.innerHTML=h;
}
window.invtRevisar=async function(num){
  const cont=document.getElementById('invt-lista'); cont.innerHTML='<p style="color:var(--muted,#777)">Cargando…</p>';
  let cd={items:{},extras:[]}; try{ const s=await getDoc(doc(db,'tomasInv',TOMA.id,'conteos',num)); if(s.exists()) cd=s.data(); }catch(e){}
  const suc=SUCS.find(s=>sucNum(s)===num)||('Suc '+num);
  const arts=TOMA.articulos||[];
  let cuadran=0,conDif=0,difTotal=0,sinContar=0;
  arts.forEach(it=>{ const rec=(cd.items||{})[it.claveKey]; const sis=it.sistema?it.sistema[num]:null;
    if(!rec||rec.fisico==null){ sinContar++; return; } if(sis==null){ return; }
    const dif=rec.fisico-sis; if(dif===0) cuadran++; else { conDif++; difTotal+=dif; } });
  let h='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><button class="btn btn-sm" onclick="pintarRevisarPicker()">←</button>';
  h+='<div style="flex:1"><b style="font-size:15px">'+esc(suc)+'</b><div style="font-size:11.5px;color:#777">'+esc(TOMA.titulo||'')+'</div></div>';
  h+='<button class="btn btn-sm" onclick="invtExport(\''+num+'\')" style="font-size:11px">⬇ CSV</button></div>';
  h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(85px,1fr));gap:8px;margin-bottom:12px">';
  h+='<div style="background:#f0fdf4;border-radius:10px;padding:9px;text-align:center"><div style="font-size:18px;font-weight:700;color:#16a34a">'+cuadran+'</div><div style="font-size:10.5px;color:#555">cuadran</div></div>';
  h+='<div style="background:#fef2f2;border-radius:10px;padding:9px;text-align:center"><div style="font-size:18px;font-weight:700;color:#dc2626">'+conDif+'</div><div style="font-size:10.5px;color:#555">con dif.</div></div>';
  h+='<div style="background:#fffbeb;border-radius:10px;padding:9px;text-align:center"><div style="font-size:18px;font-weight:700;color:#d97706">'+sinContar+'</div><div style="font-size:10.5px;color:#555">sin contar</div></div>';
  h+='<div style="background:#f8fafc;border-radius:10px;padding:9px;text-align:center"><div style="font-size:18px;font-weight:700;color:'+(difTotal===0?'#16a34a':(difTotal>0?'#0369a1':'#dc2626'))+'">'+(difTotal>0?'+':'')+difTotal+'</div><div style="font-size:10.5px;color:#555">dif. neta</div></div></div>';
  h+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:380px"><thead><tr style="color:#777;font-size:11px">'+
     '<th style="text-align:left;padding:6px;border-bottom:1px solid #eee">Clave</th><th style="text-align:right;padding:6px;border-bottom:1px solid #eee">Sist.</th><th style="text-align:right;padding:6px;border-bottom:1px solid #eee">Físico</th><th style="text-align:right;padding:6px;border-bottom:1px solid #eee">Dif.</th><th style="text-align:center;padding:6px;border-bottom:1px solid #eee">Foto</th></tr></thead><tbody>';
  const render=(clave,desc,sis,rec)=>{ const fis=rec?rec.fisico:null; let dif=null,cls='#555',txt='—';
    if(fis!=null&&sis!=null){ dif=fis-sis; if(dif===0){txt='✓';cls='#16a34a';} else {txt=(dif>0?'+':'')+dif;cls=dif>0?'#0369a1':'#dc2626';} }
    else if(fis!=null&&sis==null){ txt='nuevo';cls='#0369a1'; }
    return '<tr><td style="padding:6px;border-bottom:1px solid #f4f4f4"><b>'+esc(clave)+'</b>'+(desc?'<div style="font-size:10px;color:#999;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(desc)+'</div>':'')+'</td>'+
      '<td style="text-align:right;padding:6px;border-bottom:1px solid #f4f4f4;color:#777">'+(sis==null?'—':sis)+'</td>'+
      '<td style="text-align:right;padding:6px;border-bottom:1px solid #f4f4f4;font-weight:600">'+(fis==null?'—':fis)+'</td>'+
      '<td style="text-align:right;padding:6px;border-bottom:1px solid #f4f4f4;color:'+cls+';font-weight:600">'+txt+'</td>'+
      '<td style="text-align:center;padding:6px;border-bottom:1px solid #f4f4f4">'+(rec&&rec.foto?'<span style="color:#0369a1;cursor:pointer" onclick="invtVerFoto(\''+rec.foto.id+'\')">📷</span>':'')+'</td></tr>';
  };
  arts.forEach(it=>{ h+=render(it.clave, it.desc, it.sistema?it.sistema[num]:null, (cd.items||{})[it.claveKey]); });
  (cd.extras||[]).forEach(ex=>{ h+=render(ex.clave+' (agreg.)', ex.desc, null, ex); });
  h+='</tbody></table></div>';
  document.getElementById('invt-lista').innerHTML=h;
  window.__invtRev={num, suc, cd};
};
window.invtExport=function(num){
  const R=window.__invtRev; if(!R||!TOMA) return; const cd=R.cd; const arts=TOMA.articulos||[];
  const rows=[['Clave','Descripcion','Sistema','Fisico','Diferencia']];
  arts.forEach(it=>{ const rec=(cd.items||{})[it.claveKey]; const sis=it.sistema?it.sistema[num]:''; const fis=rec?rec.fisico:''; const dif=(fis!==''&&fis!=null&&sis!==''&&sis!=null)?(fis-sis):''; rows.push([it.clave,it.desc||'',sis==null?'':sis,fis==null?'':fis,dif]); });
  (cd.extras||[]).forEach(ex=>{ rows.push([ex.clave,ex.desc||'','',ex.fisico==null?'':ex.fisico,'']); });
  const csv=rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=(TOMA.titulo||'toma')+'_'+R.suc+'.csv'; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1500);
};
window.invtCerrar=async function(){
  if(!TOMA) return; if(!confirm2('¿Cerrar esta toma? Ya no se podrán capturar conteos.')) return;
  try{ await updateDoc(doc(db,'tomasInv',TOMA.id), { estado:'cerrada', tsCierre:Date.now() }); TOMA.estado='cerrada'; pintarRevisarPicker(); }catch(e){ alert('Error: '+e.message); }
};
function confirm2(m){ try{ return confirm(m); }catch(e){ return true; } }

/* ---------- modal crear ---------- */
function ensureNuevaModal(){
  if(document.getElementById('m-invt-nueva')) return;
  const d=document.createElement('div'); d.id='m-invt-nueva';
  d.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1003;align-items:center;justify-content:center';
  d.innerHTML='<div style="background:#fff;border-radius:12px;padding:18px;max-width:460px;width:92%;max-height:90vh;overflow-y:auto">'+
    '<h3 style="margin:0 0 4px;font-size:18px;color:#0369a1">Nueva toma de inventario</h3>'+
    '<p style="font-size:12px;color:#777;margin:0 0 12px">Una sola lista para todas las sucursales. Cada una la cuenta por separado.</p>'+
    '<label style="display:block;font-size:12px;color:#555;margin:6px 0 3px">Título</label>'+
    '<input id="invt-titulo" style="width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;font-size:13px;box-sizing:border-box">'+
    '<label style="display:block;font-size:12px;color:#555;margin:10px 0 3px">Archivo de SAIT — existencia por sucursal<br><span style="font-size:11px;color:#999">Ancho (Clave, Desc, Suc1, Suc2…) o largo (Clave, Sucursal, Existencia)</span></label>'+
    '<input type="file" accept=".xlsx,.xls,.csv" onchange="invtParseFile(this.files)" style="width:100%;font-size:12px">'+
    '<div id="invt-preview"></div>'+
    '<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#555;margin:10px 0"><input type="checkbox" id="invt-libre" checked> Permitir que agreguen artículos no listados</label>'+
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
  <p style="font-size:13px;color:var(--muted,#777);margin-bottom:12px">Una lista para todas las sucursales. Cada una cuenta a ciegas con foto; el sistema compara contra su existencia de SAIT.</p>
  <div id="invt-lista"></div>
</div>`;

window.invtOpen = function(){ TOMA=null; CONTEO=null; show('s-invtoma'); renderTomasList(); };

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
