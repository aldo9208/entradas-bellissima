/* ===== Recibir de proveedor (CEDIS) — módulo autónomo para la app de Entradas =====
   Se carga con <script type="module" src="./provee.js"></script>.
   Reutiliza el Firebase ya inicializado por la app; inyecta su propia pantalla y botón. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

let PROV_FILTRO = 'pend';
let PROV_ACTUAL = null;
let PROV_LIST = null;

const money = n => '$' + (Number(n)||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});

const SCREENS_HTML = `
<div id="s-provee" class="screen">
  <style>
    #s-provee .pv-card,#s-provee-det .pv-card{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff;border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer}
    #s-provee .pv-card:active{background:#faf6fc}
    .pv-b{display:inline-block;padding:3px 9px;border-radius:99px;font-size:11.5px;font-weight:600;white-space:nowrap}
    .pv-ok{background:#f0fdf4;color:#16a34a}.pv-falt{background:#fef2f2;color:#dc2626}.pv-pend{background:#fffbeb;color:#d97706}
    #s-provee .pv-chip{padding:6px 12px;border:1px solid var(--line,#e5e5e5);background:#fff;border-radius:99px;font-size:12.5px;cursor:pointer;color:var(--muted,#777)}
    #s-provee .pv-chip.on{background:var(--brand,#6b21a8);border-color:var(--brand,#6b21a8);color:#fff;font-weight:600}
    #s-provee-det .pv-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--line,#eee)}
    #s-provee-det .pv-row.pv-rfalt{background:#fef2f2}#s-provee-det .pv-row.pv-rsob{background:#fffbeb}
    #s-provee-det .pv-desc{font-size:12.5px;flex:1;min-width:0}
    #s-provee-det .pv-nums{display:flex;align-items:center;gap:8px;white-space:nowrap}
    #s-provee-det .pv-nums input{width:64px;padding:6px 8px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:14px;text-align:right}
    #s-provee-det .pv-f{width:44px;text-align:right;font-weight:700;font-size:12.5px}
    #s-provee-det .pv-list{border:1px solid var(--line,#eee);border-radius:12px;overflow:hidden;background:#fff}
  </style>
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-home');window.renderHome&&window.renderHome()">←</button>
    <h2>Recibir de proveedor</h2>
  </div>
  <p style="font-size:13px;color:var(--muted,#777);margin-bottom:12px">Revisa la mercancía que llega del proveedor al CEDIS contra su factura. El faltante que registres aquí es el que se le reclama al proveedor (nota de crédito) — es distinto al faltante del reparto a sucursales.</p>
  <div id="prov-chips" style="display:flex;gap:6px;margin-bottom:14px">
    <span class="pv-chip on" data-f="pend" onclick="proveeFiltro('pend')">Por revisar</span>
    <span class="pv-chip" data-f="rev" onclick="proveeFiltro('rev')">Revisadas</span>
    <span class="pv-chip" data-f="all" onclick="proveeFiltro('all')">Todas</span>
  </div>
  <div id="prov-list"></div>
</div>
<div id="s-provee-det" class="screen">
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-provee');renderProveeList()">←</button>
    <h2 id="prov-det-titulo">Revisión</h2>
  </div>
  <div id="prov-det-meta" class="card-flat" style="margin-bottom:1rem"></div>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
    <input id="prov-buscar" placeholder="Buscar producto…" style="flex:1;min-width:150px;padding:8px 10px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:14px" oninput="renderProveeDet()">
    <button class="btn btn-sm btn-s" onclick="proveeMarcarCompleto()">Todo llegó completo</button>
  </div>
  <div id="prov-det-resumen" style="margin-bottom:8px"></div>
  <div id="prov-det-body" class="pv-list"></div>
  <button class="btn" style="margin-top:1rem;width:100%" onclick="guardarRecepcionProveedor()">Guardar revisión</button>
  <div id="prov-det-status" style="font-size:13px;margin-top:8px;min-height:18px;color:var(--brand,#6b21a8)"></div>
</div>`;

async function cargarFacturas(){
  const out=[];
  const snap=await getDocs(collection(db,'ordenesCompra'));
  const revisados={};
  try{ const recSnap=await getDocs(collection(db,'recibosProveedor')); recSnap.forEach(d=>{ revisados[d.id]=d.data(); }); }catch(e){}
  snap.forEach(d=>{ const o=d.data();
    (o.compras||[]).forEach(c=>{ if(!c.folio) return;
      const prods=c.productosRecibidos||[];
      const r=revisados[c.folio];
      out.push({folioE:String(c.folio), folioS:o.folio||'', prov:o.proveedor||'', fecha:c.fechaCompra||o.fechaLlegada||'', nProd:prods.length, revisado:!!r, totalFalt:r?(r.totalFaltante||0):0, prods});
    });
  });
  out.sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)));
  return out;
}

function proveeFiltro(f){
  PROV_FILTRO=f;
  document.querySelectorAll('#prov-chips [data-f]').forEach(el=>{ el.classList.toggle('on', el.getAttribute('data-f')===f); });
  renderProveeList();
}

async function renderProveeList(){
  const cont=document.getElementById('prov-list');
  if(!cont) return;
  cont.innerHTML='<p style="color:var(--muted,#777);padding:16px">Cargando facturas…</p>';
  const list=await cargarFacturas();
  PROV_LIST=list;
  const filt=list.filter(x=> PROV_FILTRO==='all' || (PROV_FILTRO==='pend'&&!x.revisado) || (PROV_FILTRO==='rev'&&x.revisado));
  if(!filt.length){ cont.innerHTML='<p style="color:var(--muted,#777);padding:16px">No hay facturas '+(PROV_FILTRO==='pend'?'por revisar':(PROV_FILTRO==='rev'?'revisadas':''))+'.</p>'; return; }
  let h='';
  for(const x of filt){
    const badge = x.revisado ? (x.totalFalt>0?'<span class="pv-b pv-falt">Faltó '+money(x.totalFalt)+'</span>':'<span class="pv-b pv-ok">Completo</span>') : '<span class="pv-b pv-pend">Por revisar</span>';
    h+='<div class="pv-card" onclick="abrirRevisionProveedor(\''+x.folioE+'\')">'+
      '<div style="min-width:0"><b>'+x.folioE+'</b> · '+x.prov+
      '<div style="font-size:12px;color:var(--muted,#777)">'+x.fecha+' · '+x.nProd+' productos</div></div>'+
      '<div>'+badge+'</div></div>';
  }
  cont.innerHTML=h;
}

async function abrirRevisionProveedor(folioE){
  const list=PROV_LIST||await cargarFacturas();
  const f=list.find(x=>x.folioE===folioE);
  if(!f) return;
  const byClave={};
  f.prods.forEach(p=>{ const k=String(p.clave);
    if(!byClave[k]) byClave[k]={clave:k, desc:p.descripcion||p.desc||'', facturado:0, costo:p.costoPromedio||0};
    byClave[k].facturado += (p.cantRecibida||0);
  });
  const prefill={};
  try{ const d=await getDoc(doc(db,'recibosProveedor',folioE)); if(d.exists()){ (d.data().items||[]).forEach(it=>{ prefill[String(it.clave)]=it.recibido; }); } }catch(e){}
  const items=Object.keys(byClave).map(k=>{ const b=byClave[k]; return {clave:b.clave, desc:b.desc, facturado:b.facturado, costo:b.costo, recibido:(prefill[k]!=null?prefill[k]:b.facturado)}; });
  items.sort((a,b)=> a.desc<b.desc?-1:(a.desc>b.desc?1:0));
  PROV_ACTUAL={folioE:f.folioE, folioS:f.folioS, prov:f.prov, fecha:f.fecha, items};
  document.getElementById('prov-det-titulo').textContent=f.folioE;
  document.getElementById('prov-det-meta').innerHTML='<b>'+f.prov+'</b><br><span style="font-size:12px;color:var(--muted,#777)">Factura '+f.folioE+' · orden '+f.folioS+' · '+f.fecha+' · '+items.length+' productos</span>';
  document.getElementById('prov-buscar').value='';
  document.getElementById('prov-det-status').textContent='';
  renderProveeDet();
  window.show('s-provee-det');
}

function pvResumen(){
  let totFalt=0,nFalt=0;
  for(const it of PROV_ACTUAL.items){ const falta=Math.max(0,it.facturado-it.recibido); if(falta>0){ totFalt+=falta*it.costo; nFalt++; } }
  const el=document.getElementById('prov-det-resumen');
  if(el) el.innerHTML = nFalt>0 ? '<span class="pv-b pv-falt">'+nFalt+' con faltante · '+money(totFalt)+'</span>' : '<span class="pv-b pv-ok">Todo completo</span>';
}

function renderProveeDet(){
  if(!PROV_ACTUAL) return;
  const q=(document.getElementById('prov-buscar').value||'').trim().toLowerCase();
  const body=document.getElementById('prov-det-body');
  pvResumen();
  let h='', shown=0;
  for(let i=0;i<PROV_ACTUAL.items.length;i++){ const it=PROV_ACTUAL.items[i];
    if(q && (it.clave+' '+it.desc).toLowerCase().indexOf(q)<0) continue;
    const falta=it.facturado-it.recibido;
    const cls=falta>0?'pv-row pv-rfalt':(falta<0?'pv-row pv-rsob':'pv-row');
    const marca=falta>0?('−'+falta):(falta<0?('+'+(-falta)):'✓');
    const col=falta>0?'#dc2626':(falta<0?'#d97706':'#16a34a');
    h+='<div class="'+cls+'">'+
      '<div class="pv-desc"><b>'+it.clave+'</b> '+it.desc+'</div>'+
      '<div class="pv-nums">'+
        '<span style="font-size:11px;color:var(--muted,#777)">fact. '+it.facturado+'</span>'+
        '<input type="number" min="0" value="'+it.recibido+'" onchange="proveeSet('+i+',this.value)">'+
        '<span class="pv-f" style="color:'+col+'">'+marca+'</span>'+
      '</div></div>';
    shown++; if(shown>=300) break;
  }
  body.innerHTML = h || '<p style="color:var(--muted,#777);padding:12px">Sin coincidencias.</p>';
  if(shown>=300) body.innerHTML += '<p style="color:var(--muted,#777);padding:10px;font-size:12px">Mostrando 300 — usa la búsqueda para ver el resto.</p>';
}

function proveeSet(idx,val){
  if(!PROV_ACTUAL||!PROV_ACTUAL.items[idx]) return;
  let v=parseInt(val,10); if(isNaN(v)||v<0) v=0;
  PROV_ACTUAL.items[idx].recibido=v;
  renderProveeDet();
}

function proveeMarcarCompleto(){
  if(!PROV_ACTUAL) return;
  for(const it of PROV_ACTUAL.items) it.recibido=it.facturado;
  renderProveeDet();
}

async function guardarRecepcionProveedor(){
  if(!PROV_ACTUAL) return;
  const st=document.getElementById('prov-det-status'); st.textContent='Guardando…';
  const items=[]; let totFalt=0;
  for(const it of PROV_ACTUAL.items){
    const falta=Math.max(0, it.facturado-it.recibido);
    items.push({clave:it.clave, desc:it.desc, facturado:it.facturado, recibido:it.recibido, faltante:falta, costo:it.costo});
    if(falta>0) totFalt+=falta*it.costo;
  }
  try{
    await setDoc(doc(db,'recibosProveedor',PROV_ACTUAL.folioE), {
      folio:PROV_ACTUAL.folioE, folioOrden:PROV_ACTUAL.folioS, proveedor:PROV_ACTUAL.prov, fecha:PROV_ACTUAL.fecha,
      items, totalFaltante:Math.round(totFalt*100)/100, revisado:true, ts:Date.now()
    });
    st.textContent='';
    window.show('s-provee'); renderProveeList();
  }catch(e){ st.textContent='Error al guardar: '+e.message; }
}

// exponer handlers globales (onclick)
window.proveeFiltro=proveeFiltro;
window.renderProveeList=renderProveeList;
window.abrirRevisionProveedor=abrirRevisionProveedor;
window.renderProveeDet=renderProveeDet;
window.proveeSet=proveeSet;
window.proveeMarcarCompleto=proveeMarcarCompleto;
window.guardarRecepcionProveedor=guardarRecepcionProveedor;

function initUI(intentos){
  intentos=intentos||0;
  const home=document.getElementById('s-home');
  if(!home){ if(intentos<40) setTimeout(()=>initUI(intentos+1),300); return; }
  if(!document.getElementById('s-provee')){
    const tmp=document.createElement('div');
    tmp.innerHTML=SCREENS_HTML;
    const parent=home.parentNode;
    while(tmp.firstChild) parent.appendChild(tmp.firstChild);
  }
  if(!document.getElementById('pv-navbtn')){
    let adminBtn=null;
    document.querySelectorAll('#s-home button').forEach(b=>{ if((b.getAttribute('onclick')||'').indexOf('renderAdminLista')>=0) adminBtn=b; });
    const nb=document.createElement('button');
    nb.id='pv-navbtn';
    nb.className=adminBtn?adminBtn.className:'btn btn-sm btn-s';
    nb.textContent='📦 De proveedor';
    nb.setAttribute('onclick',"show('s-provee');renderProveeList()");
    if(adminBtn && adminBtn.parentNode) adminBtn.parentNode.insertBefore(nb, adminBtn.nextSibling);
    else home.insertBefore(nb, home.firstChild);
  }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initUI());
else initUI();
