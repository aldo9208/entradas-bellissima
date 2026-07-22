/* ===== Inventario (valor a costo) — módulo autónomo para la app de Entradas =====
   <script type="module" src="./inventario.js"></script>
   Panel para el equipo administrativo (contraseña). Sube el reporte consolidado de
   existencias y costos de SAIT; guarda el valor total por día y muestra tendencia e historial. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

const money = n => '$'+(Number(n)||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
const money0 = n => '$'+(Number(n)||0).toLocaleString('es-MX',{maximumFractionDigits:0});
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function hoyISO(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtFecha(iso){ const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/); if(!m) return iso||''; return new Date(+m[1],+m[2]-1,+m[3]).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}); }

let HIST=null, pending=null, SNAP=null, invQ='';

async function saveList(prefix, arr, per){
  per=per||3000; const n=Math.ceil(arr.length/per);
  await setDoc(doc(db,'inventarioPub',prefix+'_meta'), {n, len:arr.length, ts:Date.now()});
  for(let i=0;i<n;i++) await setDoc(doc(db,'inventarioPub',prefix+'_'+i), {j:JSON.stringify(arr.slice(i*per,(i+1)*per))});
}
async function loadList(prefix){
  try{ const m=await getDoc(doc(db,'inventarioPub',prefix+'_meta')); if(!m.exists()) return null;
    const n=m.data().n; let out=[]; for(let i=0;i<n;i++){ const c=await getDoc(doc(db,'inventarioPub',prefix+'_'+i)); if(c.exists()) out=out.concat(JSON.parse(c.data().j)); } return out;
  }catch(e){ return null; }
}
async function readXlsx(file){
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(new Uint8Array(buf),{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws,{header:1, raw:true, defval:''});
}
function parseInventario(rows){
  // encabezado fila 6: Clave, Descripcion, Existencia, Ultimo Costo, Costo Total, Divisa
  const items=[]; let total=0, nStock=0;
  for(let i=6;i<rows.length;i++){ const r=rows[i]; if(!r) continue;
    const clave=String(r[0]==null?'':r[0]).trim(); if(!clave) continue;
    const ex=Number(r[2])||0, ct=Number(r[4])||0;
    total+=ct; if(ex>0) nStock++;
    items.push({c:clave, d:String(r[1]||'').trim(), ex, ct:Math.round(ct*100)/100});
  }
  return {items, total:Math.round(total*100)/100, nProd:items.length, nStock};
}

async function cargarHist(){
  const snap=await getDocs(query(collection(db,'inventarioHist'), orderBy('fechaISO','asc')));
  const arr=[]; snap.forEach(d=>{ arr.push(d.data()); });
  HIST=arr;
}

/* ---------- vista ---------- */
window.renderInventario = async function(){
  const g=document.getElementById('inv-gate'), p=document.getElementById('inv-panel');
  if(p && p.style.display==='block'){ await refrescarVista(); }
  else { if(g) g.style.display='block'; if(p) p.style.display='none';
    const pm=document.getElementById('inv-pass-msg'); if(pm) pm.textContent='';
    const pp=document.getElementById('inv-pass'); if(pp) pp.value=''; }
};
window.invEntrar=function(){
  const p=document.getElementById('inv-pass').value;
  if(p==='bellissima2026'){ document.getElementById('inv-gate').style.display='none'; document.getElementById('inv-panel').style.display='block';
    document.getElementById('inv-fecha').value=hoyISO(); refrescarVista(); }
  else document.getElementById('inv-pass-msg').textContent='Contraseña incorrecta.';
};

async function refrescarVista(){
  await cargarHist();
  renderCards(); renderChart(); renderHistTabla();
}
function renderCards(){
  const cont=document.getElementById('inv-cards'); if(!cont) return;
  if(!HIST||!HIST.length){ cont.innerHTML='<div style="color:var(--muted,#777);padding:8px">Aún no hay datos. Sube el primer reporte abajo.</div>'; return; }
  const ult=HIST[HIST.length-1];
  const ant=HIST.length>1?HIST[HIST.length-2]:null;
  // ~7 días atrás
  let sem=null; const objetivo=new Date(ult.fechaISO); objetivo.setDate(objetivo.getDate()-7);
  for(let i=HIST.length-1;i>=0;i--){ if(new Date(HIST[i].fechaISO)<=objetivo){ sem=HIST[i]; break; } }
  function delta(base){ if(!base) return ''; const d=ult.total-base.total; const pct=base.total?d/base.total*100:0;
    const col=d>0?'#dc2626':(d<0?'#16a34a':'#777'); const ic=d>0?'▲':(d<0?'▼':'–');
    return '<div style="font-size:12px;color:'+col+'">'+ic+' '+money0(Math.abs(d))+' ('+(d>=0?'+':'')+pct.toFixed(1)+'%)</div>'; }
  cont.innerHTML=
    '<div class="inv-card"><div class="inv-l">Valor de inventario (a costo)</div><div class="inv-n">'+money(ult.total)+'</div><div style="font-size:11px;color:var(--muted,#777)">'+fmtFecha(ult.fechaISO)+'</div></div>'+
    '<div class="inv-card"><div class="inv-l">vs día anterior</div><div class="inv-n" style="font-size:18px">'+(ant?money0(ant.total):'—')+'</div>'+delta(ant)+'</div>'+
    '<div class="inv-card"><div class="inv-l">vs hace ~7 días</div><div class="inv-n" style="font-size:18px">'+(sem?money0(sem.total):'—')+'</div>'+delta(sem)+'</div>'+
    '<div class="inv-card"><div class="inv-l">Productos con existencia</div><div class="inv-n" style="font-size:18px">'+(ult.nStock||0).toLocaleString('es-MX')+'</div><div style="font-size:11px;color:var(--muted,#777)">de '+(ult.nProd||0).toLocaleString('es-MX')+'</div></div>';
}
function renderChart(){
  const box=document.getElementById('inv-chart'); if(!box) return;
  if(!HIST||HIST.length<2){ box.innerHTML=''; return; }
  const data=HIST.slice(-30);
  const W=680,H=170,pad=42;
  const vals=data.map(d=>d.total), min=Math.min(...vals), max=Math.max(...vals);
  const rng=(max-min)||1;
  const x=i=>pad+(i*(W-pad-10)/(data.length-1));
  const y=v=>H-24-((v-min)/rng)*(H-44);
  let pts=data.map((d,i)=>x(i)+','+y(d.total)).join(' ');
  let dots=data.map((d,i)=>'<circle cx="'+x(i).toFixed(1)+'" cy="'+y(d.total).toFixed(1)+'" r="2.5" fill="#6b21a8"></circle>').join('');
  const first=fmtFecha(data[0].fechaISO), last=fmtFecha(data[data.length-1].fechaISO);
  box.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto">'+
    '<text x="'+(pad-6)+'" y="'+(y(max)+4)+'" font-size="10" fill="#999" text-anchor="end">'+money0(max)+'</text>'+
    '<text x="'+(pad-6)+'" y="'+(y(min)+4)+'" font-size="10" fill="#999" text-anchor="end">'+money0(min)+'</text>'+
    '<polyline points="'+pts+'" fill="none" stroke="#6b21a8" stroke-width="2"></polyline>'+dots+
    '<text x="'+pad+'" y="'+(H-6)+'" font-size="10" fill="#999">'+first+'</text>'+
    '<text x="'+(W-10)+'" y="'+(H-6)+'" font-size="10" fill="#999" text-anchor="end">'+last+'</text>'+
    '</svg>';
}
function renderHistTabla(){
  const cont=document.getElementById('inv-hist'); if(!cont) return;
  if(!HIST||!HIST.length){ cont.innerHTML=''; return; }
  const arr=HIST.slice().reverse().slice(0,30);
  let h='<table class="inv-t"><thead><tr><th>Fecha</th><th style="text-align:right">Valor (costo)</th><th style="text-align:right">Cambio</th><th style="text-align:right">Con stock</th></tr></thead><tbody>';
  for(let i=0;i<arr.length;i++){ const d=arr[i]; const prev=arr[i+1];
    let ch='—'; if(prev){ const dd=d.total-prev.total; const col=dd>0?'#dc2626':(dd<0?'#16a34a':'#777'); ch='<span style="color:'+col+'">'+(dd>0?'▲ ':(dd<0?'▼ ':''))+money0(Math.abs(dd))+'</span>'; }
    h+='<tr><td>'+fmtFecha(d.fechaISO)+'</td><td style="text-align:right">'+money(d.total)+'</td><td style="text-align:right">'+ch+'</td><td style="text-align:right">'+(d.nStock||0).toLocaleString('es-MX')+'</td></tr>';
  }
  h+='</tbody></table>';
  cont.innerHTML=h;
}

window.invProcesar=async function(){
  const st=document.getElementById('inv-status');
  const f=document.getElementById('inv-file').files[0];
  const fecha=document.getElementById('inv-fecha').value || hoyISO();
  if(!f){ st.textContent='Selecciona el archivo de existencias.'; return; }
  st.textContent='Leyendo…';
  try{
    const parsed=parseInventario(await readXlsx(f));
    pending={fecha, ...parsed};
    if(!HIST) await cargarHist();
    const ant=HIST&&HIST.length?HIST[HIST.length-1]:null;
    let h='<div class="inv-sum"><div>Fecha: <b>'+fmtFecha(fecha)+'</b></div>';
    h+='<div>Valor de inventario (a costo): <b>'+money(parsed.total)+'</b></div>';
    h+='<div>'+parsed.nProd.toLocaleString('es-MX')+' productos · '+parsed.nStock.toLocaleString('es-MX')+' con existencia</div>';
    if(ant){ const d=parsed.total-ant.total; const col=d>0?'#dc2626':(d<0?'#16a34a':'#777'); h+='<div style="color:'+col+'">vs '+fmtFecha(ant.fechaISO)+': '+(d>=0?'+':'')+money0(d)+'</div>'; }
    h+='</div>';
    document.getElementById('inv-preview').innerHTML=h;
    document.getElementById('inv-guardar').disabled=false;
    st.textContent='';
  }catch(e){ st.textContent='Error: '+e.message; }
};
window.invGuardar=async function(){
  if(!pending) return;
  const st=document.getElementById('inv-status'); st.textContent='Guardando…';
  try{
    await setDoc(doc(db,'inventarioHist', pending.fecha), {
      fecha: fmtFecha(pending.fecha), fechaISO: pending.fecha, ts:Date.now(),
      total: pending.total, nProd: pending.nProd, nStock: pending.nStock
    });
    st.textContent='Guardando detalle…';
    await saveList('snap', pending.items.map(x=>({c:x.c,d:x.d,ex:x.ex,ct:x.ct})));
    await setDoc(doc(db,'inventarioPub','snap_fecha'), {fecha:pending.fecha, ts:Date.now()});
    pending=null; SNAP=null;
    document.getElementById('inv-preview').innerHTML='<div class="inv-sum" style="color:#16a34a">✓ Guardado.</div>';
    document.getElementById('inv-guardar').disabled=true;
    document.getElementById('inv-file').value='';
    st.textContent='';
    await refrescarVista();
  }catch(e){ st.textContent='Error al guardar: '+e.message; }
};

/* buscador del snapshot actual */
window.invBuscar=async function(v){
  invQ=(v||'').trim().toLowerCase();
  const cont=document.getElementById('inv-busca-res'); if(!cont) return;
  if(!invQ){ cont.innerHTML=''; return; }
  if(!SNAP){ cont.innerHTML='<p style="color:var(--muted,#777);padding:6px">Cargando catálogo…</p>'; SNAP=await loadList('snap')||[]; }
  const res=SNAP.filter(x=>(x.c+' '+x.d).toLowerCase().indexOf(invQ)>=0).slice(0,60);
  if(!res.length){ cont.innerHTML='<p style="color:var(--muted,#777);padding:6px">Sin resultados.</p>'; return; }
  let h='<table class="inv-t"><thead><tr><th>Clave</th><th>Producto</th><th style="text-align:right">Exist.</th><th style="text-align:right">Valor</th></tr></thead><tbody>';
  res.forEach(x=>{ h+='<tr><td>'+esc(x.c)+'</td><td>'+esc(x.d)+'</td><td style="text-align:right">'+x.ex+'</td><td style="text-align:right">'+money(x.ct)+'</td></tr>'; });
  cont.innerHTML=h+'</tbody></table>';
};

const SCREENS_HTML = `
<div id="s-inventario" class="screen">
  <style>
    #s-inventario .inv-card{background:#fff;border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:12px 14px}
    #s-inventario .inv-l{font-size:11.5px;color:var(--muted,#777)}
    #s-inventario .inv-n{font-size:22px;font-weight:700;color:var(--brand,#6b21a8);margin-top:2px}
    #s-inventario .inv-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:14px}
    #s-inventario .inv-t{width:100%;border-collapse:collapse;font-size:13px;background:#fff}
    #s-inventario .inv-t th{background:#f6f1f8;text-align:left;padding:7px 10px;font-size:11px;text-transform:uppercase;color:var(--muted,#777);border-bottom:1px solid var(--line,#eee)}
    #s-inventario .inv-t td{padding:7px 10px;border-bottom:1px solid var(--line,#eee)}
    #s-inventario .inv-drop{border:1px dashed var(--line,#ccc);border-radius:10px;padding:10px;background:#faf7fb;margin:6px 0}
    #s-inventario .inv-sum{background:#f6f1f8;border:1px solid var(--line,#e5e5e5);border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.7}
    #s-inventario .inv-box{border:1px solid var(--line,#eee);border-radius:12px;background:#fff;padding:12px;margin-bottom:14px}
    #s-inventario h3{font-size:15px;margin:16px 0 8px}
  </style>
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-home');window.renderHome&&window.renderHome()">←</button>
    <h2>Inventario</h2>
  </div>
  <div id="inv-gate">
    <p style="font-size:13px;color:var(--muted,#777)">Panel administrativo. Ingresa la contraseña.</p>
    <input id="inv-pass" type="password" placeholder="Contraseña" style="width:100%;padding:9px 12px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:14px" onkeydown="if(event.key==='Enter')invEntrar()">
    <div id="inv-pass-msg" style="color:#dc2626;font-size:12px;margin:6px 0"></div>
    <button class="btn" style="margin-top:8px;width:100%" onclick="invEntrar()">Entrar</button>
  </div>
  <div id="inv-panel" style="display:none">
    <div id="inv-cards"></div>
    <div class="inv-box"><div style="font-size:12px;color:var(--muted,#777);margin-bottom:4px">Evolución del valor de inventario</div><div id="inv-chart"></div></div>
    <input placeholder="Buscar producto en el último reporte…" style="width:100%;padding:9px 12px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:14px;margin-bottom:8px" oninput="invBuscar(this.value)">
    <div id="inv-busca-res" style="margin-bottom:14px"></div>
    <h3>Subir reporte del día</h3>
    <div class="inv-drop">
      <label style="font-size:12px;font-weight:600">Fecha</label><br>
      <input id="inv-fecha" type="date" style="padding:7px 10px;border:1px solid var(--line,#ccc);border-radius:8px;font-size:14px;margin-bottom:8px"><br>
      <label style="font-size:12px;font-weight:600">Reporte de existencias y costos (SAIT)</label><br>
      <input id="inv-file" type="file" accept=".xlsx,.xls">
    </div>
    <button class="btn btn-s" style="width:100%;margin-top:4px" onclick="invProcesar()">Procesar</button>
    <div id="inv-preview" style="margin:12px 0"></div>
    <button class="btn" id="inv-guardar" style="width:100%" onclick="invGuardar()" disabled>Guardar el día</button>
    <div id="inv-status" style="font-size:13px;color:var(--brand,#6b21a8);margin-top:8px;min-height:18px"></div>
    <h3>Historial</h3>
    <div id="inv-hist"></div>
  </div>
</div>`;

function initUI(intentos){
  intentos=intentos||0;
  const home=document.getElementById('s-home');
  if(!home){ if(intentos<40) setTimeout(()=>initUI(intentos+1),300); return; }
  if(!document.getElementById('s-inventario')){
    const tmp=document.createElement('div'); tmp.innerHTML=SCREENS_HTML;
    const parent=home.parentNode; while(tmp.firstChild) parent.appendChild(tmp.firstChild);
  }
  if(!document.getElementById('inv-navbtn')){
    let ref=document.getElementById('pre-navbtn')||document.getElementById('pv-navbtn');
    if(!ref){ document.querySelectorAll('#s-home button').forEach(b=>{ if((b.getAttribute('onclick')||'').indexOf('renderAdminLista')>=0) ref=b; }); }
    const nb=document.createElement('button');
    nb.id='inv-navbtn'; nb.className=ref?ref.className:'btn btn-sm btn-s';
    nb.textContent='📊 Inventario';
    nb.setAttribute('onclick',"show('s-inventario');renderInventario()");
    if(ref && ref.parentNode) ref.parentNode.insertBefore(nb, ref.nextSibling);
    else home.insertBefore(nb, home.firstChild);
  }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initUI());
else initUI();
