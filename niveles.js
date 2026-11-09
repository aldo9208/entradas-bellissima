/* ===== Niveles de inventario por sucursal — módulo autónomo =====
   <script type="module" src="./niveles.js?v=1"></script>
   Guarda un CORTE DIARIO (resumen) por sucursal en la colección nivelesInv,
   fecha como ID del documento. Un documento chico por día: {fecha, ts, total:{valor,piezas,claves},
   sucs:{num:{nombre,valor,piezas,claves}}}. La pantalla (protegida con clave admin, es dinero)
   muestra 3 cifras de hoy, una línea de tendencia en SVG simple (sin librería) y una tabla de
   dónde está parado el dinero. Los cortes se leen SOLO al entrar a la pestaña.
   El corte se calcula subiendo el reporte de SAIT existencias_con_costos (XLSX o CSV):
   columnas por posición clave,descrip,categoria,provedor,existencia,ultcosto,p1..p5,no_sucur.
   Solo cuenta sucursales 1-12; descarta 98/99/blanco y negativos. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs, getDoc, doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

const NOM = {'1':'Matriz','2':'Morelos','3':'Hidalgo CEDIS','4':'Allende','5':'CEDIS/Oficina','6':'Tlapacoyan','7':'Papantla','8':'Puebla','9':'Perote','10':'Independencia','11':'Ávila Camacho','12':'Misantla'};
const ORDEN = ['1','2','3','4','5','6','7','8','9','10','11','12'];
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const money = n => { n=Math.round(n||0); if(Math.abs(n)>=1e6) return '$'+(n/1e6).toFixed(2)+'M'; if(Math.abs(n)>=1e3) return '$'+Math.round(n/1e3)+'K'; return '$'+n; };
const moneyFull = n => '$'+Math.round(n||0).toLocaleString('es-MX');
const num = n => Math.round(n||0).toLocaleString('es-MX');

let CORTES = [];      // [{fecha, ts, total, sucs}]
let scope = 'total';  // 'total' o número de sucursal

/* ---------- viewer ---------- */
window.renderNiveles = async function(){
  const cont=document.getElementById('niveles-body'); if(!cont) return;
  cont.innerHTML='<p style="color:var(--muted,#777);padding:20px;text-align:center">Cargando cortes…</p>';
  CORTES=[];
  try{ const s=await getDocs(collection(db,'nivelesInv')); s.forEach(d=>CORTES.push({id:d.id, ...d.data()})); }catch(e){}
  CORTES.sort((a,b)=>(a.fecha>b.fecha?1:-1));
  pintarNiveles();
};
function pintarNiveles(){
  const cont=document.getElementById('niveles-body'); if(!cont) return;
  if(!CORTES.length){ cont.innerHTML='<div style="padding:24px;text-align:center;color:var(--muted,#777)">Aún no hay cortes de inventario.<br>Sube el reporte de SAIT abajo para guardar el primero.</div>'+bloqueCarga(); return; }
  const hoy=CORTES[CORTES.length-1];
  const esTotal=scope==='total';
  const dato = esTotal ? hoy.total : (hoy.sucs&&hoy.sucs[scope]) ? hoy.sucs[scope] : {valor:0,piezas:0,claves:0};
  // selector
  let h='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">';
  h+='<button onclick="nivSetScope(\'total\')" style="padding:6px 12px;border-radius:99px;border:1px solid '+(esTotal?'#0369a1':'#ddd')+';background:'+(esTotal?'#0369a1':'#fff')+';color:'+(esTotal?'#fff':'#555')+';font-size:12px;cursor:pointer">Toda la empresa</button>';
  ORDEN.forEach(s=>{ if(!hoy.sucs||!hoy.sucs[s]) return; const act=scope===s; h+='<button onclick="nivSetScope(\''+s+'\')" style="padding:6px 12px;border-radius:99px;border:1px solid '+(act?'#0369a1':'#ddd')+';background:'+(act?'#0369a1':'#fff')+';color:'+(act?'#fff':'#555')+';font-size:12px;cursor:pointer">'+s+'-'+esc(hoy.sucs[s].nombre||NOM[s]||s)+'</button>'; });
  h+='</div>';
  // 3 cifras de hoy
  h+='<div style="font-size:12px;color:#777;margin-bottom:6px">'+(esTotal?'Toda la empresa':esc((hoy.sucs[scope].nombre||NOM[scope]))+' (suc '+scope+')')+' · corte '+esc(hoy.fecha)+'</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:16px">';
  h+='<div style="background:#f0fdf4;border-radius:12px;padding:12px"><div style="font-size:12px;color:#555">Valor a costo</div><div style="font-size:22px;font-weight:700;color:#16a34a">'+money(dato.valor)+'</div></div>';
  h+='<div style="background:#eff6ff;border-radius:12px;padding:12px"><div style="font-size:12px;color:#555">Piezas</div><div style="font-size:22px;font-weight:700;color:#2563eb">'+num(dato.piezas)+'</div></div>';
  h+='<div style="background:#faf5ff;border-radius:12px;padding:12px"><div style="font-size:12px;color:#555">Claves con existencia</div><div style="font-size:22px;font-weight:700;color:#7c3aed">'+num(dato.claves)+'</div></div>';
  h+='</div>';
  // tendencia SVG (valor del scope a lo largo de los cortes)
  h+='<div style="font-size:13px;font-weight:600;color:#333;margin-bottom:6px">Tendencia del valor</div>';
  h+=svgTendencia(scope);
  // tabla "dónde está el dinero" (solo en vista empresa)
  if(esTotal){
    h+='<div style="font-size:13px;font-weight:600;color:#333;margin:16px 0 8px">Dónde está parado el dinero (hoy)</div>';
    h+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr style="color:#777;font-size:11px">'+
       '<th style="text-align:left;padding:6px">Sucursal</th><th style="text-align:right;padding:6px">Valor</th><th style="text-align:right;padding:6px">Piezas</th><th style="text-align:right;padding:6px">% del total</th></tr></thead><tbody>';
    const arr=ORDEN.filter(s=>hoy.sucs&&hoy.sucs[s]).map(s=>({s, ...hoy.sucs[s]})).sort((a,b)=>b.valor-a.valor);
    arr.forEach(x=>{ const pct=hoy.total.valor?Math.round(x.valor/hoy.total.valor*100):0;
      h+='<tr><td style="padding:6px;border-top:1px solid #f2f2f2">'+x.s+'-'+esc(x.nombre||NOM[x.s]||x.s)+'</td>'+
         '<td style="text-align:right;padding:6px;border-top:1px solid #f2f2f2;font-weight:600">'+moneyFull(x.valor)+'</td>'+
         '<td style="text-align:right;padding:6px;border-top:1px solid #f2f2f2">'+num(x.piezas)+'</td>'+
         '<td style="text-align:right;padding:6px;border-top:1px solid #f2f2f2;color:#0369a1">'+pct+'%</td></tr>';
    });
    h+='<tr style="border-top:2px solid #ddd;font-weight:700"><td style="padding:6px">TOTAL</td><td style="text-align:right;padding:6px">'+moneyFull(hoy.total.valor)+'</td><td style="text-align:right;padding:6px">'+num(hoy.total.piezas)+'</td><td style="text-align:right;padding:6px">100%</td></tr>';
    h+='</tbody></table></div>';
  }
  h+=bloqueCarga();
  cont.innerHTML=h;
}
window.nivSetScope=function(s){ scope=s; pintarNiveles(); };

function svgTendencia(sc){
  const pts=CORTES.map(c=> sc==='total'?(c.total?c.total.valor:0):((c.sucs&&c.sucs[sc])?c.sucs[sc].valor:0));
  if(pts.length<2) return '<div style="font-size:12px;color:#999;padding:10px 0">Con un solo corte aún no hay tendencia; aparece cuando haya al menos dos días.</div>';
  const W=320,H=90,pad=4;
  const mn=Math.min(...pts), mx=Math.max(...pts), rng=(mx-mn)||1;
  const X=i=>pad+i*((W-2*pad)/(pts.length-1));
  const Y=v=>H-pad-((v-mn)/rng)*(H-2*pad);
  let d=''; pts.forEach((v,i)=>{ d+=(i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1)+' '; });
  const ultimo=pts[pts.length-1], primero=pts[0], delta=ultimo-primero;
  let s='<svg viewBox="0 0 '+W+' '+(H+18)+'" style="width:100%;max-width:420px;height:auto">';
  s+='<path d="'+d+'" fill="none" stroke="#0369a1" stroke-width="2"/>';
  pts.forEach((v,i)=>{ s+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="2.5" fill="#0369a1"/>'; });
  s+='<text x="'+pad+'" y="'+(H+14)+'" font-size="9" fill="#999">'+esc(CORTES[0].fecha)+'</text>';
  s+='<text x="'+(W-pad)+'" y="'+(H+14)+'" font-size="9" fill="#999" text-anchor="end">'+esc(CORTES[CORTES.length-1].fecha)+'</text>';
  s+='</svg>';
  s+='<div style="font-size:12px;color:'+(delta>=0?'#16a34a':'#dc2626')+';margin-top:2px">'+(delta>=0?'▲ ':'▼ ')+money(Math.abs(delta))+' vs primer corte · '+pts.length+' cortes</div>';
  return s;
}

/* ---------- carga del reporte SAIT (calcula y guarda el corte) ---------- */
function bloqueCarga(){
  return '<div style="margin-top:20px;border-top:1px solid #eee;padding-top:14px">'+
    '<div style="font-size:12px;font-weight:600;color:#555;margin-bottom:6px">Actualizar corte (subir reporte de SAIT)</div>'+
    '<div style="font-size:11.5px;color:#999;margin-bottom:8px">existencias_con_costos — XLSX (recomendado) o CSV</div>'+
    '<label style="display:block;border:2px dashed #cbd5e1;border-radius:10px;padding:16px;text-align:center;cursor:pointer;background:#f8fafc">'+
    '<span style="font-weight:600;font-size:13px">Seleccionar archivo de SAIT</span>'+
    '<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="nivProcesar(this.files)"></label>'+
    '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#555;margin-top:8px">Fecha del corte: <input type="date" id="niv-fecha" value="'+hoyISO()+'" style="padding:5px;border:1px solid #ccc;border-radius:6px"></label>'+
    '<div id="niv-status" style="font-size:12.5px;margin-top:8px;min-height:16px;color:#16a34a"></div></div>';
}
function hoyISO(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

window.nivProcesar=async function(files){
  const st=document.getElementById('niv-status'); if(!files||!files.length) return;
  const file=files[0]; const fecha=(document.getElementById('niv-fecha')||{}).value||hoyISO();
  st.style.color='#555'; st.textContent='Leyendo archivo…';
  try{
    let rows=[];
    const XLSX=window.XLSX;
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    if(ext==='csv'){
      const txt=await leerTexto(file);
      rows=txt.split(/\r?\n/).filter(l=>l.length).map(parseCSVline);
    } else if(XLSX){
      const buf=await file.arrayBuffer(); const wb=XLSX.read(buf,{type:'array'});
      rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});
    } else { st.style.color='#dc2626'; st.textContent='No pude leer el XLSX; sube el CSV.'; return; }
    if(!rows.length){ st.style.color='#dc2626'; st.textContent='Archivo vacío.'; return; }
    // saltar encabezado si lo trae
    let start=0; const h0=String(rows[0][0]||'').toLowerCase().trim();
    if(h0==='clave'||h0.indexOf('clave')>=0) start=1;
    st.textContent='Calculando ('+(rows.length-start)+' filas)…';
    const sucs={}; let tV=0,tP=0; const clTot=new Set();
    const clSuc={};
    for(let r=start;r<rows.length;r++){
      const row=rows[r]; if(!row) continue;
      const s=String(row[11]==null?'':row[11]).trim();
      if(!/^([1-9]|1[0-2])$/.test(s)) continue; // solo 1-12
      const clave=String(row[0]==null?'':row[0]).trim();
      const ex=parseFloat(row[4])||0; const co=parseFloat(row[5])||0;
      if(ex<=0 && co<=0) { /*nada*/ }
      const val=ex*co;
      if(!sucs[s]) sucs[s]={nombre:NOM[s]||s,valor:0,piezas:0,claves:0};
      sucs[s].valor+=val; sucs[s].piezas+=ex;
      if(ex>0){ if(!clSuc[s]) clSuc[s]=new Set(); clSuc[s].add(clave); clTot.add(clave); }
      tV+=val; tP+=ex;
    }
    Object.keys(sucs).forEach(s=>{ sucs[s].valor=Math.round(sucs[s].valor*100)/100; sucs[s].piezas=Math.round(sucs[s].piezas); sucs[s].claves=clSuc[s]?clSuc[s].size:0; });
    const total={valor:Math.round(tV*100)/100, piezas:Math.round(tP), claves:clTot.size};
    if(!Object.keys(sucs).length){ st.style.color='#dc2626'; st.textContent='No detecté filas de sucursales 1-12. ¿El archivo es el de existencias por sucursal?'; return; }
    st.textContent='Guardando corte '+fecha+'…';
    await setDoc(doc(db,'nivelesInv',fecha), { fecha, ts:Date.now(), fuente:'SAIT existencias_con_costos', total, sucs });
    st.style.color='#16a34a'; st.textContent='✓ Corte guardado: '+money(total.valor)+' · '+num(total.piezas)+' pz · '+total.claves+' claves.';
    renderNiveles();
  }catch(e){ st.style.color='#dc2626'; st.textContent='Error: '+e.message; }
};
function leerTexto(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result)); r.onerror=()=>rej(new Error('read')); r.readAsText(file,'latin1'); }); }
function parseCSVline(line){
  // parser tolerante: respeta comillas pero no se rompe con comillas sueltas internas
  const out=[]; let cur='', q=false;
  for(let i=0;i<line.length;i++){ const c=line[i];
    if(c==='"'){ if(q && line[i+1]===','){ q=false; } else if(!q && (i===0||line[i-1]===',')){ q=true; } else { cur+=c; } }
    else if(c===',' && !q){ out.push(cur); cur=''; }
    else cur+=c;
  }
  out.push(cur); return out;
}

/* ---------- pantalla + nav ---------- */
const SCREEN_HTML = `
<div id="s-niveles" class="screen">
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-home');window.renderHome&&window.renderHome()">←</button>
    <h2>📊 Niveles de inventario</h2>
  </div>
  <p style="font-size:13px;color:var(--muted,#777);margin-bottom:12px">Valor, piezas y claves por sucursal, con tendencia diaria. Se actualiza subiendo el reporte de SAIT.</p>
  <div id="niveles-body"></div>
</div>`;

window.nivOpen = function(){ show('s-niveles'); renderNiveles(); };

function initUI(intentos){
  intentos=intentos||0;
  const home=document.getElementById('s-home');
  if(!home){ if(intentos<40) setTimeout(()=>initUI(intentos+1),300); return; }
  if(!document.getElementById('s-niveles')){
    const tmp=document.createElement('div'); tmp.innerHTML=SCREEN_HTML;
    const parent=home.parentNode; while(tmp.firstChild) parent.appendChild(tmp.firstChild);
  }
  if(!document.getElementById('niv-navbtn')){
    let ref=document.getElementById('rz-navbtn')||document.getElementById('invt-navbtn')||document.getElementById('gar-navbtn')||document.getElementById('inv-navbtn');
    const nb=document.createElement('button');
    nb.id='niv-navbtn'; nb.className=ref?ref.className:'btn btn-sm btn-s';
    nb.textContent='📊 Niveles';
    nb.setAttribute('onclick',"(window.__gate?window.__gate:function(f){f()})(function(){nivOpen()})");
    if(ref && ref.parentNode) ref.parentNode.insertBefore(nb, ref.nextSibling);
    else home.insertBefore(nb, home.firstChild);
  }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initUI());
else initUI();
