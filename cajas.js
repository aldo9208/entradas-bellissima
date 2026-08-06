/* ===== Evidencias por caja (surtido a sucursales) — módulo autónomo =====
   <script type="module" src="./cajas.js"></script>
   - Cajas organizadas por PERSONA y por SUCURSAL, cada combinación con su propio
     consecutivo (Caja 1, 2, 3…). Dos personas pueden surtir la misma orden sin encimarse.
   - Foto directa desde la cámara del celular o desde galería.
   - Captura en el modal "Marcar como surtido" o reabriendo desde la lista de órdenes
     con "📦 Cajas" (Guardar avance sin marcar surtido).
   - Pantalla "Evidencias de surtido" para verlas. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, addDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

const CH = 700000;
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
let CAJAS = [];          // [{persona, sucursal, fotos:[{dataUrl?,id?,nombre}]}]
let ordenIdActual = null;
let lastSuc = '';
let lastPersona = '';
let SUCS = [];
let activeCont = null;
let hookPuesto = false;

async function cargarSucursales(){
  if(SUCS.length) return SUCS;
  try{
    const s=await getDocs(collection(db,'traspasos'));
    const set=new Set(); s.forEach(d=>{ const x=d.data().sucDest; if(x) set.add(x); });
    SUCS=[...set].sort((a,b)=>{ const na=parseInt(a)||99, nb=parseInt(b)||99; return na-nb; });
  }catch(e){ SUCS=[]; }
  if(SUCS.length && !lastSuc) lastSuc=SUCS[0];
  return SUCS;
}

/* ---------- fotos ---------- */
function comprimirImagen(file){
  return new Promise((res,rej)=>{
    const img=new Image(); const url=URL.createObjectURL(file);
    img.onload=()=>{ URL.revokeObjectURL(url);
      let w=img.width,h=img.height; const max=1200;
      if(w>max||h>max){ const s=Math.min(max/w,max/h); w=Math.round(w*s); h=Math.round(h*s); }
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      res(cv.toDataURL('image/jpeg',0.7));
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error('imagen inválida')); };
    img.src=url;
  });
}
async function guardarFoto(dataUrl, nombre){
  const b64=dataUrl.slice(dataUrl.indexOf(',')+1);
  const n=Math.ceil(b64.length/CH);
  const ref=await addDoc(collection(db,'adjuntos'), {nombre:nombre||'caja.jpg', tipo:'image/jpeg', nChunks:n, ts:Date.now()});
  for(let i=0;i<n;i++) await setDoc(doc(db,'adjuntos',ref.id,'chunks',String(i)), {d:b64.slice(i*CH,(i+1)*CH)});
  return ref.id;
}
async function abrirFotoGuardada(id){
  try{
    const meta=await getDoc(doc(db,'adjuntos',id)); if(!meta.exists()){ alert('No encontré la foto.'); return; }
    const m=meta.data(); let s=''; for(let i=0;i<m.nChunks;i++){ const d=await getDoc(doc(db,'adjuntos',id,'chunks',String(i))); if(d.exists()) s+=d.data().d; }
    const bin=atob(s), arr=new Uint8Array(bin.length); for(let k=0;k<bin.length;k++) arr[k]=bin.charCodeAt(k);
    const url=URL.createObjectURL(new Blob([arr],{type:m.tipo||'image/jpeg'})); window.open(url,'_blank'); setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(e){ alert('Error: '+e.message); }
}
function setStatus(txt){ if(activeCont){ const s=activeCont.querySelector('[data-cajas-status]'); if(s) s.textContent=txt||''; } }

/* ---------- handlers ---------- */
window.cajaSetSuc = function(v){ lastSuc=v; };
window.cajaSetPersona = function(v){ lastPersona=v; };
window.cajaAgregar = function(){
  const selP = activeCont && activeCont.querySelector('[data-caja-persona]');
  const selS = activeCont && activeCont.querySelector('[data-caja-suc]');
  const persona = (selP ? selP.value : lastPersona).trim();
  const suc = selS ? selS.value : (lastSuc||SUCS[0]||'');
  if(!persona){ alert('Escribe quién surte (nombre) antes de agregar la caja.'); if(selP) selP.focus(); return; }
  if(!suc){ alert('No hay sucursales cargadas.'); return; }
  lastPersona=persona; lastSuc=suc;
  CAJAS.push({persona:persona, sucursal:suc, fotos:[]}); renderCajas();
};
window.cajaBorrar = function(ci){ if(!confirm('¿Quitar esta caja y sus fotos?')) return; CAJAS.splice(ci,1); renderCajas(); };
window.cajaFotoAdd = async function(ci, files){
  if(!files||!files.length||!CAJAS[ci]) return;
  setStatus('Procesando foto(s)…');
  for(const f of files){ if(!/^image\//.test(f.type)) continue;
    try{ const dataUrl=await comprimirImagen(f); CAJAS[ci].fotos.push({dataUrl, nombre:f.name||'caja.jpg'}); }catch(e){}
  }
  setStatus('');
  renderCajas();
};
window.cajaFotoDel = function(ci, fi){ if(CAJAS[ci]) CAJAS[ci].fotos.splice(fi,1); renderCajas(); };
window.cajaVerFoto = function(ci, fi){
  const f=CAJAS[ci] && CAJAS[ci].fotos[fi]; if(!f) return;
  if(f.dataUrl){ const w=window.open(''); if(w) w.document.write('<img src="'+f.dataUrl+'" style="max-width:100%">'); }
  else if(f.id){ abrirFotoGuardada(f.id); }
};

function cardCaja(caja, ci, numLocal){
  let h='<div style="border:1px solid #e5e5e5;border-radius:10px;padding:10px;margin-bottom:8px">';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="font-size:13px;color:#6b21a8">Caja '+numLocal+'</b>'+
     '<button type="button" onclick="cajaBorrar('+ci+')" style="border:none;background:none;color:#dc2626;font-size:12px;cursor:pointer">Quitar</button></div>';
  h+='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
  caja.fotos.forEach((f,fi)=>{
    const inner = f.dataUrl ? '<img src="'+f.dataUrl+'" style="width:100%;height:100%;object-fit:cover">' : '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:20px;color:#6b21a8">📷</div>';
    h+='<div style="position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid #ddd;background:#f6f6f6;cursor:pointer" onclick="cajaVerFoto('+ci+','+fi+')">'+inner+
       '<button type="button" onclick="event.stopPropagation();cajaFotoDel('+ci+','+fi+')" style="position:absolute;top:1px;right:1px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:99px;width:18px;height:18px;font-size:11px;line-height:1;cursor:pointer">✕</button></div>';
  });
  // Cámara directa + Galería
  h+='<label style="display:inline-flex;align-items:center;gap:5px;padding:7px 12px;border:1px solid #a855f7;color:#fff;background:#a855f7;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer">📷 Cámara'+
     '<input type="file" accept="image/*" capture="environment" style="display:none" onchange="cajaFotoAdd('+ci+',this.files)"></label>';
  h+='<label style="display:inline-flex;align-items:center;gap:5px;padding:7px 12px;border:1px dashed #a855f7;color:#a855f7;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;background:#faf5ff">🖼️ Galería'+
     '<input type="file" accept="image/*" multiple style="display:none" onchange="cajaFotoAdd('+ci+',this.files)"></label>';
  h+='</div></div>';
  return h;
}

function renderCajas(){
  const cont=activeCont; if(!cont) return;
  let h='<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">'+
    '<input data-caja-persona value="'+esc(lastPersona)+'" oninput="cajaSetPersona(this.value)" placeholder="¿Quién surte? (nombre)" style="padding:8px 10px;border:1px solid #ccc;border-radius:8px;font-size:13px">'+
    '<div style="display:flex;gap:8px">'+
      '<select data-caja-suc onchange="cajaSetSuc(this.value)" style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:8px;font-size:13px">'+
      SUCS.map(s=>'<option value="'+esc(s)+'"'+(s===lastSuc?' selected':'')+'>'+esc(s)+'</option>').join('')+'</select>'+
      '<button type="button" onclick="cajaAgregar()" style="padding:8px 14px;border:1px solid #a855f7;background:#a855f7;color:#fff;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">➕ Caja</button>'+
    '</div></div>';
  // agrupar por persona -> sucursal
  const porPersona={}; const ordenP=[];
  CAJAS.forEach((c,gi)=>{
    const p=c.persona||'(sin nombre)';
    if(!porPersona[p]){ porPersona[p]={}; ordenP.push(p); }
    (porPersona[p][c.sucursal]=porPersona[p][c.sucursal]||[]).push(gi);
  });
  if(!CAJAS.length){ h+='<div style="font-size:12.5px;color:#94a3b8;padding:8px 0">Escribe quién surte, elige sucursal y agrega sus cajas.</div>'; }
  ordenP.forEach(persona=>{
    h+='<div style="font-weight:700;font-size:13px;color:#6b21a8;margin:12px 0 4px">👤 '+esc(persona)+'</div>';
    const sucs=porPersona[persona];
    const ordenS=SUCS.filter(s=>sucs[s]).concat(Object.keys(sucs).filter(s=>SUCS.indexOf(s)<0));
    ordenS.forEach(suc=>{
      h+='<div style="font-weight:600;font-size:12px;color:#334155;margin:6px 0 4px;padding-bottom:2px;border-bottom:1px solid #eee">'+esc(suc)+' <span style="color:#94a3b8;font-weight:500">('+sucs[suc].length+' cajas)</span></div>';
      sucs[suc].forEach((ci,localIdx)=>{ h+=cardCaja(CAJAS[ci], ci, localIdx+1); });
    });
  });
  h+='<div data-cajas-status style="font-size:12px;color:#a855f7;margin-top:6px;min-height:16px"></div>';
  cont.innerHTML=h;
}

async function cargarCajasDeOrden(ordenId){
  CAJAS=[];
  try{ const d=await getDoc(doc(db,'evidenciaSurtido',ordenId));
    if(d.exists()){ (d.data().cajas||[]).forEach(c=>{ CAJAS.push({persona:c.persona||'', sucursal:c.sucursal||'', fotos:(c.fotos||[]).map(ft=>({id:ft.id,nombre:ft.nombre||'caja.jpg'}))}); }); }
  }catch(e){}
}

async function guardarEvidenciaCajas(ordenId){
  ordenId = ordenId || window.__ordenAccionId || ordenIdActual;
  if(!ordenId || !CAJAS.length) return;
  const cajasGuardar=[];
  for(const caja of CAJAS){
    const fotos=[];
    for(const f of caja.fotos){
      if(f.id) fotos.push({id:f.id, nombre:f.nombre||'caja.jpg'});
      else if(f.dataUrl){ const id=await guardarFoto(f.dataUrl, f.nombre); fotos.push({id, nombre:f.nombre||'caja.jpg'}); }
    }
    cajasGuardar.push({persona:caja.persona||'', sucursal:caja.sucursal||'', fotos});
  }
  let info={};
  try{ const o=(window.__ordenesCompra||[]).find(x=>x.id===ordenId); if(o){ info={folio:o.folio||'', proveedor:o.proveedor||'', fecha:o.fecha||''}; } }catch(e){}
  await setDoc(doc(db,'evidenciaSurtido',ordenId), Object.assign({ordenId, cajas:cajasGuardar, ts:Date.now()}, info));
}

/* ---------- modal en surtir ---------- */
function injectIntoModal(){
  const modal=document.getElementById('modal-surtir-orden'); if(!modal) return;
  const cancelar=modal.querySelector('#btn-sur-cancelar'); if(!cancelar) return;
  if(!modal.querySelector('#cajas-sec')){
    const row=cancelar.parentNode;
    const sec=document.createElement('div'); sec.id='cajas-sec'; sec.style.margin='4px 0';
    sec.innerHTML='<label class="lbl" style="display:block;margin-bottom:6px">Evidencias por caja (por persona y sucursal)</label><div id="cajas-cont"></div>';
    row.parentNode.insertBefore(sec, row);
  }
  activeCont = modal.querySelector('#cajas-cont');
  renderCajas();
}

/* ---------- editor independiente ---------- */
function ensureEditorModal(){
  if(document.getElementById('m-cajas-editor')) return;
  const d=document.createElement('div');
  d.id='m-cajas-editor';
  d.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1002;align-items:center;justify-content:center';
  d.innerHTML='<div style="background:#fff;border-radius:12px;padding:20px;max-width:440px;width:92%;max-height:90vh;overflow-y:auto">'+
    '<h3 style="margin:0 0 4px;font-size:18px;color:#6b21a8">Cajas del surtido</h3>'+
    '<div id="cajas-ed-info" style="font-size:12.5px;color:#777;margin-bottom:12px"></div>'+
    '<div id="cajas-cont-ed"></div>'+
    '<div style="display:flex;gap:8px;margin-top:14px">'+
      '<button type="button" onclick="cajasCerrarEditor()" class="btn" style="flex:1">Cerrar</button>'+
      '<button type="button" onclick="cajasGuardarAvance()" class="btn btn-primary" style="flex:1;background:#a855f7">Guardar avance</button>'+
    '</div>'+
    '<div data-cajas-ed-status style="font-size:12.5px;color:#16a34a;margin-top:8px;min-height:16px;text-align:center"></div>'+
  '</div>';
  d.addEventListener('click', e=>{ if(e.target.id==='m-cajas-editor') cajasCerrarEditor(); });
  document.body.appendChild(d);
}
window.cajasCerrarEditor = function(){ const m=document.getElementById('m-cajas-editor'); if(m) m.style.display='none'; activeCont=null; };
window.cajasGuardarAvance = async function(){
  const st=document.querySelector('#m-cajas-editor [data-cajas-ed-status]');
  if(st){ st.style.color='#16a34a'; st.textContent='Guardando…'; }
  try{
    await guardarEvidenciaCajas(ordenIdActual);
    if(st) st.textContent='✓ Avance guardado. Puedes seguir después.';
  }catch(e){ if(st){ st.style.color='#dc2626'; st.textContent='Error: '+e.message; } }
};
async function openCajasEditor(ordenId){
  ordenIdActual = ordenId;
  ensureEditorModal();
  await cargarSucursales();
  await cargarCajasDeOrden(ordenId);
  let info='';
  try{ const o=(window.__ordenesCompra||[]).find(x=>x.id===ordenId); if(o) info=(o.folio||'')+(o.proveedor?' · '+o.proveedor:''); }catch(e){}
  const m=document.getElementById('m-cajas-editor');
  m.querySelector('#cajas-ed-info').textContent = info || 'Agrega o completa las cajas. Guarda tu avance cuando quieras.';
  activeCont = m.querySelector('#cajas-cont-ed');
  m.style.display='flex';
  renderCajas();
}

/* ---------- enganches ---------- */
function hookSurtir(){
  document.addEventListener('click', function(ev){
    const cajasBtn = ev.target.closest && ev.target.closest('[data-orden-cajas]');
    if(cajasBtn){ ev.preventDefault(); ev.stopPropagation(); openCajasEditor(cajasBtn.getAttribute('data-orden-cajas')); return; }
    const b = ev.target.closest && ev.target.closest('[data-orden-surtir]');
    if(b){
      ordenIdActual = b.getAttribute('data-orden-surtir');
      setTimeout(async()=>{ await cargarSucursales(); await cargarCajasDeOrden(ordenIdActual); injectIntoModal(); }, 60);
      return;
    }
    const g = ev.target.closest && ev.target.closest('#btn-sur-guardar');
    if(g){ setTimeout(()=>{ guardarEvidenciaCajas(window.__ordenAccionId).catch(()=>{}); }, 30); }
  }, true);
}

/* ---------- pantalla para ver evidencias ---------- */
const SCREEN_HTML = `
<div id="s-cajas" class="screen">
  <style>
    #s-cajas .cj-card{background:#fff;border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:12px 14px;margin-bottom:10px}
    #s-cajas .cj-foto{width:78px;height:78px;border-radius:8px;overflow:hidden;border:1px solid #ddd;background:#f6f6f6;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:22px;color:#6b21a8}
  </style>
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-home');window.renderHome&&window.renderHome()">←</button>
    <h2>Evidencias de surtido</h2>
  </div>
  <p style="font-size:13px;color:var(--muted,#777);margin-bottom:12px">Fotos de las cajas al surtir, por persona y sucursal.</p>
  <div id="cajas-lista"></div>
</div>`;

window.renderCajasLista = async function(){
  const cont=document.getElementById('cajas-lista'); if(!cont) return;
  cont.innerHTML='<p style="color:var(--muted,#777)">Cargando…</p>';
  let arr=[];
  try{ const s=await getDocs(collection(db,'evidenciaSurtido')); s.forEach(d=>arr.push(d.data())); }catch(e){}
  arr.sort((a,b)=>(b.ts||0)-(a.ts||0));
  if(!arr.length){ cont.innerHTML='<div style="padding:24px;text-align:center;color:var(--muted,#777)">Aún no hay evidencias de surtido.</div>'; return; }
  let h='';
  arr.forEach(ev=>{
    const nCajas=(ev.cajas||[]).length;
    const nFotos=(ev.cajas||[]).reduce((a,c)=>a+((c.fotos||[]).length),0);
    h+='<div class="cj-card"><div style="margin-bottom:6px"><b>'+esc(ev.folio||ev.ordenId||'Surtido')+'</b>'+
       '<div style="font-size:11.5px;color:var(--muted,#777)">'+esc(ev.fecha||'')+' · '+nCajas+' cajas · '+nFotos+' fotos</div></div>';
    // agrupar persona -> sucursal
    const porP={}; const ordenP=[];
    (ev.cajas||[]).forEach(c=>{ const p=c.persona||'(sin nombre)'; if(!porP[p]){porP[p]={};ordenP.push(p);} (porP[p][c.sucursal||'(sin sucursal)']=porP[p][c.sucursal||'(sin sucursal)']||[]).push(c); });
    ordenP.forEach(persona=>{
      h+='<div style="font-weight:700;font-size:12.5px;color:#6b21a8;margin:8px 0 3px">👤 '+esc(persona)+'</div>';
      Object.keys(porP[persona]).forEach(suc=>{
        h+='<div style="font-weight:600;font-size:12px;color:#334155;margin:4px 0 3px 6px">'+esc(suc)+'</div>';
        porP[persona][suc].forEach((c,ci)=>{
          h+='<div style="margin:3px 0 6px 12px"><div style="font-size:11.5px;color:#6b21a8;margin-bottom:3px">Caja '+(ci+1)+'</div><div style="display:flex;gap:6px;flex-wrap:wrap">';
          (c.fotos||[]).forEach(ft=>{ h+='<div class="cj-foto" onclick="cajasVerId(\''+ft.id+'\')">📷</div>'; });
          h+='</div></div>';
        });
      });
    });
    h+='</div>';
  });
  cont.innerHTML=h;
};
window.cajasVerId = function(id){ abrirFotoGuardada(id); };

function initUI(intentos){
  intentos=intentos||0;
  const home=document.getElementById('s-home');
  if(!home){ if(intentos<40) setTimeout(()=>initUI(intentos+1),300); return; }
  if(!document.getElementById('s-cajas')){
    const tmp=document.createElement('div'); tmp.innerHTML=SCREEN_HTML;
    const parent=home.parentNode; while(tmp.firstChild) parent.appendChild(tmp.firstChild);
  }
  if(!document.getElementById('cajas-navbtn')){
    let ref=document.getElementById('inv-navbtn')||document.getElementById('pre-navbtn')||document.getElementById('pv-navbtn');
    if(!ref){ document.querySelectorAll('#s-home button').forEach(b=>{ if((b.getAttribute('onclick')||'').indexOf('renderAdminLista')>=0) ref=b; }); }
    const nb=document.createElement('button');
    nb.id='cajas-navbtn'; nb.className=ref?ref.className:'btn btn-sm btn-s';
    nb.textContent='📦 Evidencias de surtido';
    nb.setAttribute('onclick',"show('s-cajas');renderCajasLista()");
    if(ref && ref.parentNode) ref.parentNode.insertBefore(nb, ref.nextSibling);
    else home.insertBefore(nb, home.firstChild);
  }
  if(!hookPuesto){ hookSurtir(); cargarSucursales(); hookPuesto=true; }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initUI());
else initUI();
