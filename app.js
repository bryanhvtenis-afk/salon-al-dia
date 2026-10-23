/* ===== Núcleo: datos, guardado, FIFO, utilidades ===== */
'use strict';
const VERSION = '1.1 · 14/10/2026';
const LARGOS = [['corto','Corto'],['medio','Medio'],['largo','Largo'],['extra','Extra largo']];
const TIPOS = {servicio:'Uso en servicios', venta:'Para vender', ambos:'Servicios y venta', desechable:'Desechable'};
const CAT_GASTO = ['Arriendo','Luz','Agua','Internet y teléfono','Ayudantes','Mantenimiento','Publicidad','Impuestos y SRI','Transporte','Otros'];
const CAT_SERV = ['Corte','Color','Tratamiento','Barbería','Peinado','Otro'];
const PAGOS = ['Efectivo','Transferencia','Tarjeta'];

let S = null;            // estado completo
const FOTOS = {};        // id -> dataURL (cache)
let ROL = 'duena';       // 'duena' | 'ayudante'

function estadoVacio(){
  return {v:1, demo:false, seq:1,
    negocio:{nombre:'Mi Salón', ruc:'', regimen:'', ivaCosto:true, largos:{corto:.7,medio:1,largo:1.5,extra:2}, semanasProveedor:1},
    pins:{duena:null, ayudante:null},
    productos:[], lotes:[], movs:[], recetas:[], ventas:[], gastos:[], compras:[], mapeo:{}, bitacora:[]};
}
const uid = p => p + (S.seq++).toString(36) + Date.now().toString(36).slice(-3);
const hoyISO = () => { const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); };
const ahoraISO = () => { const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,16); };
const $ = n => '$' + (Math.round((+n||0)*100)/100).toFixed(2);
const r2 = n => Math.round((+n||0)*100)/100;
const r3 = n => Math.round((+n||0)*1000)/1000;
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fechaTxt = iso => { if(!iso) return ''; const [y,m,d]=iso.slice(0,10).split('-'); return `${d}/${m}/${y}`; };
const mesTxt = ym => { const M=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']; const [y,m]=ym.split('-'); return M[+m-1]+' '+y; };
const iniciales = s => String(s||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const sinTildes = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

/* ---------- Guardado (IndexedDB con respaldo en memoria) ---------- */
const IDB = {
  db:null,
  abrir(){ return new Promise(res=>{ try{ const rq=indexedDB.open('salon-al-dia',1);
      rq.onupgradeneeded=()=>{ const d=rq.result; d.createObjectStore('kv'); d.createObjectStore('fotos'); };
      rq.onsuccess=()=>{ this.db=rq.result; res(true); }; rq.onerror=()=>res(false);
    }catch(e){ res(false); } }); },
  get(store,k){ return new Promise(res=>{ if(!this.db) return res(null); try{ const rq=this.db.transaction(store).objectStore(store).get(k); rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>res(null);}catch(e){res(null);} }); },
  put(store,k,v){ return new Promise(res=>{ if(!this.db) return res(false); try{ const tx=this.db.transaction(store,'readwrite'); tx.objectStore(store).put(v,k); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false);}catch(e){res(false);} }); },
  del(store,k){ return new Promise(res=>{ if(!this.db) return res(false); try{ const tx=this.db.transaction(store,'readwrite'); tx.objectStore(store).delete(k); tx.oncomplete=()=>res(true);}catch(e){res(false);} }); },
  todas(store){ return new Promise(res=>{ if(!this.db) return res({}); try{ const out={}; const rq=this.db.transaction(store).objectStore(store).openCursor();
      rq.onsuccess=()=>{ const c=rq.result; if(c){ out[c.key]=c.value; c.continue(); } else res(out); }; rq.onerror=()=>res(out);}catch(e){res({});} }); }
};
let _tGuardar=null;
function guardarYa(){ clearTimeout(_tGuardar); _tGuardar=null; return IDB.put('kv','estado',JSON.stringify(S)); }
function guardar(){ clearTimeout(_tGuardar); _tGuardar=setTimeout(guardarYa, 120); }
addEventListener('pagehide', ()=>{ if(_tGuardar) guardarYa(); });
document.addEventListener('visibilitychange', ()=>{ if(document.hidden && _tGuardar) guardarYa(); });
async function guardarFoto(dataUrl){ const id='f'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); FOTOS[id]=dataUrl; await IDB.put('fotos',id,dataUrl); return id; }
function fotoHTML(id, alt, ini){ return id && FOTOS[id] ? `<img src="${FOTOS[id]}" alt="${esc(alt||'')}">` : esc(ini||iniciales(alt)); }

/* Comprimir foto de cámara (máx 900 px, JPEG) */
function comprimirImagen(file, max=900, q=.78){
  return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onerror=rej;
    fr.onload=()=>{ const img=new Image(); img.onerror=()=>rej('No pude leer la imagen');
      img.onload=()=>{ const k=Math.min(1,max/Math.max(img.width,img.height)); const c=document.createElement('canvas');
        c.width=Math.round(img.width*k); c.height=Math.round(img.height*k); c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        res(c.toDataURL('image/jpeg',q)); };
      img.src=fr.result; };
    fr.readAsDataURL(file); });
}

/* ---------- Productos y unidades ---------- */
const prod = id => S.productos.find(p=>p.id===id);
function stockDe(pid){ let q=0; for(const l of S.lotes) if(l.pid===pid) q+=l.restante; const p=prod(pid); return r3(q-(p&&p.deficit||0)); }
function lotesVivos(pid){ return S.lotes.filter(l=>l.pid===pid && l.restante>1e-9).sort((a,b)=> (a.fecha<b.fecha?-1:a.fecha>b.fecha?1:(a.orden||0)-(b.orden||0))); }
function ultimoCosto(pid){ const ls=S.lotes.filter(l=>l.pid===pid).sort((a,b)=>a.fecha<b.fecha?1:-1); return ls.length? ls[0].costoU : 0; }
function costoActual(pid){ const v=lotesVivos(pid); return v.length? v[0].costoU : ultimoCosto(pid); }
function uTxt(p){ return p.unidad==='u' ? 'u' : p.unidad; }
function fmtCant(p, q){ q=r3(q); if(!p) return q; if(p.unidad==='u') return `${+q.toFixed(2)} u`; return `${+q.toFixed(1)} ${p.unidad}`; }
function fmtStock(p, q){
  if(q==null) q=stockDe(p.id);
  if(q<0) return `Faltan ${fmtCant(p,-q)}`;
  if(p.contenido>1 && p.unidad!=='u'){ const e=Math.floor(q/p.contenido+1e-9), r=r3(q-e*p.contenido);
    const env=p.envase||'envase'; const envs = e===1? env : (/[aeiou]$/i.test(env)? env+'s' : env+'es');
    return e>0 ? `${e} ${envs}${r>0? ' + '+fmtCant(p,r):''}` : fmtCant(p,r); }
  return fmtCant(p,q);
}
function estadoStock(p){ const q=stockDe(p.id); if(q<=0) return ['Agotado','p-bad']; if(p.stockMin && q<=p.stockMin) return ['Bajo','p-warn']; return ['Bien','p-ok']; }
function porVencer(p, dias=45){ const lim=new Date(Date.now()+dias*864e5).toISOString().slice(0,10); return lotesVivos(p.id).find(l=>l.vence && l.vence<=lim); }

/* Unidad y contenido a partir de la descripción de la factura: "TINTE 7.1 60G", "OXIDANTE 20VOL 1000 ML", "SHAMPOO 1 LT" */
function adivinarUnidad(desc){
  const m = String(desc||'').toUpperCase().match(/(\d+(?:[.,]\d+)?)\s*(ML|CC|LTS?|L|GRS?|G|KG|OZ)\b/);
  if(!m) return {unidad:'u', contenido:1, envase:'unidad'};
  let n=parseFloat(m[1].replace(',','.')), u=m[2];
  if(/^L/.test(u)) return {unidad:'ml', contenido:n*1000, envase:'frasco'};
  if(u==='ML'||u==='CC') return {unidad:'ml', contenido:n, envase: n<=100?'tubo':'frasco'};
  if(u==='KG') return {unidad:'g', contenido:n*1000, envase:'funda'};
  if(u==='OZ') return {unidad:'ml', contenido:Math.round(n*29.57), envase:'frasco'};
  return {unidad:'g', contenido:n, envase: n<=100?'tubo':'frasco'};
}

/* ---------- FIFO ---------- */
/* Agrega un lote. cantidad y costoTotal en unidades base (g/ml/u). */
function agregarLote(pid, cantidad, costoTotal, extra={}){
  const p=prod(pid); if(!p||cantidad<=0) return null;
  const l={id:uid('L'), pid, fecha:extra.fecha||hoyISO(), orden:Date.now()+Math.random(), cantidad:r3(cantidad), restante:r3(cantidad),
    costoU: cantidad>0 ? costoTotal/cantidad : 0, prov:extra.prov||'', compraId:extra.compraId||null, promo:!!extra.promo, regalo:extra.regalo||0, vence:extra.vence||'', nota:extra.nota||''};
  // si había faltante (se usó más de lo que había), este lote lo cubre primero
  if(p.deficit>0){ const t=Math.min(p.deficit,l.restante); l.restante=r3(l.restante-t); p.deficit=r3(p.deficit-t); l.cubrioDeficit=t; }
  S.lotes.push(l);
  S.movs.push({id:uid('M'), fecha:l.fecha, pid, tipo:extra.tipo||'compra', q:l.cantidad, costo:r2(costoTotal), ref:extra.compraId||'', nota:extra.nota||''});
  return l;
}
/* Consume q unidades del lote más antiguo primero. Devuelve el detalle para poder deshacer. */
function consumir(pid, q, tipo, ref, nota){
  const p=prod(pid); if(!p||q<=0) return {pid, partes:[], def:0, costo:0};
  let falta=q, costo=0; const partes=[];
  for(const l of lotesVivos(pid)){ if(falta<=1e-9) break; const t=Math.min(l.restante,falta);
    l.restante=r3(l.restante-t); falta=r3(falta-t); costo+=t*l.costoU; partes.push({lid:l.id,q:t}); }
  let def=0; if(falta>1e-9){ def=falta; p.deficit=r3((p.deficit||0)+falta); costo+=falta*ultimoCosto(pid); }
  const c={pid, partes, def, costo:r3(costo)};
  S.movs.push({id:uid('M'), fecha:hoyISO(), pid, tipo, q:-r3(q), costo:-r2(costo), ref:ref||'', nota:nota||''});
  return c;
}
function devolver(c, ref){ // deshace un consumo
  const p=prod(c.pid); if(!p) return;
  for(const pt of c.partes){ const l=S.lotes.find(x=>x.id===pt.lid); if(l) l.restante=r3(l.restante+pt.q); }
  if(c.def) p.deficit=r3(Math.max(0,(p.deficit||0)-c.def));
  S.movs.push({id:uid('M'), fecha:hoyISO(), pid:c.pid, tipo:'anulación', q:r3(c.partes.reduce((a,b)=>a+b.q,0)+c.def), costo:r2(c.costo), ref:ref||''});
}
/* Simula el costo FIFO sin tocar el inventario (para recetas) */
function costoSimulado(pid, q){
  let falta=q, costo=0; for(const l of lotesVivos(pid)){ if(falta<=0) break; const t=Math.min(l.restante,falta); costo+=t*l.costoU; falta-=t; }
  if(falta>0) costo+=falta*ultimoCosto(pid); return costo;
}

/* ---------- Recetas ---------- */
const receta = id => S.recetas.find(r=>r.id===id);
function factorLargo(r, largo){ return r.porLargo ? (S.negocio.largos[largo]||1) : 1; }
function usosReceta(r, largo){ const f=factorLargo(r,largo); return r.items.filter(i=>prod(i.pid)).map(i=>({pid:i.pid, q:r3(i.q*(i.fijo?1:f))})); }
function precioReceta(r, largo){ return r.porLargo && r.precios && r.precios[largo]!=null ? +r.precios[largo] : +r.precio||0; }
function costoReceta(r, largo){ return usosReceta(r,largo).reduce((a,u)=>a+costoSimulado(u.pid,u.q),0); }
/* Uso real promedio por ingrediente (últimos registros donde se ajustó) llevado a tamaño "medio" */
function usoReal(r){
  const acc={}; const vs=S.ventas.filter(v=>!v.anulada).slice(-200);
  for(const v of vs) for(const it of v.items) if(it.k==='s' && it.rid===r.id && it.ajustado){
    const f=factorLargo(r,it.largo); for(const u of it.usos){ const i=r.items.find(x=>x.pid===u.pid); if(!i) continue; const base=i.fijo?u.q:u.q/f; (acc[u.pid]=acc[u.pid]||[]).push(base); } }
  const out={}; for(const k in acc){ const a=acc[k]; if(a.length>=3) out[k]={n:a.length, prom:r3(a.reduce((x,y)=>x+y,0)/a.length)}; } return out;
}

/* ---------- Clave de acceso SRI (49 dígitos) ---------- */
function dvMod11(s48){ let suma=0, k=2; for(let i=s48.length-1;i>=0;i--){ suma+=(+s48[i])*k; k=k===7?2:k+1; } let dv=11-(suma%11); if(dv===11) dv=0; if(dv===10) dv=1; return dv; }
function leerClave(txt){
  const c=String(txt||'').replace(/\D/g,''); if(c.length!==49) return {ok:false, error:'La clave de acceso debe tener 49 números (tiene '+c.length+').'};
  if(dvMod11(c.slice(0,48))!==+c[48]) return {ok:false, error:'La clave no es válida: revisa que no falte o sobre un número.'};
  const TIPO={'01':'Factura','03':'Liquidación de compra','04':'Nota de crédito','05':'Nota de débito','06':'Guía de remisión','07':'Retención'};
  return {ok:true, clave:c, fecha:`${c.slice(4,8)}-${c.slice(2,4)}-${c.slice(0,2)}`, tipo:TIPO[c.slice(8,10)]||('Tipo '+c.slice(8,10)), ruc:c.slice(10,23),
    ambiente: c[23]==='2'?'Producción':'Pruebas', numero:`${c.slice(24,27)}-${c.slice(27,30)}-${c.slice(30,39)}`};
}

/* ---------- Factura electrónica XML del SRI ---------- */
function leerFacturaXML(txt){
  const P=new DOMParser(); let doc=P.parseFromString(txt,'text/xml');
  if(doc.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un XML válido.');
  const comp=doc.getElementsByTagName('comprobante')[0];
  if(comp && /<factura/i.test(comp.textContent)) doc=P.parseFromString(comp.textContent.trim(),'text/xml');
  const f=doc.getElementsByTagName('factura')[0];
  if(!f) throw new Error('Este XML no es una factura (puede ser una retención o nota de crédito).');
  const g=(el,t)=>{ if(!el) return ''; const x=el.getElementsByTagName(t)[0]; return x? x.textContent.trim() : ''; };
  const it=f.getElementsByTagName('infoTributaria')[0], inf=f.getElementsByTagName('infoFactura')[0];
  const fe=g(inf,'fechaEmision').split('/'); const fecha = fe.length===3? `${fe[2]}-${fe[1].padStart(2,'0')}-${fe[0].padStart(2,'0')}` : hoyISO();
  const lineas=[...f.getElementsByTagName('detalle')].map(d=>{
    let iva=0; for(const im of d.getElementsByTagName('impuesto')) iva+=parseFloat(g(im,'valor'))||0;
    const cant=parseFloat(g(d,'cantidad'))||0, sub=parseFloat(g(d,'precioTotalSinImpuesto'))||0, desc=parseFloat(g(d,'descuento'))||0, pu=parseFloat(g(d,'precioUnitario'))||0;
    return {codigo:g(d,'codigoPrincipal')||g(d,'codigoInterno'), desc:g(d,'descripcion'), cant, pu, descuento:desc, subtotal:sub, iva:r2(iva)};
  });
  return {clave:g(it,'claveAcceso'), ruc:g(it,'ruc'), prov:g(it,'nombreComercial')||g(it,'razonSocial'), razon:g(it,'razonSocial'),
    numero:`${g(it,'estab')}-${g(it,'ptoEmi')}-${g(it,'secuencial')}`, fecha, total:parseFloat(g(inf,'importeTotal'))||0, lineas};
}

/* ---------- Seguridad: PIN ---------- */
async function hashPIN(pin){
  const t='salon-al-dia|'+pin;
  try{ const b=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
  catch(e){ let h=5381; for(const ch of t) h=((h<<5)+h+ch.charCodeAt(0))|0; return 'd'+(h>>>0).toString(16); }
}
function registrar(accion, detalle){ S.bitacora.push({f:ahoraISO(), rol:ROL, accion, detalle}); }

/* ===== Datos de ejemplo (se borran en Ajustes) ===== */
function diasAtras(n){ const d=new Date(Date.now()-n*864e5); return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); }
function cargarEjemplo(){
  S=estadoVacio(); S.demo=true; S.negocio.nombre='Mi Salón (ejemplo)';
  const P=(o)=>{ const p=Object.assign({id:uid('P'), marca:'', tono:'', tipo:'servicio', unidad:'g', contenido:1, envase:'unidad', stockMin:0, precioVenta:0, deficit:0, foto:null, prov:''},o); S.productos.push(p); return p; };
  const t71=P({nombre:'Tinte 7.1 rubio ceniza', marca:'Marca A', tono:'7.1', unidad:'g', contenido:60, envase:'tubo', stockMin:120, prov:'Distribuidora Belleza'});
  const t60=P({nombre:'Tinte 6.0 rubio oscuro', marca:'Marca A', tono:'6.0', unidad:'g', contenido:60, envase:'tubo', stockMin:120, prov:'Distribuidora Belleza'});
  const ox20=P({nombre:'Oxidante 20 vol', marca:'Marca A', unidad:'ml', contenido:1000, envase:'frasco', stockMin:800, prov:'Distribuidora Belleza'});
  const ox30=P({nombre:'Oxidante 30 vol', marca:'Marca A', unidad:'ml', contenido:1000, envase:'frasco', stockMin:500, prov:'Distribuidora Belleza'});
  const deco=P({nombre:'Decolorante en polvo', marca:'Marca A', unidad:'g', contenido:500, envase:'funda', stockMin:200, prov:'Distribuidora Belleza'});
  const sh=P({nombre:'Shampoo profesional (lavacabezas)', marca:'Marca B', unidad:'ml', contenido:1000, envase:'galón', stockMin:500, prov:'Distribuidora Belleza'});
  const ker=P({nombre:'Keratina alisadora', marca:'Marca C', unidad:'ml', contenido:1000, envase:'frasco', stockMin:200, tipo:'servicio'});
  const trat=P({nombre:'Tratamiento reparador 300 ml', marca:'Marca B', unidad:'ml', contenido:300, envase:'frasco', tipo:'ambos', precioVenta:18, stockMin:300});
  const shv=P({nombre:'Shampoo para casa 400 ml', marca:'Marca B', unidad:'ml', contenido:400, envase:'frasco', tipo:'venta', precioVenta:14, stockMin:800});
  const cera=P({nombre:'Cera para peinar 100 g', marca:'Marca D', unidad:'g', contenido:100, envase:'pote', tipo:'venta', precioVenta:9, stockMin:200});
  const nav=P({nombre:'Navajas desechables', marca:'Marca E', unidad:'u', contenido:100, envase:'caja', tipo:'desechable', stockMin:20});
  const guan=P({nombre:'Guantes de nitrilo', unidad:'u', contenido:100, envase:'caja', tipo:'desechable', stockMin:20});
  const pap=P({nombre:'Papel de cuello', unidad:'u', contenido:100, envase:'rollo', tipo:'desechable', stockMin:30});
  const alu=P({nombre:'Papel aluminio para mechas', unidad:'u', contenido:200, envase:'rollo', tipo:'desechable', stockMin:40});

  // Compras: la primera a precio normal y una promoción más barata después (FIFO usa primero la más antigua)
  const L=(p,env,costoEnv,dias,extra={})=>agregarLote(p.id, env*p.contenido, env*costoEnv, Object.assign({fecha:diasAtras(dias), prov:p.prov||'Proveedor', tipo:'compra'},extra));
  L(t71,3,7.20,40); L(t71,4,5.40,12,{promo:true,nota:'Promoción 25% desc.'});
  L(t60,4,7.20,40); L(ox20,2,9.50,40); L(ox30,1,9.50,40); L(deco,1,16.00,35);
  L(sh,1,22.00,40); L(ker,1,48.00,30,{vence:diasAtras(-30)}); L(trat,6,9.00,30); L(shv,5,7.00,30); L(cera,6,4.20,30);
  L(nav,1,6.00,40); L(guan,1,7.50,40); L(pap,1,4.00,40); L(alu,1,6.00,40);

  const R=(o)=>{ const r=Object.assign({id:uid('R'), categoria:'Corte', precio:0, porLargo:false, precios:null, items:[], foto:null, activo:true},o); S.recetas.push(r); return r; };
  R({nombre:'Corte de dama', categoria:'Corte', precio:8, items:[{pid:sh.id,q:15},{pid:pap.id,q:1,fijo:true}]});
  R({nombre:'Corte de caballero', categoria:'Barbería', precio:5, items:[{pid:pap.id,q:1,fijo:true}]});
  R({nombre:'Corte + barba con navaja', categoria:'Barbería', precio:8, items:[{pid:pap.id,q:1,fijo:true},{pid:nav.id,q:1,fijo:true}]});
  const tinte=R({nombre:'Tinte completo 7.1', categoria:'Color', porLargo:true, precio:30, precios:{corto:25,medio:30,largo:38,extra:45},
    items:[{pid:t71.id,q:60},{pid:ox20.id,q:90},{pid:guan.id,q:2,fijo:true},{pid:sh.id,q:20}]});
  R({nombre:'Retoque de raíz 6.0', categoria:'Color', precio:18, items:[{pid:t60.id,q:30},{pid:ox20.id,q:45},{pid:guan.id,q:2,fijo:true}]});
  R({nombre:'Mechas', categoria:'Color', porLargo:true, precio:45, precios:{corto:35,medio:45,largo:60,extra:75},
    items:[{pid:deco.id,q:40},{pid:ox30.id,q:80},{pid:alu.id,q:30},{pid:guan.id,q:2,fijo:true}]});
  R({nombre:'Keratina', categoria:'Tratamiento', porLargo:true, precio:60, precios:{corto:45,medio:60,largo:80,extra:100}, items:[{pid:ker.id,q:50},{pid:sh.id,q:20}]});

  // Ventas de los últimos días
  const venta=(dias, items, pago)=>{ const fecha=diasAtras(dias)+'T'+String(9+Math.floor(Math.random()*9)).padStart(2,'0')+':15';
    const v={id:uid('V'), fecha, cliente:'', pago:pago||'Efectivo', comp:{tipo:'ninguno',num:''}, items:[], total:0, costo:0, ayudante:null, anulada:false};
    for(const it of items){ if(it.r){ const r=it.r, largo=it.largo||'medio'; const usos=usosReceta(r,largo); const cons=usos.map(u=>consumir(u.pid,u.q,'servicio',v.id,r.nombre));
        const x={k:'s', rid:r.id, nombre:r.nombre, largo:r.porLargo?largo:null, precio:precioReceta(r,largo), usos, cons, costo:r2(cons.reduce((a,c)=>a+c.costo,0)), ajustado:false};
        if(it.real){ x.ajustado=true; } v.items.push(x); }
      else { const p=it.p, q=it.cant*p.contenido; const c=consumir(p.id,q,'venta',v.id,'Venta'); v.items.push({k:'p', pid:p.id, nombre:p.nombre, cant:it.cant, precio:p.precioVenta*it.cant, cons:[c], costo:r2(c.costo)}); } }
    v.total=r2(v.items.reduce((a,b)=>a+b.precio,0)); v.costo=r2(v.items.reduce((a,b)=>a+b.costo,0)); S.ventas.push(v); for(const m of S.movs) if(m.ref===v.id) m.fecha=fecha.slice(0,10); };
  const rc=n=>S.recetas.find(r=>r.nombre===n);
  for(let d=20; d>=0; d--){
    if(d%7===6) continue;
    venta(d,[{r:rc('Corte de dama')}]); venta(d,[{r:rc('Corte de caballero')}],'Transferencia');
    if(d%2===0) venta(d,[{r:rc('Corte + barba con navaja')}]);
    if(d%3===0) venta(d,[{r:tinte, largo:['corto','medio','largo'][d%3===0?(d/3)%3:1]}],'Transferencia');
    if(d%5===0) venta(d,[{r:rc('Mechas'),largo:'medio'},{p:trat,cant:1}],'Tarjeta');
    if(d%4===1) venta(d,[{p:shv,cant:1}]);
    if(d%6===2) venta(d,[{r:rc('Keratina'),largo:'largo'}],'Transferencia');
  }
  const G=(dias,cat,desc,valor)=>S.gastos.push({id:uid('G'), fecha:diasAtras(dias), cat, desc, valor, prov:'', foto:null, anulado:false});
  G(12,'Arriendo','Arriendo del local',250); G(9,'Luz','Planilla eléctrica',28.40); G(9,'Agua','Planilla de agua',9.10); G(8,'Internet y teléfono','Internet',25);
  G(5,'Ayudantes','Ayuda sábado (Carmen)',20); G(3,'Mantenimiento','Afilado de tijeras',6);
  S.compras.push({id:uid('C'), fecha:diasAtras(12), prov:'Distribuidora Belleza', ruc:'1790000000001', numero:'001-002-000004512', clave:'', fuente:'xml', total:24.84, foto:null,
    lineas:[{desc:'TINTE 7.1 60G (PROMO)', pid:t71.id, envases:4, regalo:0, costo:21.60, gasto:false}]});
  // Clientes de ejemplo y sus visitas
  migrar();
  const K=(nombre,telefono,extra={})=>{ const c={id:uid('K'), nombre, telefono, cumple:'', semanas:'', notas:'', notaInterna:'', creado:diasAtras(60), recordado:'', ...extra}; S.clientes.push(c); return c; };
  const ks=[K('María López','0991234567',{notas:'Le gusta el corte en capas'}), K('Andrea Torres','0987654321'), K('Carlos Mena','0998877665'), K('Lucía Guerrero','0961112233'), K('Diego Paredes','0974455667')];
  S.ventas.forEach((v,i)=>{ if(i%3!==2){ const c=ks[i%ks.length]; v.clienteId=c.id; v.cliente=c.nombre; } });
  const rosa=K('Rosa Pérez','0992223344',{notaInterna:'Raíz con 7.1; puntas solo 10 min. Cuero cabelludo sensible: 20 vol, no 30.'});
  const jorge=K('Jorge Salazar','0985556677');
  venta(44,[{r:tinte, largo:'largo'}],'Transferencia'); { const v=S.ventas[S.ventas.length-1]; v.clienteId=rosa.id; v.cliente=rosa.nombre; v.items[0].nota='35 min de pose'; }
  venta(23,[{r:rc('Corte + barba con navaja')}]); { const v=S.ventas[S.ventas.length-1]; v.clienteId=jorge.id; v.cliente=jorge.nombre; }
  S.bitacora=[]; S.movs.sort((a,b)=>a.fecha<b.fecha?-1:1);
}

/* ===== Clientes: ficha, historial con fórmulas y recordatorios por WhatsApp ===== */
const SEMANAS_CAT = {Corte:4, 'Barbería':3, Color:6, Tratamiento:10, Peinado:0, Otro:0};
const PLANTILLA_WA = 'Hola {nombre} 👋, te saluda {negocio}. Ya van {semanas} semanas desde tu {servicio}. ¿Te reservo un turno esta semana?';

function migrar(){ // agrega lo nuevo a datos guardados con versiones anteriores
  if(!S.clientes) S.clientes=[];
  if(!S.negocio.plantillaWA) S.negocio.plantillaWA=PLANTILLA_WA;
  for(const r of S.recetas) if(r.recordarSemanas==null) r.recordarSemanas=SEMANAS_CAT[r.categoria]??0;
}
const cliente = id => S.clientes.find(c=>c.id===id);
function visitasDe(cid){ return S.ventas.filter(v=>!v.anulada && v.clienteId===cid).sort((a,b)=>a.fecha<b.fecha?1:-1); }
function semanasEntre(a,b){ return Math.round((new Date(b)-new Date(a))/(7*864e5)); }
/* Cada cuántas semanas vuelve: lo que ella puso, o lo que dicen los servicios de su última visita */
function intervaloCliente(c){
  if(+c.semanas>0) return +c.semanas;
  const u=visitasDe(c.id)[0]; if(!u) return 0;
  const ss=u.items.filter(i=>i.k==='s').map(i=>{ const r=receta(i.rid); return r? +r.recordarSemanas||0 : 0; }).filter(x=>x>0);
  return ss.length? Math.min(...ss) : 0;
}
function proximaVisita(c){ const u=visitasDe(c.id)[0], n=intervaloCliente(c); if(!u||!n) return null;
  const d=new Date(u.fecha.slice(0,10)+'T12:00'); d.setDate(d.getDate()+n*7); return d.toISOString().slice(0,10); }
function porRecordar(){ // le toca en los próximos 3 días o ya se pasó (hasta 45 días), y no se le escribió desde su última visita
  const hoy=hoyISO(), lim=new Date(Date.now()+3*864e5).toISOString().slice(0,10), viejo=new Date(Date.now()-45*864e5).toISOString().slice(0,10);
  return S.clientes.map(c=>({c, prox:proximaVisita(c), u:visitasDe(c.id)[0]})).filter(x=>x.prox && x.prox<=lim && x.prox>=viejo && !(x.c.recordado && x.c.recordado>=x.u.fecha.slice(0,10)))
    .sort((a,b)=>a.prox<b.prox?-1:1);
}
function telWA(t){ let d=String(t||'').replace(/\D/g,''); if(!d) return ''; if(d.startsWith('593')) return d; if(d.startsWith('0')) d=d.slice(1); return d.length===9? '593'+d : d; }
function mensajeWA(c){ const u=visitasDe(c.id)[0]; const serv=u? u.items.filter(i=>i.k==='s').map(i=>i.nombre.toLowerCase()).join(' y ') || 'última visita' : 'última visita';
  return (S.negocio.plantillaWA||PLANTILLA_WA).replace(/\{nombre\}/g, (c.nombre||'').split(' ')[0]).replace(/\{negocio\}/g, S.negocio.nombre.replace(/\s*\(ejemplo\)/,''))
    .replace(/\{semanas\}/g, u? Math.max(1,semanasEntre(u.fecha.slice(0,10), hoyISO())) : '').replace(/\{servicio\}/g, serv); }
function linkWA(c, txt){ const t=telWA(c.telefono); return t? 'https://wa.me/'+t+'?text='+encodeURIComponent(txt||mensajeWA(c)) : ''; }
function formulaTxt(it){ if(it.k!=='s') return ''; const ps=(it.usos||[]).filter(u=>u.q>0).map(u=>{ const p=prod(u.pid); if(!p||p.tipo==='desechable') return ''; return `${p.tono?'Tono '+p.tono:p.nombre} ${fmtCant(p,u.q)}`; }).filter(Boolean);
  return ps.join(' + '); }
function resumenUltima(c){ const u=visitasDe(c.id)[0]; if(!u) return 'Primera visita';
  return `Última vez ${fechaTxt(u.fecha)}: ${u.items.map(i=>i.nombre+(i.largo?' ('+i.largo+')':'')).join(', ')} · ${$(u.total)}`; }

function vClientes(){
  const q=sinTildes(UI.buscaCli||'');
  const rec=porRecordar();
  const cs=S.clientes.filter(c=>!q || sinTildes(c.nombre+' '+c.telefono).includes(q)).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
  const filaRec=x=>{ const atras=x.prox<hoyISO(); const link=linkWA(x.c);
    return `<div class="li"><div class="thumb">${esc(iniciales(x.c.nombre))}</div><div class="grow"><b>${esc(x.c.nombre)}</b><div class="small muted">${esc(resumenUltima(x.c))}</div>
      <div class="small">${atras?'<span class="pill p-warn">Le tocaba el '+fechaTxt(x.prox)+'</span>':'<span class="pill p-acc">Le toca el '+fechaTxt(x.prox)+'</span>'}</div></div>
      ${link?`<a class="btn pri sm" href="${link}" target="_blank" rel="noopener" data-act="recordado" data-id="${x.c.id}">WhatsApp</a>`:`<button class="btn sm" data-act="verCliente" data-id="${x.c.id}">Poner su número</button>`}
      <button class="btn sm" data-act="posponer" data-id="${x.c.id}" aria-label="Ya no recordar esta vez">Omitir</button></div>`; };
  return `<div class="top"><div><h1>Clientes</h1><div class="sub">${S.clientes.length} clientes guardados</div></div><button class="btn pri" data-act="nuevoCliente">${svg('mas')} Nuevo cliente</button></div>
  <div class="grid g-2" style="align-items:start">
    <div class="stack"><h2>Recordar esta semana</h2>
      <div class="list">${rec.map(filaRec).join('') || '<div class="empty">Nadie por recordar hoy. Aquí aparecen los clientes a los que ya les toca volver.</div>'}</div>
      <p class="small muted">Al tocar WhatsApp se abre el chat con el mensaje listo; solo lo revisas y lo envías. Cada servicio tiene sus semanas para volver (se cambian en Recetas).</p></div>
    <div class="stack"><label class="search">${svg('buscar')}<input class="in" id="buscaCli" data-bind="buscaCli" placeholder="Buscar por nombre o teléfono" value="${esc(UI.buscaCli||'')}"></label>
      <div class="list">${cs.map(c=>{ const p=proximaVisita(c); return `<div class="li tap" data-act="verCliente" data-id="${c.id}"><div class="thumb">${esc(iniciales(c.nombre))}</div><div class="grow"><b>${esc(c.nombre)}</b>
        <div class="small muted">${esc(resumenUltima(c))}</div></div>${p?`<span class="small muted">Próxima ${fechaTxt(p)}</span>`:''}</div>`; }).join('') || '<div class="empty">No hay clientes con ese nombre.</div>'}</div></div>
  </div>`;
}
let EDCL=null;
function hojaCliente(id, desdeCaja){
  const c=id? cliente(id) : null;
  EDCL = c? {...c} : {id:null, nombre:(desdeCaja&&UI.ticket.buscaCli)||'', telefono:'', cumple:'', semanas:'', notas:'', notaInterna:''};
  abrirHoja(c? c.nombre : 'Nuevo cliente', cuerpoCliente, {desdeCaja});
}
function cuerpoCliente(){
  const c=EDCL, real=c.id?cliente(c.id):null, vs=real?visitasDe(real.id):[], ay=ROL==='ayudante';
  const auto = real? intervaloCliente({...real, semanas:0}) : 0;
  const form=`<div class="grid g-2">
    <label class="f">Nombre<input class="in" id="clNom" data-bind="edcl" data-k="nombre" value="${esc(c.nombre)}" placeholder="Nombre y apellido"></label>
    <label class="f">WhatsApp<span class="h">ej. 0991234567</span><input class="in num" id="clTel" type="tel" inputmode="tel" data-bind="edcl" data-k="telefono" value="${esc(c.telefono)}"></label>
    <label class="f">Cumpleaños <span class="h">(opcional, para saludarle)</span><input class="in" type="date" id="clCum" data-bind="edcl" data-k="cumple" value="${esc(c.cumple)}"></label>
    <label class="f">Cada cuántas semanas suele venir<span class="h">${auto?'Si lo dejas vacío: '+auto+' (según su último servicio)':'Si lo dejas vacío se calcula por el servicio'}</span><input class="in num" inputmode="numeric" id="clSem" data-bind="edcl" data-k="semanas" value="${esc(c.semanas)}"></label>
    <label class="f">Preferencias<span class="h">lo que le gusta, cómo le gusta el corte…</span><textarea class="in" id="clNotas" data-bind="edcl" data-k="notas">${esc(c.notas)}</textarea></label>
    <label class="f">Notas internas de fórmula<span class="h">solo para el salón; no van en el mensaje</span><textarea class="in" id="clInt" data-bind="edcl" data-k="notaInterna" placeholder="Ej. raíz con 6.0 + 7.1 mitad y mitad, 20 vol, 35 min">${esc(c.notaInterna)}</textarea></label>
  </div>
  <div class="row" style="justify-content:flex-end;margin-top:12px">${real&&!vs.length&&!ay?'<button class="btn bad" data-act="borrarCliente">Eliminar</button>':''}<button class="btn pri" data-act="guardarCliente">Guardar</button></div>`;
  if(!real) return form;
  const link=linkWA(real);
  const hist=vs.map(v=>`<div class="panel stack" style="gap:6px"><div class="row" style="justify-content:space-between"><b>${fechaTxt(v.fecha)}</b><b class="num">${$(v.total)}</b></div>
    ${v.items.map(i=>`<div><span>${esc(i.nombre)}${i.largo?' <span class="pill p-acc">'+esc(i.largo)+'</span>':''}${i.k==='p'&&i.cant>1?' ×'+i.cant:''}</span> <span class="muted num">${$(i.precio)}</span>
      ${i.k==='s'&&formulaTxt(i)?`<div class="small"><span class="muted">Fórmula:</span> ${esc(formulaTxt(i))}${i.nota?' · <i>'+esc(i.nota)+'</i>':''}</div>`:''}</div>`).join('')}
    <div class="small muted">${esc(v.pago)}${v.comp.tipo!=='ninguno'?' · '+(v.comp.tipo==='nota'?'Nota de venta ':'Factura ')+esc(v.comp.num):''}</div></div>`).join('');
  const prox=proximaVisita(real);
  return `<div class="row" style="margin-bottom:14px">
      <button class="btn pri" data-act="repetirVisita" data-id="${real.id}" ${vs.length?'':'disabled'}>Repetir lo de la última vez</button>
      ${link?`<a class="btn" href="${link}" target="_blank" rel="noopener" data-act="recordado" data-id="${real.id}">Escribir por WhatsApp</a>`:'<span class="small muted">Agrega su WhatsApp para enviarle recordatorios.</span>'}
      ${prox?`<span class="pill p-acc">Próxima visita: ${fechaTxt(prox)}</span>`:''}</div>
    <h3 style="margin:4px 0 8px">Visitas (${vs.length})${vs.length?` · en total ${$(vs.reduce((a,v)=>a+v.total,0))}`:''}</h3><div class="stack" style="margin-bottom:18px">${hist||'<div class="empty">Todavía no tiene visitas registradas.</div>'}</div>
    <h3 style="margin-bottom:8px">Datos</h3>${form}`;
}
function guardarCliente(){
  const c=EDCL; if(!c.nombre.trim()) return toast('Escribe el nombre');
  const dup=S.clientes.find(x=>x.id!==c.id && sinTildes(x.nombre)===sinTildes(c.nombre.trim()) && telWA(x.telefono)===telWA(c.telefono));
  if(dup) return toast('Ya existe '+dup.nombre+' con ese número');
  const datos={nombre:c.nombre.trim().replace(/\s+/g,' '), telefono:c.telefono.trim(), cumple:c.cumple, semanas:c.semanas===''?'':(+c.semanas||''), notas:c.notas.trim(), notaInterna:c.notaInterna.trim()};
  let id=c.id; if(id) Object.assign(cliente(id), datos); else { id=uid('K'); S.clientes.push({id, creado:hoyISO(), recordado:'', ...datos}); }
  guardar(); toast('Cliente guardado');
  if(HOJA&&HOJA.opts.desdeCaja){ elegirClienteCaja(id); cerrarHoja(); return; }
  hojaCliente(id);
}
function elegirClienteCaja(id){ const c=cliente(id); UI.ticket.clienteId=id; UI.ticket.cliente=c.nombre; UI.ticket.buscaCli=''; }
function repetirVisita(id){
  const u=visitasDe(id)[0]; if(!u) return; UI.ticket=ticketNuevo(); elegirClienteCaja(id); UI.ticket.pago=u.pago;
  for(const it of u.items){
    if(it.k==='s'){ const r=receta(it.rid); if(!r||!r.activo) continue;
      UI.ticket.items.push({k:'s', rid:r.id, nombre:r.nombre, largo:it.largo, precio:precioReceta(r,it.largo||'medio'), usos:(it.usos||[]).filter(u=>prod(u.pid)).map(u=>({...u})), ajustado:!!it.ajustado, nota:it.nota||''}); }
    else { const p=prod(it.pid); if(p&&!p.inactivo) UI.ticket.items.push({k:'p', pid:p.id, nombre:p.nombre, cant:it.cant, precio:r2(p.precioVenta*it.cant)}); }
  }
  cerrarHojaSilencio(); UI.vista='caja'; render(); toast('Cargué lo de la última vez. Revisa y cobra.');
}
/* Selector de cliente dentro de la Caja */
function cajaCliente(){
  const T=UI.ticket;
  if(T.clienteId && cliente(T.clienteId)){ const c=cliente(T.clienteId);
    return `<div class="stack" style="gap:6px"><b class="small">Cliente</b><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><span style="min-width:0"><b>${esc(c.nombre)}</b><div class="small muted">${esc(resumenUltima(c))}</div>
      ${c.notaInterna?`<div class="small"><span class="muted">Fórmula guardada:</span> ${esc(c.notaInterna)}</div>`:''}</span><button class="btn sm" data-act="quitarClienteCaja">Cambiar</button></div></div>`; }
  const q=sinTildes(T.buscaCli||''); const sug=q? S.clientes.filter(c=>sinTildes(c.nombre+' '+c.telefono).includes(q)).slice(0,5) : [];
  return `<div class="stack" style="gap:6px"><b class="small">Cliente <span class="muted" style="font-weight:400">(opcional)</span></b>
    <input class="in" id="tkCli" data-bind="tkCli" value="${esc(T.buscaCli||'')}" placeholder="Busca o escribe el nombre" autocomplete="off">
    ${q?`<div class="list">${sug.map(c=>`<div class="li tap" data-act="elegirCliente" data-id="${c.id}"><div class="grow"><b>${esc(c.nombre)}</b><div class="small muted">${esc(resumenUltima(c))}</div></div></div>`).join('')}
      <div class="li tap" data-act="nuevoClienteCaja"><div class="grow"><b>+ Guardar "${esc(T.buscaCli)}" como cliente nuevo</b></div></div></div>`:''}</div>`;
}

/* ===== Interfaz ===== */
const IC = {
  inicio:'<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  caja:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
  inventario:'<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',
  recetas:'<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 14h9"/>',
  compras:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  gastos:'<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.5 0-2.6-.6-3-1.6M12 6.5v11"/>',
  resumen:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  ajustes:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  clientes:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6"/>',
  buscar:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  mas:'<path d="M12 5v14M5 12h14"/>',
  camara:'<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  barras:'<path d="M4 5v14M7 5v14M10 5v14M14 5v14M17 5v14M20 5v14"/>',
  archivo:'<path d="M4 6l8 6 8-6"/><rect x="3" y="5" width="18" height="14" rx="2"/>',
  lapiz:'<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  candado:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
};
const svg = (k,extra='') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${IC[k]}</svg>`;

const UI = {vista:'inicio', filtroInv:'todos', buscaInv:'', buscaCaja:'', cajaTab:'serv', catServ:'Todas', mes:hoyISO().slice(0,7), mesG:hoyISO().slice(0,7),
  ticket:null};
function ticketNuevo(){ return {items:[], cliente:'', clienteId:null, buscaCli:'', pago:'Efectivo', comp:'ninguno', num:'', ayuda:false, ayudante:'', pagoAyudante:''}; }
UI.ticket=ticketNuevo();
const VISTAS = [['inicio','Inicio'],['caja','Caja'],['clientes','Clientes'],['inventario','Inventario'],['recetas','Recetas'],['compras','Compras'],['gastos','Gastos'],['resumen','Resumen'],['ajustes','Ajustes']];
const VISTAS_AYUDANTE = ['inicio','caja','clientes','inventario'];

function toast(t){ const el=document.getElementById('toast'); el.textContent=t; el.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>el.hidden=true, 2600); }
function ir(v){ UI.vista=v; render(); window.scrollTo(0,0); }

function render(){
  const permit = ROL==='ayudante' ? VISTAS_AYUDANTE : VISTAS.map(v=>v[0]);
  if(!permit.includes(UI.vista)) UI.vista='inicio';
  const nav = document.getElementById('rail');
  nav.innerHTML = `<div class="marca">${esc(S.negocio.nombre)}</div>` + VISTAS.filter(v=>permit.includes(v[0])).map(([k,t])=>
    `<button class="nav ${UI.vista===k?'on':''}" data-act="ir" data-v="${k}" aria-label="${t}">${svg(k)}<span>${t}</span></button>`).join('')
    + (S.pins.duena? `<button class="nav" data-act="bloquear" aria-label="Bloquear">${svg('candado')}<span>Bloquear</span></button>`:'');
  const m=document.getElementById('main');
  m.innerHTML = (S.demo && ROL==='duena' ? `<div class="banner"><span><b>Estás viendo datos de ejemplo.</b> Pruébalo todo con confianza. Cuando quieras empezar con tus datos reales, bórralos.</span><button class="btn sm" data-act="ir" data-v="ajustes">Empezar con mis datos</button></div>` : '')
    + ({inicio:vInicio, caja:vCaja, clientes:vClientes, inventario:vInventario, recetas:vRecetas, compras:vCompras, gastos:vGastos, resumen:vResumen, ajustes:vAjustes}[UI.vista])();
}

/* ---------- Hoja (ventana) ---------- */
let HOJA=null;
function abrirHoja(titulo, fnCuerpo, opts={}){ HOJA={titulo, fnCuerpo, opts}; document.querySelector('#sheet .box').scrollTop=0; pintarHoja(); document.getElementById('sheet').hidden=false; }
function pintarHoja(){ if(!HOJA) return; const box=document.querySelector('#sheet .box'); const st=box.scrollTop;
  box.innerHTML=`<div class="sh-top"><h2>${esc(HOJA.titulo)}</h2><button class="x" data-act="cerrarHoja" aria-label="Cerrar">×</button></div>${HOJA.fnCuerpo()}`; box.scrollTop=st; }
function cerrarHoja(){ HOJA=null; document.getElementById('sheet').hidden=true; render(); }

/* ---------- INICIO ---------- */
function vInicio(){
  const hoy=hoyISO(); const vs=S.ventas.filter(v=>!v.anulada && v.fecha.slice(0,10)===hoy);
  const total=vs.reduce((a,v)=>a+v.total,0), costo=vs.reduce((a,v)=>a+v.costo,0), nServ=vs.reduce((a,v)=>a+v.items.filter(i=>i.k==='s').length,0);
  const bajos=S.productos.filter(p=>!p.inactivo && estadoStock(p)[0]!=='Bien');
  const vencen=S.productos.filter(p=>!p.inactivo && porVencer(p));
  const faltan=S.productos.filter(p=>p.deficit>0);
  const d=new Date(); const DIAS=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  return `<div class="top"><div><h1>Hola 👋</h1><div class="sub">Hoy es ${DIAS[d.getDay()]} ${fechaTxt(hoy)}</div></div></div>
  <div class="grid g-2" style="margin-bottom:18px">
    <button class="opt" data-act="ir" data-v="caja">${svg('caja')}<span><b>Registrar servicio o venta</b><span class="muted small">Corte, tinte, producto… se descuenta solo del inventario</span></span></button>
    ${ROL==='duena'?`<button class="opt" data-act="subirFactura">${svg('compras')}<span><b>Subir factura de compra</b><span class="muted small">Del correo, con el código de barras o una foto</span></span></button>
    <button class="opt" data-act="nuevoGasto">${svg('gastos')}<span><b>Anotar un gasto</b><span class="muted small">Arriendo, luz, ayudante, mantenimiento…</span></span></button>`:''}
    ${porRecordar().length?`<button class="opt" data-act="ir" data-v="clientes">${svg('clientes')}<span><b>Recordar a ${porRecordar().length} cliente${porRecordar().length>1?'s':''}</b><span class="muted small">Ya les toca volver. Mensaje de WhatsApp listo.</span></span></button>`:''}
    <button class="opt" data-act="ir" data-v="inventario">${svg('inventario')}<span><b>Ver inventario</b><span class="muted small">${bajos.length? bajos.length+' productos por acabarse':'Todo con stock'}</span></span></button>
  </div>
  ${ROL==='duena'?`<div class="grid g-kpi" style="margin-bottom:18px">
    <div class="kpi"><div class="l">Vendido hoy</div><div class="v">${$(total)}</div><div class="d">${vs.length} cobros</div></div>
    <div class="kpi"><div class="l">Servicios hoy</div><div class="v">${nServ}</div><div class="d">&nbsp;</div></div>
    <div class="kpi ok"><div class="l">Queda después de productos</div><div class="v">${$(total-costo)}</div><div class="d">Productos usados: ${$(costo)}</div></div>
  </div>`:''}
  <div class="grid g-2">
    <div class="stack"><h2>Para atender</h2>
      <div class="list">
      ${faltan.map(p=>`<div class="li tap" data-act="verProducto" data-id="${p.id}"><span class="pill p-bad">Revisar</span><div class="grow"><b>${esc(p.nombre)}</b><div class="small muted">Se usó ${fmtCant(p,p.deficit)} más de lo que había. Sube la factura de compra o cuenta el inventario.</div></div></div>`).join('')}
      ${bajos.slice(0,8).map(p=>{const [t,c]=estadoStock(p); return `<div class="li tap" data-act="verProducto" data-id="${p.id}"><div class="thumb">${fotoHTML(p.foto,p.nombre)}</div><div class="grow"><b>${esc(p.nombre)}</b><div class="small muted">Quedan ${fmtStock(p)}</div></div><span class="pill ${c}">${t}</span></div>`}).join('')}
      ${vencen.map(p=>{const l=porVencer(p); return `<div class="li tap" data-act="verProducto" data-id="${p.id}"><div class="thumb">${fotoHTML(p.foto,p.nombre)}</div><div class="grow"><b>${esc(p.nombre)}</b><div class="small muted">Vence el ${fechaTxt(l.vence)}. Úsalo primero.</div></div><span class="pill p-warn">Vence pronto</span></div>`}).join('')}
      ${!bajos.length&&!vencen.length&&!faltan.length?'<div class="empty">Todo en orden. No hay productos por acabarse.</div>':''}
      </div>
      ${ROL==='duena' && !S.pins.duena?`<div class="alert p-acc">${svg('candado','style="width:22px;height:22px;flex:none"')}<span>Pon un PIN para proteger la app. <button class="btn sm" data-act="ir" data-v="ajustes">Poner PIN</button></span></div>`:''}
    </div>
    <div class="stack"><h2>Cobros de hoy</h2>${listaVentas(vs.slice().reverse())}</div>
  </div>`;
}
function listaVentas(vs){
  if(!vs.length) return '<div class="list"><div class="empty">Todavía no hay cobros hoy.</div></div>';
  return `<div class="list">${vs.map(v=>`<div class="li ${v.anulada?'muted':''}"><div class="grow"><b>${esc(v.items.map(i=>i.nombre+(i.largo?' ('+i.largo+')':'')+(i.k==='p'&&i.cant>1?' ×'+i.cant:'')).join(', '))}</b>
    <div class="small muted">${v.fecha.slice(11,16)} · ${esc(v.pago)}${v.cliente?' · '+esc(v.cliente):''}${v.comp.tipo!=='ninguno'?' · '+(v.comp.tipo==='nota'?'Nota de venta':'Factura')+' '+esc(v.comp.num):''}${v.anulada?' · ANULADO':''}</div></div>
    <b class="num">${$(v.total)}</b>${ROL==='duena'&&!v.anulada?`<button class="btn sm" data-act="anularVenta" data-id="${v.id}">Anular</button>`:''}</div>`).join('')}</div>`;
}

/* ---------- CAJA ---------- */
function vCaja(){
  const T=UI.ticket, q=sinTildes(UI.buscaCaja);
  let cuerpo='';
  if(UI.cajaTab==='serv'){
    const cats=['Todas',...CAT_SERV.filter(c=>S.recetas.some(r=>r.activo&&r.categoria===c))];
    const rs=S.recetas.filter(r=>r.activo && (UI.catServ==='Todas'||r.categoria===UI.catServ) && (!q||sinTildes(r.nombre).includes(q)));
    cuerpo=`<div class="row" style="margin-bottom:12px">${cats.map(c=>`<button class="chip ${UI.catServ===c?'on':''}" data-act="catServ" data-c="${c}">${c}</button>`).join('')}</div>
    <div class="grid g-cards">${rs.map(r=>`<button class="card mini" data-act="addServ" data-id="${r.id}"><div class="ph">${fotoHTML(r.foto,r.nombre)}</div><div class="bd"><span class="nm">${esc(r.nombre)}</span>
      <div class="ft"><b class="num">${r.porLargo? 'desde '+$(Math.min(...LARGOS.map(([k])=>precioReceta(r,k)))) : $(r.precio)}</b>${r.porLargo?'<span class="pill p-acc">Por largo</span>':''}</div></div></button>`).join('')||'<div class="empty">No hay servicios. Créalos en Recetas.</div>'}</div>`;
  } else {
    const ps=S.productos.filter(p=>!p.inactivo && (p.tipo==='venta'||p.tipo==='ambos') && (!q||sinTildes(p.nombre+' '+p.marca).includes(q)));
    cuerpo=`<div class="grid g-cards">${ps.map(p=>{const [t,c]=estadoStock(p); return `<button class="card mini" data-act="addProd" data-id="${p.id}"><div class="ph">${fotoHTML(p.foto,p.nombre)}</div><div class="bd"><span class="nm">${esc(p.nombre)}</span><span class="meta">${esc(p.marca)} · quedan ${fmtStock(p)}</span>
      <div class="ft"><b class="num">${$(p.precioVenta)}</b><span class="pill ${c}">${t}</span></div></div></button>`}).join('')||'<div class="empty">No hay productos para vender. Márcalos como "Para vender" en Inventario.</div>'}</div>`;
  }
  const total=T.items.reduce((a,i)=>a+(+i.precio||0),0);
  const vsHoy=S.ventas.filter(v=>v.fecha.slice(0,10)===hoyISO()).slice().reverse();
  return `<div class="top"><div><h1>Caja</h1><div class="sub">Toca lo que hiciste o vendiste</div></div></div>
  <div class="caja"><div style="min-width:0">
    <div class="row" style="margin-bottom:12px"><button class="chip ${UI.cajaTab==='serv'?'on':''}" data-act="cajaTab" data-t="serv">Servicios</button><button class="chip ${UI.cajaTab==='prod'?'on':''}" data-act="cajaTab" data-t="prod">Productos para vender</button>
      <label class="search">${svg('buscar')}<input class="in" id="buscaCaja" data-bind="buscaCaja" placeholder="Buscar…" value="${esc(UI.buscaCaja)}"></label></div>
    ${cuerpo}
    <h2 style="margin:22px 0 10px">Cobros de hoy</h2>${listaVentas(vsHoy)}
  </div>
  ${T.items.length?`<button class="btn pri big vercuenta" data-act="verCuenta">Ver cuenta (${T.items.length}) · ${$(total)}</button>`:''}
  <div class="panel ticket stack" id="cuenta"><h2>Cuenta</h2>
    ${T.items.length? T.items.map((it,ix)=>`<div class="tline"><div class="grow"><b>${esc(it.nombre)}</b>${it.largo?` <span class="pill p-acc">${esc(LARGOS.find(l=>l[0]===it.largo)[1])}</span>`:''}${it.k==='p'?` <span class="muted">× ${it.cant}</span>`:''}
      ${it.k==='s'?`<div><button class="btn sm" data-act="ajustarUso" data-ix="${ix}" style="margin-top:6px">${it.ajustado?'Productos ajustados ✓':'Ajustar productos usados'}</button></div>`:''}</div>
      <input class="in num" style="width:96px;min-height:44px;text-align:right" inputmode="decimal" data-bind="precioTicket" data-ix="${ix}" value="${(+it.precio).toFixed(2)}" aria-label="Precio">
      <button class="x" style="width:40px;height:40px" data-act="quitarTicket" data-ix="${ix}" aria-label="Quitar">×</button></div>`).join('') : '<div class="muted">Toca un servicio o producto para agregarlo.</div>'}
    <div class="row" style="justify-content:space-between"><span class="muted">Total</span><span class="tot">${$(total)}</span></div>
    ${cajaCliente()}
    <div class="stack" style="gap:6px"><b class="small">¿Cómo pagó?</b><div class="row">${PAGOS.map(p=>`<button class="chip ${T.pago===p?'on':''}" data-act="tkPago" data-p="${p}">${p}</button>`).join('')}</div></div>
    <div class="stack" style="gap:6px"><b class="small">Comprobante</b><div class="row">${[['ninguno','Ninguno'],['nota','Nota de venta'],['factura','Factura SRI']].map(([k,t])=>`<button class="chip ${T.comp===k?'on':''}" data-act="tkComp" data-c="${k}">${t}</button>`).join('')}</div>
      ${T.comp!=='ninguno'?`<input class="in" id="tkNum" data-bind="tk" data-k="num" value="${esc(T.num)}" placeholder="Número, ej. 001-001-000123">`:''}</div>
    <label class="row" style="gap:10px;cursor:pointer"><input type="checkbox" id="tkAyuda" data-bind="tkAyuda" ${T.ayuda?'checked':''} style="width:24px;height:24px"> <b class="small">Me ayudó otra persona</b></label>
    ${T.ayuda?`<div class="row"><input class="in" style="flex:1;min-width:120px" id="tkAyNom" data-bind="tk" data-k="ayudante" value="${esc(T.ayudante)}" placeholder="Nombre"><input class="in num" style="width:120px" id="tkAyPago" inputmode="decimal" data-bind="tk" data-k="pagoAyudante" value="${esc(T.pagoAyudante)}" placeholder="Pago $"></div>`:''}
    <button class="btn pri big" data-act="cobrar" ${T.items.length?'':'disabled'}>Cobrar ${$(total)}</button>
  </div></div>`;
}
function addServicio(r, largo){
  const usos=usosReceta(r,largo||'medio');
  UI.ticket.items.push({k:'s', rid:r.id, nombre:r.nombre, largo:r.porLargo?largo:null, precio:precioReceta(r,largo||'medio'), usos, ajustado:false});
  render(); toast(r.nombre+' agregado');
}
function hojaLargo(r){
  abrirHoja(r.nombre, ()=>`<p class="muted">¿Qué largo de cabello?</p><div class="grid g-2">${LARGOS.map(([k,t])=>`<button class="opt" data-act="elegirLargo" data-id="${r.id}" data-l="${k}"><span><b>${t}</b><span class="muted num">${$(precioReceta(r,k))}</span></span></button>`).join('')}</div>`);
}
let AJUSTE=null;
function hojaAjuste(ix){
  const it=UI.ticket.items[ix]; AJUSTE={ix, usos:it.usos.map(u=>({...u})), nota:it.nota||'', pick:''}; const r=receta(it.rid);
  abrirHoja('Productos usados: '+it.nombre, ()=>`<p class="muted">Si usaste más o menos de lo normal, cámbialo aquí. Se descuenta lo que pongas.</p>
    ${AJUSTE.usos.map((u,i)=>{const p=prod(u.pid); return `<div class="ing"><div class="thumb">${fotoHTML(p.foto,p.nombre)}</div><div><b>${esc(p.nombre)}</b><div class="small muted">${(()=>{const b=usosReceta(r,it.largo||'medio').find(x=>x.pid===u.pid); return b?'Receta: '+fmtCant(p,b.q):'Agregado a la mezcla';})()}</div></div>
      <div class="ctl">${stepper('aj',i,u.q,p)}</div></div>`}).join('')}
    <div class="panel stack" style="margin-top:12px"><div class="row"><b>¿Mezclaste otro producto?</b><label class="search">${svg('buscar')}<input class="in" id="ajPick" data-bind="ajPick" placeholder="Busca: 6.0, matizador…" value="${esc(AJUSTE.pick)}"></label></div>
      ${AJUSTE.pick?`<div class="grid g-cards" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">${S.productos.filter(p=>!p.inactivo&&p.tipo!=='venta'&&!AJUSTE.usos.some(u=>u.pid===p.id)&&sinTildes(p.nombre+' '+p.marca+' '+p.tono).includes(sinTildes(AJUSTE.pick))).slice(0,8).map(p=>`<button class="card mini" data-act="ajAdd" data-id="${p.id}"><div class="ph">${fotoHTML(p.foto,p.nombre)}</div><div class="bd"><span class="small nm">${esc(p.nombre)}</span></div></button>`).join('')||'<span class="muted">No encontré ese producto.</span>'}</div>`:''}</div>
    <label class="f" style="margin-top:12px">Nota de la fórmula <span class="h">interna: tiempo de pose, técnica, cómo quedó</span><textarea class="in" id="ajNota" data-bind="ajNota" placeholder="Ej. 35 min de pose, raíz primero">${esc(AJUSTE.nota)}</textarea></label>
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-act="cerrarHoja">Cancelar</button><button class="btn pri" data-act="guardarAjuste">Listo</button></div>`);
}
function paso(p){ if(p.unidad==='u') return 1; return p.contenido>=500? 10 : 5; }
function stepper(grupo,i,val,p){ return `<span class="step"><button data-act="step" data-g="${grupo}" data-i="${i}" data-d="-${paso(p)}" aria-label="Menos">−</button><input inputmode="decimal" data-bind="step" data-g="${grupo}" data-i="${i}" value="${+r3(val)}" aria-label="Cantidad"><span class="u">${uTxt(p)}</span><button data-act="step" data-g="${grupo}" data-i="${i}" data-d="${paso(p)}" aria-label="Más">+</button></span>`; }
function cobrar(){
  const T=UI.ticket; if(!T.items.length) return;
  const cl=T.clienteId?cliente(T.clienteId):null; const v={id:uid('V'), fecha:ahoraISO(), cliente:cl?cl.nombre:'', clienteId:cl?cl.id:null, pago:T.pago, comp:{tipo:T.comp, num:T.num.trim()}, items:[], total:0, costo:0, ayudante:null, anulada:false};
  for(const it of T.items){
    if(it.k==='s'){ const cons=it.usos.filter(u=>u.q>0).map(u=>consumir(u.pid,u.q,'servicio',v.id,it.nombre)); v.items.push({...it, cons, costo:r2(cons.reduce((a,c)=>a+c.costo,0))}); }
    else { const p=prod(it.pid); const c=consumir(p.id, it.cant*p.contenido, 'venta', v.id, 'Venta'); v.items.push({...it, cons:[c], costo:r2(c.costo)}); }
  }
  v.total=r2(v.items.reduce((a,i)=>a+(+i.precio||0),0)); v.costo=r2(v.items.reduce((a,i)=>a+i.costo,0));
  if(T.ayuda && +T.pagoAyudante>0){ v.ayudante={nombre:T.ayudante.trim(), pago:+T.pagoAyudante};
    S.gastos.push({id:uid('G'), fecha:hoyISO(), cat:'Ayudantes', desc:'Ayuda: '+(T.ayudante.trim()||'ayudante')+' ('+v.items.map(i=>i.nombre).join(', ')+')', valor:+T.pagoAyudante, prov:'', foto:null, ventaId:v.id, anulado:false}); }
  S.ventas.push(v); UI.ticket=ticketNuevo(); guardar(); render(); toast('Cobro guardado: '+$(v.total));
}
let CONFIRMA=null;
function confirmar(titulo, texto, botón, fn, peligro=true){ CONFIRMA=fn; abrirHoja(titulo, ()=>`<p>${texto}</p><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-act="cerrarHoja">No, volver</button><button class="btn ${peligro?'bad':'pri'}" data-act="confirmaSi">${botón}</button></div>`); }
function anularVenta(id){
  const v=S.ventas.find(x=>x.id===id); if(!v||v.anulada) return;
  confirmar('Anular cobro', `Se anulará el cobro de <b>${$(v.total)}</b> y los productos vuelven al inventario. Queda registrado en el historial.`, 'Sí, anular', ()=>{
    for(const it of v.items) for(const c of it.cons||[]) devolver(c, v.id);
    v.anulada=true; S.gastos.filter(g=>g.ventaId===v.id).forEach(g=>g.anulado=true);
    registrar('Anuló cobro', $(v.total)+' · '+v.items.map(i=>i.nombre).join(', ')); guardar(); cerrarHoja(); toast('Cobro anulado');
  });
}

/* ---------- INVENTARIO ---------- */
function vInventario(){
  const q=sinTildes(UI.buscaInv); const F=UI.filtroInv;
  let ps=S.productos.filter(p=>!p.inactivo && (!q||sinTildes(p.nombre+' '+p.marca+' '+p.tono).includes(q)));
  if(F==='servicio') ps=ps.filter(p=>p.tipo==='servicio'||p.tipo==='ambos'); if(F==='venta') ps=ps.filter(p=>p.tipo==='venta'||p.tipo==='ambos');
  if(F==='desechable') ps=ps.filter(p=>p.tipo==='desechable'); if(F==='bajos') ps=ps.filter(p=>estadoStock(p)[0]!=='Bien'); if(F==='vence') ps=ps.filter(p=>porVencer(p));
  const valor=S.productos.reduce((a,p)=>a+lotesVivos(p.id).reduce((x,l)=>x+l.restante*l.costoU,0),0);
  const F_=[['todos','Todos'],['servicio','Uso en servicios'],['venta','Para vender'],['desechable','Desechables'],['bajos','Por acabarse'],['vence','Por vencer']];
  return `<div class="top"><div><h1>Inventario</h1><div class="sub">${S.productos.filter(p=>!p.inactivo).length} productos${ROL==='duena'?' · vale '+$(valor)+' a precio de compra':''}</div></div>
    ${ROL==='duena'?`<div class="row"><button class="btn" data-act="conteo">Contar inventario</button><button class="btn pri" data-act="nuevoProducto">${svg('mas')} Nuevo producto</button></div>`:''}</div>
  <div class="row" style="margin-bottom:10px"><label class="search">${svg('buscar')}<input class="in" id="buscaInv" data-bind="buscaInv" placeholder="Buscar por nombre, marca o tono (ej. 7.1)" value="${esc(UI.buscaInv)}"></label></div>
  <div class="row" style="margin-bottom:14px">${F_.map(([k,t])=>`<button class="chip ${F===k?'on':''}" data-act="filtroInv" data-f="${k}">${t}</button>`).join('')}</div>
  <div class="grid g-cards">${ps.map(p=>{const [t,c]=estadoStock(p); const v=porVencer(p); const promo=lotesVivos(p.id)[0]?.promo;
    return `<button class="card" data-act="verProducto" data-id="${p.id}"><div class="ph">${fotoHTML(p.foto,p.nombre)}</div><div class="bd"><span class="nm">${esc(p.nombre)}</span>
    <span class="meta">${esc([p.marca, TIPOS[p.tipo]].filter(Boolean).join(' · '))}</span>
    <div class="ft"><b class="num">${fmtStock(p)}</b><span class="row" style="gap:4px">${promo&&ROL==='duena'?'<span class="pill p-promo">Promo</span>':''}${v?'<span class="pill p-warn">Vence</span>':''}<span class="pill ${c}">${t}</span></span></div></div></button>`}).join('')||'<div class="empty">No hay productos con ese filtro.</div>'}</div>`;
}
let EDP=null; // producto en edición
function hojaProducto(id){
  const p=id? prod(id) : null;
  EDP = p? {...p} : {id:null, nombre:'', marca:'', tono:'', tipo:'servicio', unidad:'g', contenido:60, envase:'tubo', stockMin:0, precioVenta:0, deficit:0, foto:null, prov:''};
  EDP._minEnv = EDP.contenido>0 ? r3((EDP.stockMin||0)/EDP.contenido) : 0;
  abrirHoja(p? p.nombre : 'Nuevo producto', cuerpoProducto);
}
function cuerpoProducto(){
  const p=EDP, real=p.id?prod(p.id):null, ay=ROL==='ayudante';
  const sug = real? minimoSugerido(real) : 0;
  const ficha = `<div class="grid g-2">
    <div class="stack"><div class="card" style="cursor:default"><div class="ph" style="aspect-ratio:1">${fotoHTML(p.foto,p.nombre||'Foto')}</div></div>
      ${ay?'':`<label class="btn">${svg('camara')} ${p.foto?'Cambiar foto':'Tomar o subir foto'}<input type="file" accept="image/*" capture="environment" data-file="fotoProducto" hidden></label>`}</div>
    <div class="stack">
      <label class="f">Nombre<input class="in" id="pNom" data-bind="edp" data-k="nombre" value="${esc(p.nombre)}" placeholder="Ej. Tinte 7.1 rubio ceniza" ${ay?'disabled':''}></label>
      <div class="row"><label class="f" style="flex:2">Marca<input class="in" id="pMarca" data-bind="edp" data-k="marca" value="${esc(p.marca)}" ${ay?'disabled':''}></label><label class="f" style="flex:1">Tono o número<input class="in" id="pTono" data-bind="edp" data-k="tono" value="${esc(p.tono)}" placeholder="7.1" ${ay?'disabled':''}></label></div>
      <div class="stack" style="gap:6px"><b class="small">¿Para qué es?</b><div class="row">${Object.entries(TIPOS).map(([k,t])=>`<button class="chip ${p.tipo===k?'on':''}" data-act="edpTipo" data-t="${k}" ${ay?'disabled':''}>${t}</button>`).join('')}</div></div>
      <div class="row">
        <label class="f" style="flex:1">Se mide en<select class="in" id="pUni" data-bind="edp" data-k="unidad" ${ay||(real&&S.movs.some(m=>m.pid===real.id))?'disabled':''}><option value="g" ${p.unidad==='g'?'selected':''}>gramos (g)</option><option value="ml" ${p.unidad==='ml'?'selected':''}>mililitros (ml)</option><option value="u" ${p.unidad==='u'?'selected':''}>unidades</option></select></label>
        <label class="f" style="flex:1">Cada envase trae<input class="in num" id="pCont" inputmode="decimal" data-bind="edp" data-k="contenido" value="${p.contenido}" ${ay?'disabled':''}></label>
        <label class="f" style="flex:1">Tipo de envase<input class="in" id="pEnv" data-bind="edp" data-k="envase" value="${esc(p.envase)}" placeholder="tubo, frasco, caja" ${ay?'disabled':''}></label>
      </div>
      ${ay?'':`<div class="row">
        <label class="f" style="flex:1">Avisarme cuando queden<span class="h">envases${sug?` · sugerido: ${r3(sug/p.contenido)}`:''}</span><input class="in num" id="pMin" inputmode="decimal" data-bind="edp" data-k="_minEnv" value="${p._minEnv}"></label>
        ${p.tipo==='venta'||p.tipo==='ambos'?`<label class="f" style="flex:1">Precio de venta<span class="h">por ${esc(p.envase||'envase')}</span><input class="in num" id="pPV" inputmode="decimal" data-bind="edp" data-k="precioVenta" value="${p.precioVenta}"></label>`:''}
      </div>
      <div class="row" style="justify-content:flex-end">${real&&!S.movs.some(m=>m.pid===real.id)?'<button class="btn bad" data-act="borrarProducto">Eliminar</button>':''}${real?'<button class="btn" data-act="desactivarProducto">Ya no lo uso</button>':''}<button class="btn pri" data-act="guardarProducto">Guardar</button></div>`}
    </div></div>`;
  if(!real) return ficha;
  const vivos=lotesVivos(real.id);
  const costoEnv = costoActual(real.id)*real.contenido;
  const movs=S.movs.filter(m=>m.pid===real.id).slice(-12).reverse();
  return ficha + `<div class="panel stack" style="margin-top:16px"><div class="row" style="justify-content:space-between"><div><div class="muted small">Hay ahora</div><h2 class="num">${fmtStock(real)}</h2>${real.deficit>0?`<div class="pill p-bad">Se usó ${fmtCant(real,real.deficit)} más de lo registrado</div>`:''}</div>
    ${ay?'':`<div class="row"><button class="btn" data-act="hojaStock" data-id="${real.id}">${svg('mas')} Agregar stock</button><button class="btn" data-act="hojaSalida" data-id="${real.id}">Se dañó / uso personal</button><button class="btn" data-act="hojaContar" data-id="${real.id}">Contar</button></div>`}</div>
    ${ay?'':`<h3>Lotes (se usa primero el de arriba)</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Compra</th><th>Proveedor</th><th class="r">Queda</th><th class="r">Costo por ${esc(real.envase||'envase')}</th><th></th></tr></thead><tbody>
      ${vivos.map((l,i)=>`<tr><td>${fechaTxt(l.fecha)}</td><td>${esc(l.prov||'—')}</td><td class="r">${fmtCant(real,l.restante)}</td><td class="r">${$(l.costoU*real.contenido)}</td><td>${i===0?'<span class="pill p-acc">Se usa ahora</span> ':''}${l.promo?'<span class="pill p-promo">Promo</span> ':''}${l.regalo?'<span class="pill p-promo">Con regalo</span> ':''}${l.vence?'<span class="pill p-warn">Vence '+fechaTxt(l.vence)+'</span>':''}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Sin stock</td></tr>'}
      </tbody></table></div>
      <div class="small muted">Costo actual: ${$(costoEnv)} por ${esc(real.envase||'envase')} (${$(costoActual(real.id))} por ${uTxt(real)}).</div>
      <h3>Últimos movimientos</h3><div class="tbl-wrap"><table class="tbl"><tbody>${movs.map(m=>`<tr><td>${fechaTxt(m.fecha)}</td><td>${esc(m.tipo)}${m.nota?' · '+esc(m.nota):''}</td><td class="r">${m.q>0?'+':''}${fmtCant(real,m.q)}</td><td class="r">${$(Math.abs(m.costo))}</td></tr>`).join('')}</tbody></table></div>`}
  </div>`;
}
function minimoSugerido(p){ // consumo semanal promedio (últimas 8 semanas) × semanas que tarda el proveedor × 1,5
  const desde=new Date(Date.now()-56*864e5).toISOString().slice(0,10);
  const usado=-S.movs.filter(m=>m.pid===p.id && m.fecha>=desde && (m.tipo==='servicio'||m.tipo==='venta')).reduce((a,m)=>a+m.q,0);
  const anul=S.movs.filter(m=>m.pid===p.id && m.fecha>=desde && m.tipo==='anulación').reduce((a,m)=>a+m.q,0);
  return Math.max(0,(usado-anul)/8*(S.negocio.semanasProveedor||1)*1.5);
}
async function guardarProducto(){
  const e=EDP; if(!e.nombre.trim()) return toast('Escribe el nombre del producto');
  e.contenido=+e.contenido||1; e.stockMin=r3((+e._minEnv||0)*e.contenido); e.precioVenta=+e.precioVenta||0;
  const datos={nombre:e.nombre.trim(), marca:e.marca.trim(), tono:e.tono.trim(), tipo:e.tipo, unidad:e.unidad, contenido:e.contenido, envase:e.envase.trim()||'envase', stockMin:e.stockMin, precioVenta:e.precioVenta, foto:e.foto};
  if(e.id){ Object.assign(prod(e.id), datos); } else { const p={id:uid('P'), deficit:0, prov:'', ...datos}; S.productos.push(p); e.id=p.id; }
  guardar(); toast('Producto guardado'); if(HOJA&&HOJA.opts.alGuardar){ const f=HOJA.opts.alGuardar; f(e.id); return; } cerrarHoja();
}
let EDS=null; // entrada/salida de stock
function hojaStock(pid){ const p=prod(pid); EDS={pid, env:1, costo:r2(ultimoCosto(pid)*p.contenido), promo:false, regalo:0, vence:'', prov:p.prov||''};
  abrirHoja('Agregar stock: '+p.nombre, ()=>{ const p=prod(EDS.pid); const und=(+EDS.env+ +EDS.regalo)*p.contenido; const cu= und? (+EDS.costo)/und*p.contenido : 0;
    return `<p class="muted">Usa esto si compraste sin factura. Si tienes la factura, mejor súbela en Compras.</p><div class="grid g-2">
    <label class="f">¿Cuántos ${esc(p.envase||'envases')} compraste?<input class="in num" id="sEnv" inputmode="decimal" data-bind="eds" data-k="env" value="${EDS.env}"></label>
    <label class="f">¿Cuánto pagaste en total?<input class="in num" id="sCosto" inputmode="decimal" data-bind="eds" data-k="costo" value="${EDS.costo}"></label>
    <label class="f">${esc(p.envase||'Envases')} de regalo<span class="h">ej. promoción 3×2: compras 2, regalo 1</span><input class="in num" id="sReg" inputmode="decimal" data-bind="eds" data-k="regalo" value="${EDS.regalo}"></label>
    <label class="f">Proveedor<input class="in" id="sProv" data-bind="eds" data-k="prov" value="${esc(EDS.prov)}"></label>
    <label class="f">Vence <span class="h">(opcional)</span><input class="in" type="date" id="sVence" data-bind="eds" data-k="vence" value="${EDS.vence}"></label>
    <label class="row" style="gap:10px;cursor:pointer;align-self:end;min-height:52px"><input type="checkbox" id="sPromo" data-bind="edsPromo" ${EDS.promo?'checked':''} style="width:24px;height:24px"><b>Fue en promoción</b></label></div>
    <div class="costbar" style="margin-top:14px"><div><span class="small">Te sale cada ${esc(p.envase||'envase')} a</span><b>${$(cu)}</b></div><div><span class="small">Antes costaba</span><b>${$(ultimoCosto(p.id)*p.contenido)}</b></div></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn pri" data-act="guardarStock">Agregar</button></div>`; });
}
function guardarStock(){ const p=prod(EDS.pid); const und=(+EDS.env + +EDS.regalo)*p.contenido; if(und<=0) return toast('Pon la cantidad');
  const ult=ultimoCosto(p.id); const cu=(+EDS.costo)/und;
  agregarLote(p.id, und, +EDS.costo, {prov:EDS.prov, promo:EDS.promo || (ult>0 && cu<ult*.95), regalo:+EDS.regalo*p.contenido, vence:EDS.vence, tipo:'compra', nota:+EDS.regalo?'Incluye regalo':''});
  if(EDS.prov) p.prov=EDS.prov; guardar(); toast('Stock agregado'); hojaProducto(p.id); }
function hojaSalida(pid){ const p=prod(pid); EDS={pid, q:paso(p), motivo:'Se dañó'};
  abrirHoja('Sacar del inventario', ()=>`<p class="muted">Para productos que se dañaron, se vencieron, se regalaron o usaste para ti. Así el inventario cuadra.</p>
    <div class="row" style="margin-bottom:12px">${['Se dañó','Se venció','Uso personal','Regalo','Se perdió'].map(m=>`<button class="chip ${EDS.motivo===m?'on':''}" data-act="edsMotivo" data-m="${m}">${m}</button>`).join('')}</div>
    <div class="ing"><div class="thumb">${fotoHTML(p.foto,p.nombre)}</div><div><b>${esc(p.nombre)}</b><div class="small muted">Hay ${fmtStock(p)}</div></div><div class="ctl">${stepper('salida',0,EDS.q,p)}</div></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn pri" data-act="guardarSalida">Sacar</button></div>`); }
function guardarSalida(){ const p=prod(EDS.pid); if(!(EDS.q>0)) return; consumir(p.id, +EDS.q, 'merma', '', EDS.motivo); registrar('Sacó del inventario', p.nombre+' '+fmtCant(p,EDS.q)+' · '+EDS.motivo); guardar(); toast('Listo'); hojaProducto(p.id); }
function hojaContar(pid){ const p=prod(pid); EDS={pid, env:Math.floor(Math.max(0,stockDe(pid))/p.contenido), resto:r3(Math.max(0,stockDe(pid))%p.contenido)};
  abrirHoja('Contar: '+p.nombre, ()=>`<p class="muted">Cuenta lo que hay en la estantería. El sistema dice: <b>${fmtStock(p)}</b>.</p><div class="grid g-2">
    <label class="f">${esc(p.envase||'Envases')} cerrados<input class="in num" id="cEnv" inputmode="decimal" data-bind="eds" data-k="env" value="${EDS.env}"></label>
    ${p.contenido>1?`<label class="f">Lo que queda en el abierto (${uTxt(p)})<input class="in num" id="cResto" inputmode="decimal" data-bind="eds" data-k="resto" value="${EDS.resto}"></label>`:''}</div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn pri" data-act="guardarConteo">Guardar conteo</button></div>`); }
function aplicarConteo(pid, real){ const p=prod(pid), sis=stockDe(pid), dif=r3(real-sis); if(Math.abs(dif)<1e-6) return 0;
  if(dif<0) consumir(pid,-dif,'ajuste','', 'Conteo físico'); else { if(p.deficit>0){ const t=Math.min(p.deficit,dif); p.deficit=r3(p.deficit-t); if(dif-t>0) agregarLote(pid,dif-t,(dif-t)*ultimoCosto(pid),{tipo:'ajuste',nota:'Conteo físico'}); S.movs.push({id:uid('M'),fecha:hoyISO(),pid,tipo:'ajuste',q:t,costo:0,nota:'Conteo cubre faltante'}); } else agregarLote(pid,dif,dif*ultimoCosto(pid),{tipo:'ajuste',nota:'Conteo físico'}); }
  registrar('Conteo', p.nombre+': sistema '+fmtCant(p,sis)+' → real '+fmtCant(p,real)); return dif; }
function guardarConteo(){ const p=prod(EDS.pid); const real=(+EDS.env||0)*p.contenido+(+EDS.resto||0); aplicarConteo(p.id, real); guardar(); toast('Conteo guardado'); hojaProducto(p.id); }
let CONTEO=null;
function hojaConteo(){ CONTEO={}; for(const p of S.productos.filter(x=>!x.inactivo)) CONTEO[p.id]=''; abrirHoja('Contar inventario', ()=>`<p class="muted">Escribe cuántos envases hay de cada producto (puedes poner decimales, ej. 2.5). Deja vacío lo que no contaste.</p>
  <div class="list">${S.productos.filter(x=>!x.inactivo).map(p=>`<div class="li"><div class="thumb">${fotoHTML(p.foto,p.nombre)}</div><div class="grow"><b>${esc(p.nombre)}</b><div class="small muted">Sistema: ${fmtStock(p)}</div></div>
    <input class="in num" style="width:110px" inputmode="decimal" id="ct_${p.id}" data-bind="conteo" data-id="${p.id}" value="${esc(CONTEO[p.id])}" placeholder="${esc(p.envase||'envases')}"></div>`).join('')}</div>
  <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn pri" data-act="guardarConteoTodo">Guardar conteo</button></div>`); }

/* ---------- RECETAS ---------- */
function vRecetas(){
  const grupos=CAT_SERV.map(c=>[c,S.recetas.filter(r=>r.activo&&r.categoria===c)]).filter(g=>g[1].length);
  return `<div class="top"><div><h1>Recetas de servicios</h1><div class="sub">Qué productos lleva cada servicio. Al cobrar, se descuentan solos.</div></div><button class="btn pri" data-act="nuevaReceta">${svg('mas')} Nueva receta</button></div>
  ${grupos.map(([c,rs])=>`<h2 style="margin:18px 0 10px">${c}</h2><div class="grid g-cards">${rs.map(r=>{ const cs=costoReceta(r,'medio'), pr=precioReceta(r,'medio'), pct=pr?cs/pr*100:0;
    return `<button class="card" data-act="editarReceta" data-id="${r.id}"><div class="ph">${fotoHTML(r.foto,r.nombre)}</div><div class="bd"><span class="nm">${esc(r.nombre)}</span>
      <span class="meta">${r.items.length} productos${r.porLargo?' · precio según largo':''}</span>
      <div class="ft"><span class="num"><b>${$(pr)}</b> <span class="muted small">productos ${$(cs)}</span></span><span class="pill ${pct<=15?'p-ok':pct<=25?'p-warn':'p-bad'}">${pct.toFixed(0)}%</span></div></div></button>`}).join('')}</div>`).join('') || '<div class="empty">Aún no hay recetas. Crea la primera.</div>'}
  <p class="small muted" style="margin-top:16px">El porcentaje es cuánto del precio se va en productos. Verde: hasta 15 %. Amarillo: hasta 25 %. Rojo: revisa el precio o la cantidad.</p>`;
}
let EDR=null, PICK='';
function hojaReceta(id){
  const r=id? receta(id) : null;
  EDR = r? JSON.parse(JSON.stringify(r)) : {id:null, nombre:'', categoria:'Color', precio:0, porLargo:false, precios:{corto:0,medio:0,largo:0,extra:0}, items:[], foto:null, activo:true};
  if(!EDR.precios) EDR.precios={corto:EDR.precio,medio:EDR.precio,largo:EDR.precio,extra:EDR.precio};
  PICK=''; EDR._pick=false; abrirHoja(r? 'Receta: '+r.nombre : 'Nueva receta', cuerpoReceta);
}
function cuerpoReceta(){
  const r=EDR, real=r.id?receta(r.id):null, ur=real?usoReal(real):{};
  const fila=(it,i)=>{ const p=prod(it.pid); if(!p) return ''; const c=costoSimulado(p.id,it.q); const sug=ur[p.id];
    return `<div class="ing"><div class="thumb">${fotoHTML(p.foto,p.nombre)}</div><div style="min-width:0"><b>${esc(p.nombre)}</b><div class="small muted">${$(c)} · hay ${fmtStock(p)}</div>
      ${r.porLargo?`<label class="small" style="display:inline-flex;gap:6px;align-items:center;margin-top:4px;cursor:pointer"><input type="checkbox" data-bind="edrFijo" data-i="${i}" ${it.fijo?'checked':''} style="width:20px;height:20px"> Igual para todo largo</label>`:''}
      ${sug && Math.abs(sug.prom-it.q)/Math.max(it.q,1)>.08?`<div class="sug" style="margin-top:6px">En la práctica usas ${fmtCant(p,sug.prom)} (${sug.n} veces). <button class="btn sm" data-act="usarReal" data-i="${i}" data-q="${sug.prom}">Usar ese valor</button></div>`:''}</div>
      <div class="ctl">${stepper('rec',i,it.q,p)}<button class="x" style="width:44px;height:44px" data-act="quitarIng" data-i="${i}" aria-label="Quitar">×</button></div></div>`; };
  const tabla = r.porLargo ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Largo</th><th class="r">Precio</th><th class="r">Productos</th><th class="r">Te queda</th><th class="r">%</th></tr></thead><tbody>
      ${LARGOS.map(([k,t])=>{ const tmp={...r, precio:r.precios.medio}; const cs=costoReceta(tmp,k), pr=+r.precios[k]||0; return `<tr><td>${t} <span class="muted small">×${S.negocio.largos[k]}</span></td><td class="r"><input class="in num" style="width:96px;min-height:44px;text-align:right" inputmode="decimal" data-bind="edrPrecio" data-k="${k}" value="${pr}" aria-label="Precio ${t}"></td><td class="r">${$(cs)}</td><td class="r"><b>${$(pr-cs)}</b></td><td class="r">${pr?(cs/pr*100).toFixed(0):'—'}%</td></tr>`}).join('')}</tbody></table></div>`
    : (()=>{ const cs=costoReceta(r,'medio'), pr=+r.precio||0; return `<div class="costbar"><div><span class="small">Precio</span><input class="in num" style="width:120px;min-height:44px" inputmode="decimal" id="rPrecio" data-bind="edr" data-k="precio" value="${pr}"></div><div><span class="small">Productos</span><b>${$(cs)}</b></div><div><span class="small">Te queda</span><b>${$(pr-cs)}</b></div><div><span class="small">Se va en productos</span><b>${pr?(cs/pr*100).toFixed(0):'—'}%</b></div></div>`; })();
  const q=sinTildes(PICK);
  const cand=S.productos.filter(p=>!p.inactivo && p.tipo!=='venta' && !r.items.some(i=>i.pid===p.id) && (!q||sinTildes(p.nombre+' '+p.marca+' '+p.tono).includes(q)));
  return `<div class="grid g-2"><div class="stack">
      <label class="f">Nombre del servicio<input class="in" id="rNom" data-bind="edr" data-k="nombre" value="${esc(r.nombre)}" placeholder="Ej. Tinte completo 7.1"></label>
      <div class="stack" style="gap:6px"><b class="small">Tipo</b><div class="row">${CAT_SERV.map(c=>`<button class="chip ${r.categoria===c?'on':''}" data-act="edrCat" data-c="${c}">${c}</button>`).join('')}</div></div>
      <label class="f">¿En cuántas semanas recordarle que vuelva?<span class="h">0 = no recordar. Ej. corte 4, tinte 6, keratina 12</span><input class="in num" style="max-width:140px" inputmode="numeric" id="rSem" data-bind="edr" data-k="recordarSemanas" value="${r.recordarSemanas??''}"></label>
      <label class="row" style="gap:10px;cursor:pointer;min-height:52px"><input type="checkbox" id="rLargo" data-bind="edrLargo" ${r.porLargo?'checked':''} style="width:26px;height:26px"><span><b>Cambia según el largo del cabello</b><br><span class="small muted">Pones la cantidad para cabello medio; corto, largo y extra se calculan solos.</span></span></label>
    </div>
    <div class="stack"><div class="card" style="cursor:default"><div class="ph" style="aspect-ratio:16/10">${fotoHTML(r.foto,r.nombre||'Foto')}</div></div>
      <label class="btn">${svg('camara')} ${r.foto?'Cambiar foto':'Foto del servicio (opcional)'}<input type="file" accept="image/*" capture="environment" data-file="fotoReceta" hidden></label></div></div>
  <h3 style="margin:18px 0 4px">Productos que lleva${r.porLargo?' <span class="muted small">(cantidades para cabello medio)</span>':''}</h3>
  ${r.items.map(fila).join('') || '<div class="empty">Agrega los productos que usas en este servicio.</div>'}
  <div class="panel stack" style="margin-top:12px"><div class="row"><b>Agregar producto</b><label class="search">${svg('buscar')}<input class="in" id="rPick" data-bind="pick" placeholder="Busca: tinte, oxidante, 7.1, guantes…" value="${esc(PICK)}"></label></div>
    <div class="grid g-cards" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">${cand.slice(0,12).map(p=>`<button class="card mini" data-act="addIng" data-id="${p.id}"><div class="ph">${fotoHTML(p.foto,p.nombre)}</div><div class="bd"><span class="nm small">${esc(p.nombre)}</span></div></button>`).join('') || '<span class="muted">No hay más productos. Créalos en Inventario.</span>'}</div></div>
  <h3 style="margin:18px 0 8px">Cuánto te queda</h3>${tabla}
  <div class="row" style="justify-content:flex-end;margin-top:16px">${r.id?'<button class="btn bad" data-act="borrarReceta">Quitar</button><button class="btn" data-act="duplicarReceta">Duplicar</button>':''}<button class="btn pri" data-act="guardarReceta">Guardar receta</button></div>`;
}
function guardarReceta(){ const r=EDR; if(!r.nombre.trim()) return toast('Ponle nombre al servicio'); if(!r.items.length) return toast('Agrega al menos un producto');
  r.precio = r.porLargo ? +r.precios.medio||0 : +r.precio||0; const datos={nombre:r.nombre.trim(), categoria:r.categoria, precio:r.precio, porLargo:r.porLargo, precios:r.porLargo?Object.fromEntries(LARGOS.map(([k])=>[k,+r.precios[k]||0])):null, items:r.items.map(i=>({pid:i.pid,q:+i.q||0,fijo:!!i.fijo})), foto:r.foto, activo:true, recordarSemanas: r.recordarSemanas===''||r.recordarSemanas==null? (SEMANAS_CAT[r.categoria]??0) : +r.recordarSemanas||0};
  if(r.id) Object.assign(receta(r.id), datos); else S.recetas.push({id:uid('R'), ...datos}); guardar(); toast('Receta guardada'); cerrarHoja(); }

/* ---------- COMPRAS ---------- */
function vCompras(){
  const cs=S.compras.slice().sort((a,b)=>a.fecha<b.fecha?1:-1);
  const FU={xml:['XML','p-acc'], codigo:['Código','p-acc'], foto:['Foto','p-promo'], manual:['Manual','p-promo']};
  return `<div class="top"><div><h1>Compras</h1><div class="sub">Facturas y notas de venta de tus proveedores</div></div><button class="btn pri big" data-act="subirFactura">${svg('mas')} Subir factura</button></div>
  <div class="list">${cs.map(c=>`<div class="li tap" data-act="verCompra" data-id="${c.id}"><div class="thumb">${c.foto&&FOTOS[c.foto]?`<img src="${FOTOS[c.foto]}" alt="">`:svg('compras','style="width:24px;height:24px"')}</div>
    <div class="grow"><b>${esc(c.prov||'Proveedor')}</b><div class="small muted">${fechaTxt(c.fecha)} · ${esc(c.numero||'sin número')} · ${c.lineas.length} líneas</div></div>
    <span class="pill ${FU[c.fuente][1]}">${FU[c.fuente][0]}</span><b class="num">${$(c.total)}</b></div>`).join('') || '<div class="empty">Todavía no hay compras. Sube tu primera factura.</div>'}</div>`;
}
function hojaSubir(){
  abrirHoja('Subir factura de compra', ()=>`<div class="stack">
    <label class="opt">${svg('archivo')}<span><b>Archivo del correo (XML)</b><span class="muted small">La factura electrónica que te manda el proveedor. Se leen solos todos los productos y precios. Puedes elegir varios a la vez.</span></span><input type="file" accept=".xml,text/xml,application/xml" multiple data-file="xml" hidden></label>
    <label class="opt">${svg('barras')}<span><b>Foto del código de barras</b><span class="muted small">Para facturas electrónicas impresas. Toma la foto al código de barras de la clave de acceso; la app saca proveedor, fecha y número.</span></span><input type="file" accept="image/*" capture="environment" data-file="codigo" hidden></label>
    <label class="opt">${svg('camara')}<span><b>Foto de nota de venta o factura de papel</b><span class="muted small">Se guarda la foto y anotas los productos rápido.</span></span><input type="file" accept="image/*" capture="environment" data-file="fotoNota" hidden></label>
    <button class="opt" data-act="compraManual">${svg('lapiz')}<span><b>Sin documento</b><span class="muted small">Compra en mercado o sin comprobante.</span></span></button>
    <div class="row"><input class="in num" id="claveManual" inputmode="numeric" placeholder="O escribe los 49 números de la clave de acceso" style="flex:1;min-width:220px"><button class="btn" data-act="claveManual">Usar clave</button></div>
  </div>`);
}
let EDC=null;
function nuevaCompra(base){ EDC=Object.assign({id:null, fecha:hoyISO(), prov:'', ruc:'', numero:'', clave:'', fuente:'manual', total:0, foto:null, lineas:[]}, base); EDC.lineas=EDC.lineas||[]; abrirHoja('Revisar compra', cuerpoCompra); }
function lineaDesdeXML(L, ruc){
  const key=ruc+'|'+(L.codigo||sinTildes(L.desc)); const m=S.mapeo[key];
  let pid=m&&prod(m.pid)? m.pid : null, factor=m? m.factor : 1;
  if(!pid){ const d=sinTildes(L.desc); const p=S.productos.find(p=>!p.inactivo && sinTildes(p.nombre)===d); if(p) pid=p.id; }
  const costo = L.subtotal + (S.negocio.ivaCosto? L.iva : 0);
  return {desc:L.desc, codigo:L.codigo, pid, factor, envases:L.cant, regalo:0, costo:r2(costo), descuento:L.descuento, gasto:false, nuevo:null, guess:adivinarUnidad(L.desc)};
}
function importarXML(textos){
  const ok=[], errores=[];
  for(const [nombre,txt] of textos){ try{ ok.push(leerFacturaXML(txt)); }catch(e){ errores.push(nombre+': '+e.message); } }
  if(errores.length) toast(errores[0]);
  if(!ok.length) return;
  COLA=ok.slice(1); abrirXML(ok[0]);
}
let COLA=[];
function abrirXML(F){
  if(S.compras.some(c=>c.clave && c.clave===F.clave && !c.pendiente)) { toast('Esa factura ya estaba registrada'); if(COLA.length) abrirXML(COLA.shift()); return; }
  const previa=S.compras.find(c=>c.clave && c.clave===F.clave && c.pendiente);
  const lineas=F.lineas.map(L=>lineaDesdeXML(L,F.ruc));
  // Regalos: una línea en $0 del mismo producto que otra línea se suma como regalo (el costo se reparte)
  for(const l of lineas) if(l.costo===0){ const otra=lineas.find(o=>o!==l && o.costo>0 && ((l.pid && o.pid===l.pid) || (l.codigo && o.codigo===l.codigo))); if(otra){ otra.regalo+= l.envases; l._fusion=true; } }
  nuevaCompra({id:previa?previa.id:null, fecha:F.fecha, prov:F.prov, ruc:F.ruc, numero:F.numero, clave:F.clave, fuente:'xml', total:F.total, foto:previa?previa.foto:null, lineas:lineas.filter(l=>!l._fusion)});
}
function cuerpoCompra(){
  const c=EDC; const suma=c.lineas.reduce((a,l)=>a+(+l.costo||0),0);
  const filaL=(l,i)=>{ const p=l.pid?prod(l.pid):null; const env=(+l.envases||0)*(+l.factor||1), reg=(+l.regalo||0)*(+l.factor||1);
    let info=''; if(p&&!l.gasto){ const und=(env+reg)*p.contenido; const cu=und? l.costo/und : 0; const ult=ultimoCosto(p.id); const promo=ult>0&&cu<ult*.95;
      info=`<div class="small">Entra ${fmtCant(p,und)} · cada ${esc(p.envase||'envase')} a <b>${$(cu*p.contenido)}</b>${ult?` (antes ${$(ult*p.contenido)})`:''} ${promo?'<span class="pill p-promo">Más barato: promoción</span>':''}</div>`; }
    return `<div class="panel stack" style="gap:8px"><div class="row" style="justify-content:space-between"><b style="min-width:0">${esc(l.desc||'Producto')}</b><button class="x" style="width:40px;height:40px" data-act="quitarLinea" data-i="${i}" aria-label="Quitar línea">×</button></div>
      ${!c.desdeXML_lineas && l.manual?`<input class="in" data-bind="lin" data-i="${i}" data-k="desc" value="${esc(l.desc)}" placeholder="Descripción" id="ld_${i}">`:''}
      <div class="row">${l.gasto? `<span class="pill p-warn">Es gasto, no va al inventario</span><button class="btn sm" data-act="linGasto" data-i="${i}">Es producto</button>` :
        p? `<div class="li" style="padding:0;border:0;min-height:auto;flex:1"><div class="thumb">${fotoHTML(p.foto,p.nombre)}</div><div class="grow"><b>${esc(p.nombre)}</b><div class="small muted">Hay ${fmtStock(p)}</div></div></div><button class="btn sm" data-act="linElegir" data-i="${i}">Cambiar</button>`
          : `<span class="pill p-bad">¿Qué producto es?</span><button class="btn sm" data-act="linElegir" data-i="${i}">Elegir de mi inventario</button><button class="btn sm pri" data-act="linNuevo" data-i="${i}">Es nuevo: crearlo</button><button class="btn sm" data-act="linGasto" data-i="${i}">Es un gasto</button>`}</div>
      ${l.pick?`<div class="row"><label class="search">${svg('buscar')}<input class="in" data-bind="linPick" data-i="${i}" id="lp_${i}" value="${esc(l.pickQ||'')}" placeholder="Buscar producto"></label></div><div class="grid g-cards" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">${S.productos.filter(p=>!p.inactivo&&(!l.pickQ||sinTildes(p.nombre+' '+p.marca+' '+p.tono).includes(sinTildes(l.pickQ)))).slice(0,12).map(p=>`<button class="card mini" data-act="linSet" data-i="${i}" data-id="${p.id}"><div class="ph">${fotoHTML(p.foto,p.nombre)}</div><div class="bd"><span class="small nm">${esc(p.nombre)}</span></div></button>`).join('')}</div>`:''}
      ${l.gasto? `<div class="row"><label class="f" style="flex:1">Categoría<select class="in" data-bind="lin" data-i="${i}" data-k="cat" id="lc_${i}">${CAT_GASTO.map(g=>`<option ${l.cat===g?'selected':''}>${g}</option>`).join('')}</select></label><label class="f" style="width:140px">Valor<input class="in num" inputmode="decimal" data-bind="lin" data-i="${i}" data-k="costo" value="${l.costo}" id="lv_${i}"></label></div>`
      : `<div class="row"><label class="f" style="width:130px">Cantidad<input class="in num" inputmode="decimal" data-bind="lin" data-i="${i}" data-k="envases" value="${l.envases}" id="le_${i}"></label>
        <label class="f" style="width:130px">De regalo<input class="in num" inputmode="decimal" data-bind="lin" data-i="${i}" data-k="regalo" value="${l.regalo}" id="lr_${i}"></label>
        <label class="f" style="width:170px">Cada unidad de la factura trae<span class="h">${p?esc(p.envase||'envase')+'(s); ej. caja de 12 tubos = 12':'envases'}</span><input class="in num" inputmode="decimal" data-bind="lin" data-i="${i}" data-k="factor" value="${l.factor}" id="lf_${i}"></label>
        <label class="f" style="width:150px">Costo total${S.negocio.ivaCosto?' con IVA':''}<input class="in num" inputmode="decimal" data-bind="lin" data-i="${i}" data-k="costo" value="${l.costo}" id="lk_${i}"></label>
        <label class="f" style="width:160px">Vence <span class="h">(opcional)</span><input class="in" type="date" data-bind="lin" data-i="${i}" data-k="vence" value="${l.vence||''}" id="lx_${i}"></label></div>${info}`}
    </div>`; };
  const dif=r2((+c.total||0)-suma);
  return `${c.fuente==='codigo'?`<div class="alert p-acc" style="margin-bottom:12px">Leí la clave de acceso: proveedor (RUC), fecha y número ya están. Agrega los productos abajo. Si después llega el XML por correo, súbelo y se completa solo.</div>`:''}
  <div class="grid g-2"><div class="stack">
    <div class="row"><label class="f" style="flex:2">Proveedor<input class="in" id="cProv" data-bind="edc" data-k="prov" value="${esc(c.prov)}"></label><label class="f" style="flex:1">Fecha<input class="in" type="date" id="cFecha" data-bind="edc" data-k="fecha" value="${c.fecha}"></label></div>
    <div class="row"><label class="f" style="flex:1">RUC<input class="in num" id="cRuc" data-bind="edc" data-k="ruc" value="${esc(c.ruc)}"></label><label class="f" style="flex:1">Número<input class="in num" id="cNum" data-bind="edc" data-k="numero" value="${esc(c.numero)}"></label><label class="f" style="flex:1">Total del documento<input class="in num" inputmode="decimal" id="cTot" data-bind="edc" data-k="total" value="${c.total}"></label></div>
  </div>${c.foto&&FOTOS[c.foto]?`<div class="card" style="cursor:default"><div class="ph" style="aspect-ratio:auto;max-height:260px"><img src="${FOTOS[c.foto]}" alt="Foto del documento" style="object-fit:contain"></div></div>`:''}</div>
  <h3 style="margin:16px 0 8px">Productos (${c.lineas.length})</h3><div class="stack">${c.lineas.map(filaL).join('')}</div>
  <button class="btn" style="margin-top:10px" data-act="lineaManual">${svg('mas')} Agregar línea</button>
  <div class="costbar" style="margin-top:14px"><div><span class="small">Suma de líneas</span><b>${$(suma)}</b></div><div><span class="small">Total del documento</span><b>${$(c.total)}</b></div><div><span class="small">Diferencia</span><b style="color:${Math.abs(dif)>0.05?'var(--bad)':'var(--ok)'}">${$(dif)}</b></div></div>
  ${Math.abs(dif)>0.05?`<p class="small muted">${S.negocio.ivaCosto?'Si la diferencia es por un descuento global o transporte, ajusta el costo de las líneas.':'La diferencia puede ser el IVA (en Ajustes dices que el IVA no se suma al costo).'}</p>`:''}
  <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-act="cerrarHoja">Cancelar</button><button class="btn pri big" data-act="guardarCompra">Guardar compra</button></div>`;
}
function guardarCompra(){
  const c=EDC; const pend=c.lineas.filter(l=>!l.gasto && !l.pid);
  if(pend.length) return toast('Falta decir qué producto es: '+(pend[0].desc||'una línea'));
  if(!c.lineas.length && c.fuente!=='codigo') return toast('Agrega al menos un producto');
  let previa = c.id ? S.compras.find(x=>x.id===c.id) : null;
  if(previa && !previa.pendiente) return toast('Esta compra ya se guardó');
  const id = previa? previa.id : uid('C');
  for(const l of c.lineas){
    if(l.gasto){ S.gastos.push({id:uid('G'), fecha:c.fecha, cat:l.cat||'Otros', desc:l.desc+' ('+(c.prov||'proveedor')+')', valor:+l.costo||0, prov:c.prov, foto:c.foto, compraId:id, anulado:false}); continue; }
    const p=prod(l.pid); const f=+l.factor||1; const und=((+l.envases||0)+(+l.regalo||0))*f*p.contenido; const ult=ultimoCosto(p.id);
    const lote=agregarLote(p.id, und, +l.costo||0, {fecha:c.fecha, prov:c.prov, compraId:id, regalo:(+l.regalo||0)*f*p.contenido, vence:l.vence||'', tipo:'compra', nota:c.numero});
    if(lote && ult>0 && lote.costoU<ult*.95) lote.promo=true;
    if(c.prov) p.prov=c.prov;
    if(c.ruc && (l.codigo||l.desc)) S.mapeo[c.ruc+'|'+(l.codigo||sinTildes(l.desc))]={pid:p.id, factor:f};
  }
  const reg={id, fecha:c.fecha, prov:c.prov, ruc:c.ruc, numero:c.numero, clave:c.clave, fuente:c.fuente, total:+c.total||r2(c.lineas.reduce((a,l)=>a+(+l.costo||0),0)), foto:c.foto,
    lineas:c.lineas.map(l=>({desc:l.desc, pid:l.pid, envases:+l.envases||0, regalo:+l.regalo||0, factor:+l.factor||1, costo:+l.costo||0, gasto:!!l.gasto})), pendiente: !c.lineas.length};
  if(previa) Object.assign(previa, reg); else S.compras.push(reg);
  guardar(); toast(reg.pendiente? 'Guardada. Faltan los productos.' : 'Compra guardada y stock actualizado');
  if(COLA.length){ abrirXML(COLA.shift()); } else cerrarHoja();
}
async function leerCodigoDeFoto(file){
  if(!('BarcodeDetector' in window)) return null;
  try{ const bd=new BarcodeDetector({formats:['code_128','itf','code_39','qr_code','pdf417','data_matrix']}); const bmp=await createImageBitmap(file); const rs=await bd.detect(bmp);
    for(const r of rs){ const d=(r.rawValue||'').replace(/\D/g,''); if(d.length>=49){ const m=d.match(/\d{49}/); if(m) return m[0]; } } }catch(e){}
  return null;
}
function compraDesdeClave(k, foto){
  const r=leerClave(k); if(!r.ok) return toast(r.error);
  if(S.compras.some(c=>c.clave===r.clave)) return toast('Esa factura ya estaba registrada');
  const conocido=S.compras.find(c=>c.ruc===r.ruc && c.prov);
  nuevaCompra({fecha:r.fecha, ruc:r.ruc, prov:conocido?conocido.prov:'', numero:r.numero, clave:r.clave, fuente:'codigo', foto});
}
function verCompra(id){ const c=S.compras.find(x=>x.id===id); if(c.pendiente){ EDC={...c, lineas:[]}; abrirHoja('Completar compra', cuerpoCompra); return; }
  abrirHoja('Compra '+(c.numero||''), ()=>`<p><b>${esc(c.prov)}</b> · ${fechaTxt(c.fecha)} · RUC ${esc(c.ruc||'—')}</p>${c.clave?`<p class="small muted num" style="word-break:break-all">Clave: ${c.clave}</p>`:''}
  ${c.foto&&FOTOS[c.foto]?`<img src="${FOTOS[c.foto]}" alt="Documento" style="border-radius:12px;max-height:320px">`:''}
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="r">Cant.</th><th class="r">Regalo</th><th class="r">Costo</th></tr></thead><tbody>
  ${c.lineas.map(l=>`<tr><td>${esc(l.pid&&prod(l.pid)?prod(l.pid).nombre:l.desc)}${l.gasto?' <span class="pill p-warn">gasto</span>':''}</td><td class="r">${l.envases}</td><td class="r">${l.regalo||''}</td><td class="r">${$(l.costo)}</td></tr>`).join('')}</tbody></table></div><p class="num"><b>Total ${$(c.total)}</b></p>`); }

/* ---------- GASTOS ---------- */
function vGastos(){
  const ym=UI.mesG; const gs=S.gastos.filter(g=>g.fecha.slice(0,7)===ym).sort((a,b)=>a.fecha<b.fecha?1:-1);
  const tot=gs.filter(g=>!g.anulado).reduce((a,g)=>a+g.valor,0);
  const porCat=CAT_GASTO.map(c=>[c,gs.filter(g=>!g.anulado&&g.cat===c).reduce((a,g)=>a+g.valor,0)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  const mx=Math.max(1,...porCat.map(x=>x[1]));
  return `<div class="top"><div><h1>Gastos del negocio</h1><div class="sub">${selMes('mesG')} · total ${$(tot)}</div></div><button class="btn pri big" data-act="nuevoGasto">${svg('mas')} Anotar gasto</button></div>
  <div class="grid g-2"><div class="panel stack"><h3>En qué se va el dinero</h3>${porCat.map(([c,v])=>`<div><div class="row" style="justify-content:space-between"><span>${c}</span><b class="num">${$(v)}</b></div><div class="bar"><i style="width:${v/mx*100}%"></i></div></div>`).join('')||'<span class="muted">Sin gastos este mes.</span>'}
    <p class="small muted">Las compras de productos no salen aquí: van al inventario y cuentan como gasto cuando se usan o se venden.</p></div>
  <div class="list">${gs.map(g=>`<div class="li ${g.anulado?'muted':''}"><div class="thumb">${g.foto&&FOTOS[g.foto]?`<img src="${FOTOS[g.foto]}" alt="">`:esc(iniciales(g.cat))}</div><div class="grow"><b>${esc(g.desc||g.cat)}</b><div class="small muted">${fechaTxt(g.fecha)} · ${esc(g.cat)}${g.anulado?' · ANULADO':''}</div></div><b class="num">${$(g.valor)}</b>${!g.anulado?`<button class="btn sm" data-act="anularGasto" data-id="${g.id}">Anular</button>`:''}</div>`).join('')||'<div class="empty">No hay gastos este mes.</div>'}</div></div>`;
}
function selMes(k){ return `<span class="row" style="display:inline-flex;gap:6px"><button class="btn sm" data-act="mes" data-k="${k}" data-d="-1" aria-label="Mes anterior">‹</button><b>${mesTxt(UI[k])}</b><button class="btn sm" data-act="mes" data-k="${k}" data-d="1" aria-label="Mes siguiente">›</button></span>`; }
let EDG=null;
function hojaGasto(){ EDG={fecha:hoyISO(), cat:'', desc:'', valor:'', prov:'', foto:null};
  abrirHoja('Anotar gasto', ()=>`<div class="stack"><b class="small">¿Qué pagaste?</b><div class="row">${CAT_GASTO.map(c=>`<button class="chip ${EDG.cat===c?'on':''}" data-act="edgCat" data-c="${c}">${c}</button>`).join('')}</div>
    <div class="grid g-2"><label class="f">Valor<input class="in num" style="font-size:1.4rem" inputmode="decimal" id="gVal" data-bind="edg" data-k="valor" value="${esc(EDG.valor)}" placeholder="$0.00"></label>
    <label class="f">Fecha<input class="in" type="date" id="gFecha" data-bind="edg" data-k="fecha" value="${EDG.fecha}"></label>
    <label class="f">Detalle<input class="in" id="gDesc" data-bind="edg" data-k="desc" value="${esc(EDG.desc)}" placeholder="${EDG.cat==='Ayudantes'?'Nombre de quien ayudó y qué día':'Ej. planilla de octubre'}"></label>
    <label class="f">Proveedor <span class="h">(opcional)</span><input class="in" id="gProv" data-bind="edg" data-k="prov" value="${esc(EDG.prov)}"></label></div>
    ${EDG.foto&&FOTOS[EDG.foto]?`<img src="${FOTOS[EDG.foto]}" alt="Comprobante" style="max-height:200px;border-radius:12px;align-self:flex-start">`:''}
    <div class="row" style="justify-content:space-between"><label class="btn">${svg('camara')} Foto del comprobante<input type="file" accept="image/*" capture="environment" data-file="fotoGasto" hidden></label><button class="btn pri big" data-act="guardarGasto">Guardar gasto</button></div></div>`); }

/* ---------- RESUMEN ---------- */
function calcMes(ym){
  const vs=S.ventas.filter(v=>!v.anulada && v.fecha.slice(0,7)===ym);
  let iS=0,iP=0,cS=0,cP=0; const serv={}, pv={};
  for(const v of vs) for(const it of v.items){ if(it.k==='s'){ iS+=+it.precio; cS+=it.costo; const o=serv[it.nombre]=serv[it.nombre]||{n:0,i:0,c:0}; o.n++; o.i+=+it.precio; o.c+=it.costo; }
    else { iP+=+it.precio; cP+=it.costo; const o=pv[it.nombre]=pv[it.nombre]||{n:0,i:0,c:0}; o.n+=it.cant; o.i+=+it.precio; o.c+=it.costo; } }
  // productos dañados, regalados o faltantes al contar (los sobrantes no se cuentan como ganancia)
  const merma=-S.movs.filter(m=>m.fecha.slice(0,7)===ym && (m.tipo==='merma'||m.tipo==='ajuste') && m.costo<0).reduce((a,m)=>a+m.costo,0);
  const gs=S.gastos.filter(g=>!g.anulado && g.fecha.slice(0,7)===ym); const gastos=gs.reduce((a,g)=>a+g.valor,0);
  const compras=S.movs.filter(m=>m.fecha.slice(0,7)===ym && m.tipo==='compra').reduce((a,m)=>a+m.costo,0);
  return {vs, iS, iP, cS, cP, merma, gastos, gs, compras, serv, pv, ganancia:iS+iP-cS-cP-merma-gastos};
}
function vResumen(){
  const R=calcMes(UI.mes); const pct=R.iS? R.cS/R.iS*100 : 0; const pos=Math.min(100, pct/20*100);
  const lista=S.productos.filter(p=>!p.inactivo && p.stockMin && stockDe(p.id)<=p.stockMin);
  const tablaS=Object.entries(R.serv).sort((a,b)=>b[1].i-a[1].i);
  const tablaP=Object.entries(R.pv).sort((a,b)=>b[1].i-a[1].i);
  const cats=CAT_GASTO.map(c=>[c,R.gs.filter(g=>g.cat===c).reduce((a,g)=>a+g.valor,0)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]); const mx=Math.max(1,...cats.map(c=>c[1]));
  return `<div class="top"><div><h1>Resumen del mes</h1><div class="sub">${selMes('mes')}</div></div></div>
  <div class="grid g-kpi" style="margin-bottom:16px">
    <div class="kpi"><div class="l">Cobrado</div><div class="v">${$(R.iS+R.iP)}</div><div class="d">Servicios ${$(R.iS)} · Productos ${$(R.iP)}</div></div>
    <div class="kpi"><div class="l">Productos usados y vendidos</div><div class="v">${$(R.cS+R.cP+R.merma)}</div><div class="d">Costo FIFO${R.merma?` · dañados o faltantes ${$(R.merma)}`:''}</div></div>
    <div class="kpi"><div class="l">Gastos del negocio</div><div class="v">${$(R.gastos)}</div><div class="d">Arriendo, luz, ayudantes…</div></div>
    <div class="kpi ${R.ganancia>=0?'ok':'bad'}"><div class="l">Ganancia</div><div class="v">${$(R.ganancia)}</div><div class="d">Lo que queda para ti</div></div>
  </div>
  <div class="grid g-2">
    <div class="panel stack"><h3>¿Cuánto se va en productos de los servicios?</h3><div class="row" style="justify-content:space-between"><b class="num" style="font-size:1.6rem">${pct.toFixed(1)}%</b><span class="pill ${pct<=8?'p-ok':pct<=12?'p-warn':'p-bad'}">${pct<=8?'Bien':pct<=12?'Cuidado':'Alto'}</span></div>
      <div class="gauge"><i style="left:calc(${pos}% - 2px)"></i></div><div class="row small muted" style="justify-content:space-between"><span>0%</span><span>8%</span><span>12%</span><span>20%</span></div>
      <p class="small muted">En peluquerías lo normal es entre 5 y 8 % de lo que se cobra por servicios. Si pasa de 12 %, se está usando de más o los precios están bajos.</p></div>
    <div class="panel stack"><h3>Lista de compras</h3>${lista.map(p=>{ const falta=Math.max(p.contenido, p.stockMin*2-stockDe(p.id)); return `<div class="row" style="justify-content:space-between"><span>${esc(p.nombre)}</span><b>${Math.ceil(falta/p.contenido)} ${esc(p.envase||'envase')}${Math.ceil(falta/p.contenido)>1?'s':''}</b></div>`}).join('')||'<span class="muted">Nada por comprar.</span>'}</div>
  </div>
  <div class="grid g-2" style="margin-top:16px">
    <div class="panel"><h3 style="margin-bottom:8px">Servicios</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Servicio</th><th class="r">Veces</th><th class="r">Cobrado</th><th class="r">Productos</th><th class="r">Queda</th></tr></thead><tbody>
      ${tablaS.map(([n,o])=>`<tr><td>${esc(n)}</td><td class="r">${o.n}</td><td class="r">${$(o.i)}</td><td class="r">${$(o.c)}</td><td class="r"><b>${$(o.i-o.c)}</b></td></tr>`).join('')||'<tr><td colspan="5" class="muted">Sin servicios</td></tr>'}</tbody></table></div></div>
    <div class="panel"><h3 style="margin-bottom:8px">Productos vendidos</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="r">Unid.</th><th class="r">Cobrado</th><th class="r">Costo</th><th class="r">Ganancia</th></tr></thead><tbody>
      ${tablaP.map(([n,o])=>`<tr><td>${esc(n)}</td><td class="r">${o.n}</td><td class="r">${$(o.i)}</td><td class="r">${$(o.c)}</td><td class="r"><b>${$(o.i-o.c)}</b> <span class="muted small">${o.c?'+'+((o.i-o.c)/o.c*100).toFixed(0)+'% sobre costo':''}</span></td></tr>`).join('')||'<tr><td colspan="5" class="muted">Sin ventas de productos</td></tr>'}</tbody></table></div></div>
  </div>
  <div class="grid g-2" style="margin-top:16px">
    <div class="panel stack"><h3>Gastos</h3>${cats.map(([c,v])=>`<div><div class="row" style="justify-content:space-between"><span>${c}</span><b class="num">${$(v)}</b></div><div class="bar"><i style="width:${v/mx*100}%"></i></div></div>`).join('')||'<span class="muted">Sin gastos.</span>'}</div>
    <div class="panel stack"><h3>Dinero que salió en compras</h3><div class="kpi" style="border:0;padding:0"><div class="v">${$(R.compras)}</div><div class="d">Facturas de productos de este mes. Esto es dinero que salió; la ganancia de arriba cuenta solo lo que se usó.</div></div></div>
  </div>`;
}

/* ---------- AJUSTES ---------- */
let BORRAR='';
function vAjustes(){ const N=S.negocio;
  return `<div class="top"><div><h1>Ajustes</h1><div class="sub">Versión ${VERSION}</div></div></div>
  <div class="grid g-2">
    <div class="panel stack"><h3>Tu negocio</h3>
      <label class="f">Nombre<input class="in" id="aNom" data-bind="neg" data-k="nombre" value="${esc(N.nombre)}"></label>
      <label class="f">RUC<input class="in num" id="aRuc" data-bind="neg" data-k="ruc" value="${esc(N.ruc)}"></label>
      <label class="f">Régimen en el SRI<select class="in" id="aReg" data-bind="neg" data-k="regimen">${['','RIMPE negocio popular','RIMPE emprendedor','Régimen general','No sé'].map(o=>`<option ${N.regimen===o?'selected':''} value="${o}">${o||'Elegir…'}</option>`).join('')}</select></label>
      <label class="row" style="gap:10px;cursor:pointer"><input type="checkbox" id="aIva" data-bind="negIva" ${N.ivaCosto?'checked':''} style="width:24px;height:24px"><span><b>Sumar el IVA de las compras al costo</b><br><span class="small muted">Déjalo marcado si no recuperas el IVA en tus declaraciones (lo normal en RIMPE).</span></span></label>
      <label class="f">¿Cuántas semanas tarda tu proveedor en traer?<input class="in num" inputmode="decimal" id="aSem" data-bind="neg" data-k="semanasProveedor" value="${N.semanasProveedor}"></label>
    </div>
    <div class="panel stack"><h3>Cantidades según el largo</h3><p class="small muted">Cuánto más producto se usa comparado con cabello medio. Ej. 1.5 = 50 % más.</p>
      <div class="row">${LARGOS.map(([k,t])=>`<label class="f" style="width:110px">${t}<input class="in num" inputmode="decimal" id="lg_${k}" data-bind="largo" data-k="${k}" value="${N.largos[k]}" ${k==='medio'?'disabled':''}></label>`).join('')}</div></div>
    <div class="panel stack"><h3>Seguridad</h3>
      <p class="small muted">Con PIN, la app se bloquea sola tras 10 minutos sin uso. El PIN de ayudante solo deja cobrar y ver el inventario, sin costos ni ganancias.</p>
      <div class="row"><button class="btn" data-act="pin" data-r="duena">${S.pins.duena?'Cambiar mi PIN':'Poner mi PIN'}</button>${S.pins.duena?'<button class="btn" data-act="quitarPin" data-r="duena">Quitar PIN</button>':''}</div>
      <div class="row"><button class="btn" data-act="pin" data-r="ayudante" ${S.pins.duena?'':'disabled'}>${S.pins.ayudante?'Cambiar PIN de ayudante':'Crear PIN de ayudante'}</button>${S.pins.ayudante?'<button class="btn" data-act="quitarPin" data-r="ayudante">Quitar</button>':''}</div>
      ${S.pins.duena?'':'<span class="small muted">Primero pon tu PIN para poder crear el de ayudante.</span>'}</div>
    <div class="panel stack"><h3>Copia de seguridad</h3><p class="small muted">Descarga una copia cada semana y guárdala en tu Google Drive. Si la tablet se daña, la restauras en otra.</p>
      <div class="row"><button class="btn pri" data-act="descargarCopia">Descargar copia</button><label class="btn">Restaurar copia<input type="file" accept=".json,application/json" data-file="restaurar" hidden></label></div></div>
    <div class="panel stack"><h3>Mensaje de WhatsApp</h3><p class="small muted">Se completa solo con: {nombre} {servicio} {semanas} {negocio}</p>
      <textarea class="in" id="aWA" data-bind="neg" data-k="plantillaWA">${esc(N.plantillaWA||'')}</textarea>
      <div class="small"><span class="muted">Así se ve:</span> ${esc(mensajeWA({id:'_', nombre:'María López', telefono:''}))}</div></div>
    <div class="panel stack"><h3>Facturar desde la app</h3><p class="small muted">Próxima etapa: con tu firma electrónica, la app enviará la factura al SRI y al cliente con un botón, usando su propio punto de emisión (ej. 001-002) para no chocar con el Facturador del SRI. Mientras tanto, anota en Caja el número de la factura o nota de venta que emitas.</p></div>
    <div class="panel stack"><h3>Empezar con mis datos</h3><p class="small muted">Borra todo (ejemplo incluido) para empezar desde cero. Escribe BORRAR para confirmar.</p>
      <div class="row"><input class="in" style="flex:1;min-width:140px" id="aBorrar" data-bind="borrar" value="${esc(BORRAR)}" placeholder="BORRAR"><button class="btn bad" data-act="borrarTodo" ${BORRAR==='BORRAR'?'':'disabled'}>Borrar todo</button></div>
      ${S.demo?'':'<button class="btn sm" data-act="cargarEjemplo">Ver datos de ejemplo</button>'}</div>
  </div>
  <div class="panel" style="margin-top:16px"><h3 style="margin-bottom:8px">Historial de cambios</h3><div class="tbl-wrap"><table class="tbl"><tbody>${S.bitacora.slice(-25).reverse().map(b=>`<tr><td>${b.f.replace('T',' ')}</td><td>${b.rol==='duena'?'Dueña':'Ayudante'}</td><td>${esc(b.accion)}</td><td>${esc(b.detalle)}</td></tr>`).join('')||'<tr><td class="muted">Sin cambios registrados.</td></tr>'}</tbody></table></div></div>`;
}

/* ---------- Bloqueo con PIN ---------- */
let PINBUF='', PINMODO=null; // PINMODO: null = desbloquear; {rol, paso, primero}
function pintarLock(msg){
  const el=document.getElementById('lock'); const tit = PINMODO? (PINMODO.paso===1? 'Escribe el nuevo PIN ('+(PINMODO.rol==='duena'?'dueña':'ayudante')+')' : 'Repite el PIN') : esc(S.negocio.nombre);
  el.innerHTML=`<div style="text-align:center"><h2>${tit}</h2><p class="muted">${msg||(PINMODO?'4 a 6 números':'Escribe tu PIN')}</p><div class="dots">${[0,1,2,3,4,5].slice(0,Math.max(4,PINBUF.length)).map(i=>`<i class="${i<PINBUF.length?'f':''}"></i>`).join('')}</div>
    <div class="pad">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-act="pinKey" data-k="${n}">${n}</button>`).join('')}<button data-act="pinKey" data-k="del" aria-label="Borrar">⌫</button><button data-act="pinKey" data-k="0">0</button><button data-act="pinKey" data-k="ok" aria-label="Entrar">✓</button></div>
    ${PINMODO?'<button class="btn" style="margin-top:16px" data-act="pinCancelar">Cancelar</button>':''}</div>`;
  el.hidden=false;
}
async function pinOK(){
  if(PINBUF.length<4) return pintarLock('Mínimo 4 números');
  if(PINMODO){ if(PINMODO.paso===1){ PINMODO.primero=PINBUF; PINMODO.paso=2; PINBUF=''; return pintarLock(); }
    if(PINBUF!==PINMODO.primero){ PINMODO.paso=1; PINBUF=''; return pintarLock('No coincide. Empieza otra vez.'); }
    S.pins[PINMODO.rol]=await hashPIN(PINBUF); registrar('PIN', 'Se cambió el PIN de '+(PINMODO.rol==='duena'?'dueña':'ayudante')); await guardarYa(); PINMODO=null; PINBUF=''; document.getElementById('lock').hidden=true; render(); return toast('PIN guardado'); }
  const h=await hashPIN(PINBUF); PINBUF='';
  if(h===S.pins.duena) ROL='duena'; else if(S.pins.ayudante && h===S.pins.ayudante) ROL='ayudante'; else return pintarLock('PIN incorrecto');
  document.getElementById('lock').hidden=true; UI.vista=ROL==='ayudante'?'caja':'inicio'; render();
}
function bloquear(){ if(!S.pins.duena) return; PINMODO=null; PINBUF=''; cerrarHojaSilencio(); pintarLock(); }
function cerrarHojaSilencio(){ HOJA=null; document.getElementById('sheet').hidden=true; }
let _idle=null; function tocarActividad(){ clearTimeout(_idle); if(S&&S.pins.duena) _idle=setTimeout(bloquear, 10*60*1000); }

/* ===== Eventos e inicio ===== */
const ACT = {
  ir:d=>ir(d.v), cerrarHoja:()=>cerrarHoja(), bloquear:()=>bloquear(),
  confirmaSi:()=>{ const f=CONFIRMA; CONFIRMA=null; f&&f(); },
  // caja
  cajaTab:d=>{UI.cajaTab=d.t; render();}, catServ:d=>{UI.catServ=d.c; render();},
  addServ:d=>{ const r=receta(d.id); if(r.porLargo) hojaLargo(r); else addServicio(r); },
  elegirLargo:d=>{ cerrarHojaSilencio(); addServicio(receta(d.id), d.l); },
  addProd:d=>{ const p=prod(d.id); const ex=UI.ticket.items.find(i=>i.k==='p'&&i.pid===p.id);
    if(ex){ ex.cant++; ex.precio=r2(p.precioVenta*ex.cant); } else UI.ticket.items.push({k:'p', pid:p.id, nombre:p.nombre, cant:1, precio:p.precioVenta});
    if(stockDe(p.id) < (ex?ex.cant:1)*p.contenido) toast('Ojo: en el sistema no queda suficiente '+p.nombre); render(); },
  quitarTicket:d=>{ UI.ticket.items.splice(+d.ix,1); render(); },
  tkPago:d=>{ UI.ticket.pago=d.p; render(); }, tkComp:d=>{ UI.ticket.comp=d.c; render(); },
  ajustarUso:d=>hojaAjuste(+d.ix),
  guardarAjuste:()=>{ const it=UI.ticket.items[AJUSTE.ix]; it.usos=AJUSTE.usos.map(u=>({pid:u.pid,q:Math.max(0,+u.q||0)})); it.ajustado=true; it.nota=AJUSTE.nota.trim(); cerrarHoja(); },
  ajAdd:d=>{ const p=prod(d.id); AJUSTE.usos.push({pid:p.id, q:p.unidad==='u'?1:10}); AJUSTE.pick=''; pintarHoja(); },
  // clientes
  nuevoCliente:()=>hojaCliente(null), verCliente:d=>hojaCliente(d.id), guardarCliente:()=>guardarCliente(),
  borrarCliente:()=>{ const c=cliente(EDCL.id); confirmar('Eliminar cliente', `Se borrará a <b>${esc(c.nombre)}</b>.`, 'Eliminar', ()=>{ S.clientes=S.clientes.filter(x=>x.id!==c.id); guardar(); cerrarHoja(); }); },
  repetirVisita:d=>repetirVisita(d.id),
  recordado:d=>{ const c=cliente(d.id); c.recordado=hoyISO(); guardar(); setTimeout(()=>{ if(HOJA) pintarHoja(); else render(); }, 300); },
  posponer:d=>{ const c=cliente(d.id); c.recordado=hoyISO(); guardar(); render(); toast('Listo, no aparece hasta su próxima visita'); },
  elegirCliente:d=>{ elegirClienteCaja(d.id); render(); },
  quitarClienteCaja:()=>{ UI.ticket.clienteId=null; UI.ticket.cliente=''; render(); },
  nuevoClienteCaja:()=>hojaCliente(null, true),
  cobrar:()=>cobrar(), verCuenta:()=>document.getElementById('cuenta').scrollIntoView({behavior:'smooth'}), anularVenta:d=>anularVenta(d.id),
  step:d=>{ const g=d.g, i=+d.i, dl=+d.d; const ref = g==='aj'? AJUSTE.usos[i] : g==='rec'? EDR.items[i] : EDS;
    const key = g==='salida'? 'q' : 'q'; ref[key]=Math.max(0, r3((+ref[key]||0)+dl)); pintarHoja(); },
  // inventario
  filtroInv:d=>{UI.filtroInv=d.f; render();}, verProducto:d=>hojaProducto(d.id), nuevoProducto:()=>hojaProducto(null),
  edpTipo:d=>{ EDP.tipo=d.t; pintarHoja(); }, guardarProducto:()=>guardarProducto(),
  borrarProducto:()=>{ const p=prod(EDP.id); if(S.recetas.some(r=>r.items.some(i=>i.pid===p.id))) return toast('Está en una receta. Quítalo de la receta primero.');
    S.productos=S.productos.filter(x=>x.id!==p.id); guardar(); cerrarHoja(); toast('Producto eliminado'); },
  desactivarProducto:()=>{ const p=prod(EDP.id); confirmar('Ya no lo uso', `<b>${esc(p.nombre)}</b> dejará de aparecer en el inventario y en la caja. Su historial se guarda.`, 'Ocultar producto', ()=>{ p.inactivo=true; registrar('Ocultó producto',p.nombre); guardar(); cerrarHoja(); }); },
  hojaStock:d=>hojaStock(d.id), guardarStock:()=>guardarStock(), hojaSalida:d=>hojaSalida(d.id), edsMotivo:d=>{EDS.motivo=d.m; pintarHoja();}, guardarSalida:()=>guardarSalida(),
  hojaContar:d=>hojaContar(d.id), guardarConteo:()=>guardarConteo(), conteo:()=>hojaConteo(),
  guardarConteoTodo:()=>{ let n=0; for(const id in CONTEO){ const v=CONTEO[id]; if(v===''||v==null) continue; const p=prod(id); aplicarConteo(id, (+v||0)*p.contenido); n++; } guardar(); cerrarHoja(); toast(n+' productos contados'); },
  // recetas
  nuevaReceta:()=>hojaReceta(null), editarReceta:d=>hojaReceta(d.id), edrCat:d=>{EDR.categoria=d.c; pintarHoja();},
  addIng:d=>{ const p=prod(d.id); const q = p.unidad==='u' ? 1 : Math.max(5, Math.round(p.contenido*(p.contenido>=500?.05:.5)/5)*5); EDR.items.push({pid:p.id, q, fijo:p.unidad==='u'}); PICK=''; pintarHoja(); },
  quitarIng:d=>{ EDR.items.splice(+d.i,1); pintarHoja(); }, usarReal:d=>{ EDR.items[+d.i].q=+d.q; pintarHoja(); },
  guardarReceta:()=>guardarReceta(),
  duplicarReceta:()=>{ EDR.id=null; EDR.nombre=EDR.nombre+' (copia)'; HOJA.titulo='Nueva receta'; pintarHoja(); toast('Copia lista: cambia lo necesario y guarda'); },
  borrarReceta:()=>{ const r=receta(EDR.id); confirmar('Quitar receta', `El servicio <b>${esc(r.nombre)}</b> ya no aparecerá en la caja. Los cobros anteriores se mantienen.`, 'Quitar', ()=>{ r.activo=false; registrar('Quitó receta',r.nombre); guardar(); cerrarHoja(); }); },
  // compras
  subirFactura:()=>hojaSubir(), compraManual:()=>nuevaCompra({fuente:'manual', lineas:[{desc:'', manual:true, pid:null, factor:1, envases:1, regalo:0, costo:0}]}),
  claveManual:()=>{ const v=document.getElementById('claveManual').value; compraDesdeClave(v, null); },
  verCompra:d=>verCompra(d.id),
  lineaManual:()=>{ EDC.lineas.push({desc:'', manual:true, pid:null, factor:1, envases:1, regalo:0, costo:0}); pintarHoja(); },
  quitarLinea:d=>{ EDC.lineas.splice(+d.i,1); pintarHoja(); },
  linElegir:d=>{ const l=EDC.lineas[+d.i]; l.pick=!l.pick; l.pickQ=''; pintarHoja(); },
  linSet:d=>{ const l=EDC.lineas[+d.i]; l.pid=d.id; l.pick=false; l.gasto=false; pintarHoja(); },
  linGasto:d=>{ const l=EDC.lineas[+d.i]; l.gasto=!l.gasto; l.cat=l.cat||'Otros'; l.pick=false; pintarHoja(); },
  linNuevo:d=>{ const i=+d.i, l=EDC.lineas[i]; const g=l.guess||adivinarUnidad(l.desc); const compraGuardada=EDC, tit=HOJA.titulo, fn=HOJA.fnCuerpo;
    EDP={id:null, nombre:limpiarNombre(l.desc), marca:'', tono:(l.desc.match(/\b\d{1,2}[.,/]\d{1,2}\b/)||[''])[0].replace(',','.'), tipo:'servicio', unidad:g.unidad, contenido:g.contenido, envase:g.envase, stockMin:0, precioVenta:0, foto:null, _minEnv:0};
    abrirHoja('Nuevo producto (de la factura)', cuerpoProducto, {alGuardar:(pid)=>{ EDC=compraGuardada; EDC.lineas[i].pid=pid; HOJA={titulo:tit, fnCuerpo:fn, opts:{}}; pintarHoja(); }}); },
  guardarCompra:()=>guardarCompra(),
  // gastos
  nuevoGasto:()=>hojaGasto(), edgCat:d=>{ EDG.cat=d.c; pintarHoja(); },
  guardarGasto:()=>{ if(!EDG.cat) return toast('Elige qué pagaste'); if(!(+EDG.valor>0)) return toast('Escribe el valor');
    S.gastos.push({id:uid('G'), fecha:EDG.fecha, cat:EDG.cat, desc:EDG.desc.trim(), valor:r2(+EDG.valor), prov:EDG.prov.trim(), foto:EDG.foto, anulado:false}); guardar(); cerrarHoja(); toast('Gasto guardado'); },
  anularGasto:d=>{ const g=S.gastos.find(x=>x.id===d.id); confirmar('Anular gasto', `Se anulará <b>${esc(g.desc||g.cat)}</b> por ${$(g.valor)}.`, 'Sí, anular', ()=>{ g.anulado=true; registrar('Anuló gasto', g.cat+' '+$(g.valor)); guardar(); cerrarHoja(); }); },
  mes:d=>{ const [y,m]=UI[d.k].split('-').map(Number); const dt=new Date(y, m-1+(+d.d), 1); UI[d.k]=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0'); render(); },
  // ajustes
  pin:d=>{ PINMODO={rol:d.r, paso:1}; PINBUF=''; pintarLock(); },
  quitarPin:d=>{ confirmar('Quitar PIN', d.r==='duena'?'La app quedará sin protección y también se quitará el PIN de ayudante.':'Se quitará el PIN de ayudante.', 'Quitar', ()=>{ S.pins[d.r]=null; if(d.r==='duena') S.pins.ayudante=null; registrar('PIN','Quitó PIN de '+d.r); guardar(); cerrarHoja(); }); },
  pinKey:d=>{ if(d.k==='del') PINBUF=PINBUF.slice(0,-1); else if(d.k==='ok') return pinOK(); else if(PINBUF.length<6) PINBUF+=d.k; pintarLock(); if(!PINMODO && PINBUF.length>=4) autoPin(); },
  pinCancelar:()=>{ PINMODO=null; PINBUF=''; document.getElementById('lock').hidden=true; },
  descargarCopia:()=>descargarCopia(),
  borrarTodo:()=>{ if(BORRAR!=='BORRAR') return; const pins=S.pins; S=estadoVacio(); migrar(); S.pins=pins; BORRAR=''; IDB.todas('fotos').then(f=>Object.keys(f).forEach(k=>IDB.del('fotos',k))); guardar(); UI.vista='inicio'; render(); toast('Listo. Empieza agregando tus productos en Inventario.'); },
  cargarEjemplo:()=>{ const pins=S.pins; cargarEjemplo(); S.pins=pins; guardar(); UI.vista='inicio'; render(); }
};
let _autoT=null; function autoPin(){ clearTimeout(_autoT); _autoT=setTimeout(async()=>{ if(PINMODO||PINBUF.length<4) return; const h=await hashPIN(PINBUF); if(h===S.pins.duena||(S.pins.ayudante&&h===S.pins.ayudante)) pinOK(); }, 150); }
function limpiarNombre(d){ return String(d||'').replace(/\s+/g,' ').trim().toLowerCase().replace(/(^|\s)\S/g, s=>s.toUpperCase()); }

document.addEventListener('click', e=>{
  tocarActividad();
  const b=e.target.closest('[data-act]'); if(!b || b.disabled) return;
  const f=ACT[b.dataset.act]; if(f){ if(b.tagName!=='A') e.preventDefault(); f(b.dataset, b); }
});
document.getElementById('sheet').addEventListener('click', e=>{ if(e.target.id==='sheet') cerrarHoja(); });
document.addEventListener('keydown', e=>{ tocarActividad(); if(e.key==='Escape' && HOJA) cerrarHoja();
  if(!document.getElementById('lock').hidden){ if(/^\d$/.test(e.key)) ACT.pinKey({k:e.key}); if(e.key==='Backspace') ACT.pinKey({k:'del'}); if(e.key==='Enter') ACT.pinKey({k:'ok'}); } });

/* Campos: se guardan al escribir; solo se repinta lo que cambia de cálculo */
document.addEventListener('input', e=>{
  const el=e.target, d=el.dataset, b=d.bind; if(!b) return; tocarActividad();
  const v = el.type==='checkbox' ? el.checked : el.value;
  const repintar=(fn)=>{ const id=el.id, pos=el.selectionStart; fn(); if(id){ const n=document.getElementById(id); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos);}catch(_){} } } };
  switch(b){
    case 'buscaCaja': UI.buscaCaja=v; repintar(render); break;
    case 'buscaInv': UI.buscaInv=v; repintar(render); break;
    case 'precioTicket': UI.ticket.items[+d.ix].precio=+v||0; { const t=UI.ticket.items.reduce((a,i)=>a+(+i.precio||0),0); document.querySelector('.ticket .tot').textContent=$(t); document.querySelector('[data-act="cobrar"]').textContent='Cobrar '+$(t); } break;
    case 'tk': UI.ticket[d.k]=v; break;
    case 'tkCli': UI.ticket.buscaCli=v; repintar(render); break;
    case 'buscaCli': UI.buscaCli=v; repintar(render); break;
    case 'edcl': EDCL[d.k]=v; break;
    case 'ajNota': AJUSTE.nota=v; break;
    case 'ajPick': AJUSTE.pick=v; repintar(pintarHoja); break;
    case 'tkAyuda': UI.ticket.ayuda=v; render(); break;
    case 'step': { const g=d.g, i=+d.i; const ref = g==='aj'? AJUSTE.usos[i] : g==='rec'? EDR.items[i] : EDS; ref.q=+v||0; if(g==='rec') repintar(pintarHoja); } break;
    case 'edp': EDP[d.k]=v; if(d.k==='nombre'||d.k==='unidad') {} break;
    case 'eds': EDS[d.k]=v; if(['env','costo','regalo'].includes(d.k)) repintar(pintarHoja); break;
    case 'edsPromo': EDS.promo=v; break;
    case 'conteo': CONTEO[d.id]=v; break;
    case 'edr': EDR[d.k]= d.k==='precio'? v : v; if(d.k==='precio') repintar(pintarHoja); break;
    case 'edrLargo': EDR.porLargo=v; if(v && !EDR.precios.medio) EDR.precios={corto:+EDR.precio||0,medio:+EDR.precio||0,largo:+EDR.precio||0,extra:+EDR.precio||0}; pintarHoja(); break;
    case 'edrFijo': EDR.items[+d.i].fijo=v; pintarHoja(); break;
    case 'edrPrecio': EDR.precios[d.k]=v; EDR._toc=EDR._toc||{}; EDR._toc[d.k]=true;
      if(d.k==='medio') for(const [k] of LARGOS) if(k!=='medio' && !EDR._toc[k] && !(+EDR.precios[k]>0 && EDR.id)) EDR.precios[k]=Math.round((+v||0)*S.negocio.largos[k]);
      repintar(pintarHoja); break;
    case 'pick': PICK=v; repintar(pintarHoja); break;
    case 'edc': EDC[d.k]=v; if(d.k==='total') repintar(pintarHoja); break;
    case 'lin': EDC.lineas[+d.i][d.k]=v; if(['envases','regalo','factor','costo'].includes(d.k)) repintar(pintarHoja); break;
    case 'linPick': EDC.lineas[+d.i].pickQ=v; repintar(pintarHoja); break;
    case 'edg': EDG[d.k]=v; break;
    case 'neg': S.negocio[d.k]= d.k==='semanasProveedor'? (+v||1) : v; guardar(); if(d.k==='nombre') { document.querySelector('.rail .marca').textContent=v; } break;
    case 'negIva': S.negocio.ivaCosto=v; guardar(); break;
    case 'largo': S.negocio.largos[d.k]=+v||1; guardar(); break;
    case 'borrar': BORRAR=v.trim().toUpperCase(); repintar(render); break;
  }
});
document.addEventListener('change', async e=>{
  const el=e.target, tipo=el.dataset.file; if(!tipo || !el.files || !el.files.length) return;
  const files=[...el.files]; el.value='';
  try{
    if(tipo==='fotoProducto'){ EDP.foto=await guardarFoto(await comprimirImagen(files[0])); pintarHoja(); }
    else if(tipo==='fotoReceta'){ EDR.foto=await guardarFoto(await comprimirImagen(files[0])); pintarHoja(); }
    else if(tipo==='fotoGasto'){ EDG.foto=await guardarFoto(await comprimirImagen(files[0],1400,.7)); pintarHoja(); }
    else if(tipo==='xml'){ const textos=await Promise.all(files.map(f=>f.text().then(t=>[f.name,t]))); importarXML(textos); }
    else if(tipo==='codigo'){ toast('Buscando el código…'); const clave=await leerCodigoDeFoto(files[0]); const foto=await guardarFoto(await comprimirImagen(files[0],1400,.7));
      if(clave) compraDesdeClave(clave, foto);
      else { toast('No pude leer el código. Escribe los 49 números o toma la foto más cerca.'); nuevaCompra({fuente:'foto', foto, lineas:[{desc:'', manual:true, pid:null, factor:1, envases:1, regalo:0, costo:0}]}); } }
    else if(tipo==='fotoNota'){ const foto=await guardarFoto(await comprimirImagen(files[0],1400,.7)); nuevaCompra({fuente:'foto', foto, lineas:[{desc:'', manual:true, pid:null, factor:1, envases:1, regalo:0, costo:0}]}); }
    else if(tipo==='restaurar'){ const t=await files[0].text(); const o=JSON.parse(t); if(!o.estado||!o.estado.productos) throw new Error('Ese archivo no es una copia de esta app');
      S=o.estado; migrar(); for(const k in (o.fotos||{})){ FOTOS[k]=o.fotos[k]; await IDB.put('fotos',k,o.fotos[k]); } guardar(); render(); toast('Copia restaurada'); }
  }catch(err){ toast(typeof err==='string'? err : (err.message||'No se pudo leer el archivo')); }
});
function descargarCopia(){
  const datos=JSON.stringify({app:'salon-al-dia', fecha:ahoraISO(), estado:S, fotos:FOTOS});
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([datos],{type:'application/json'})); a.download='copia-salon-'+hoyISO()+'.json'; document.body.appendChild(a); a.click(); a.remove();
  toast('Copia descargada. Guárdala en tu Google Drive.');
}

async function iniciar(){
  await IDB.abrir();
  let txt=null; try{ txt=await IDB.get('kv','estado'); }catch(e){}
  if(txt){ try{ S=JSON.parse(txt); }catch(e){ S=null; } }
  if(!S){ cargarEjemplo(); guardar(); }
  migrar();
  Object.assign(FOTOS, await IDB.todas('fotos'));
  try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){}
  if(S.pins.duena) pintarLock(); render(); tocarActividad();
}
iniciar();

if('serviceWorker' in navigator && location.protocol==='https:'){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
