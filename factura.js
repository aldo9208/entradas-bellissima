/* ===== Factura por orden — módulo autónomo =====
   <script type="module" src="./factura.js?v=1"></script>
   Agrega un botón "🧾 Factura" en cada orden (solo CEDIS/admin) para adjuntar
   el/los PDF(s) de la factura del proveedor y ver de un vistazo cuáles órdenes ya
   la tienen (botón verde ✓) y cuáles no. Guarda en la colección facturasOrden +
   adjuntos (chunked). El botón solo aparece con el modo admin activo (window.__adminOK). */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, addDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

const CH = 700000;
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

let CACHE = {};        // ordenId -> nº de facturas adjuntas
let ACT = null;        // {ordenId, folio, proveedor, archivos:[...]}
let cacheListo = false;

async function cargarCache(){
  CACHE={};
  try{ const s=await getDocs(collection(db,'facturasOrden')); s.forEach(d=>{ const x=d.data(); CACHE[d.id]=(x.archivos||[]).length; }); }catch(e){}
  cacheListo=true;
  scanAndInject();
}

/* ---------- almacenamiento de archivos (chunked, cualquier tipo) ---------- */
function fileToB64(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>{ const s=String(r.result); res(s.slice(s.indexOf(',')+1)); }; r.onerror=()=>rej(new Error('read')); r.readAsDataURL(file); }); }
async function guardarArchivo(file){
  const b64=await fileToB64(file); const n=Math.ceil(b64.length/CH);
  const ref=await addDoc(collection(db,'adjuntos'),{nombre:file.name||'factura.pdf', tipo:file.type||'application/pdf', nChunks:n, ts:Date.now()});
  for(let i=0;i<n;i++) await setDoc(doc(db,'adjuntos',ref.id,'chunks',String(i)),{d:b64.slice(i*CH,(i+1)*CH)});
  return { id:ref.id, nombre:file.name||'factura.pdf', tipo:file.type||'application/pdf' };
}
async function abrirArchivo(id){
  try{ const meta=await getDoc(doc(db,'adjuntos',id)); if(!meta.exists()){ alert('No encontré el archivo.'); return; }
    const m=meta.data(); let s=''; for(let i=0;i<m.nChunks;i++){ const d=await getDoc(doc(db,'adjuntos',id,'chunks',String(i))); if(d.exists()) s+=d.data().d; }
    const bin=atob(s), arr=new Uint8Array(bin.length); for(let k=0;k<bin.length;k++) arr[k]=bin.charCodeAt(k);
    const blob=new Blob([arr],{type:m.tipo||'application/pdf'}); const url=URL.createObjectURL(blob);
    window.open(url,'_blank'); setTimeout(()=>URL.revokeObjectURL(url),120000);
  }catch(e){ alert('Error: '+e.message); }
}
window.factVerArchivo=function(id){ if(id) abrirArchivo(id); };

/* ---------- modal ---------- */
window.factAbrir=async function(ordenId, folio, proveedor){
  const run=async ()=>{
    ensureModal();
    ACT={ordenId, folio, proveedor, archivos:[]};
    document.getElementById('m-fact').style.display='flex';
    document.getElementById('fact-body').innerHTML='<p style="color:#777">Cargando…</p>';
    try{ const s=await getDoc(doc(db,'facturasOrden',ordenId)); if(s.exists()) ACT.archivos=(s.data().archivos||[]); }catch(e){}
    pintarModal();
  };
  if(window.__adminOK) run(); else (window.__gate?window.__gate:(f)=>f())(run);
};
window.factCerrar=function(){ const m=document.getElementById('m-fact'); if(m) m.style.display='none'; };

function pintarModal(){
  const b=document.getElementById('fact-body'); if(!b||!ACT) return;
  let h='<div style="font-size:12px;color:#777;margin-bottom:10px">Orden <b>'+esc(ACT.folio||'')+'</b>'+(ACT.proveedor?' · '+esc(ACT.proveedor):'')+'</div>';
  if(ACT.archivos.length){
    h+='<div style="font-size:12.5px;font-weight:600;color:#555;margin-bottom:6px">Facturas adjuntas ('+ACT.archivos.length+'):</div>';
    ACT.archivos.forEach((a,i)=>{
      h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8fafc;border:1px solid #eee;border-radius:8px;margin-bottom:6px">'+
         '<span style="font-size:18px">📄</span><span style="flex:1;font-size:12.5px;word-break:break-all">'+esc(a.nombre||'factura.pdf')+'</span>'+
         '<button onclick="factVerArchivo(\''+a.id+'\')" style="border:none;background:#0369a1;color:#fff;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer">Ver</button>'+
         '<button onclick="factBorrar('+i+')" style="border:none;background:none;color:#dc2626;font-size:16px;cursor:pointer" title="Quitar">✕</button></div>';
    });
  } else {
    h+='<div style="padding:14px;text-align:center;color:#999;font-size:12.5px;background:#fafafa;border-radius:8px;margin-bottom:10px">Aún no hay factura adjunta para esta orden.</div>';
  }
  h+='<label style="display:block;margin-top:12px"><span style="display:inline-block;padding:10px 14px;background:#0369a1;color:#fff;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">➕ Adjuntar PDF</span>'+
     '<input type="file" accept="application/pdf,.pdf" multiple style="display:none" onchange="factSubir(this.files)"></label>';
  h+='<div id="fact-status" style="font-size:12.5px;margin-top:8px;min-height:16px;color:#16a34a"></div>';
  b.innerHTML=h;
}

window.factSubir=async function(files){
  if(!ACT||!files||!files.length) return;
  const st=document.getElementById('fact-status');
  const pdfs=[...files].filter(f=> /pdf/i.test(f.type) || /\.pdf$/i.test(f.name));
  if(!pdfs.length){ if(st){ st.style.color='#dc2626'; st.textContent='Solo se aceptan archivos PDF.'; } return; }
  try{
    for(let i=0;i<pdfs.length;i++){
      if(st){ st.style.color='#555'; st.textContent='Subiendo '+(i+1)+' de '+pdfs.length+'…'; }
      const a=await guardarArchivo(pdfs[i]); ACT.archivos.push(a);
    }
    await setDoc(doc(db,'facturasOrden',ACT.ordenId), { ordenId:ACT.ordenId, folio:ACT.folio||'', proveedor:ACT.proveedor||'', archivos:ACT.archivos, ts:Date.now() });
    CACHE[ACT.ordenId]=ACT.archivos.length;
    if(st){ st.style.color='#16a34a'; st.textContent='✓ Factura(s) guardada(s).'; }
    pintarModal(); scanAndInject();
  }catch(e){ if(st){ st.style.color='#dc2626'; st.textContent='Error: '+e.message; } }
};
window.factBorrar=async function(i){
  if(!ACT||!ACT.archivos[i]) return;
  ACT.archivos.splice(i,1);
  try{
    if(ACT.archivos.length) await setDoc(doc(db,'facturasOrden',ACT.ordenId), { ordenId:ACT.ordenId, folio:ACT.folio||'', proveedor:ACT.proveedor||'', archivos:ACT.archivos, ts:Date.now() });
    else await deleteDoc(doc(db,'facturasOrden',ACT.ordenId));
    CACHE[ACT.ordenId]=ACT.archivos.length;
  }catch(e){}
  pintarModal(); scanAndInject();
};

function ensureModal(){
  if(document.getElementById('m-fact')) return;
  const d=document.createElement('div'); d.id='m-fact';
  d.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1004;align-items:center;justify-content:center';
  d.innerHTML='<div style="background:#fff;border-radius:12px;padding:18px;max-width:440px;width:92%;max-height:88vh;overflow-y:auto">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0;font-size:18px;color:#0369a1">🧾 Factura de la orden</h3>'+
    '<button onclick="factCerrar()" style="border:none;background:none;font-size:20px;cursor:pointer;color:#888">✕</button></div>'+
    '<div id="fact-body"></div>'+
    '<div style="margin-top:14px"><button onclick="factCerrar()" class="btn" style="width:100%">Cerrar</button></div></div>';
  d.addEventListener('click',e=>{ if(e.target.id==='m-fact') factCerrar(); });
  document.body.appendChild(d);
}

/* ---------- inyección del botón en cada orden ---------- */
function folioToOrden(folio){ return (window.__ordenesCompra||[]).find(x=>x.folio===folio); }

function scanAndInject(){
  if(!window.__adminOK || !cacheListo) return;
  const botones=[...document.querySelectorAll('button')].filter(b=>{ const t=(b.textContent||'').trim().toLowerCase(); return t==='editar'; });
  botones.forEach(btn=>{
    let cont=btn.parentElement, folio=null, hops=0;
    while(cont && hops<6){ const m=(cont.textContent||'').match(/\bS\d{3,6}\b/); if(m){ folio=m[0]; break; } cont=cont.parentElement; hops++; }
    if(!cont || !folio) return;
    if(cont.querySelector('[data-fact-btn]')) return;
    const o=folioToOrden(folio); if(!o) return;
    const tiene=CACHE[o.id]>0;
    const b=document.createElement('button');
    b.setAttribute('data-fact-btn','1');
    b.className=btn.className||'';
    b.textContent = tiene ? '🧾 Factura ✓' : '🧾 Factura';
    if(tiene) b.style.cssText='background:#16a34a;color:#fff;border-color:#16a34a';
    b.addEventListener('click', function(ev){ ev.stopPropagation(); ev.preventDefault(); window.factAbrir(o.id, o.folio, o.proveedor); });
    btn.parentElement.insertBefore(b, btn);
  });
}
window.factRefresh=scanAndInject;

let deb=null;
function armarObserver(){
  try{ const obs=new MutationObserver(()=>{ clearTimeout(deb); deb=setTimeout(scanAndInject,250); }); obs.observe(document.body,{childList:true,subtree:true}); }catch(e){}
}

function start(){
  if(!document.body){ setTimeout(start,300); return; }
  cargarCache();
  armarObserver();
  let n=0; const iv=setInterval(()=>{ scanAndInject(); if(++n>20) clearInterval(iv); }, 1000);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
