/**
 * Mis Visitas — servidor gratis en Google Apps Script.
 * Guarda cada visita en la hoja "Visitas" (una fila por visita, sin duplicar)
 * y las fotos en la carpeta de Drive "Mis Visitas - Fotos".
 * Pegar este código en Extensiones > Apps Script de tu Google Sheet nuevo.
 */
var HOJA = 'Visitas';
var CARPETA = 'Mis Visitas - Fotos';
var COLS = ['id', 'Fecha visita', 'Segmento', 'Canal', 'Cliente', 'Código', 'Ciudad', 'Pareto', 'Posición Pareto', 'KPI 4PM',
  'Exhibición barra', 'Menú', 'RRSS', 'Implementación imagen', 'Activación', 'Capacitación FBD',
  'Mueble de piso', 'Letrero exterior', 'Material POP', 'Degustación',
  'Fernet Branca', 'Branca Menta', 'Sernova', 'Carpano', 'Borghetti', 'Punt e Mes',
  'Precio Fernet 750', 'Precio Fernet 1000', 'Precio Carpano', 'Precio Sernova', 'Vaso Fernet', 'Vaso Carpano', 'Vaso Sernova',
  'Competencia', 'Acuerdo', 'Brandeo', 'Marca foco', 'Relacionamiento', 'Reporte stock', 'Observaciones', 'Próxima acción',
  'Fotos', 'Cliente nuevo', 'Borrada', 'Actualizada', 'JSON'];

function hoja_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HOJA);
  if (!sh) { sh = ss.insertSheet(HOJA); sh.appendRow(COLS); sh.setFrozenRows(1); sh.hideColumns(COLS.length); }
  return sh;
}
function carpeta_() {
  var it = DriveApp.getFoldersByName(CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA);
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function fila_(v) {
  var e = v.ejec || {}, p = v.precios || {}, d = v.det || {}, o = v.porta || {};
  var k4 = v.seg === 'ON' && e.barra === 'SI' && e.menu === 'SI' && e.imagen === 'SI' ? 'SI' : '';
  return [v.id, v.fecha, v.seg, v.canal, v.cliente, v.codigo || '', v.ciudad, v.pareto, v.pareto_pos || '', k4,
    e.barra, e.menu, e.rrss, e.imagen, e.activacion, e.capacitacion, e.mueble, e.letrero, e.pop, e.degustacion,
    o['Fernet Branca'], o['Branca Menta'], o['Sernova'], o['Carpano'], o['Borghetti'], o['Punt e Mes'],
    p.f750, p.f1000, p.carpano, p.sernova, p.v_fernet, p.v_carpano, p.v_sernova,
    (v.comp || []).map(function (c) { return c.m + (c.pres ? ' ' + c.pres : '') + (c.p != null ? ' (bot. ' + c.p + ')' : '') + (c.v != null ? ' (vaso ' + c.v + ')' : ''); }).join(' | '),
    d.acuerdo, d.brandeo, d.marca_foco, d.relacionamiento, d.reporte_stock, d.observaciones, d.proxima,
    (v.fotos || []).map(function (f) { return f.url || ''; }).filter(String).join(' '),
    v.nuevo ? 'SI' : '', v.deleted ? 'SI' : '', new Date(v.updatedAt || Date.now()), JSON.stringify(v)]
    .map(function (x) { return x == null ? '' : x; });
}

function doPost(e) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var b = JSON.parse(e.postData.contents);
    if (b.action === 'upsert') {
      var sh = hoja_(); var n = sh.getLastRow();
      var ids = n > 1 ? sh.getRange(2, 1, n - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
      var nuevas = [];
      b.visitas.forEach(function (v) {
        delete v.synced;
        var i = ids.indexOf(v.id);
        if (i >= 0) sh.getRange(i + 2, 1, 1, COLS.length).setValues([fila_(v)]);
        else nuevas.push(fila_(v));
      });
      if (nuevas.length) sh.getRange(sh.getLastRow() + 1, 1, nuevas.length, COLS.length).setValues(nuevas);
      return json_({ ok: true, n: b.visitas.length });
    }
    if (b.action === 'foto') {
      var f = carpeta_();
      var existe = f.getFilesByName(b.id + '.jpg');
      var file = existe.hasNext() ? existe.next()
        : f.createFile(Utilities.newBlob(Utilities.base64Decode(b.data.split(',')[1]), 'image/jpeg', b.id + '.jpg'));
      return json_({ ok: true, url: file.getUrl() });
    }
    return json_({ ok: false, error: 'acción desconocida' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

// Recuperar todas las visitas (por si cambias de celular)
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'list') {
    var sh = hoja_(); var n = sh.getLastRow();
    var vs = n > 1 ? sh.getRange(2, COLS.length, n - 1, 1).getValues().map(function (r) { try { return JSON.parse(r[0]); } catch (x) { return null; } }).filter(Boolean) : [];
    return json_({ ok: true, visitas: vs });
  }
  return json_({ ok: true, app: 'Mis Visitas' });
}
