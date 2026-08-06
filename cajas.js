/* ===== Evidencias por caja (surtido a sucursales) — módulo autónomo =====
   <script type="module" src="./cajas.js"></script>
   Se engancha al modal "Marcar como surtido": permite agregar cajas (Caja 1, Caja 2…)
   y tomar fotos por caja (comprimidas). Se guardan ligadas a la orden de surtido.
   Además agrega una pantalla para ver las evidencias después. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, addDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

const CH = 700000;
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
let CAJAS = [];          // caja actual en el modal: [{fotos:[{dataUrl?,id?,nombre}]}]
let ordenIdActual = null;
let hookGuardarPuesto = false;

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

/* ---------- UI dentro del modal de surtir ---------- */
window.cajaAgregar = function(){ CAJAS.push({fotos:[]}); renderCajas(); };
window.cajaBorrar = function(ci){ if(!confirm('¿Quitar la Caja '+(ci+1)+' y sus fotos?')) return; CAJAS.splice(ci,1); renderCajas(); };
window.cajaFotoAdd = async function(ci, files){
  if(!files||!files.length||!CAJAS[ci]) return;
  const st=document.getElementById('cajas-status'); if(st) st.textContent='Procesando foto(s)…';
  for(const f of files){ if(!/^image\//.test(f.type)) continue;
    try{ const dataUrl=await comprimirImagen(f); CAJAS[ci].fotos.push({dataUrl, nombre:f.name||'caja.jpg'}); }catch(e){}
  }
  if(st) st.textContent='';
  renderCajas();
};
window.cajaFotoDel = function(ci, fi){ if(CAJAS[ci]) CAJAS[ci].fotos.splice(fi,1); renderCajas(); };
window.cajaVerFoto = function(ci, fi){
  const f=CAJAS[ci] && CAJAS[ci].fotos[fi]; if(!f) return;
  if(f.dataUrl){ const w=window.open(''); if(w) w.document.write('<img src="'+f.dataUrl+'" style="max-width:100%">'); }
  else if(f.id){ abrirFotoGuardada(f.id); }
};

function renderCajas(){
  const cont=document.getElementById('cajas-cont'); if(!cont) return;
  let h='';
  CAJAS.forEach((caja,ci)=>{
    h+='<div style="border:1px solid #e5e5e5;border-radius:10px;padding:10px;margin-bottom:8px">';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="font-size:13px;color:#6b21a8">Caja '+(ci+1)+'</b>'+
       '<button type="button" onclick="cajaBorrar('+ci+')" style="border:none;background:none;color:#dc2626;font-size:12px;cursor:pointer">Quitar</button></div>';
    h+='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">';
    caja.fotos.forEach((f,fi)=>{
      const inner = f.dataUrl ? '<img src="'+f.dataUrl+'" style="width:100%;height:100%;object-fit:cover">' : '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:20px;color:#6b21a8">📷</div>';
      h+='<div style="position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid #ddd;background:#f6f6f6;cursor:pointer" onclick="cajaVerFoto('+ci+','+fi+')">'+inner+
         '<button type="button" onclick="event.stopPropagation();cajaFotoDel('+ci+','+fi+')" style="position:absolute;top:1px;right:1px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:99px;width:18px;height:18px;font-size:11px;line-height:1;cursor:pointer">✕</button></div>';
    });
    h+='<label style="display:inline-flex;align-items:center;gap:5px;padding:7px 12px;border:1px dashed #a855f7;color:#a855f7;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;background:#faf5ff">📷 Foto'+
       '<input type="file" accept="image/*" multiple style="display:none" onchange="cajaFotoAdd('+ci+',this.files)"></label>';
    h+='</div></div>';
  });
  h+='<button type="button" onclick="cajaAgregar()" style="width:100%;padding:9px;border:1px dashed #cbd5e1;background:#f8fafc;border-radius:10px;font-size:13px;font-weight:600;color:#475569;cursor:pointer">➕ Agregar caja</button>';
  h+='<div id="cajas-status" style="font-size:12px;color:#a855f7;margin-top:6px;min-height:16px"></div>';
  cont.innerHTML=h;
}

async function cargarCajasDeOrden(ordenId){
  CAJAS=[];
  try{ const d=await getDoc(doc(db,'evidenciaSurtido',ordenId));
    if(d.exists()){ (d.data().cajas||[]).forEach(c=>{ CAJAS.push({fotos:(c.fotos||[]).map(ft=>({id:ft.id,nombre:ft.nombre||'caja.jpg'}))}); }); }
  }catch(e){}
}

function injectIntoModal(){
  const modal=document.getElementById('modal-surtir-orden'); if(!modal) return;
  const cancelar=modal.querySelector('#btn-sur-cancelar'); if(!cancelar) return;
  if(!modal.querySelector('#cajas-sec')){
    const row=cancelar.parentNode;
    const sec=document.createElement('div'); sec.id='cajas-sec'; sec.style.margin='4px 0';
    sec.innerHTML='<label class="lbl" style="display:block;margin-bottom:6px">Evidencias por caja (fotos)</label><div id="cajas-cont"></div>';
    row.parentNode.insertBefore(sec, row);
  }
  renderCajas();
}

async function guardarEvidenciaCajas(){
  const ordenId = window.__ordenAccionId || ordenIdActual;
  if(!ordenId) return;
  if(!CAJAS.length) return; // nada que guardar
  const cajasGuardar=[];
  for(const caja of CAJAS){
    const fotos=[];
    for(const f of caja.fotos){
      if(f.id) fotos.push({id:f.id, nombre:f.nombre||'caja.jpg'});
      else if(f.dataUrl){ const id=await guardarFoto(f.dataUrl, f.nombre); fotos.push({id, nombre:f.nombre||'caja.jpg'}); }
    }
    cajasGuardar.push({fotos});
  }
  // datos de la orden para poder mostrarla luego
  let info={};
  try{ const o=(window.__ordenesCompra||[]).find(x=>x.id===ordenId); if(o){ info={folio:o.folio||'', sucursal:o.sucursal||o.sucDest||'', proveedor:o.proveedor||'', fecha:o.fecha||''}; } }catch(e){}
  await setDoc(doc(db,'evidenciaSurtido',ordenId), Object.assign({ordenId, cajas:cajasGuardar, ts:Date.now()}, info));
}

/* enganche: al abrir el modal de surtir y al guardar */
function hookSurtir(){
  document.addEventListener('click', function(ev){
    const b = ev.target.closest && ev.target.closest('[data-orden-surtir]');
    if(b){
      ordenIdActual = b.getAttribute('data-orden-surtir');
      setTimeout(async()=>{ await cargarCajasDeOrden(ordenIdActual); injectIntoModal(); }, 60);
      return;
    }
    const g = ev.target.closest && ev.target.closest('#btn-sur-guardar');
    if(g){
      // guardar las cajas en paralelo al guardado base (no bloquea)
      setTimeout(()=>{ guardarEvidenciaCajas().catch(()=>{}); }, 30);
    }
  }, true);
}

/* ---------- pantalla para ver evidencias ---------- */
const SCREEN_HTML = `
<div id="s-cajas" class="screen">
  <style>
    #s-cajas .cj-card{background:#fff;border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:12px 14px;margin-bottom:10px}
    #s-cajas .cj-foto{width:80px;height:80px;border-radius:8px;overflow:hidden;border:1px solid #ddd;background:#f6f6f6;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:22px;color:#6b21a8}
  </style>
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-home');window.renderHome&&window.renderHome()">←</button>
    <h2>Evidencias de surtido</h2>
  </div>
  <p style="font-size:13px;color:var(--muted,#777);margin-bottom:12px">Fotos de las cajas tomadas al surtir a las sucursales.</p>
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
    h+='<div class="cj-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
       '<div><b>'+esc(ev.folio||ev.sucursal||ev.ordenId||'Surtido')+'</b>'+(ev.sucursal?' · '+esc(ev.sucursal):'')+
       '<div style="font-size:11.5px;color:var(--muted,#777)">'+esc(ev.fecha||'')+' · '+nCajas+' cajas · '+nFotos+' fotos</div></div></div>';
    (ev.cajas||[]).forEach((c,ci)=>{
      h+='<div style="margin-top:6px"><div style="font-size:12px;font-weight:600;color:#6b21a8;margin-bottom:4px">Caja '+(ci+1)+'</div><div style="display:flex;gap:6px;flex-wrap:wrap">';
      (c.fotos||[]).forEach(ft=>{ h+='<div class="cj-foto" onclick="cajasVerId(\''+ft.id+'\')">📷</div>'; });
      h+='</div></div>';
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
  if(!hookGuardarPuesto){ hookSurtir(); hookGuardarPuesto=true; }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initUI());
else initUI();
