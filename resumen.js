/* ===== Resumen (dashboard) — módulo autónomo, solo lectura =====
   <script type="module" src="./resumen.js?v=1"></script>
   Pantalla "📊 Resumen" con totales y desglose por mes. Protegida con clave admin. */
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const _apps = getApps();
const _app = _apps.length ? _apps[0] : initializeApp({ apiKey:'AIzaSyCpFCqO25oDdBne1mOiJarY-ZEBBX0jOVk', authDomain:'bellissima-entradas.firebaseapp.com', projectId:'bellissima-entradas' });
const db = getFirestore(_app);

const MESES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function mesKey(ts, iso){
  if(iso && /^\d{4}-\d{2}/.test(iso)) return iso.slice(0,7);
  if(ts){ const d=new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  return '?';
}
function mesLabel(k){ if(k==='?') return 'Sin fecha'; const p=k.split('-'); return MESES[parseInt(p[1])-1]+' '+p[0]; }
function money(n){ n=Math.round(n||0); if(Math.abs(n)>=1e6) return '$'+(n/1e6).toFixed(2)+'M'; if(Math.abs(n)>=1e3) return '$'+Math.round(n/1e3)+'K'; return '$'+n; }
function moneyFull(n){ return '$'+Math.round(n||0).toLocaleString('es-MX'); }

async function getAll(c){ const s=await getDocs(collection(db,c)); return s.docs.map(d=>({_id:d.id,...d.data()})); }

window.renderResumen = async function(){
  const cont=document.getElementById('resumen-body'); if(!cont) return;
  cont.innerHTML='<p style="color:var(--muted,#777);padding:20px;text-align:center">Calculando resumen…</p>';
  try{
    const [ordenes,pagos,traspasos,recep,recibos,inv,gar]=await Promise.all([
      getAll('ordenesCompra'),getAll('pagos'),getAll('traspasos'),getAll('recepciones'),getAll('recibosProveedor'),getAll('inventarioHist'),getAll('garantias')
    ]);

    // ---- por mes ----
    const M={}; // key -> {compras,fact,pagos,surt,recep}
    const ins=(k)=>{ if(!M[k]) M[k]={compras:0,fact:0,pagos:0,surt:0,recep:0}; return M[k]; };
    let totalCompras=0, provCompra={};
    ordenes.forEach(o=>{
      (o.compras||[]).forEach(c=>{
        const k=mesKey(o.ts, c.fechaCompra); const m=ins(k);
        const imp=c.importeCompra||0; m.compras+=imp; m.fact+=1; totalCompras+=imp;
        provCompra[o.proveedor||'?']=(provCompra[o.proveedor||'?']||0)+imp;
      });
    });
    let totalPagos=0;
    pagos.forEach(p=>{ const k=mesKey(p.ts,p.fecha); const val=(p.monto||p.importe||p.total||0); ins(k).pagos+=val; totalPagos+=val; });
    traspasos.forEach(t=>{ ins(mesKey(t.ts)).surt+=1; });
    recep.forEach(r=>{ ins(mesKey(r.ts)).recep+=1; });

    const keys=Object.keys(M).filter(k=>k!=='?').sort();

    // ---- operación ----
    let cedisConFalt=0; recibos.forEach(r=>{ let pz=0; (r.items||[]).forEach(i=>{ if(i.faltante>0) pz+=i.faltante; }); if(pz>0) cedisConFalt++; });
    const cedisPct = recibos.length? Math.round((recibos.length-cedisConFalt)/recibos.length*100):0;
    let faltan=0, sobran=0;
    recep.forEach(r=>{ (r.items||[]).forEach(i=>{ if(i.resuelto) return; faltan+=Math.max(0,(i.esperado||0)-(i.recibido||0)); sobran+=Math.max(0,(i.recibido||0)-(i.esperado||0)); }); });
    const topProv=Object.entries(provCompra).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const invO=inv.map(x=>({fecha:x.fecha,total:x.total||0})).sort((a,b)=>a.fecha>b.fecha?1:-1);
    const invLast=invO.length?invO[invO.length-1].total:0;
    const status={}; ordenes.forEach(o=>{ status[o.status||'?']=(status[o.status||'?']||0)+1; });
    // garantías/mermas
    let gCount={garantia:0,inventario:0,merma:0}; gar.forEach(x=>{ gCount[x.tipo]=(gCount[x.tipo]||0)+1; });

    // ---- render ----
    let h='';
    // KPIs
    h+='<div class="rz-grid">';
    h+=kpi('Compras', money(totalCompras), ordenes.reduce((a,o)=>a+((o.compras||[]).length),0)+' facturas');
    h+=kpi('Pagos', money(totalPagos), pagos.length+' pagos');
    h+=kpi('Por pagar (aprox.)', money(totalCompras-totalPagos), 'compras − pagos');
    h+=kpi('Surtido', traspasos.length.toLocaleString('es-MX'), recep.length.toLocaleString('es-MX')+' recepciones');
    h+=kpi('Inventario', money(invLast), '≈ a costo');
    h+=kpi('Recepción CEDIS', cedisPct+'%', recibos.length+' revisadas', '#16a34a');
    h+='</div>';

    // tabla por mes
    h+='<div class="rz-h">Por mes</div>';
    h+='<div style="overflow-x:auto"><table class="rz-table"><thead><tr>'+
       '<th>Mes</th><th>Compras</th><th>Fact.</th><th>Pagos</th><th>Surtidos</th><th>Recep.</th></tr></thead><tbody>';
    keys.forEach(k=>{ const m=M[k];
      h+='<tr><td style="font-weight:600">'+mesLabel(k)+'</td>'+
         '<td>'+money(m.compras)+'</td><td>'+m.fact+'</td>'+
         '<td>'+money(m.pagos)+'</td><td>'+m.surt+'</td><td>'+m.recep+'</td></tr>';
    });
    // fila total
    const tC=keys.reduce((a,k)=>a+M[k].compras,0), tF=keys.reduce((a,k)=>a+M[k].fact,0), tP=keys.reduce((a,k)=>a+M[k].pagos,0), tS=keys.reduce((a,k)=>a+M[k].surt,0), tR=keys.reduce((a,k)=>a+M[k].recep,0);
    h+='<tr style="border-top:2px solid #ddd;font-weight:700"><td>Total</td><td>'+money(tC)+'</td><td>'+tF+'</td><td>'+money(tP)+'</td><td>'+tS+'</td><td>'+tR+'</td></tr>';
    h+='</tbody></table></div>';

    // top proveedores
    h+='<div class="rz-h">Top proveedores (compras)</div>';
    const maxP=topProv.length?topProv[0][1]:1;
    topProv.forEach(([p,v])=>{
      const pct=Math.round(v/maxP*100);
      h+='<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12.5px"><span style="font-weight:500">'+esc(p)+'</span><span style="color:#555">'+moneyFull(v)+'</span></div>'+
         '<div style="background:#eee;border-radius:99px;height:7px;margin-top:2px"><div style="background:#2a78d6;height:7px;border-radius:99px;width:'+pct+'%"></div></div></div>';
    });

    // operación / pendientes
    h+='<div class="rz-h">Operación</div>';
    h+='<div class="rz-grid">';
    h+=kpi('Difs. en sucursales', faltan.toLocaleString('es-MX'), sobran+' pz sobran', faltan>0?'#dc2626':'#16a34a', 'pz faltan pendientes');
    h+=kpi('Órdenes', (status.surtido||0)+' surtidas', (status.transito||0)+' en tránsito · '+(status.revisado||0)+' x revisar');
    if((gCount.garantia+gCount.inventario+gCount.merma)>0)
      h+=kpi('Garantías/Mermas', (gCount.garantia+gCount.merma)+'', gCount.garantia+' garantías · '+gCount.merma+' mermas · '+gCount.inventario+' inv.');
    h+='</div>';

    h+='<p style="font-size:11.5px;color:var(--muted,#999);margin-top:14px;line-height:1.5">Estos números son lo que registra la app (compras, pagos, surtido, inventario). <b>No incluyen ventas</b> (SAIT). El inventario son los cortes guardados en la app.</p>';

    cont.innerHTML=h;
  }catch(e){ cont.innerHTML='<p style="color:#dc2626;padding:20px">Error al calcular: '+esc(e.message)+'</p>'; }
};

function kpi(label,val,sub,color,subFull){
  return '<div class="rz-kpi"><div class="rz-kpi-l">'+label+'</div>'+
    '<div class="rz-kpi-v"'+(color?' style="color:'+color+'"':'')+'>'+val+'</div>'+
    '<div class="rz-kpi-s">'+(sub||'')+'</div></div>';
}

const CSS = `
#s-resumen .rz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:6px}
#s-resumen .rz-kpi{background:#fafafa;border:1px solid #eee;border-radius:12px;padding:12px 14px}
#s-resumen .rz-kpi-l{font-size:12px;color:#777}
#s-resumen .rz-kpi-v{font-size:22px;font-weight:600;line-height:1.15;margin-top:2px}
#s-resumen .rz-kpi-s{font-size:11px;color:#999;margin-top:2px}
#s-resumen .rz-h{font-size:14px;font-weight:600;margin:18px 0 10px;color:#333}
#s-resumen .rz-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:360px}
#s-resumen .rz-table th{text-align:right;padding:7px 8px;color:#777;font-weight:600;border-bottom:1px solid #eee;font-size:11.5px}
#s-resumen .rz-table th:first-child{text-align:left}
#s-resumen .rz-table td{text-align:right;padding:7px 8px;border-bottom:1px solid #f4f4f4}
#s-resumen .rz-table td:first-child{text-align:left}
`;

const SCREEN_HTML = `
<div id="s-resumen" class="screen">
  <style>${CSS}</style>
  <div class="topbar">
    <button class="btn-ico" onclick="show('s-home');window.renderHome&&window.renderHome()">←</button>
    <h2>📊 Resumen</h2>
  </div>
  <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button class="btn btn-sm" onclick="renderResumen()" style="font-size:12px">↻ Actualizar</button>
  </div>
  <div id="resumen-body"></div>
</div>`;

function initUI(intentos){
  intentos=intentos||0;
  const home=document.getElementById('s-home');
  if(!home){ if(intentos<40) setTimeout(()=>initUI(intentos+1),300); return; }
  if(!document.getElementById('s-resumen')){
    const tmp=document.createElement('div'); tmp.innerHTML=SCREEN_HTML;
    const parent=home.parentNode; while(tmp.firstChild) parent.appendChild(tmp.firstChild);
  }
  if(!document.getElementById('rz-navbtn')){
    let ref=document.getElementById('gar-navbtn')||document.getElementById('cajas-navbtn')||document.getElementById('inv-navbtn')||document.getElementById('pre-navbtn')||document.getElementById('pv-navbtn');
    const nb=document.createElement('button');
    nb.id='rz-navbtn'; nb.className=ref?ref.className:'btn btn-sm btn-s';
    nb.textContent='📊 Resumen';
    nb.setAttribute('onclick',"(window.__gate?window.__gate:function(f){f()})(function(){show('s-resumen');renderResumen()})");
    if(ref && ref.parentNode) ref.parentNode.insertBefore(nb, ref.nextSibling);
    else home.insertBefore(nb, home.firstChild);
  }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>initUI());
else initUI();
