// Describe cada entidad: texto visible, campos de la tabla y, entre ellos, cuáles calcula el servidor (auto).
const entities = {
  // Los pedidos se crean desde la pestaña Compra; aquí se consultan, se editan y se borran.
  pedido: {
    label: 'Pedidos', noCreate: true, auto: ['monto_total'],
    fields: ['identificador', 'fecha', 'cliente', 'merch', 'cantidad', 'color', 'accesorio', 'sucursal', 'atendido_por', 'metodo_pago', 'monto_total']
  },
  cliente: { label: 'Clientes', fields: ['cedula', 'nombre', 'apellidos', 'correo', 'telefono', 'tipo'] },
  vendedor: { label: 'Vendedores', fields: ['cedula', 'nombre', 'apellidos', 'correo', 'telefono', 'puesto', 'salario_x_hora'] },
  sucursal: { label: 'Lugares de retiro', fields: ['identificador', 'nombre', 'ubicacion'] },
  merch: { label: 'Tipos de merch', fields: ['identificador', 'nombre', 'precio_x_unidad'] },
  color: { label: 'Colores', fields: ['identificador', 'nombre'] },
  accesorio: { label: 'Accesorios', fields: ['identificador', 'nombre', 'precio_extra'] }
};

// Nombres que se muestran al usuario para cada campo (el resto usa el nombre del campo sin guiones bajos).
const labels = { sucursal: 'lugar de retiro', merch: 'tipo de merch', atendido_por: 'atendido por', monto_total: 'total' };

// Campos que son llaves foráneas: se muestran como lista desplegable con los registros de la otra tabla.
const references = { cliente: 'cliente', atendido_por: 'vendedor', sucursal: 'sucursal', merch: 'merch', color: 'color', accesorio: 'accesorio' };
// Campos con opciones fijas.
const choices = { tipo: ['Regular', 'Mayorista', 'Coleccionista'], metodo_pago: ['Efectivo', 'Tarjeta', 'SINPE'] };
// Campos numéricos y los que se muestran como dinero.
const numeric = ['salario_x_hora', 'precio_x_unidad', 'precio_extra', 'cantidad', 'monto_total'];
const moneyFields = ['salario_x_hora', 'precio_x_unidad', 'precio_extra', 'monto_total'];

// Pestaña especial (no es CRUD genérico) y pestaña actual.
const specialTabs = { compra: 'Compra' };
let current = 'compra';
let editing = null;
let rows = [];
let cache = {};
let names = {};

// Atajos cortos para leer el código con facilidad.
const $ = id => document.getElementById(id);
const label = text => labels[text] || text.replaceAll('_', ' ');
const money = n => '₡' + Number(n).toLocaleString('es-CR', { maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pk = entity => entities[entity].fields[0];
const setMessage = (text, ok = false) => { $('message').textContent = text; $('message').className = ok ? 'ok' : ''; };

// Pide una tabla a la API y la guarda para no repetir la consulta.
async function table(name) {
  if (!cache[name]) cache[name] = await (await fetch('/api/' + name)).json();
  return cache[name];
}
// Texto que identifica a un registro dentro de una lista desplegable o de la tabla.
function refLabel(tableName, row) {
  if (tableName === 'cliente' || tableName === 'vendedor') return `${row.nombre} ${row.apellidos}`;
  if (tableName === 'merch') return `${row.nombre} (${money(row.precio_x_unidad)})`;
  if (tableName === 'accesorio') return row.precio_extra ? `${row.nombre} (+${money(row.precio_extra)})` : row.nombre;
  if (tableName === 'sucursal') return `${row.nombre} - ${row.ubicacion}`;
  return row.nombre;
}
const refKey = tableName => (tableName === 'cliente' || tableName === 'vendedor' ? 'cedula' : 'identificador');
async function optionsFor(tableName) {
  return (await table(tableName)).map(r => ({ value: r[refKey(tableName)], text: refLabel(tableName, r) }));
}

// Cuadros de resumen que calcula el endpoint /api/resumen.
async function summary() {
  const s = await (await fetch('/api/resumen')).json();
  $('summary').innerHTML = [
    [s.pedidos, 'Pedidos'], [s.unidades, 'Unidades pedidas'], [money(s.total_facturado), 'Total facturado'], [s.clientes, 'Clientes']
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
  $('pos').hidden = tab !== 'compra';
  $('crud').hidden = tab in specialTabs;
  if (tab === 'compra') return renderPurchase();
  await renderForm();
  load();
}

/* ======================= CRUD genérico ======================= */

// Construye el formulario y los encabezados de tabla para la entidad activa.
async function renderForm() {
  const entity = entities[current];
  const fields = entity.fields.filter(f => !(entity.auto || []).includes(f));
  $('title').textContent = entity.label;
  $('head').innerHTML = '<tr>' + entity.fields.map(f => `<th>${label(f)}</th>`).join('') + '<th>Acciones</th></tr>';
  if (entity.noCreate && !editing) {
    $('form').innerHTML = '<p>Los pedidos se registran desde la pestaña <b>Compra</b>. Aquí puedes ver el detalle, editar sus datos o borrarlos.</p>';
    $('form').onsubmit = null;
    return;
  }
  const inputs = await Promise.all(fields.map(async field => {
    const locked = editing && field === pk(current);
    let control;
    if (references[field]) {
      const options = await optionsFor(references[field]);
      control = `<select name="${field}" required>${options.map(o => `<option value="${esc(o.value)}">${esc(o.text)}</option>`).join('')}</select>`;
    } else if (choices[field]) {
      control = `<select name="${field}" required>${choices[field].map(o => `<option>${o}</option>`).join('')}</select>`;
    } else {
      const type = field === 'fecha' ? 'date' : numeric.includes(field) ? 'number' : field === 'correo' ? 'email' : 'text';
      const attrs = type === 'number' ? `step="${field === 'cantidad' ? 1 : 0.01}" min="${field === 'cantidad' ? 1 : 0}"` : '';
      control = `<input name="${field}" type="${type}" ${attrs} ${locked ? 'readonly' : ''} required>`;
    }
    return `<label>${label(field)}${control}</label>`;
  }));
  $('form').innerHTML = inputs.join('') + `<button class="primary">${editing ? 'Actualizar' : 'Crear'}</button>` +
    (editing ? '<button type="button" id="cancel">Cancelar</button>' : '');
  $('form').onsubmit = save;
  if ($('cancel')) $('cancel').onclick = () => { editing = null; renderForm(); setMessage(''); };
}

// Texto de cada celda: dinero con formato y, en las llaves foráneas, el nombre del registro en vez de su código.
const cell = (field, value) => {
  if (moneyFields.includes(field)) return esc(money(value));
  if (names[field] && names[field][value]) return esc(names[field][value]);
  return esc(value);
};

// Pide los registros al endpoint GET y dibuja una fila por cada respuesta.
async function load() {
  const entity = entities[current];
  const refs = entity.fields.filter(f => references[f]);
  names = {};
  for (const f of refs) {
    const tableName = references[f];
    names[f] = Object.fromEntries((await table(tableName)).map(r => [r[refKey(tableName)],
      tableName === 'cliente' || tableName === 'vendedor' ? `${r.nombre} ${r.apellidos}` : r.nombre]));
  }
  rows = await (await fetch('/api/' + current)).json();
  $('body').innerHTML = rows.map((row, i) => '<tr>' +
    entity.fields.map(field => `<td>${cell(field, row[field])}</td>`).join('') +
    `<td class="actions">${current === 'pedido' ? `<button data-detail="${i}">Detalle</button>` : ''}` +
    `<button data-edit="${i}">Editar</button><button class="danger" data-del="${i}">Borrar</button></td></tr>`
  ).join('') || `<tr><td colspan="${entity.fields.length + 1}">No hay registros todavía.</td></tr>`;
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(rows[b.dataset.edit]));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => removeRow(rows[b.dataset.del]));
  document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => showDetail(rows[b.dataset.detail].identificador));
}

// Envía el formulario como JSON mediante POST para crear o PUT para actualizar.
async function save(event) {
  event.preventDefault();
  const data = {};
  for (const element of event.target.elements) {
    if (element.name) data[element.name] = element.value;
  }
  // El identificador de una fila editada no cambia: se toma de la fila original.
  if (editing) data[pk(current)] = editing[pk(current)];
  for (const field of Object.keys(data)) {
    if (numeric.includes(field)) data[field] = Number(data[field]);
  }
  const url = '/api/' + current + (editing ? '/' + encodeURIComponent(editing[pk(current)]) : '');
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
  if (Array.isArray(body.detail)) return body.detail.map(e => `${label(String(e.loc.slice(-1)[0]))}: ${e.msg}`).join(' · ');
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
  const response = await fetch('/api/' + current + '/' + encodeURIComponent(row[pk(current)]), { method: 'DELETE' });
  setMessage(response.ok ? 'Registro eliminado.' : errorText(await response.json()), response.ok);
  cache = {};
  load();
  summary();
}

/* ======================= Detalle del pedido ======================= */

// Muestra en una ventana todos los datos del pedido y su total.
async function showDetail(id) {
  const response = await fetch('/api/pedido/' + encodeURIComponent(id) + '/detalle');
  if (!response.ok) return setMessage(errorText(await response.json()));
  const p = await response.json();
  $('dialog').innerHTML = `<h2>Pedido ${esc(p.identificador)}</h2>
    <dl>
      <dt>Fecha</dt><dd>${esc(p.fecha)}</dd>
      <dt>Cliente</dt><dd>${esc(p.cliente_nombre)}</dd>
      <dt>Tipo de merch</dt><dd>${esc(p.merch_nombre)} (${money(p.merch_precio)} c/u)</dd>
      <dt>Cantidad</dt><dd>${p.cantidad}</dd>
      <dt>Color</dt><dd>${esc(p.color_nombre)}</dd>
      <dt>Accesorio</dt><dd>${esc(p.accesorio_nombre)}${p.accesorio_precio ? ` (+${money(p.accesorio_precio)} c/u)` : ''}</dd>
      <dt>Lugar de retiro</dt><dd>${esc(p.sucursal_nombre)}, ${esc(p.sucursal_ubicacion)}</dd>
      <dt>Atendido por</dt><dd>${esc(p.vendedor_nombre)}</dd>
      <dt>Método de pago</dt><dd>${esc(p.metodo_pago)}</dd>
    </dl>
    <p class="grand">Total: ${money(p.monto_total)}</p>
    <button class="primary" id="close-dialog">Cerrar</button>`;
  $('close-dialog').onclick = () => $('dialog').close();
  $('dialog').showModal();
}

/* ======================= Compra ======================= */

// Pantalla de compra: el cliente indica qué merch quiere, cuántas unidades, color, accesorio y dónde la retira.
async function renderPurchase() {
  const [clients, sellers, branches, merch, colors, accessories] = await Promise.all(
    ['cliente', 'vendedor', 'sucursal', 'merch', 'color', 'accesorio'].map(optionsFor));
  const prices = { merch: Object.fromEntries((await table('merch')).map(m => [m.identificador, m.precio_x_unidad])),
    accesorio: Object.fromEntries((await table('accesorio')).map(a => [a.identificador, a.precio_extra])) };
  const select = (id, text, options) => `<label>${text}<select id="${id}">${options.map(o => `<option value="${esc(o.value)}">${esc(o.text)}</option>`).join('')}</select></label>`;
  $('pos').innerHTML = `<div class="panel"><h2>Nueva compra</h2><form id="purchase-form">
      ${select('p-cliente', 'Cliente', clients)}
      ${select('p-merch', 'Tipo de merch', merch)}
      <label>Cantidad<input id="p-cantidad" type="number" min="1" step="1" value="1"></label>
      ${select('p-color', 'Color', colors)}
      ${select('p-accesorio', 'Accesorio', accessories)}
      ${select('p-sucursal', 'Lugar de retiro', branches)}
      ${select('p-vendedor', 'Atendido por', sellers)}
      ${select('p-pago', 'Método de pago', choices.metodo_pago.map(o => ({ value: o, text: o })))}
      <div class="total-box"><span class="grand" id="p-total"></span><button class="primary" id="p-save">Realizar compra</button></div>
    </form><p id="message" role="status"></p></div>`;
  // El total mostrado es un estimado; el valor oficial lo calcula el servidor al guardar.
  const estimate = () => {
    const quantity = Math.max(Number($('p-cantidad').value) || 0, 0);
    $('p-total').textContent = 'Total: ' + money((prices.merch[$('p-merch').value] + prices.accesorio[$('p-accesorio').value]) * quantity);
  };
  ['p-merch', 'p-accesorio', 'p-cantidad'].forEach(id => $(id).oninput = estimate);
  estimate();
  $('purchase-form').onsubmit = registerPurchase;
}

// Envía la compra al endpoint POST /api/compra, que crea el pedido y calcula el total.
async function registerPurchase(event) {
  event.preventDefault();
  const response = await fetch('/api/compra', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cliente: $('p-cliente').value, atendido_por: $('p-vendedor').value, sucursal: $('p-sucursal').value,
      metodo_pago: $('p-pago').value, merch: $('p-merch').value, cantidad: Number($('p-cantidad').value),
      color: $('p-color').value, accesorio: $('p-accesorio').value
    })
  });
  if (!response.ok) return setMessage(errorText(await response.json()));
  const order = await response.json();
  cache = {};
  await renderPurchase();
  summary();
  setMessage(`Compra registrada en el pedido ${order.identificador}.`, true);
  showDetail(order.identificador);
}

// Inicializa la interfaz al terminar de cargar el archivo JavaScript.
choose('compra');
