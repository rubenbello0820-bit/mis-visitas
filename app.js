/* Mis Visitas — app personal offline-first.
   Todo se guarda primero en el teléfono (IndexedDB) y después se sincroniza con Google Sheets. */
'use strict';

// ---------- Constantes ----------
const ON_CANALES = ['Night', 'HORECA', 'Eventos'];
const CIUDAD_DEF = 'Santa Cruz';
// Campos de ejecución según segmento (igual que tu Sheet)
const EJEC = {
  ON: [['barra', 'Exhibición en barra'], ['menu', 'Menú'], ['rrss', 'RRSS'], ['imagen', 'Implementación imagen'], ['activacion', 'Activación'], ['capacitacion', 'Capacitación FBD']],
  OFF: [['mueble', 'Mueble de piso'], ['letrero', 'Letrero exterior'], ['pop', 'Material POP'], ['degustacion', 'Degustación']],
};
const PORTA = ['Fernet Branca', 'Branca Menta', 'Sernova', 'Carpano', 'Borghetti', 'Punt e Mes'];
const RELAC = {
  ON: ['Dueños / Administradores', 'Staff (barstaff, meseros, guardias)', 'Comercial OFF-ON'],
  OFF: ['Reponedores / promotores PDV', 'Cliente / encargado', 'Distribución de exhibidores'],
};
const MARCAS_FOCO = ['Fernet Branca', 'Branca Menta', 'Carpano', 'Sernova', 'Borghetti', 'Punt e Mes'];
// KPI 4PM = visita ON con Exhibición en barra + Menú + Implementación imagen en SI (tu regla del Panel KPI)
const es4PM = (v) => v.seg === 'ON' && v.ejec?.barra === 'SI' && v.ejec?.menu === 'SI' && v.ejec?.imagen === 'SI';
const PRECIOS_BOT = [
  { k: 'f750', t: 'Fernet 750' }, { k: 'f1000', t: 'Fernet 1000' },
  { k: 'carpano', t: 'Carpano' }, { k: 'sernova', t: 'Sernova' },
];
const PRECIOS_VASO = [
  { k: 'v_fernet', t: 'Vaso Fernet' }, { k: 'v_carpano', t: 'Vaso Carpano' }, { k: 'v_sernova', t: 'Vaso Sernova' },
];
// Botones rápidos: las marcas que más aparecen en tu histórico
const COMPETENCIA = ['Buhero', 'Buhero Madero', 'Casa Real Etiqueta Negra', 'Ron Abuelo', 'Havana Club Reserva', 'Havana Club Especial',
  'Flor de Caña 4 años', 'Flor de Caña 5 años', '37 Lenguas', 'Fernet 1882', 'Fernet Capri', 'Fernet Rosemberg', 'Sky Vodka',
  'Stolichnaya', 'Cinzano', 'Martini Bianco'];
const RONES = ['havana', 'flor de cana', 'abuelo', 'bacardi', 'ron '];
const esRon = (m) => { const n = norm(m) + ' '; return RONES.some((r) => n.includes(r)) || n.startsWith('ron'); };
const CFG_DEF = {
  url: '',
  metas: { on: 40, off: 140, pareto: 20, k4pm: 40 },
  com: { basico: 4500, variable: 1125, w_on: 25, w_off: 25, w_pareto: 25, w_k4pm: 25, minimo: 0, tope: 100, tc: 6.96 },
};

// ---------- Utilidades ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const hoy = () => { const d = new Date(); return ymd(d); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtF = (s) => s ? s.split('-').reverse().join('/') : '';
const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const bs = (n) => 'Bs ' + (Math.round((n || 0) * 100) / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (isFinite(n) ? Math.round(n * 1000) / 10 : 0) + '%';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms = 2500) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
function lunes(fechaStr) { const [y, m, d] = fechaStr.split('-').map(Number); const dt = new Date(y, m - 1, d); const w = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - w); return ymd(dt); }

// ---------- Base local (IndexedDB) ----------
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('misvisitas', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('visitas', { keyPath: 'id' });
      d.createObjectStore('fotos', { keyPath: 'id' });
      d.createObjectStore('kv');
    };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode); const s = t.objectStore(store); let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbAll = (store) => tx(store, 'readonly', (s) => reqP(s.getAll()));
const dbPut = (store, v, k) => tx(store, 'readwrite', (s) => reqP(k === undefined ? s.put(v) : s.put(v, k)));
const dbGet = (store, k) => tx(store, 'readonly', (s) => reqP(s.get(k)));

// ---------- Estado ----------
let CFG = structuredClone(CFG_DEF);
let BASE = { version: '', rows: [] };   // clientes
let byCode = new Map();
let VISITAS = [];                        // en memoria (sin fotos)
let form = null;                         // visita en edición

function setBase(b) {
  BASE = b; byCode = new Map();
  const c = b.cols;
  BASE.list = b.rows.map((r) => { const o = {}; c.forEach((k, i) => (o[k] = r[i])); o.busq = norm(o.nombre + ' ' + o.razon + ' ' + o.codigo); byCode.set(o.codigo, o); return o; });
}
function cliDe(v) { return v.codigo ? byCode.get(String(v.codigo).toUpperCase().trim()) : null; }
// Pareto SIEMPRE desde la base de ventas vigente (no se confía en el dato viejo)
function paretoDe(v) { const c = cliDe(v); return c ? { es: !!c.pareto, pos: c.pos, total: c.ptotal, canal: c.canal, ciudad: c.ciudad } : { es: false }; }
function ciudadDe(v) { const c = cliDe(v); return c ? c.ciudad : v.ciudad; }
function canalDe(v) { const c = cliDe(v); return c ? c.canal : v.canal; }
const segDeCanal = (canal) => (ON_CANALES.includes(canal) ? 'ON' : 'OFF');
function etiquetaPareto(c) { return c.pareto ? `Pareto #${c.pos} de ${c.canal} ${c.ciudad}` : 'No Pareto'; }

// ---------- Inicio ----------
async function init() {
  await openDB();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const cfg = await dbGet('kv', 'config'); if (cfg) CFG = { ...CFG_DEF, ...cfg, metas: { ...CFG_DEF.metas, ...cfg.metas }, com: { ...CFG_DEF.com, ...cfg.com } };
  let base = await dbGet('kv', 'base');
  if (!base) base = { cols: [], rows: [] }; // la base de ventas NO se publica: se sube desde Ajustes (queda solo en el teléfono)
  setBase(base);
  VISITAS = await dbAll('visitas');
  await importarHistoricoSiHay();
  llenarSelects(); bindUI(); renderBusqueda(); renderSync();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('online', () => sincronizar());
  setInterval(() => sincronizar(true), 60000);
  if (CFG.url && !VISITAS.length) recuperar(); // celular nuevo: trae todo de tu Sheet
  sincronizar(true);
}

// Histórico migrado (historico.json se agrega en la Parte 2). Se importa una sola vez, sin duplicar.
async function importarHistoricoSiHay() {
  if (await dbGet('kv', 'historico_ok')) return;
  try {
    const r = await fetch('historico.json', { cache: 'no-store' }); if (!r.ok) return;
    const h = await r.json(); const ids = new Set(VISITAS.map((v) => v.id));
    for (const v of h.visitas) if (!ids.has(v.id)) { v.synced = false; await dbPut('visitas', v); }
    await dbPut('kv', true, 'historico_ok'); VISITAS = await dbAll('visitas');
    toast(`Histórico importado: ${h.visitas.length} visitas`);
  } catch (e) { /* sin histórico todavía */ }
}

function opciones(sel, vals, todos) { sel.innerHTML = (todos ? `<option value="">${todos}</option>` : '') + vals.map((v) => `<option>${esc(v)}</option>`).join(''); }
function llenarSelects() {
  const ciudades = [...new Set(BASE.list.map((c) => c.ciudad))].sort();
  const canales = [...new Set(BASE.list.map((c) => c.canal))].sort();
  opciones($('#fCiudad'), ciudades, 'Todas las ciudades'); $('#fCiudad').value = CIUDAD_DEF;
  opciones($('#fCanal'), canales, 'Todos los canales');
  opciones($('#nCiudad'), ciudades); $('#nCiudad').value = CIUDAD_DEF;
  opciones($('#nCanal'), canales);
  opciones($('#hCiudad'), ciudades, 'Todas las ciudades');
  opciones($('#pCiudad'), ciudades, 'Todas las ciudades');
  const mes = hoy().slice(0, 7); $('#hMes').value = mes; $('#pMes').value = mes;
  $('#baseInfo').textContent = `Base: ${BASE.version || '-'} · ${BASE.list.length} clientes · ${BASE.list.filter((c) => c.pareto).length} Pareto`;
}

// ---------- Navegación ----------
function ir(v) {
  $$('.view').forEach((x) => x.classList.remove('active')); $('#v-' + v).classList.add('active');
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  window.scrollTo(0, 0);
  if (v === 'historial') renderHistorial();
  if (v === 'panel') renderPanel();
  if (v === 'ajustes') renderAjustes();
}

function bindUI() {
  $$('#tabs button').forEach((b) => (b.onclick = () => ir(b.dataset.v)));
  ['#q', '#fCiudad', '#fCanal', '#fPareto'].forEach((s) => $(s).addEventListener('input', renderBusqueda));
  $('#btnNuevo').onclick = () => abrirVisita(null);
  $('#btnCancelar').onclick = () => { form = null; ir('registrar'); };
  $('#btnGuardar').onclick = guardarVisita;
  $$('#segBtns button').forEach((b) => (b.onclick = () => { form.seg = b.dataset.v; renderForm(); }));
  $('#fotoIn').onchange = agregarFoto;
  $('#compAdd').onclick = () => { const m = $('#compOtra').value.trim(); if (m) { toggleComp(m, true); $('#compOtra').value = ''; } };
  ['#hMes', '#hCiudad'].forEach((s) => $(s).addEventListener('input', renderHistorial));
  ['#pMes', '#pCiudad', '#prVista', '#prCanal'].forEach((s) => $(s).addEventListener('input', renderPanel));
  $('#btnSync').onclick = () => sincronizar(false);
  $('#btnRestore').onclick = recuperar;
  $('#cfgUrl').onchange = async () => { CFG.url = $('#cfgUrl').value.trim(); await guardarCfg(); if (!VISITAS.length) await recuperar(); sincronizar(false); };
  $('#baseIn').onchange = subirBase;
  $('#btnBackup').onclick = descargarRespaldo;
  $('#backupIn').onchange = cargarRespaldo;
  $('#btnReporte').onclick = reporteMensual;
}
async function guardarCfg() { await dbPut('kv', CFG, 'config'); }

// ---------- Buscador ----------
function renderBusqueda() {
  const q = norm($('#q').value), fc = $('#fCiudad').value, fca = $('#fCanal').value, fp = $('#fPareto').value;
  const box = $('#resultados');
  // Agregar por código: si escribe un código exacto, lo trae directo
  const exacto = byCode.get($('#q').value.trim().toUpperCase());
  let l = BASE.list.filter((c) => (!fc || c.ciudad === fc) && (!fca || c.canal === fca) && (fp !== 'P' && fp !== 'T' || c.pareto) && (fp !== 'N' || !c.pareto));
  if (q.length >= 2) { const parts = q.split(/\s+/); l = l.filter((c) => parts.every((p) => c.busq.includes(p))); }
  else if (!fp && !fca) { l = []; }
  l.sort(fp === 'T' ? (a, b) => b.c9l - a.c9l : (a, b) => (b.pareto - a.pareto) || (a.pos - b.pos));
  if (exacto && !l.includes(exacto)) l.unshift(exacto);
  const ult = ultimaPorCodigo();
  box.innerHTML = l.slice(0, 60).map((c) => {
    const u = ult.get(c.codigo);
    return `<div class="item" data-c="${esc(c.codigo)}"><b>${esc(c.nombre)}</b>
      <div class="meta">${esc(c.codigo)} · ${esc(c.canal)} · ${esc(c.ciudad)} · ${esc(c.vendedor)}</div>
      <span class="tag ${c.pareto ? 'p' : ''}">${esc(etiquetaPareto(c))}</span>
      ${u ? `<span class="tag">Última visita ${fmtF(u.fecha)}</span>` : ''}</div>`;
  }).join('') || (!BASE.list.length ? '<div class="card"><b>Primer paso:</b> sube tu Export de ventas en ⚙️ Ajustes → Base de ventas. Se calcula tu Pareto en el teléfono.</div>' : q.length >= 2 ? '<p class="note">Sin resultados. Si es un cliente nuevo, usa el botón de abajo.</p>' : '<p class="note">Escribe 2-3 letras del nombre o pega el código del cliente.</p>');
  box.querySelectorAll('.item').forEach((el) => (el.onclick = () => abrirVisita(byCode.get(el.dataset.c))));
}
function ultimaPorCodigo() {
  const m = new Map();
  for (const v of VISITAS) if (!v.deleted && v.codigo) { const p = m.get(v.codigo); if (!p || v.fecha > p.fecha || (v.fecha === p.fecha && v.createdAt > p.createdAt)) m.set(v.codigo, v); }
  return m;
}

// ---------- Formulario de visita ----------
function visitaVacia() {
  return { id: uid(), fecha: hoy(), codigo: '', cliente: '', canal: '', ciudad: '', seg: 'ON', ejec: {}, porta: {},
    precios: {}, comp: [], fotos: [], det: {}, nuevo: false, createdAt: Date.now(), updatedAt: Date.now(), synced: false };
}
function abrirVisita(cli, existente) {
  if (existente) { form = structuredClone(existente); form.porta = form.porta || {}; form.det = form.det || {}; form.ejec = form.ejec || {}; form._edit = true; }
  else {
    form = visitaVacia();
    if (cli) {
      form.codigo = cli.codigo; form.cliente = cli.nombre; form.canal = cli.canal; form.ciudad = cli.ciudad; form.seg = segDeCanal(cli.canal);
      const u = ultimaPorCodigo().get(cli.codigo);
      if (u) { // Autocompletar con la última visita
        form.seg = u.seg || form.seg; form.ejec = { ...u.ejec }; form.porta = { ...u.porta };
        form.precios = { ...u.precios }; form.comp = structuredClone(u.comp || []); form.det = { ...u.det, observaciones: '', reporte_stock: '' };
        form._prefill = u.fecha;
      }
    } else form.nuevo = true;
  }
  ir('visita'); renderForm();
}
function chips(lista, sel, campo) {
  const s = new Set(String(sel || '').split(',').map((x) => x.trim()).filter(Boolean));
  return `<div class="comp-btns">${[...new Set([...lista, ...s])].map((m) => `<button type="button" data-chip="${campo}" data-m="${esc(m)}" class="${s.has(m) ? 'on' : ''}">${esc(m)}</button>`).join('')}</div>`;
}
function renderForm() {
  const f = form, c = cliDe(f), on = f.seg === 'ON';
  $('#cliCard').innerHTML = f.nuevo && !c ? '<b>Cliente nuevo</b><div class="meta note">No está en la base de ventas: cuenta como No Pareto.</div>'
    : `<b>${esc(f.cliente)}</b><div class="note">${esc(f.codigo)} · ${esc(c?.canal || f.canal)} · ${esc(c?.ciudad || f.ciudad)} · ${esc(c?.vendedor || '')}</div>
       ${c ? `<span class="tag ${c.pareto ? 'p' : ''}">${esc(etiquetaPareto(c))}</span><span class="tag">C9L ${c.c9l.toFixed(2)}</span>${(c.marcas || []).map((m) => `<span class="tag ok">${esc(m)}</span>`).join('')}` : '<span class="tag">Sin ventas 2026 en la base: No Pareto</span>'}`;
  $('#nuevoBox').classList.toggle('hidden', !(f.nuevo && !c));
  if (f.nuevo) { $('#nNombre').value = f.cliente || ''; if (f.ciudad) $('#nCiudad').value = f.ciudad; if (f.canal) $('#nCanal').value = f.canal; }
  $('#fFecha').value = f.fecha;
  $$('#segBtns button').forEach((b) => b.classList.toggle('on', b.dataset.v === f.seg));
  $('#prefillNote').classList.toggle('hidden', !f._prefill);
  if (f._prefill) $('#prefillNote').textContent = `Datos traídos de tu visita del ${fmtF(f._prefill)}. Cambia solo lo diferente.`;
  // Ejecución SI/NO (cambia según ON/OFF)
  const filas = EJEC[f.seg].map(([k, t]) => yn(t, f.ejec[k], `ejec.${k}`));
  if (on) filas.push(`<div class="note">${es4PM(f) ? '✅ Esta visita suma al KPI 4PM (barra + menú + imagen)' : 'KPI 4PM: necesita barra, menú e imagen en SI'}</div>`);
  const porta = `<div class="lbl" style="margin-top:10px">Portafolio presente</div>` + PORTA.map((m) => yn(m, f.porta[m], `porta.${m}`, true)).join('');
  $('#ejec').innerHTML = filas.join('') + (on ? '' : porta);
  // Precios
  const precios = on ? [...PRECIOS_BOT, ...PRECIOS_VASO] : PRECIOS_BOT;
  $('#precios').innerHTML = precios.map((p) => `<label>${p.t}<input inputmode="decimal" type="number" step="0.5" data-p="${p.k}" value="${f.precios[p.k] ?? ''}"></label>`).join('');
  $$('#precios input').forEach((i) => (i.oninput = () => { f.precios[i.dataset.p] = num(i.value); }));
  // Fotos
  $('#fotoPrev').innerHTML = f.fotos.map((x, i) => `<img src="${x.data || x.url || ''}" data-i="${i}" alt="foto ${i + 1}">`).join('');
  $$('#fotoPrev img').forEach((im) => (im.onclick = () => { if (confirm('¿Quitar esta foto?')) { f.fotos.splice(+im.dataset.i, 1); renderForm(); } }));
  // Competencia: un toque a la marca + precio
  const marcas = [...new Set([...COMPETENCIA, ...f.comp.map((x) => x.m)])];
  $('#compBtns').innerHTML = marcas.map((m) => `<button data-m="${esc(m)}" class="${f.comp.some((x) => x.m === m) ? 'on' : ''}">${esc(m)}</button>`).join('');
  $$('#compBtns button').forEach((b) => (b.onclick = () => toggleComp(b.dataset.m)));
  $('#compList').innerHTML = f.comp.map((x, i) => `<label>${esc(x.m)}${x.pres ? ` <small>${esc(x.pres)}</small>` : ''}<input inputmode="decimal" type="number" step="0.5" placeholder="botella" data-i="${i}" data-c="p" value="${x.p ?? ''}">${on ? `<input inputmode="decimal" type="number" step="0.5" placeholder="vaso" data-i="${i}" data-c="v" value="${x.v ?? ''}">` : ''}</label>`).join('');
  $$('#compList input').forEach((i) => (i.oninput = () => { f.comp[+i.dataset.i][i.dataset.c] = num(i.value); }));
  // Detalle (opcional)
  const d = f.det;
  $('#detalleCampos').innerHTML = [
    on ? yn('Acuerdo', d.acuerdo, 'det.acuerdo') + yn('Brandeo', d.brandeo, 'det.brandeo') : '',
    on ? porta : '',
    `<div class="lbl">Marca foco</div>${chips(MARCAS_FOCO, d.marca_foco, 'marca_foco')}`,
    `<div class="lbl">Relacionamiento</div>${chips(RELAC[f.seg], d.relacionamiento, 'relacionamiento')}`,
    on ? '' : `<label>Reporte stock<textarea data-d="reporte_stock">${esc(d.reporte_stock || '')}</textarea></label>`,
    `<label>Observaciones<textarea data-d="observaciones">${esc(d.observaciones || '')}</textarea></label>`,
    `<label>Próxima acción<input data-d="proxima" value="${esc(d.proxima || '')}"></label>`,
  ].join('');
  $$('#detalleCampos [data-d]').forEach((i) => (i.oninput = () => { d[i.dataset.d] = i.value; }));
  $$('#detalleCampos [data-chip]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.chip; const s = String(d[k] || '').split(',').map((x) => x.trim()).filter(Boolean);
    const j = s.indexOf(b.dataset.m); if (j >= 0) s.splice(j, 1); else s.push(b.dataset.m); d[k] = s.join(', '); renderForm(); $('#detalle').open = true;
  }));
  // Botones SI/NO (ejecución, portafolio y detalle)
  $$('#ejec .yn button, #detalleCampos .yn button').forEach((b) => (b.onclick = () => {
    const [grupo, ...resto] = b.dataset.f.split('.'); const k = resto.join('.');
    const obj = grupo === 'ejec' ? f.ejec : grupo === 'porta' ? f.porta : f.det;
    obj[k] = obj[k] === b.dataset.v ? null : b.dataset.v;
    const abierto = $('#detalle').open; renderForm(); $('#detalle').open = abierto;
  }));
  $('#btnGuardar').textContent = f._edit ? 'Guardar cambios' : 'Guardar visita';
}
function yn(t, v, campo, contrabando) {
  return `<div class="yn"><span>${t}</span><div class="opts">
    <button class="si ${v === 'SI' ? 'on' : ''}" data-f="${campo}" data-v="SI">SI</button>
    <button class="no ${v === 'NO' ? 'on' : ''}" data-f="${campo}" data-v="NO">NO</button>
    ${contrabando ? `<button class="ct ${v === 'CONTRABANDO' ? 'on' : ''}" data-f="${campo}" data-v="CONTRABANDO">CONTRA.</button>` : ''}</div></div>`;
}
function toggleComp(m, forzar) {
  const i = form.comp.findIndex((x) => x.m === m);
  if (i >= 0 && !forzar) form.comp.splice(i, 1); else if (i < 0) form.comp.push({ m, p: null, v: null });
  renderForm();
  if (i < 0) { const inp = $(`#compList input[data-i="${form.comp.length - 1}"]`); inp && inp.focus(); }
}
async function agregarFoto(e) {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (form.fotos.length >= 3) return toast('Máximo 3 fotos por visita');
  const data = await comprimir(file, 1280, 0.7);
  form.fotos.push({ id: uid(), data }); renderForm();
}
function comprimir(file, max, q) {
  return new Promise((res) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', q)); };
    img.src = url;
  });
}
async function guardarVisita() {
  const f = form;
  f.fecha = $('#fFecha').value || hoy();
  if (f.nuevo && !cliDe(f)) {
    f.cliente = $('#nNombre').value.trim(); f.ciudad = $('#nCiudad').value; f.canal = $('#nCanal').value;
    if (!f.cliente) return toast('Escribe el nombre del cliente nuevo');
  }
  const p = paretoDe(f); f.pareto = p.es ? 'SI' : 'NO'; f.pareto_pos = p.es ? p.pos : null; // copia informativa
  // Fotos: se guardan aparte (pesadas) y la visita guarda solo la referencia
  for (const ft of f.fotos) if (ft.data && !(await dbGet('fotos', ft.id))) await dbPut('fotos', { id: ft.id, visitaId: f.id, data: ft.data, synced: false });
  f.fotos = f.fotos.map((ft) => ({ id: ft.id, url: ft.url || null }));
  f.updatedAt = Date.now(); f.synced = false; delete f._prefill; delete f._edit;
  await dbPut('visitas', f);
  VISITAS = await dbAll('visitas');
  form = null; $('#q').value = ''; ir('registrar'); renderBusqueda(); renderSync();
  toast(`✅ Guardada en el teléfono${p.es ? ` · Pareto #${p.pos} · suma a tu KPI` : ''}`);
  sincronizar(true);
}

// ---------- Historial ----------
async function renderHistorial() {
  const mes = $('#hMes').value, ciu = $('#hCiudad').value;
  const l = VISITAS.filter((v) => !v.deleted && (!mes || v.fecha.startsWith(mes)) && (!ciu || ciudadDe(v) === ciu)).sort((a, b) => (b.fecha.localeCompare(a.fecha)) || (b.createdAt - a.createdAt));
  const total = VISITAS.filter((v) => !v.deleted).length;
  $('#hList').innerHTML = `<p class="note">${l.length} visitas en ${mes ? fmtF(mes + '-01').slice(3) : 'todos los meses'} · ${total} en total en el teléfono${total && !l.length ? ' (cambia el mes arriba o bórralo para ver todas)' : ''}${!total ? ' · Si ya tienes visitas en tu Sheet, ve a ⚙️ Ajustes y toca "Recuperar desde Sheets"' : ''}</p>` + l.map((v) => { const p = paretoDe(v);
    return `<div class="item" data-id="${v.id}"><b>${esc(v.cliente)}</b><div class="meta">${fmtF(v.fecha)} · ${v.seg} · ${esc(canalDe(v))} · ${esc(ciudadDe(v))}</div>
      <span class="tag ${p.es ? 'p' : ''}">${p.es ? `Pareto #${p.pos}` : 'No Pareto'}</span><span class="tag ${v.synced ? 'ok' : 'warn'}">${v.synced ? 'Sincronizada' : 'Pendiente'}</span>
      <div class="row2"><button class="btn ghost" data-a="edit">Editar</button><button class="btn ghost" data-a="del">Borrar</button></div></div>`; }).join('');
  $$('#hList .item button').forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation(); const v = VISITAS.find((x) => x.id === b.closest('.item').dataset.id);
    if (b.dataset.a === 'edit') { const fotos = []; for (const ft of v.fotos || []) { const r = await dbGet('fotos', ft.id); fotos.push({ id: ft.id, url: ft.url, data: r?.data }); } abrirVisita(null, { ...v, fotos }); }
    else if (confirm(`¿Borrar la visita a ${v.cliente} del ${fmtF(v.fecha)}?`)) { v.deleted = true; v.updatedAt = Date.now(); v.synced = false; await dbPut('visitas', v); VISITAS = await dbAll('visitas'); renderHistorial(); sincronizar(true); }
  }));
}

// ---------- KPIs y comisión ----------
function visitasMes(mes, ciu) { return VISITAS.filter((v) => !v.deleted && v.fecha.startsWith(mes) && (!ciu || ciudadDe(v) === ciu)); }
function calcularKPI(mes, ciu) {
  const l = visitasMes(mes, ciu);
  const real = {
    on: l.filter((v) => v.seg === 'ON').length,
    off: l.filter((v) => v.seg === 'OFF').length,
    pareto: l.filter((v) => v.seg === 'ON' && paretoDe(v).es).length,
    k4pm: l.filter(es4PM).length,
  };
  const m = CFG.metas, c = CFG.com;
  const kp = [
    { k: 'on', t: 'Visitas ON', meta: m.on, w: c.w_on },
    { k: 'off', t: 'Visitas OFF', meta: m.off, w: c.w_off },
    { k: 'pareto', t: 'Seguimiento Pareto ON', meta: m.pareto, w: c.w_pareto },
    { k: 'k4pm', t: 'KPI 4PM', meta: m.k4pm, w: c.w_k4pm },
  ].map((x) => {
    const r = real[x.k]; const cumpl = x.meta > 0 ? r / x.meta : 0;
    const paga = cumpl * 100 >= (Number(c.minimo) || 0) ? Math.min(cumpl, (Number(c.tope) || 100) / 100) : 0;
    return { ...x, real: r, cumpl, aporte: paga * (Number(x.w) || 0) / 100 };
  });
  const factor = kp.reduce((s, x) => s + x.aporte, 0);
  const variable = (Number(c.variable) || 0) * factor;
  return { lista: l, kp, factor, basico: Number(c.basico) || 0, variable, total: (Number(c.basico) || 0) + variable };
}
let chart;
function renderPanel() {
  const mes = $('#pMes').value || hoy().slice(0, 7), ciu = $('#pCiudad').value;
  const K = calcularKPI(mes, ciu);
  $('#kpis').innerHTML = K.kp.map((x) => `<div class="kpi"><div class="t">${x.t}</div><div class="v">${x.real}<small style="font-size:14px;color:var(--mut)"> / ${x.meta}</small></div>
    <div class="bar"><i style="width:${Math.min(100, x.cumpl * 100)}%"></i></div><div class="m">${pct(x.cumpl)} cumplido</div></div>`).join('');
  $('#comision').innerHTML = `<div class="t note">Comisión estimada ${mes}${ciu ? ' · ' + esc(ciu) : ''}</div><div class="big">${bs(K.total)}</div>
    <div class="note">Básico ${bs(K.basico)} + Variable ${bs(K.variable)} (${pct(K.factor)} del variable)</div>
    ${!CFG.com.variable ? '<p class="note">⚠️ Carga tu básico y variable en Ajustes para ver la comisión real.</p>' : ''}`;
  renderAlerta(ciu || CIUDAD_DEF);
  renderPrecios(mes, ciu);
}
function renderAlerta(ciu) {
  const esViernes = new Date().getDay() === 5; const box = $('#alertaViernes');
  const sem = lunes(hoy());
  const visit = new Set(VISITAS.filter((v) => !v.deleted && v.fecha >= sem).map((v) => v.codigo));
  const pend = BASE.list.filter((c) => c.pareto && c.ciudad === ciu && !visit.has(c.codigo)).sort((a, b) => (ON_CANALES.includes(b.canal) - ON_CANALES.includes(a.canal)) || a.canal.localeCompare(b.canal) || a.pos - b.pos);
  const on = pend.filter((c) => ON_CANALES.includes(c.canal));
  box.classList.remove('hidden');
  box.innerHTML = `<b>${esViernes ? '🔔 Es viernes: ' : ''}Pareto de ${esc(ciu)} sin visita esta semana</b>
    <div class="note">${on.length} Pareto ON y ${pend.length - on.length} Pareto OFF pendientes desde el lunes ${fmtF(sem)}.</div>
    <details ${esViernes ? 'open' : ''}><summary>Ver lista</summary>${pend.slice(0, 150).map((c) => `<div class="item" data-c="${esc(c.codigo)}"><b>${esc(c.nombre)}</b><div class="meta">${esc(c.canal)} · Pareto #${c.pos} · ${esc(c.vendedor)}</div></div>`).join('')}</details>`;
  box.querySelectorAll('.item').forEach((el) => (el.onclick = () => abrirVisita(byCode.get(el.dataset.c))));
}

// ---------- Precios por semana ----------
function promedio(a) { const v = a.filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }
function renderPrecios(mes, ciu) {
  const vista = $('#prVista').value; const seg = vista === 'on' ? 'ON' : 'OFF';
  const canales = [...new Set(VISITAS.filter((v) => v.seg === seg).map(canalDe))].filter(Boolean).sort();
  const cSel = $('#prCanal'); const prev = cSel.value; opciones(cSel, canales, `Todos los canales ${seg}`); if (canales.includes(prev)) cSel.value = prev;
  const [y, m] = mes.split('-').map(Number); const fin = ymd(new Date(y, m, 0)); const ini = lunes(ymd(new Date(y, m - 1, 1 - 7 * 11)));
  const l = VISITAS.filter((v) => !v.deleted && v.seg === seg && v.fecha >= ini && v.fecha <= fin && (!ciu || ciudadDe(v) === ciu) && (!cSel.value || canalDe(v) === cSel.value));
  const semanas = [...new Set(l.map((v) => lunes(v.fecha)))].sort();
  const serie = (fn) => semanas.map((s) => promedio(l.filter((v) => lunes(v.fecha) === s).flatMap(fn)));
  const comp = (pred, campo = 'p') => (v) => (v.comp || []).filter((x) => pred(x.m)).map((x) => x[campo]);
  let ds = [], tabla = '';
  if (seg === 'OFF') {
    const nombre = { buhero: 'Buhero', rones: 'Rones (promedio)', casareal: 'Casa Real Etiqueta Negra' }[vista];
    const pred = vista === 'rones' ? esRon : vista === 'buhero' ? (mm) => norm(mm).startsWith('buhero') : (mm) => norm(mm).includes('casa real');
    const br = serie((v) => [v.precios?.f750]); const co = serie(comp(pred));
    ds = [{ label: 'Branca 750', data: br }, { label: nombre, data: co }];
    tabla = `<table><tr><th>Semana</th><th>Branca</th><th>${esc(nombre)}</th><th>Índice</th><th>Brecha</th></tr>${semanas.map((s, i) => {
      const idx = br[i] && co[i] ? (br[i] / co[i]) * 100 : null;
      return `<tr><td>${fmtF(s)}</td><td>${br[i]?.toFixed(1) ?? '-'}</td><td>${co[i]?.toFixed(1) ?? '-'}</td><td>${idx ? idx.toFixed(0) : '-'}</td><td>${idx ? (idx - 100).toFixed(1) + '%' : '-'}</td></tr>`; }).join('')}</table>`;
  } else {
    const mias = [...PRECIOS_BOT, ...PRECIOS_VASO].map((p) => ({ label: p.t, data: serie((v) => [v.precios?.[p.k]]) }));
    const marcas = [...new Set(l.flatMap((v) => (v.comp || []).map((x) => x.m)))];
    ds = [...mias, ...marcas.flatMap((mm) => [{ label: mm + ' botella', data: serie(comp((x) => x === mm)) }, { label: mm + ' vaso', data: serie(comp((x) => x === mm, 'v')) }])].filter((d) => d.data.some((x) => x != null));
  }
  $('#prTabla').innerHTML = (semanas.length ? '' : '<p class="note">Todavía no hay precios cargados en este período.</p>') + tabla;
  if (!window.Chart) return;
  if (chart) chart.destroy();
  chart = new Chart($('#chart'), { type: 'line', data: { labels: semanas.map(fmtF), datasets: ds.map((d) => ({ ...d, spanGaps: true, tension: 0.2 })) },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { title: { display: true, text: 'Bs' } } } } });
}

// ---------- Reporte mensual RRHH ----------
function reporteMensual() {
  const mes = $('#pMes').value || hoy().slice(0, 7), ciu = $('#pCiudad').value;
  const K = calcularKPI(mes, ciu);
  const filas = K.lista.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).map((v) => { const p = paretoDe(v); const e = v.ejec || {};
    return { Fecha: fmtF(v.fecha), Cliente: v.cliente, Código: v.codigo || '(nuevo)', Segmento: v.seg, Canal: canalDe(v), Ciudad: ciudadDe(v),
      Pareto: p.es ? `SI (#${p.pos} de ${p.total})` : 'NO', Ejecución: EJEC[v.seg].filter(([k]) => e[k] === 'SI').map(([, t]) => t).join(', ') || '-',
      '4PM': es4PM(v) ? 'SI' : '', Observaciones: v.det?.observaciones || '' }; });
  const [y, m] = mes.split('-'); const nomMes = new Date(+y, +m - 1, 1).toLocaleDateString('es-BO', { month: 'long', year: 'numeric' });
  const r = $('#reporte');
  r.innerHTML = `<div class="rep-actions"><button class="btn primary" id="rPrint">Guardar PDF / Imprimir</button><button class="btn" id="rXls">Descargar Excel</button><button class="btn" id="rClose">Cerrar</button></div>
    <h1>Reporte mensual de visitas — ${esc(nomMes)}</h1><div>Brand Activator · ${ciu ? esc(ciu) : 'Todas las ciudades'} · Generado ${fmtF(hoy())}</div>
    <h2>Resumen de KPIs</h2><table><tr><th>KPI</th><th>Meta</th><th>Real</th><th>Cumplimiento</th><th>Peso</th><th>Aporte</th></tr>
    ${K.kp.map((x) => `<tr><td>${x.t}</td><td>${x.meta}</td><td>${x.real}</td><td>${pct(x.cumpl)}</td><td>${x.w}%</td><td>${pct(x.aporte)}</td></tr>`).join('')}</table>
    <h2>Cálculo de comisión</h2><table><tr><td>Básico</td><td>${bs(K.basico)}</td></tr><tr><td>Variable (${bs(CFG.com.variable)} × ${pct(K.factor)})</td><td>${bs(K.variable)}</td></tr><tr><th>Total a pagar</th><th>${bs(K.total)} · USD ${(K.total / (Number(CFG.com.tc) || 6.96)).toFixed(2)}</th></tr></table>
    <h2>Detalle de visitas (${filas.length})</h2><table><tr>${Object.keys(filas[0] || { Fecha: '' }).map((k) => `<th>${k}</th>`).join('')}</tr>
    ${filas.map((f) => `<tr>${Object.values(f).map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table>`;
  r.classList.remove('hidden'); $('main').classList.add('hidden'); $('#tabs').classList.add('hidden'); window.scrollTo(0, 0);
  $('#rClose').onclick = () => { r.classList.add('hidden'); $('main').classList.remove('hidden'); $('#tabs').classList.remove('hidden'); };
  $('#rPrint').onclick = () => window.print();
  $('#rXls').onclick = () => {
    if (!window.XLSX) return toast('Excel no disponible sin conexión la primera vez');
    const wb = XLSX.utils.book_new();
    const res = [...K.kp.map((x) => ({ KPI: x.t, Meta: x.meta, Real: x.real, Cumplimiento: Math.round(x.cumpl * 1000) / 10 + '%', Peso: x.w + '%', Aporte: Math.round(x.aporte * 1000) / 10 + '%' })),
      {}, { KPI: 'Básico', Meta: K.basico }, { KPI: 'Variable', Meta: Math.round(K.variable * 100) / 100 }, { KPI: 'COMISIÓN TOTAL', Meta: Math.round(K.total * 100) / 100 }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(res), 'Resumen KPI');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Visitas');
    XLSX.writeFile(wb, `Reporte visitas ${mes}.xlsx`);
  };
}

// ---------- Ajustes ----------
function renderAjustes() {
  $('#cfgUrl').value = CFG.url || '';
  const campos = (obj, defs, cont, unidad) => { cont.innerHTML = defs.map(([k, t]) => `<label>${t}<input inputmode="decimal" type="number" data-k="${k}" value="${obj[k] ?? ''}"></label>`).join('');
    cont.querySelectorAll('input').forEach((i) => (i.onchange = async () => { obj[i.dataset.k] = num(i.value) ?? 0; await guardarCfg(); toast('Guardado'); })); };
  campos(CFG.metas, [['on', 'Visitas ON'], ['off', 'Visitas OFF'], ['pareto', 'Seguimiento Pareto ON'], ['k4pm', 'KPI 4PM']], $('#cfgMetas'));
  campos(CFG.com, [['basico', 'Básico (Bs)'], ['variable', 'Variable máximo (Bs)'], ['w_on', 'Peso Visitas ON %'], ['w_off', 'Peso Visitas OFF %'], ['w_pareto', 'Peso Pareto ON %'], ['w_k4pm', 'Peso 4PM %'], ['minimo', 'Mínimo para cobrar %'], ['tope', 'Tope por KPI %'], ['tc', 'Tipo de cambio Bs/USD']], $('#cfgCom'));
  renderSync();
}

// ---------- Actualizar base de ventas (recalcula Pareto en el teléfono) ----------
function calcularBase(filas) {
  const key = (o, nombres) => { const ks = Object.keys(o); for (const n of nombres) { const k = ks.find((x) => norm(x) === norm(n)); if (k) return k; } return null; };
  const f0 = filas[0] || {};
  const K = { cod: key(f0, ['Cod. Cliente', 'Cód. Cliente', 'Codigo Cliente']), ciu: key(f0, ['Ciudad']), can: key(f0, ['Canal']), nom: key(f0, ['Nombre Comercial']),
    raz: key(f0, ['Razón Social', 'Razon Social']), ven: key(f0, ['Vendedor']), c9l: key(f0, ['C9L']), mar: key(f0, ['Marca']) };
  if (!K.cod || !K.can || !K.ciu || !K.c9l) throw new Error('El Excel no tiene las columnas Cod. Cliente, Canal, Ciudad y C9L');
  const g = new Map();
  for (const r of filas) {
    const cod = String(r[K.cod] ?? '').trim().toUpperCase(); const ciu = r[K.ciu]; const can = r[K.can];
    if (!cod || !ciu || !can || /^(total|filtros)/i.test(String(ciu))) continue;
    let o = g.get(cod); if (!o) { o = { codigo: cod, c9l: 0, cnt: {}, marcas: new Set() }; g.set(cod, o); }
    const c9 = Number(r[K.c9l]) || 0; o.c9l += c9;
    for (const [f, k] of [['nombre', K.nom], ['razon', K.raz], ['canal', K.can], ['ciudad', K.ciu], ['vendedor', K.ven]]) {
      if (!k || r[k] == null || r[k] === '') continue; const v = String(r[k]); o.cnt[f] = o.cnt[f] || {}; o.cnt[f][v] = (o.cnt[f][v] || 0) + 1; }
    if (K.mar && c9 > 0 && r[K.mar]) o.marcas.add(String(r[K.mar]));
  }
  const moda = (c) => { if (!c) return ''; let best = null, n = -1; for (const [v, k] of Object.entries(c)) if (k > n || (k === n && v < best)) { best = v; n = k; } return best; };
  const clientes = [...g.values()].map((o) => ({ codigo: o.codigo, nombre: moda(o.cnt.nombre), razon: moda(o.cnt.razon), canal: moda(o.cnt.canal), ciudad: moda(o.cnt.ciudad), vendedor: moda(o.cnt.vendedor), c9l: Math.round(o.c9l * 1e6) / 1e6, marcas: [...o.marcas].sort() }));
  const grupos = new Map(); for (const c of clientes) { const k = c.ciudad + '|' + c.canal; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(c); }
  const rows = [];
  for (const l of grupos.values()) {
    l.sort((a, b) => (b.c9l - a.c9l) || (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
    const tot = l.reduce((s, c) => s + c.c9l, 0); let acum = 0;
    l.forEach((c, i) => { const prev = tot > 0 ? acum / tot : 0; acum += c.c9l; c.pos = i + 1; c.total = l.length; c.pareto = tot > 0 && prev < 0.8 && c.c9l > 0 ? 1 : 0; });
    const np = l.filter((c) => c.pareto).length;
    l.forEach((c) => rows.push([c.codigo, c.nombre, c.razon, c.canal, c.ciudad, c.vendedor, Math.round(c.c9l * 10000) / 10000, c.pos, c.total, c.pareto, np, c.marcas]));
  }
  return { cols: ['codigo', 'nombre', 'razon', 'canal', 'ciudad', 'vendedor', 'c9l', 'pos', 'total', 'pareto', 'ptotal', 'marcas'], rows };
}
async function subirBase(e) {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (!window.XLSX) return toast('Necesitas conexión la primera vez para leer Excel');
  try {
    toast('Leyendo el Export…', 8000);
    const wb = XLSX.read(await file.arrayBuffer()); const ws = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { defval: null });
    const b = calcularBase(filas); b.version = file.name; b.generado = hoy();
    await dbPut('kv', b, 'base'); setBase(b); llenarSelects(); renderBusqueda();
    toast(`✅ Base actualizada: ${b.rows.length} clientes, ${b.rows.filter((r) => r[9]).length} Pareto. Tus visitas se recalcularon.`, 5000);
  } catch (err) { toast('No se pudo leer: ' + err.message, 6000); }
}

// ---------- Sincronización con Google Sheets (Apps Script) ----------
let syncing = false;
function pendientes() { return VISITAS.filter((v) => !v.synced).length; }
function renderSync(msg) {
  const p = pendientes(); const b = $('#syncBadge');
  b.textContent = !CFG.url ? '⚠️ Sin nube' : syncing ? '🔄 Sincronizando' : p ? `⏳ ${p} pendientes` : '☁️ Al día';
  const info = $('#syncInfo'); if (info) info.textContent = msg || `${VISITAS.filter((v) => !v.deleted).length} visitas en el teléfono · ${p} por sincronizar${navigator.onLine ? '' : ' · sin señal'}`;
}
async function post(body) {
  const r = await fetch(CFG.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) throw new Error(j.error || 'error'); return j;
}
async function sincronizar(silencioso) {
  if (syncing || !CFG.url || !navigator.onLine) { renderSync(); if (!silencioso && !CFG.url) toast('Primero pega el enlace de tu Apps Script'); return; }
  syncing = true; renderSync();
  try {
    // 1) fotos pendientes (una por una)
    const fotos = (await dbAll('fotos')).filter((f) => !f.synced);
    for (const f of fotos) {
      const j = await post({ action: 'foto', id: f.id, visitaId: f.visitaId, data: f.data });
      f.synced = true; f.url = j.url; await dbPut('fotos', f);
      const v = VISITAS.find((x) => x.id === f.visitaId);
      if (v) { const ft = (v.fotos || []).find((x) => x.id === f.id); if (ft) { ft.url = j.url; v.synced = false; await dbPut('visitas', v); } }
    }
    // 2) visitas pendientes en lotes
    VISITAS = await dbAll('visitas');
    const pend = VISITAS.filter((v) => !v.synced);
    for (let i = 0; i < pend.length; i += 50) {
      const lote = pend.slice(i, i + 50).map((v) => { const p = paretoDe(v); return { ...v, ciudad: ciudadDe(v), canal: canalDe(v), pareto: p.es ? 'SI' : 'NO', pareto_pos: p.es ? p.pos : '' }; });
      const marca = Object.fromEntries(lote.map((v) => [v.id, v.updatedAt]));
      await post({ action: 'upsert', visitas: lote });
      for (const id in marca) { const v = await dbGet('visitas', id); if (v && v.updatedAt === marca[id]) { v.synced = true; await dbPut('visitas', v); } }
    }
    VISITAS = await dbAll('visitas');
    if (!silencioso) toast('☁️ Todo sincronizado');
  } catch (e) { if (!silencioso) toast('No se pudo sincronizar ahora. Se reintenta solo. (' + e.message + ')', 5000); }
  finally { syncing = false; renderSync(); }
}
async function recuperar() {
  if (!CFG.url) return toast('Primero pega el enlace de tu Apps Script');
  try {
    const j = await (await fetch(CFG.url + '?action=list')).json(); let n = 0;
    for (const v of j.visitas || []) { const loc = await dbGet('visitas', v.id); if (!loc || (v.updatedAt || 0) > (loc.updatedAt || 0)) { v.synced = true; await dbPut('visitas', v); n++; } }
    VISITAS = await dbAll('visitas'); renderSync(); renderBusqueda(); toast(`Recuperadas ${n} visitas desde Sheets`);
  } catch (e) { toast('No se pudo recuperar: ' + e.message); }
}

// ---------- Respaldo manual ----------
async function descargarRespaldo() {
  const data = { app: 'misvisitas', fecha: hoy(), visitas: await dbAll('visitas'), fotos: await dbAll('fotos'), config: CFG };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `respaldo-visitas-${hoy()}.json`; a.click();
}
async function cargarRespaldo(e) {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const d = JSON.parse(await file.text()); let n = 0;
    for (const v of d.visitas || []) { const loc = await dbGet('visitas', v.id); if (!loc || (v.updatedAt || 0) > (loc.updatedAt || 0)) { await dbPut('visitas', v); n++; } }
    for (const f of d.fotos || []) if (!(await dbGet('fotos', f.id))) await dbPut('fotos', f);
    VISITAS = await dbAll('visitas'); renderSync(); toast(`Respaldo cargado: ${n} visitas`);
  } catch (err) { toast('Archivo de respaldo no válido'); }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__TEST__) init();
if (typeof module !== 'undefined') module.exports = { calcularBase };
