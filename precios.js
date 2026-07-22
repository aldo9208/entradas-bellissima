/* ===== Precios y ofertas — módulo autónomo para la app de Entradas =====
   <script type="module" src="./precios.js"></script>
   Vista de sucursales: cambios de precio (iguales para todas) + ofertas (por sucursal) + buscador.
   Admin (contraseña): sube lista de precios de SAIT + PROMO (+ catálogo de líneas opcional),
   detecta cambios vs el reporte anterior y publica. Guarda historial de precios anterior→nuevo. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, addDoc, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

const SUC = {1:'Matriz',2:'Morelos',3:'Hidalgo',4:'Allende',5:'Sucursal 5',6:'Tlapacoyan',7:'Papantla',8:'Sucursal 8',9:'Perote',10:'Independencia',11:'Ávila Camacho',12:'Misantla'};
const IVA = 1.16;
const money = n => '$'+(Number(n)||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const MESES = {ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,oct:10,nov:11,dic:12,jan:1,apr:4,aug:8,dec:12};
function pd(s){ const m=String(s||'').trim().match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/); if(!m) return null; const mm=MESES[m[2].toLowerCase()]; if(!mm) return null; let y=+m[3]; if(y<100) y+=2000; return new Date(y, mm-1, +m[1]); }
function nk(s){ return String(s==null?'':s).trim().toUpperCase().replace(/^0+/,'')||'0'; }

let PUB=null; // {fecha, cambios:[], ofertas:[]}
let BASE=null; // [{c,d,p}]
let sucSel = null, chip='cambios', q='', pending=null;

/* ---------- almacenamiento en Firebase (por trozos) ---------- */
async function saveList(prefix, arr, per){
  per=per||3000; const n=Math.ceil(arr.length/per);
  await setDoc(doc(db,'preciosPub',prefix+'_meta'), {n, len:arr.length, ts:Date.now()});
  for(let i=0;i<n;i++) await setDoc(doc(db,'preciosPub',prefix+'_'+i), {j:JSON.stringify(arr.slice(i*per,(i+1)*per))});
}
async function loadList(prefix){
  try{ const m=await getDoc(doc(db,'preciosPub',prefix+'_meta')); if(!m.exists()) return null;
    const n=m.data().n; let out=[]; for(let i=0;i<n;i++){ const c=await getDoc(doc(db,'preciosPub',prefix+'_'+i)); if(c.exists()) out=out.concat(JSON.parse(c.data().j)); } return out;
  }catch(e){ return null; }
}

/* ---------- lectura de Excel (usa el SheetJS de la app) ---------- */
async function readXlsx(file){
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(new Uint8Array(buf),{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws,{header:1, raw:true, defval:''});
}
function parseListaPrecios(rows){
  // encabezado fila 6 (índice 5): Clave, Descripcion, Precio 1...
  const out=[];
  for(let i=6;i<rows.length;i++){ const r=rows[i]; if(!r) continue;
    const clave=String(r[0]==null?'':r[0]).trim(); if(!clave) continue;
    const p1=Number(r[2]); if(!(p1>0)) continue;
    out.push({c:clave, d:String(r[1]||'').trim(), p:Math.round(p1*IVA*100)/100});
  }
  return out;
}
function parsePromo(rows){
  // encabezado fila 1 (índice 0): numart,numlin,...,fini(4),ffin(5),pjedesc(8),sucursales(10)
  const hoy=new Date(); hoy.setHours(0,0,0,0);
  const prod=[], lin=[];
  for(let i=1;i<rows.length;i++){ const r=rows[i]; if(!r) continue;
    const numart=String(r[0]==null?'':r[0]).trim();
    const numlin=String(r[1]==null?'':r[1]).trim();
    const fini=pd(r[4]), ffin=pd(r[5]);
    if(!fini||!ffin||hoy<fini||hoy>ffin) continue;
    const pct=Number(r[8])||0; if(pct<=0) continue;
    const sucs=String(r[10]||'').split(',').map(s=>s.trim()).filter(Boolean);
    if(numart) prod.push({clave:numart, pct, sucs});
    else if(numlin) lin.push({numlin:numlin.replace(/^0+/,'')||numlin, pct, sucs});
  }
  return {prod, lin};
}
function parseCatalogo(rows){
  // catálogo de líneas: encabezado fila 6, col0 clave, col5 clave Linea
  const map={};
  for(let i=6;i<rows.length;i++){ const r=rows[i]; if(!r) continue;
    const clave=String(r[0]==null?'':r[0]).trim(); if(!clave) continue;
    const nl=String(r[5]==null?'':r[5]).trim(); if(nl) map[clave]=nl.replace(/^0+/,'')||nl;
  }
  return map;
}

/* ---------- construir cambios y ofertas ---------- */
function detectarCambios(nuevo, baseMap){
  const cambios=[];
  if(!baseMap || !Object.keys(baseMap).length) return cambios; // primera vez: sólo se fija la base
  for(const it of nuevo){
    const ant=baseMap[it.c];
    if(ant==null){ cambios.push({c:it.c, d:it.d, p:it.p, ant:null, tipo:'nuevo'}); }
    else if(Math.abs(ant-it.p)>0.005){ cambios.push({c:it.c, d:it.d, p:it.p, ant, tipo: it.p>ant?'sube':'baja'}); }
  }
  return cambios;
}
function construirOfertas(promo, precioMap, catMap){
  const of={}; // clave -> {c,d,p,of,pct,sucs}
  const aplicar=(clave,pct,sucs)=>{
    const pm=precioMap[clave]; if(!pm) return;
    let ex=of[clave];
    if(!ex){ ex=of[clave]={c:clave, d:pm.d, p:pm.p, pct:0, sucs:[]}; }
    ex.pct=Math.max(ex.pct, pct);
    ex.sucs=Array.from(new Set(ex.sucs.concat(sucs)));
    ex.of=Math.round(pm.p*(1-ex.pct/100)*100)/100;
  };
  promo.prod.forEach(o=>aplicar(o.clave, o.pct, o.sucs));
  if(catMap && Object.keys(catMap).length && promo.lin.length){
    // expandir TODAS las ofertas de línea a sus productos (una línea puede tener
    // varias filas activas con distintas sucursales: se unen todas)
    const prodsPorLinea={};
    for(const clave in precioMap){ const nl=catMap[clave]; if(nl){ (prodsPorLinea[nl]=prodsPorLinea[nl]||[]).push(clave); } }
    promo.lin.forEach(o=>{ const cs=prodsPorLinea[o.numlin]; if(cs){ cs.forEach(clave=>aplicar(clave, o.pct, o.sucs)); } });
  }
  return Object.values(of);
}

/* ---------- vista SUCURSALES ---------- */
async function cargarPub(){
  const [meta, camb, ofer] = await Promise.all([
    getDoc(doc(db,'preciosPub','meta')).then(d=>d.exists()?d.data():null),
    loadList('camb'), loadList('ofer')
  ]);
  PUB = {fecha: meta?meta.fecha:'', ts: meta?meta.ts:0, cambios: camb||[], ofertas: ofer||[]};
}
window.renderPrecios = async function(){
  const lo=document.getElementById('pre-loading');
  if(lo) lo.style.display='block';
  if(!PUB){ await cargarPub(); }
  if(!BASE){ BASE = await loadList('base') || []; }
  if(lo) lo.style.display='none';
  if(!sucSel){ try{ sucSel = localStorage.getItem('preciosSuc') || '1'; }catch(e){ sucSel='1'; } }
  fillSucSelect();
  renderPreView();
};
function fillSucSelect(){
  const se=document.getElementById('pre-suc'); if(!se) return;
  let h=''; Object.keys(SUC).forEach(k=>{ h+='<option value="'+k+'"'+(String(sucSel)===k?' selected':'')+'>'+SUC[k]+'</option>'; });
  se.innerHTML=h;
}
window.preSuc=function(v){ sucSel=String(v); try{ localStorage.setItem('preciosSuc',sucSel); }catch(e){} renderPreView(); };
window.preChip=function(c){ chip=c; document.querySelectorAll('#pre-chips [data-c]').forEach(el=>el.classList.toggle('on', el.getAttribute('data-c')===c)); document.getElementById('pre-buscar').value=''; q=''; renderPreView(); };
window.preBuscar=function(v){ q=(v||'').trim().toLowerCase(); renderPreView(); };

function ofertaDe(clave){ // oferta activa para la sucursal seleccionada
  if(!PUB) return null;
  const o=PUB.ofertas.find(x=>x.c===clave && x.sucs.indexOf(String(sucSel))>=0);
  return o||null;
}
function renderPreView(){
  const cont=document.getElementById('pre-list'); if(!cont) return;
  const fecha=PUB&&PUB.fecha?('<div style="font-size:12px;color:var(--muted,#777);margin-bottom:8px">Actualizado: '+esc(PUB.fecha)+'</div>'):'';
  let rows=[];
  if(q){
    // buscador sobre todo el catálogo
    rows=(BASE||[]).filter(x=>(x.c+' '+x.d).toLowerCase().indexOf(q)>=0).slice(0,200).map(x=>({c:x.c,d:x.d,p:x.p}));
  } else if(chip==='cambios'){
    rows=(PUB?PUB.cambios:[]);
  } else if(chip==='ofertas'){
    rows=(PUB?PUB.ofertas.filter(o=>o.sucs.indexOf(String(sucSel))>=0):[]);
  }
  if(!rows.length){
    let msg = q ? 'Sin resultados para "'+esc(q)+'".'
      : chip==='cambios' ? 'No hay cambios de precio por ahora.' : 'No hay ofertas para esta sucursal.';
    cont.innerHTML=fecha+'<div style="padding:28px;text-align:center;color:var(--muted,#777)">'+msg+'</div>'; return;
  }
  let h=fecha;
  for(const it of rows){
    const of = it.of!=null ? it : ofertaDe(it.c); // en ofertas ya trae of; en cambios/búsqueda se busca
    let right='';
    if(of && of.of!=null){
      right='<div style="text-align:right"><span style="text-decoration:line-through;color:var(--muted,#999);font-size:12px">'+money(of.p)+'</span> '+
        '<b style="color:#16a34a">'+money(of.of)+'</b><div style="font-size:11px;color:#16a34a">oferta −'+of.pct+'%</div></div>';
    } else if(it.tipo){
      const ic = it.tipo==='sube'?'🔺':(it.tipo==='baja'?'🔻':'🆕');
      const col = it.tipo==='sube'?'#dc2626':(it.tipo==='baja'?'#16a34a':'#6b21a8');
      const antes = it.ant!=null ? '<span style="text-decoration:line-through;color:var(--muted,#999);font-size:12px">'+money(it.ant)+'</span> ' : '';
      right='<div style="text-align:right">'+antes+'<b style="color:'+col+'">'+money(it.p)+'</b><div style="font-size:11px;color:'+col+'">'+ic+' '+(it.tipo==='nuevo'?'nuevo':'')+'</div></div>';
    } else {
      right='<div style="text-align:right"><b>'+money(it.p)+'</b></div>';
    }
    h+='<div class="pre-row"><div style="min-width:0"><b>'+esc(it.c)+'</b> '+esc(it.d)+'</div>'+right+'</div>';
  }
  if(rows.length>=200) h+='<div style="padding:10px;text-align:center;color:var(--muted,#777);font-size:12px">Mostrando 200 — afina la búsqueda.</div>';
  cont.innerHTML=h;
}

/* ---------- ADMIN ---------- */
window.preAdminEntrar=function(){
  const p=document.getElementById('pre-pass').value;
  if(p==='bellissima2026'){ document.getElementById('pre-admin-gate').style.display='none'; document.getElementById('pre-admin-panel').style.display='block'; renderHistorial(); }
  else { document.getElementById('pre-pass-msg').textContent='Contraseña incorrecta.'; }
};
window.preProcesar=async function(){
  const st=document.getElementById('pre-adm-status');
  const fL=document.getElementById('pre-f-lista').files[0];
  const fP=document.getElementById('pre-f-promo').files[0];
  const fC=document.getElementById('pre-f-cat').files[0];
  if(!fL){ st.textContent='Falta la lista de precios (obligatoria).'; return; }
  st.textContent='Leyendo archivos…';
  try{
    const nuevo=parseListaPrecios(await readXlsx(fL));
    const precioMap={}; nuevo.forEach(x=>{ precioMap[x.c]={d:x.d,p:x.p}; });
    const promo = fP ? parsePromo(await readXlsx(fP)) : {prod:[],lin:[]};
    const catMap = fC ? parseCatalogo(await readXlsx(fC)) : {};
    const baseArr = await loadList('base');
    const baseMap={}; (baseArr||[]).forEach(x=>{ baseMap[x.c]=x.p; });
    const cambios=detectarCambios(nuevo, baseMap);
    const ofertas=construirOfertas(promo, precioMap, catMap);
    pending={nuevo, cambios, ofertas, primera: !(baseArr&&baseArr.length)};
    const sube=cambios.filter(c=>c.tipo==='sube').length, baja=cambios.filter(c=>c.tipo==='baja').length, nue=cambios.filter(c=>c.tipo==='nuevo').length;
    let h='<div class="pre-sum">';
    h+='<div><b>'+nuevo.length.toLocaleString('es-MX')+'</b> productos en la lista</div>';
    if(pending.primera){ h+='<div style="color:#d97706">Primera vez: se guardará la base. Los cambios aparecerán la próxima vez que subas un reporte.</div>'; }
    else { h+='<div>Cambios: <b>'+cambios.length+'</b> ('+sube+' 🔺 subieron, '+baja+' 🔻 bajaron, '+nue+' 🆕 nuevos)</div>'; }
    h+='<div>Ofertas activas: <b>'+ofertas.length+'</b></div>';
    h+='</div>';
    document.getElementById('pre-preview').innerHTML=h;
    document.getElementById('pre-publicar').disabled=false;
    st.textContent='';
  }catch(e){ st.textContent='Error: '+e.message; }
};
window.prePublicar=async function(){
  if(!pending) return;
  const st=document.getElementById('pre-adm-status'); st.textContent='Publicando…';
  try{
    const fecha=new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'});
    st.textContent='Guardando base…';
    await saveList('base', pending.nuevo.map(x=>({c:x.c,d:x.d,p:x.p})));
    st.textContent='Guardando cambios y ofertas…';
    await saveList('camb', pending.cambios);
    await saveList('ofer', pending.ofertas);
    await setDoc(doc(db,'preciosPub','meta'), {fecha, ts:Date.now(), nCamb:pending.cambios.length, nOfer:pending.ofertas.length});
    // historial (registro anterior→nuevo)
    await addDoc(collection(db,'preciosHist'), {fecha, ts:Date.now(), nCambios:pending.cambios.length,
      cambios: pending.cambios.slice(0,4000).map(c=>({c:c.c, d:c.d, ant:c.ant, p:c.p, tipo:c.tipo})) });
    pending=null; PUB=null; BASE=null;
    document.getElementById('pre-preview').innerHTML='<div class="pre-sum" style="color:#16a34a">✓ Publicado. Las sucursales ya lo ven.</div>';
    document.getElementById('pre-publicar').disabled=true;
    document.getElementById('pre-f-lista').value=''; document.getElementById('pre-f-promo').value=''; document.getElementById('pre-f-cat').value='';
    st.textContent=''; renderHistorial();
  }catch(e){ st.textContent='Error al publicar: '+e.message; }
};
async function renderHistorial(){
  const cont=document.getElementById('pre-hist'); if(!cont) return;
  cont.innerHTML='<p style="color:var(--muted,#777)">Cargando historial…</p>';
  try{
    const snap=await getDocs(query(collection(db,'preciosHist'), orderBy('ts','desc')));
    const arr=[]; snap.forEach(d=>{ const o=d.data(); o._id=d.id; arr.push(o); });
    if(!arr.length){ cont.innerHTML='<p style="color:var(--muted,#777)">Aún no hay publicaciones.</p>'; return; }
    let h='';
    arr.slice(0,20).forEach(o=>{
      h+='<details class="pre-hist-item"><summary><b>'+esc(o.fecha)+'</b> — '+(o.nCambios||0)+' cambios</summary>';
      h+='<div style="max-height:260px;overflow:auto;margin-top:6px">';
      (o.cambios||[]).slice(0,300).forEach(c=>{
        const ic=c.tipo==='sube'?'🔺':(c.tipo==='baja'?'🔻':'🆕');
        h+='<div class="pre-hrow">'+ic+' <b>'+esc(c.c)+'</b> '+esc(String(c.d||'').slice(0,30))+' <span style="float:right">'+(c.ant!=null?money(c.ant)+' → ':'')+money(c.p)+'</span></div>';
      });
      h+='</div></details>';
    });
    cont.innerHTML=h;
  }catch(e){ cont.innerHTML='<p style="color:#dc2626">Error: '+e.message+'</p>'; }
}

/* ---------- pantallas ---------- */
const SCREENS_HTML = `
<div id="s-precios" class="screen">
  <style>
    #s-precios .pre-chip,#s-precios .pre-chip{padding:7px 14px;border:1px solid var(--line,#e5e5e5);background:#fff;border-radius:99px;font-size:13px;cursor:pointer;color:var(--muted,#777)}
    #s-precios .pre-chip.on{background:var(--brand,#6b21a8);border-color:var(--brand,#6b21a8);color:#fff;font-weight:600}
    #s-precios .pre-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 12px;border-bottom:1px solid var(--line,#eee);font-size:13px}
    #s-precios .pre-row:nth-child(even){background:#fafafa}
    #s-precios .pre-sel{padding:8px 10px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:14px;background:#fff}
    #s-precios .pre-sum{background:#f6f1f8;border:1px solid var(--line,#e5e5e5);border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.7}
    #s-precios .pre-drop{border:1px dashed var(--line,#ccc);border-radius:10px;padding:10px;background:#faf7fb;margin:6px 0}
    #s-precios .pre-hist-item{border:1px solid var(--line,#eee);border-radius:8px;padding:8px 12px;margin-bottom:6px;font-size:13px}
    #s-precios .pre-hist-item summary{cursor:pointer}
    #s-precios .pre-hrow{font-size:12px;padding:3px 0;border-bottom:1px dotted var(--line,#eee)}
    #s-precios .pre-tabbtn{background:none;border:none;font-size:13px;color:var(--brand,#6b21a8);cursor:pointer;text-decoration:underline;padding:0}
  </style>
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-home');window.renderHome&&window.renderHome()">←</button>
    <h2>Precios y ofertas</h2>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <label style="font-size:13px;color:var(--muted,#777)">Sucursal
      <select id="pre-suc" class="pre-sel" onchange="preSuc(this.value)"></select>
    </label>
    <button class="pre-tabbtn" onclick="show('s-precios-admin');preAdminReset()">⚙ Admin</button>
  </div>
  <input id="pre-buscar" placeholder="Buscar cualquier producto…" style="width:100%;padding:9px 12px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:14px;margin-bottom:10px" oninput="preBuscar(this.value)">
  <div id="pre-chips" style="display:flex;gap:6px;margin-bottom:12px">
    <span class="pre-chip on" data-c="cambios" onclick="preChip('cambios')">🔄 Cambios de precio</span>
    <span class="pre-chip" data-c="ofertas" onclick="preChip('ofertas')">🏷️ Ofertas</span>
  </div>
  <div id="pre-loading" style="display:none;color:var(--brand,#6b21a8);font-size:13px;padding:10px">Cargando…</div>
  <div id="pre-list" style="border:1px solid var(--line,#eee);border-radius:12px;overflow:hidden;background:#fff"></div>
</div>
<div id="s-precios-admin" class="screen">
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-precios');renderPrecios()">←</button>
    <h2>Admin — Precios</h2>
  </div>
  <div id="pre-admin-gate">
    <p style="font-size:13px;color:var(--muted,#777)">Ingresa la contraseña para publicar precios.</p>
    <input id="pre-pass" type="password" placeholder="Contraseña" style="width:100%;padding:9px 12px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:14px" onkeydown="if(event.key==='Enter')preAdminEntrar()">
    <div id="pre-pass-msg" style="color:#dc2626;font-size:12px;margin:6px 0"></div>
    <button class="btn" style="margin-top:8px;width:100%" onclick="preAdminEntrar()">Entrar</button>
  </div>
  <div id="pre-admin-panel" style="display:none">
    <div class="pre-drop"><label style="font-size:13px;font-weight:600">1. Lista de precios de SAIT (obligatorio)</label><br><input id="pre-f-lista" type="file" accept=".xlsx,.xls"></div>
    <div class="pre-drop"><label style="font-size:13px;font-weight:600">2. PROMO por sucursal (ofertas)</label><br><input id="pre-f-promo" type="file" accept=".xlsx,.xls"></div>
    <div class="pre-drop"><label style="font-size:13px;font-weight:600">3. Catálogo de líneas (opcional — ofertas de línea)</label><br><input id="pre-f-cat" type="file" accept=".xlsx,.xls"></div>
    <button class="btn btn-s" style="width:100%;margin-top:4px" onclick="preProcesar()">Procesar y comparar</button>
    <div id="pre-preview" style="margin:12px 0"></div>
    <button class="btn" id="pre-publicar" style="width:100%" onclick="prePublicar()" disabled>Publicar a sucursales</button>
    <div id="pre-adm-status" style="font-size:13px;color:var(--brand,#6b21a8);margin-top:8px;min-height:18px"></div>
    <h3 style="margin:18px 0 8px;font-size:15px">Historial de cambios</h3>
    <div id="pre-hist"></div>
  </div>
</div>`;

window.preAdminReset=function(){
  const g=document.getElementById('pre-admin-gate'), p=document.getElementById('pre-admin-panel');
  if(g&&p){ g.style.display='block'; p.style.display='none'; }
  const pm=document.getElementById('pre-pass-msg'); if(pm) pm.textContent='';
  const pp=document.getElementById('pre-pass'); if(pp) pp.value='';
};

function initUI(intentos){
  intentos=intentos||0;
  const home=document.getElementById('s-home');
  if(!home){ if(intentos<40) setTimeout(()=>initUI(intentos+1),300); return; }
  if(!document.getElementById('s-precios')){
    const tmp=document.createElement('div'); tmp.innerHTML=SCREENS_HTML;
    const parent=home.parentNode; while(tmp.firstChild) parent.appendChild(tmp.firstChild);
  }
  if(!document.getElementById('pre-navbtn')){
    let ref=document.getElementById('pv-navbtn');
    if(!ref){ document.querySelectorAll('#s-home button').forEach(b=>{ if((b.getAttribute('onclick')||'').indexOf('renderAdminLista')>=0) ref=b; }); }
    const nb=document.createElement('button');
    nb.id='pre-navbtn'; nb.className=ref?ref.className:'btn btn-sm btn-s';
    nb.textContent='🏷️ Precios y ofertas';
    nb.setAttribute('onclick',"show('s-precios');renderPrecios()");
    if(ref && ref.parentNode) ref.parentNode.insertBefore(nb, ref.nextSibling);
    else home.insertBefore(nb, home.firstChild);
  }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initUI());
else initUI();
