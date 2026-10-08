// Describe cada entidad: texto visible, campos de la tabla y, entre ellos, cuáles calcula el servidor (auto).
const entities = {
  cliente: { label: 'Clientes', fields: ['cedula', 'nombre', 'apellidos', 'correo', 'telefono', 'tipo'] },
  vendedor: { label: 'Vendedores', fields: ['cedula', 'nombre', 'apellidos', 'correo', 'telefono', 'puesto', 'salario_x_hora'] },
  categoria: { label: 'Categorías', fields: ['identificador', 'nombre'] },
  producto: { label: 'Productos', fields: ['identificador', 'marca', 'nombre', 'categoria', 'precio_x_unidad', 'stock', 'emoji'] },
  sucursal: { label: 'Sucursales', fields: ['identificador', 'nombre', 'ubicacion'] },
  // Las facturas se crean desde la pestaña Compra; aquí se consultan, se editan sus datos y se borran.
  factura: { label: 'Facturas', fields: ['identificador', 'fecha', 'metodo_pago', 'cliente', 'atendido_por', 'sucursal', 'monto_total'], auto: ['monto_total'], noCreate: true }
};

// Campos que son llaves foráneas: se muestran como lista desplegable con los registros de la otra tabla.
const references = { categoria: 'categoria', cliente: 'cliente', atendido_por: 'vendedor', sucursal: 'sucursal' };
// Campos con opciones fijas.
const choices = { tipo: ['Regular', 'Mayorista', 'Coleccionista'], metodo_pago: ['Efectivo', 'Tarjeta', 'SINPE'] };
// Campos numéricos y los que se muestran como dinero.
const numeric = ['salario_x_hora', 'precio_x_unidad', 'stock', 'cantidad', 'monto_total', 'precio_unitario'];
const integers = ['stock', 'cantidad'];
const moneyFields = ['salario_x_hora', 'precio_x_unidad', 'monto_total', 'precio_unitario'];

// Pestañas especiales (no son CRUD genérico) y pestaña actual.
const specialTabs = {  compra: 'Compra' };
let current = 'catalogo';
let editing = null;
let rows = [];
let cache = {};
let cart = [];

// Atajos cortos para leer el código con facilidad.
const $ = id => document.getElementById(id);
const label = text => text.replaceAll('_', ' ');
const money = n => '₡' + Number(n).toLocaleString('es-CR', { maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pk = entity => [entities[entity].fields[0]];
const keyOf = (entity, row) => pk(entity).map(f => encodeURIComponent(row[f])).join('/');
const setMessage = (text, ok = false) => { $('message').textContent = text; $('message').className = ok ? 'ok' : ''; };

// Pide una tabla a la API y la guarda para no repetir la consulta.
async function table(name) {
  if (!cache[name]) cache[name] = await (await fetch('/api/' + name)).json();
  return cache[name];
}
// Texto que identifica a un registro dentro de una lista desplegable.
async function refLabel(tableName, row) {
  if (tableName === 'cliente' || tableName === 'vendedor') return `${row.cedula} – ${row.nombre} ${row.apellidos}`;
  return `${row.identificador} – ${row.nombre || row.fecha || ''}`;
}
const refKey = tableName => (tableName === 'cliente' || tableName === 'vendedor' ? 'cedula' : 'identificador');
async function optionsFor(tableName) {
  const list = await table(tableName);
  return Promise.all(list.map(async r => ({ value: r[refKey(tableName)], text: await refLabel(tableName, r) })));
}

// Cuadros de resumen que calcula el endpoint /api/resumen.
async function summary() {
  const s = await (await fetch('/api/resumen')).json();
  $('summary').innerHTML = [
    [money(s.ventas), 'Ventas facturadas'], [s.facturas, 'Facturas'], [s.productos, 'Productos'],
    [s.unidades, 'Unidades en inventario'], [s.stock_bajo.length, 'Productos con stock bajo (≤ 10)']
  ].map(([value, text]) => `<div class="stat"><b>${value}</b><span>${text}</span></div>`).join('');
}

// Dibuja un botón por cada sección del sistema.
function nav() {
  const tabs = [...Object.entries(specialTabs), ...Object.entries(entities).map(([k, v]) => [k, v.label])];
  $('tabs').innerHTML = tabs.map(([key, text]) =>
    `<button class="${key === current ? 'active' : ''}" data-tab="${key}">${text}</button>`).join('');
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => choose(b.dataset.tab));
}

// Cambia de sección, descarta una edición pendiente y actualiza la pantalla.
async function choose(tab) {
  current = tab;
  editing = null;
  cache = {};
  setMessage('');
  nav();
  summary();
  if (tab !== 'compra') $('pos').innerHTML = '';
  $('catalog').hidden = tab !== 'catalogo';
  $('pos').hidden = tab !== 'compra';
  $('crud').hidden = tab in specialTabs;
  if (tab === 'catalogo') return renderCatalog();
  if (tab === 'compra') return renderPOS();
  await renderForm();
  load();
}

/* ======================= CRUD genérico ======================= */

// Construye el formulario y los encabezados de tabla para la entidad activa.
async function renderForm() {
  const entity = entities[current];
  const fields = entity.fields.filter(f => !(entity.auto || []).includes(f));
  $('title').textContent = entity.label;
  if (entity.noCreate && !editing) {
    $('form').innerHTML = '<p>Las facturas se generan desde la pestaña <b>Compra</b>. Aquí puedes ver el detalle, editar sus datos o borrarlas.</p>';
    $('form').onsubmit = null;
    $('head').innerHTML = '<tr>' + entity.fields.map(f => `<th>${label(f)}</th>`).join('') + '<th>Acciones</th></tr>';
    return;
  }
  const inputs = await Promise.all(fields.map(async field => {
    const locked = editing && pk(current).includes(field);
    let control;
    if (references[field]) {
      const options = await optionsFor(references[field]);
      control = `<select name="${field}" ${locked ? 'disabled' : ''} required>${options.map(o => `<option value="${esc(o.value)}">${esc(o.text)}</option>`).join('')}</select>`;
    } else if (choices[field]) {
      control = `<select name="${field}" required>${choices[field].map(o => `<option>${o}</option>`).join('')}</select>`;
    } else {
      const type = field === 'fecha' ? 'date' : numeric.includes(field) ? 'number' : field === 'correo' ? 'email' : 'text';
      const step = integers.includes(field) ? '1' : '0.01';
      control = `<input name="${field}" type="${type}" ${type === 'number' ? `step="${step}" min="${field === 'cantidad' ? 1 : 0}"` : ''} ${locked ? 'readonly' : ''} required>`;
    }
    return `<label>${label(field)}${control}</label>`;
  }));
  $('form').innerHTML = inputs.join('') + `<button class="primary">${editing ? 'Actualizar' : 'Crear'}</button>` +
    (editing ? '<button type="button" id="cancel">Cancelar</button>' : '');
  $('form').onsubmit = save;
  if ($('cancel')) $('cancel').onclick = () => { editing = null; renderForm(); setMessage(''); };
  if (!editing && fields.includes('fecha')) $('form').elements.fecha.value = new Date().toISOString().slice(0, 10);
  if (!editing && fields.includes('emoji')) $('form').elements.emoji.value = '🦫';
  $('head').innerHTML = '<tr>' + entity.fields.map(f => `<th>${label(f)}</th>`).join('') + '<th>Acciones</th></tr>';
}

// Texto de cada celda de la tabla (dinero con formato, el resto tal cual).
const cell = (field, value) => esc(moneyFields.includes(field) ? money(value) : value);

// Pide los registros al endpoint GET y dibuja una fila por cada respuesta.
async function load() {
  const response = await fetch('/api/' + current);
  rows = await response.json();
  $('body').innerHTML = rows.map((row, i) => '<tr>' +
    entities[current].fields.map(field => `<td>${cell(field, row[field])}</td>`).join('') +
    `<td class="actions">${current === 'factura' ? `<button data-detail="${i}">Detalle</button>` : ''}` +
    `<button data-edit="${i}">Editar</button><button class="danger" data-del="${i}">Borrar</button></td></tr>`
  ).join('') || `<tr><td colspan="${entities[current].fields.length + 1}">No hay registros todavía.</td></tr>`;
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(rows[b.dataset.edit]));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => removeRow(rows[b.dataset.del]));
  document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => showDetail(rows[b.dataset.detail].identificador));
}

// Envía el formulario como JSON mediante POST para crear o PUT para actualizar.
async function save(event) {
  event.preventDefault();
  const form = event.target;
  const data = {};
  for (const element of form.elements) {
    if (element.name) data[element.name] = element.value;
  }
  // Las listas desplegables bloqueadas no se envían en el formulario, así que se toman de la fila editada.
  if (editing) for (const f of pk(current)) data[f] = editing[f];
  for (const field of Object.keys(data)) {
    if (numeric.includes(field)) data[field] = Number(data[field]);
  }
  const url = '/api/' + current + (editing ? '/' + keyOf(current, editing) : '');
  const response = await fetch(url, {
    method: editing ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!response.ok) return setMessage(errorText(await response.json()));
  setMessage('Guardado correctamente.', true);
  editing = null;
  cache = {};
  await renderForm();
  load();
  summary();
}

// Convierte los errores de FastAPI (texto o lista de validaciones) en un mensaje legible.
function errorText(body) {
  if (Array.isArray(body.detail)) return body.detail.map(e => `${e.loc.slice(-1)[0]}: ${e.msg}`).join(' · ');
  return body.detail || 'Ocurrió un error';
}

// Carga los valores de una fila en el formulario para permitir la actualización.
async function edit(row) {
  editing = row;
  await renderForm();
  for (const element of $('form').elements) {
    if (element.name && element.name in row) element.value = row[element.name];
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Solicita confirmación y, si el usuario acepta, llama al endpoint DELETE.
async function removeRow(row) {
  if (!confirm('¿Eliminar este registro?')) return;
  const response = await fetch('/api/' + current + '/' + keyOf(current, row), { method: 'DELETE' });
  setMessage(response.ok ? 'Registro eliminado.' : errorText(await response.json()), response.ok);
  cache = {};
  load();
  summary();
}

/* ======================= Detalle de factura ======================= */

// Muestra en una ventana los datos de la factura, sus artículos y el total de la compra.
async function showDetail(id) {
  const response = await fetch('/api/factura/' + encodeURIComponent(id) + '/detalle');
  if (!response.ok) return setMessage(errorText(await response.json()));
  const d = await response.json();
  const f = d.factura;
  $('dialog').innerHTML = `<h2>Factura ${esc(f.identificador)}</h2>
    <p><b>${esc(f.cliente_nombre)}</b> · ${esc(f.fecha)} · ${esc(f.metodo_pago)}<br>
    Atendió: ${esc(f.vendedor_nombre)} · ${esc(f.sucursal_nombre)}</p>
    <table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>
    ${d.productos.map(p => `<tr><td>${esc(p.emoji)} ${esc(p.nombre)}</td><td>${p.cantidad}</td><td>${money(p.precio_unitario)}</td><td>${money(p.subtotal)}</td></tr>`).join('') ||
      '<tr><td colspan="4">Sin artículos.</td></tr>'}</tbody></table>
    <p class="totals"><span class="grand">Total de la compra: ${money(f.monto_total)}</span></p>
    <button class="primary" id="close-dialog">Cerrar</button>`;
  $('close-dialog').onclick = () => $('dialog').close();
  $('dialog').showModal();
}


/* ======================= Compra ======================= */

// Pantalla de compra: se elige cliente, vendedor, sucursal, método de pago y los productos.
async function renderPOS() {
  const [clients, sellers, branches, products] = await Promise.all(
    ['cliente', 'vendedor', 'sucursal', 'producto'].map(optionsFor));
  const stock = await table('producto');
  const select = (id, options) => `<select id="${id}">${options.map(o => `<option value="${esc(o.value)}">${esc(o.text)}</option>`).join('')}</select>`;
  $('pos').innerHTML = `<div class="pos-grid">
    <div class="panel"><h3>1. Datos de la compra</h3><form id="pos-form">
      <label>Cliente ${select('p-cliente', clients)}</label>
      <label>Atiende ${select('p-vendedor', sellers)}</label>
      <label>Sucursal ${select('p-sucursal', branches)}</label>
      <label>Método de pago <select id="p-pago">${choices.metodo_pago.map(o => `<option>${o}</option>`).join('')}</select></label>
    </form></div>
    <div class="panel"><h3>2. Productos</h3>
      <div class="row"><label>Producto ${select('p-producto', products)}</label>
      <label class="qty">Cantidad <input id="p-cantidad" type="number" min="1" step="1" value="1"></label>
      <button id="p-add" type="button">Agregar</button></div>
      <p id="message" role="status"></p>
      <div id="p-lines"></div>
      <button class="primary" id="p-save" type="button">Realizar compra</button>
    </div></div>`;
  $('p-add').onclick = () => {
    const id = $('p-producto').value;
    const quantity = Number($('p-cantidad').value);
    const product = stock.find(p => p.identificador === id);
    const line = cart.find(l => l.identificador_producto === id);
    const wanted = (line ? line.cantidad : 0) + quantity;
    if (!(quantity >= 1)) return setMessage('La cantidad debe ser al menos 1.');
    if (wanted > product.stock) return setMessage(`Solo hay ${product.stock} unidades de «${product.nombre}».`);
    if (line) line.cantidad = wanted; else cart.push({ identificador_producto: id, cantidad: quantity });
    setMessage('');
    drawLines(stock);
  };
  $('p-save').onclick = registerPurchase;
  drawLines(stock);
}

// Dibuja los productos de la compra y el total (el total oficial lo calcula el servidor al guardar).
function drawLines(stock) {
  const total = cart.reduce((sum, l) => sum + l.cantidad * stock.find(p => p.identificador === l.identificador_producto).precio_x_unidad, 0);
  $('p-lines').innerHTML = (cart.length ? `<table><tbody>${cart.map((l, i) => {
    const p = stock.find(x => x.identificador === l.identificador_producto);
    return `<tr><td>${esc(p.emoji)} ${esc(p.nombre)}</td><td>${l.cantidad} × ${money(p.precio_x_unidad)}</td>
      <td><button class="danger" data-remove="${i}">Quitar</button></td></tr>`;
  }).join('')}</tbody></table>` : '<p>Aún no hay productos en la compra.</p>') +
    `<p class="totals"><span class="grand">Total: ${money(total)}</span></p>`;
  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { cart.splice(b.dataset.remove, 1); drawLines(stock); });
}

// Envía la compra completa al endpoint POST /api/compra.
async function registerPurchase() {
  if (!cart.length) return setMessage('Agrega al menos un producto.');
  const response = await fetch('/api/compra', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cliente: $('p-cliente').value, atendido_por: $('p-vendedor').value, sucursal: $('p-sucursal').value,
      metodo_pago: $('p-pago').value, items: cart
    })
  });
  if (!response.ok) return setMessage(errorText(await response.json()));
  const sale = await response.json();
  cart = [];
  cache = {};
  await renderPOS();
  summary();
  setMessage(`Compra registrada en la factura ${sale.factura.identificador}.`, true);
  showDetail(sale.factura.identificador);
}

// Inicializa la interfaz al terminar de cargar el archivo JavaScript.
choose('catalogo');
