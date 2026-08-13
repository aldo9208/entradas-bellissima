/* ===== Garantías y evidencias de inventario — módulo autónomo =====
   <script type="module" src="./garantias.js?v=1"></script>
   Lo usan las sucursales desde el celular:
   - Garantía de aparato: datos + no. serie + falla + fotos + seguimiento de estado.
   - Evidencia de inventario: artículo + cantidad física + fotos (lo del WhatsApp).
   Pantalla de seguimiento con filtros para CEDIS. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, addDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

const CH = 700000;
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const ESTADOS = ['Pendiente','Enviada a proveedor','En revisión','Resuelta','Rechazada'];
const ESTADOS_MERMA = ['Reportada','Autorizada','Rechazada'];
const MOTIVOS = ['Caducado','Dañado','Roto','Robo','Otro'];
const COLOR = {'Pendiente':'#d97706','Enviada a proveedor':'#2563eb','En revisión':'#7c3aed','Resuelta':'#16a34a','Rechazada':'#dc2626','Registrado':'#64748b','Reportada':'#d97706','Autorizada':'#16a34a'};

let SUCS=[], lastSuc='', lastQuien='';
let FOTOS=[];
let TIPO='garantia';
let DATOS=[];
let filtroActual='todos';

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
  const ref=await addDoc(collection(db,'adjuntos'),{nombre:nombre||'gar.jpg',tipo:'image/jpeg',nChunks:n,ts:Date.now()});
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

/* ---------- formulario ---------- */
window.garSetTipo=function(t){ TIPO=t; pintarForm(); };
window.garSucSet=function(v){ lastSuc=v; };
window.garQuienSet=function(v){ lastQuien=v; };
window.garFotoAdd=async function(files){
  if(!files||!files.length) return;
  const st=document.getElementById('gar-foto-status'); if(st) st.textContent='Procesando…';
  for(const f of files){ if(!/^image\//.test(f.type)) continue; try{ FOTOS.push({dataUrl:await comprimir(f),nombre:f.name||'gar.jpg'}); }catch(e){} }
  if(st) st.textContent='';
  pintarFotos();
};
window.garFotoDel=function(i){ FOTOS.splice(i,1); pintarFotos(); };
window.garFotoVer=function(i){ const f=FOTOS[i]; if(!f) return; if(f.dataUrl){ const w=window.open(''); if(w) w.document.write('<img src="'+f.dataUrl+'" style="max-width:100%">'); } else if(f.id) abrirFoto(f.id); };

function pintarFotos(){
  const c=document.getElementById('gar-fotos'); if(!c) return;
  let h='';
  FOTOS.forEach((f,i)=>{ const src=f.dataUrl||'';
    h+='<div style="position:relative;width:70px;height:70px;border-radius:8px;overflow:hidden;border:1px solid #ddd;background:#f6f6f6;cursor:pointer" onclick="garFotoVer('+i+')">'+
       (src?'<img src="'+src+'" style="width:100%;height:100%;object-fit:cover">':'<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:20px;color:#6b21a8">📷</div>')+
       '<button type="button" onclick="event.stopPropagation();garFotoDel('+i+')" style="position:absolute;top:1px;right:1px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:99px;width:18px;height:18px;font-size:11px;cursor:pointer">✕</button></div>';
  });
  h+='<label style="display:inline-flex;align-items:center;gap:5px;padding:8px 12px;border:1px solid #a855f7;background:#a855f7;color:#fff;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer">📷 Cámara<input type="file" accept="image/*" capture="environment" style="display:none" onchange="garFotoAdd(this.files)"></label>';
  h+='<label style="display:inline-flex;align-items:center;gap:5px;padding:8px 12px;border:1px dashed #a855f7;color:#a855f7;background:#faf5ff;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer">🖼️ Galería<input type="file" accept="image/*" multiple style="display:none" onchange="garFotoAdd(this.files)"></label>';
  c.innerHTML=h;
}

function campo(label,id,ph,val,tipo){ tipo=tipo||'text';
  return '<label style="display:block;font-size:12px;color:#555;margin:8px 0 3px">'+label+'</label>'+
    '<input id="'+id+'" type="'+tipo+'" value="'+esc(val||'')+'" placeholder="'+esc(ph||'')+'" style="width:100%;padding:9px 10px;border:1px solid #ccc;border-radius:8px;font-size:13px;box-sizing:border-box">';
}

function pintarForm(){
  const c=document.getElementById('gar-form-body'); if(!c) return;
  const tabG = TIPO==='garantia', tabI = TIPO==='inventario', tabM = TIPO==='merma';
  const bt=(t,label,on)=>'<button type="button" onclick="garSetTipo(\''+t+'\')" style="flex:1;padding:9px 4px;border-radius:8px;border:1px solid '+(on?'#a855f7':'#ddd')+';background:'+(on?'#a855f7':'#fff')+';color:'+(on?'#fff':'#555')+';font-size:12.5px;font-weight:600;cursor:pointer">'+label+'</button>';
  let h='';
  h+='<div style="display:flex;gap:6px;margin-bottom:10px">'+bt('garantia','🔧 Garantía',tabG)+bt('inventario','📦 Inventario',tabI)+bt('merma','📉 Merma',tabM)+'</div>';
  h+='<label style="display:block;font-size:12px;color:#555;margin:8px 0 3px">Sucursal</label>';
  h+='<select id="gar-suc" onchange="garSucSet(this.value)" style="width:100%;padding:9px 10px;border:1px solid #ccc;border-radius:8px;font-size:13px;box-sizing:border-box">'+SUCS.map(s=>'<option value="'+esc(s)+'"'+(s===lastSuc?' selected':'')+'>'+esc(s)+'</option>').join('')+'</select>';
  h+=campo('¿Quién reporta?','gar-quien','Nombre',lastQuien);
  h+=campo(tabG?'Artículo (aparato)':'Artículo','gar-articulo','Clave o descripción');
  if(tabG){
    h+=campo('Marca / Modelo','gar-marca','Ej. Kuul secadora X');
    h+=campo('No. de serie','gar-serie','Serie del aparato');
    h+='<label style="display:block;font-size:12px;color:#555;margin:8px 0 3px">Descripción de la falla</label>';
    h+='<textarea id="gar-falla" placeholder="¿Qué falla presenta?" style="width:100%;min-height:64px;padding:9px 10px;border:1px solid #ccc;border-radius:8px;font-size:13px;box-sizing:border-box"></textarea>';
  } else if(tabM){
    h+=campo('Cantidad','gar-cant','¿Cuántas piezas?','','number');
    h+='<label style="display:block;font-size:12px;color:#555;margin:8px 0 3px">Motivo de la merma</label>';
    h+='<select id="gar-motivo" style="width:100%;padding:9px 10px;border:1px solid #ccc;border-radius:8px;font-size:13px;box-sizing:border-box">'+MOTIVOS.map(m=>'<option value="'+esc(m)+'">'+esc(m)+'</option>').join('')+'</select>';
  } else {
    h+=campo('Cantidad física','gar-cant','¿Cuántas piezas hay?','','number');
  }
  h+='<label style="display:block;font-size:12px;color:#555;margin:8px 0 3px">Notas (opcional)</label>';
  h+='<textarea id="gar-notas" placeholder="Notas" style="width:100%;min-height:48px;padding:9px 10px;border:1px solid #ccc;border-radius:8px;font-size:13px;box-sizing:border-box"></textarea>';
  h+='<label style="display:block;font-size:12px;color:#555;margin:10px 0 5px">Fotos</label>';
  h+='<div id="gar-fotos" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"></div>';
  h+='<div id="gar-foto-status" style="font-size:12px;color:#a855f7;margin-top:6px;min-height:16px"></div>';
  c.innerHTML=h;
  pintarFotos();
}

window.garNuevo=async function(tipo){
  await cargarSucursales();
  TIPO=tipo||'garantia'; FOTOS=[];
  ensureFormModal();
  pintarForm();
  document.getElementById('gar-form-status').textContent='';
  document.getElementById('m-gar-form').style.display='flex';
};
window.garCerrarForm=function(){ const m=document.getElementById('m-gar-form'); if(m) m.style.display='none'; };

window.garGuardar=async function(){
  const g=id=>{ const el=document.getElementById(id); return el?el.value.trim():''; };
  const suc=g('gar-suc')||lastSuc; const quien=g('gar-quien'); const articulo=g('gar-articulo');
  if(!quien){ alert('Escribe quién reporta.'); return; }
  if(!articulo){ alert('Escribe el artículo.'); return; }
  lastSuc=suc; lastQuien=quien;
  const st=document.getElementById('gar-form-status'); if(st){ st.style.color='#16a34a'; st.textContent='Guardando…'; }
  try{
    const fotos=[];
    for(const f of FOTOS){ if(f.id) fotos.push({id:f.id,nombre:f.nombre}); else if(f.dataUrl){ const id=await guardarFoto(f.dataUrl,f.nombre); fotos.push({id,nombre:f.nombre}); } }
    const fecha=new Date().toLocaleDateString('es-MX');
    const base={ tipo:TIPO, sucursal:suc, quien, articulo, notas:g('gar-notas'), fotos, fecha, ts:Date.now() };
    if(TIPO==='garantia'){
      base.marcaModelo=g('gar-marca'); base.serie=g('gar-serie'); base.falla=g('gar-falla');
      base.estado='Pendiente';
      base.historial=[{estado:'Pendiente', fecha, nota:'Registro inicial'}];
    } else if(TIPO==='merma'){
      base.cantidad=g('gar-cant'); base.motivo=g('gar-motivo');
      base.estado='Reportada';
      base.historial=[{estado:'Reportada', fecha, nota:'Merma reportada'}];
    } else {
      base.cantidad=g('gar-cant'); base.estado='Registrado';
    }
    await addDoc(collection(db,'garantias'), base);
    garCerrarForm();
    renderGarantiasLista();
  }catch(e){ if(st){ st.style.color='#dc2626'; st.textContent='Error: '+e.message; } }
};

/* ---------- detalle / seguimiento ---------- */
window.garVerDetalle=async function(id){
  ensureDetModal();
  const m=document.getElementById('m-gar-det'); const body=document.getElementById('gar-det-body');
  body.innerHTML='<p style="color:#777">Cargando…</p>'; m.style.display='flex';
  let d=null; try{ const s=await getDoc(doc(db,'garantias',id)); if(s.exists()) d={id, ...s.data()}; }catch(e){}
  if(!d){ body.innerHTML='<p>No encontré el registro.</p>'; return; }
  let h='';
  const badge='<span style="background:'+(COLOR[d.estado]||'#64748b')+';color:#fff;font-size:11px;padding:2px 9px;border-radius:99px">'+esc(d.estado||'')+'</span>';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:15px">'+esc(d.articulo||'')+'</b>'+badge+'</div>';
  const tipoLbl = d.tipo==='garantia'?'🔧 Garantía':(d.tipo==='merma'?'📉 Merma':'📦 Inventario');
  h+='<div style="font-size:12px;color:#777;margin-bottom:10px">'+tipoLbl+' · '+esc(d.sucursal||'')+' · '+esc(d.fecha||'')+' · '+esc(d.quien||'')+'</div>';
  if(d.tipo==='garantia'){
    if(d.marcaModelo) h+='<div style="font-size:13px;margin:3px 0"><b>Marca/Modelo:</b> '+esc(d.marcaModelo)+'</div>';
    if(d.serie) h+='<div style="font-size:13px;margin:3px 0"><b>No. serie:</b> '+esc(d.serie)+'</div>';
    if(d.falla) h+='<div style="font-size:13px;margin:3px 0"><b>Falla:</b> '+esc(d.falla)+'</div>';
  } else if(d.tipo==='merma'){
    if(d.cantidad) h+='<div style="font-size:13px;margin:3px 0"><b>Cantidad:</b> '+esc(d.cantidad)+'</div>';
    if(d.motivo) h+='<div style="font-size:13px;margin:3px 0"><b>Motivo:</b> '+esc(d.motivo)+'</div>';
  } else {
    if(d.cantidad) h+='<div style="font-size:13px;margin:3px 0"><b>Cantidad física:</b> '+esc(d.cantidad)+'</div>';
  }
  if(d.notas) h+='<div style="font-size:13px;margin:3px 0"><b>Notas:</b> '+esc(d.notas)+'</div>';
  if((d.fotos||[]).length){
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">';
    (d.fotos||[]).forEach(ft=>{ h+='<div onclick="garAbrirFoto(\''+ft.id+'\')" style="width:76px;height:76px;border-radius:8px;border:1px solid #ddd;background:#f6f6f6;display:flex;align-items:center;justify-content:center;font-size:22px;color:#6b21a8;cursor:pointer">📷</div>'; });
    h+='</div>';
  }
  if(d.tipo==='garantia' || d.tipo==='merma'){
    const setEst = d.tipo==='merma'?ESTADOS_MERMA:ESTADOS;
    h+='<div style="border-top:1px solid #eee;margin-top:10px;padding-top:10px"><div style="font-size:12px;font-weight:600;color:#555;margin-bottom:6px">Cambiar estado</div>';
    h+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
    setEst.forEach(e=>{ const act=e===d.estado; const col=COLOR[e]||'#64748b'; h+='<button type="button" onclick="garSetEstado(\''+d.id+'\',\''+e+'\')" style="padding:5px 10px;border-radius:8px;border:1px solid '+col+';background:'+(act?col:'#fff')+';color:'+(act?'#fff':col)+';font-size:11.5px;font-weight:600;cursor:pointer">'+e+'</button>'; });
    h+='</div>';
    if((d.historial||[]).length){
      h+='<div style="font-size:12px;font-weight:600;color:#555;margin:12px 0 6px">Historial</div>';
      (d.historial||[]).slice().reverse().forEach(x=>{ h+='<div style="font-size:12px;color:#555;padding:4px 0;border-bottom:1px solid #f2f2f2"><b style="color:'+(COLOR[x.estado]||'#555')+'">'+esc(x.estado)+'</b> · '+esc(x.fecha||'')+(x.nota?' — '+esc(x.nota):'')+'</div>'; });
    }
    h+='</div>';
  }
  body.innerHTML=h;
};
window.garAbrirFoto=function(id){ abrirFoto(id); };
window.garSetEstado=async function(id,estado){
  const nota=prompt('Nota para este cambio (opcional):')||'';
  try{
    const s=await getDoc(doc(db,'garantias',id)); if(!s.exists()) return; const d=s.data();
    const hist=d.historial||[]; hist.push({estado, fecha:new Date().toLocaleDateString('es-MX'), nota});
    await updateDoc(doc(db,'garantias',id), { estado, historial:hist });
    garVerDetalle(id); renderGarantiasLista();
  }catch(e){ alert('Error: '+e.message); }
};
window.garCerrarDet=function(){ const m=document.getElementById('m-gar-det'); if(m) m.style.display='none'; };

/* ---------- lista / seguimiento ---------- */
window.garFiltro=function(f){ filtroActual=f; pintarLista(); };
window.renderGarantiasLista=async function(){
  const cont=document.getElementById('gar-lista'); if(!cont) return;
  cont.innerHTML='<p style="color:var(--muted,#777)">Cargando…</p>';
  DATOS=[]; try{ const s=await getDocs(collection(db,'garantias')); s.forEach(d=>DATOS.push({id:d.id, ...d.data()})); }catch(e){}
  DATOS.sort((a,b)=>(b.ts||0)-(a.ts||0));
  pintarLista();
};
function pintarLista(){
  const cont=document.getElementById('gar-lista'); if(!cont) return;
  const chips=[['todos','Todas'],['garantia','🔧 Garantías'],['inventario','📦 Inventario'],['merma','📉 Mermas'],['Pendiente','Pendientes'],['Reportada','Merma x autorizar'],['Resuelta','Resueltas']];
  let filtered=DATOS.filter(d=>{
    if(filtroActual==='todos') return true;
    if(filtroActual==='garantia'||filtroActual==='inventario'||filtroActual==='merma') return d.tipo===filtroActual;
    return d.estado===filtroActual;
  });
  let h='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">';
  chips.forEach(x=>{ const v=x[0],l=x[1]; const act=v===filtroActual; h+='<button type="button" onclick="garFiltro(\''+v+'\')" style="padding:5px 11px;border-radius:99px;border:1px solid '+(act?'#6b21a8':'#ddd')+';background:'+(act?'#6b21a8':'#fff')+';color:'+(act?'#fff':'#555')+';font-size:12px;cursor:pointer">'+l+'</button>'; });
  h+='</div>';
  if(!filtered.length){ h+='<div style="padding:24px;text-align:center;color:var(--muted,#777)">Sin registros'+(filtroActual!=='todos'?' en este filtro':'')+'.</div>'; cont.innerHTML=h; return; }
  filtered.forEach(d=>{
    const nF=(d.fotos||[]).length;
    const badge='<span style="background:'+(COLOR[d.estado]||'#64748b')+';color:#fff;font-size:10.5px;padding:2px 8px;border-radius:99px;white-space:nowrap">'+esc(d.estado||'')+'</span>';
    h+='<div onclick="garVerDetalle(\''+d.id+'\')" style="background:#fff;border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:12px 14px;margin-bottom:10px;cursor:pointer">';
    const ico = d.tipo==='garantia'?'🔧':(d.tipo==='merma'?'📉':'📦');
    h+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div style="flex:1"><div style="font-weight:600;font-size:14px">'+ico+' '+esc(d.articulo||'')+'</div>';
    h+='<div style="font-size:11.5px;color:var(--muted,#777);margin-top:2px">'+esc(d.sucursal||'')+' · '+esc(d.quien||'')+' · '+esc(d.fecha||'')+(nF?' · '+nF+' 📷':'')+'</div>';
    if(d.tipo==='garantia'&&d.serie) h+='<div style="font-size:11.5px;color:#94a3b8">Serie: '+esc(d.serie)+'</div>';
    if(d.tipo==='inventario'&&d.cantidad) h+='<div style="font-size:11.5px;color:#94a3b8">Cantidad: '+esc(d.cantidad)+'</div>';
    if(d.tipo==='merma') h+='<div style="font-size:11.5px;color:#94a3b8">'+(d.cantidad?esc(d.cantidad)+' pz':'')+(d.motivo?' · '+esc(d.motivo):'')+'</div>';
    h+='</div>'+badge+'</div></div>';
  });
  cont.innerHTML=h;
}

/* ---------- modales ---------- */
function ensureFormModal(){
  if(document.getElementById('m-gar-form')) return;
  const d=document.createElement('div'); d.id='m-gar-form';
  d.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1003;align-items:center;justify-content:center';
  d.innerHTML='<div style="background:#fff;border-radius:12px;padding:18px;max-width:440px;width:92%;max-height:90vh;overflow-y:auto">'+
    '<h3 style="margin:0 0 12px;font-size:18px;color:#6b21a8">Nuevo registro</h3>'+
    '<div id="gar-form-body"></div>'+
    '<div style="display:flex;gap:8px;margin-top:14px"><button type="button" onclick="garCerrarForm()" class="btn" style="flex:1">Cancelar</button>'+
    '<button type="button" onclick="garGuardar()" class="btn btn-primary" style="flex:1;background:#a855f7">Guardar</button></div>'+
    '<div id="gar-form-status" style="font-size:12.5px;margin-top:8px;min-height:16px;text-align:center;color:#16a34a"></div></div>';
  d.addEventListener('click',e=>{ if(e.target.id==='m-gar-form') garCerrarForm(); });
  document.body.appendChild(d);
}
function ensureDetModal(){
  if(document.getElementById('m-gar-det')) return;
  const d=document.createElement('div'); d.id='m-gar-det';
  d.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1003;align-items:center;justify-content:center';
  d.innerHTML='<div style="background:#fff;border-radius:12px;padding:18px;max-width:440px;width:92%;max-height:90vh;overflow-y:auto">'+
    '<div id="gar-det-body"></div>'+
    '<div style="margin-top:14px"><button type="button" onclick="garCerrarDet()" class="btn" style="width:100%">Cerrar</button></div></div>';
  d.addEventListener('click',e=>{ if(e.target.id==='m-gar-det') garCerrarDet(); });
  document.body.appendChild(d);
}

/* ---------- pantalla + nav ---------- */
const SCREEN_HTML = `
<div id="s-garantias" class="screen">
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-home');window.renderHome&&window.renderHome()">←</button>
    <h2>Garantías y evidencias</h2>
  </div>
  <p style="font-size:13px;color:var(--muted,#777);margin-bottom:12px">Reporta garantías de aparatos o evidencia de inventario con foto. Se guarda con seguimiento.</p>
  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <button type="button" onclick="garNuevo('garantia')" style="flex:1;min-width:120px;padding:11px 6px;border-radius:10px;border:none;background:#6b21a8;color:#fff;font-size:13px;font-weight:600;cursor:pointer">🔧 Nueva garantía</button>
    <button type="button" onclick="garNuevo('inventario')" style="flex:1;min-width:120px;padding:11px 6px;border-radius:10px;border:1px solid #6b21a8;background:#fff;color:#6b21a8;font-size:13px;font-weight:600;cursor:pointer">📦 Inventario</button>
    <button type="button" onclick="garNuevo('merma')" style="flex:1;min-width:120px;padding:11px 6px;border-radius:10px;border:1px solid #dc2626;background:#fff;color:#dc2626;font-size:13px;font-weight:600;cursor:pointer">📉 Merma</button>
  </div>
  <div id="gar-lista"></div>
</div>`;

function initUI(intentos){
  intentos=intentos||0;
  const home=document.getElementById('s-home');
  if(!home){ if(intentos<40) setTimeout(()=>initUI(intentos+1),300); return; }
  if(!document.getElementById('s-garantias')){
    const tmp=document.createElement('div'); tmp.innerHTML=SCREEN_HTML;
    const parent=home.parentNode; while(tmp.firstChild) parent.appendChild(tmp.firstChild);
  }
  if(!document.getElementById('gar-navbtn')){
    let ref=document.getElementById('cajas-navbtn')||document.getElementById('inv-navbtn')||document.getElementById('pre-navbtn')||document.getElementById('pv-navbtn');
    const nb=document.createElement('button');
    nb.id='gar-navbtn'; nb.className=ref?ref.className:'btn btn-sm btn-s';
    nb.textContent='🔧 Garantías';
    nb.setAttribute('onclick',"show('s-garantias');renderGarantiasLista()");
    if(ref && ref.parentNode) ref.parentNode.insertBefore(nb, ref.nextSibling);
    else home.insertBefore(nb, home.firstChild);
  }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initUI());
else initUI();
