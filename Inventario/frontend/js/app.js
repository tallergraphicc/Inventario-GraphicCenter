// ==========================================================================
// app.js — arranque de la aplicación, tabs, y dashboard
// ==========================================================================

let appIniciada = false;

async function iniciarApp() {
  try {
    await cargarCatalogos();
    // Los administradores activos llenan el desplegable de "Quién autoriza"
    // en salidas, mermas y ajustes.
    await cargarAutorizadores();
  } catch (err) {
    // Si el token venció, apiFetch ya nos regresó al login solo
    return;
  }

  if (!appIniciada) {
    initTabs();
    initInventarioListeners();
    initMovimientosListeners();
    initRollosListeners();
    initLaminasListeners();
    initUsuariosListeners();
    appIniciada = true;
  }

  aplicarPermisos();
  cambiarTab('dashboard');
}
window.iniciarApp = iniciarApp;

function initTabs() {
  document.querySelectorAll('.inv-tab').forEach((btn) => {
    btn.addEventListener('click', () => cambiarTab(btn.dataset.tab));
  });
}

async function cambiarTab(tab) {
  document.querySelectorAll('.inv-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.inv-view').forEach((v) => v.classList.add('inv-hidden'));
  const vista = document.getElementById(`view-${tab}`);
  vista.classList.remove('inv-hidden');
  // Los avisos de un error anterior se quitan: si ahora carga bien, no
  // tienen por qué seguir ahí (antes se iban apilando).
  vista.querySelectorAll('.inv-tab-error').forEach((el) => el.remove());

  // Si algo falla (servidor apagado, red), se dice — antes la pestaña se
  // quedaba en blanco sin explicación.
  try {
    if (tab === 'dashboard') await renderDashboard();
    else if (tab === 'inventario') await renderInventario();
    else if (tab === 'movimientos') await renderMovimientos();
    else if (tab === 'rollos') await renderRollos();
    else if (tab === 'laminas') await renderLaminas();
    else if (tab === 'config') await renderConfig();
    else if (tab === 'usuarios') await renderUsuarios();
  } catch (err) {
    const aviso = document.createElement('div');
    aviso.className = 'inv-error is-visible inv-tab-error';
    aviso.textContent = `No se pudo cargar esta pestaña: ${err.message}`;
    vista.prepend(aviso);
  }
}

/**
 * Después de guardar algo: recarga los catálogos y repinta SOLO la pestaña
 * que se está viendo. Antes cada guardado repintaba inventario, rollos y
 * dashboard aunque no estuvieran a la vista (varias consultas al servidor
 * por cada clic).
 */
async function refrescarVistas() {
  const visible = (id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('inv-hidden');
  };
  try {
    await cargarCatalogos();
    if (visible('view-dashboard')) await renderDashboard();
    if (visible('view-inventario')) await renderInventario();
    if (visible('view-movimientos')) await renderMovimientos();
    if (visible('view-rollos')) await renderRollos();
    if (visible('view-laminas')) await renderLaminas();
    if (visible('view-config')) await renderConfig();
  } catch (err) {
    console.error('No se pudo refrescar la pantalla', err);
  }
}

// ==========================================================================
// Dashboard
// ==========================================================================

// Las cuatro tarjetas de arriba. Cada una sabe qué materiales le tocan, para
// poder abrir la lista al hacerle clic.
const GRUPOS_DASHBOARD = [
  {
    id: 'activos',
    etiqueta: 'Materiales activos',
    titulo: 'Todos los materiales activos',
    filtro: () => true,
  },
  {
    id: 'bajos',
    etiqueta: 'Bajo / Crítico',
    titulo: 'Materiales en bajo o crítico',
    warn: true,
    filtro: (m) => m.estado === 'BAJO' || m.estado === 'CRITICO',
  },
  {
    id: 'agotados',
    etiqueta: 'Agotados',
    titulo: 'Materiales agotados',
    warn: true,
    filtro: (m) => m.estado === 'AGOTADO',
  },
  {
    // La existencia en negativo siempre es un error que hay que arreglar:
    // antes no se veía en ninguna tarjeta del dashboard.
    id: 'negativos',
    etiqueta: 'En negativo',
    titulo: 'Materiales con existencia negativa (hay que revisarlos)',
    warn: true,
    filtro: (m) => m.estado === 'NEGATIVO',
  },
  {
    id: 'porConfirmar',
    etiqueta: 'Por confirmar',
    titulo: 'Materiales por confirmar o por medir',
    filtro: (m) => m.estado === 'POR_CONFIRMAR' || m.estado === 'POR_MEDIR' || m.estado === 'FALTAN_POR_MEDIR',
  },
];

// Qué tarjeta está desplegada ahora mismo (null = ninguna) y el último
// listado de materiales que trajimos, para poder repintar sin volver a pedirlo.
let DASH_GRUPO_ABIERTO = null;
let DASH_MATERIALES = [];
// Totales del mes elegido en el Dashboard (entradas, salidas, merma en B/.)
let DASH_RESUMEN_MES = null;

async function renderDashboard() {
  const selMes = document.getElementById('dashMes');
  if (!selMes.options.length) {
    selMes.innerHTML = opcionesDeMeses(mesActual());
    selMes.addEventListener('change', async () => {
      await cargarResumenDelMes();
      pintarValorDashboard();
    });
  }

  const [materiales, respuesta] = await Promise.all([
    api.get('/materiales'),
    // /movimientos viene paginado: { movimientos, total, pagina... }. Para el
    // dashboard alcanza con las primeras filas. Si falla, el resto del
    // dashboard igual se pinta y abajo se dice por qué.
    api.get('/movimientos?porPagina=8').catch((err) => ({ movimientos: [], error: err.message })),
    cargarResumenDelMes(),
  ]);
  const movimientos = Array.isArray(respuesta) ? respuesta : respuesta.movimientos;
  guardarEnCache(movimientos);

  DASH_MATERIALES = materiales;
  // Los modales de edición leen de aquí; si no lo refrescamos, editar desde el
  // Dashboard trabajaría con datos viejos.
  CATALOGOS.materiales = materiales;

  pintarTarjetasDashboard();
  pintarValorDashboard();
  pintarListaDashboard();

  const recientes = movimientos.slice(0, 8);
  document.getElementById('dashMovBody').innerHTML = recientes.length
    ? recientes.map((mv) => `
        <tr class="inv-row-clickable" onclick="abrirDetalleMovimiento(${mv.id})">
          <td class="mono">${esc(mv.fecha.slice(0, 10))}</td>
          <td>${chipTipo(mv.tipo)}</td>
          <td class="mono">${esc(mv.material_codigo)}</td>
          <td class="num">${cantidadMovimientoHtml(mv)}</td>
          <td>${esc(mv.area_nombre || mv.motivo || mv.ot || mv.proveedor_nombre || '—')}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="5"><div class="inv-empty">${respuesta.error
        ? `No se pudieron cargar los movimientos.<br><span style="color:var(--color-magenta-dark);">${esc(respuesta.error)}</span>`
        : 'Todavía no hay movimientos.'}</div></td></tr>`;
}

/** Las tarjetas son botones: cada una abre (o cierra) su lista. */
function pintarTarjetasDashboard() {
  document.getElementById('dashStats').innerHTML = GRUPOS_DASHBOARD.map((g) => {
    const cuantos = DASH_MATERIALES.filter(g.filtro).length;
    const abierta = DASH_GRUPO_ABIERTO === g.id;
    return `
      <button type="button"
              class="inv-stat-card inv-stat-card-btn ${g.warn ? 'warn' : ''} ${abierta ? 'is-open' : ''}"
              onclick="alternarGrupoDashboard('${g.id}')"
              aria-expanded="${abierta}">
        <div class="value">${cuantos}</div>
        <div class="label">${esc(g.etiqueta)}</div>
        <div class="inv-stat-accion">${abierta ? 'Ocultar lista' : 'Ver lista'}</div>
      </button>
    `;
  }).join('');
}

// ==========================================================================
// Valor del inventario y del mes
//
// Valor del inventario = existencia × costo por unidad de cada material, hoy.
// Del mes = cuánto entró, salió y se perdió en merma en el mes elegido,
// valorizado con el costo que se guardó en cada movimiento.
// ==========================================================================

async function cargarResumenDelMes() {
  const mes = document.getElementById('dashMes').value || mesActual();
  const { desde, hasta } = rangoDelMes(mes);
  try {
    DASH_RESUMEN_MES = await api.get(`/movimientos/resumen?desde=${desde}&hasta=${hasta}`);
  } catch (err) {
    DASH_RESUMEN_MES = null;
  }
}

/** Suma existencia × costo. Lo negativo o sin confirmar no suma. */
function calcularValorInventario(materiales) {
  let valor = 0;
  let conValor = 0;
  let sinCosto = 0;
  materiales.forEach((m) => {
    const existencia = Number(m.existencia);
    if (!(existencia > 0)) return;
    if (m.costo == null) { sinCosto++; return; }
    valor += existencia * Number(m.costo);
    conValor++;
  });
  return { valor, conValor, sinCosto };
}

function pintarValorDashboard() {
  const cont = document.getElementById('dashValor');
  const mes = document.getElementById('dashMes').value || mesActual();
  const nombreMes = nombreDelMes(mes).split(' ')[0];
  const { valor, conValor, sinCosto } = calcularValorInventario(DASH_MATERIALES);
  const abierta = DASH_GRUPO_ABIERTO === 'valor';

  const porTipo = (DASH_RESUMEN_MES && DASH_RESUMEN_MES.porTipo) || [];
  const delTipo = (tipo) => porTipo.find((t) => t.tipo === tipo) || { valor: 0, registros: 0 };

  const tarjetaMes = (tipo, etiqueta, warn) => {
    const t = delTipo(tipo);
    const hayDatos = !!DASH_RESUMEN_MES;
    return `
      <button type="button" class="inv-stat-card inv-stat-card-btn ${warn ? 'warn' : ''}"
              onclick="verMovimientosDelMes('${tipo}', '${mes}')">
        <div class="value inv-valor">${hayDatos ? esc(money(t.valor || 0)) : '—'}</div>
        <div class="label">${esc(etiqueta)} de ${esc(nombreMes)}</div>
        <div class="inv-stat-sub">${hayDatos ? `${t.registros} movimiento${Number(t.registros) === 1 ? '' : 's'}` : 'sin datos'}</div>
        <div class="inv-stat-accion">Ver en Movimientos</div>
      </button>`;
  };

  cont.innerHTML = `
    <button type="button" class="inv-stat-card inv-stat-card-btn ${abierta ? 'is-open' : ''}"
            onclick="alternarGrupoDashboard('valor')" aria-expanded="${abierta}">
      <div class="value inv-valor">${esc(money(valor))}</div>
      <div class="label">Valor del inventario hoy</div>
      <div class="inv-stat-sub">
        ${conValor} material${conValor === 1 ? '' : 'es'} con costo${sinCosto
          ? ` · <span style="color:var(--color-magenta-dark);">${sinCosto} sin costo no suman</span>` : ''}
      </div>
      <div class="inv-stat-accion">${abierta ? 'Ocultar detalle' : 'Ver por material'}</div>
    </button>
    ${tarjetaMes('ENTRADA', 'Entradas')}
    ${tarjetaMes('SALIDA', 'Salidas')}
    ${tarjetaMes('MERMA', 'Merma', true)}
    ${DASH_RESUMEN_MES ? '' : `<div class="inv-hint" style="grid-column:1/-1;">No se pudieron traer los totales del mes.</div>`}
  `;
}

/** Lista de materiales ordenados por cuánto valen en bodega. */
function pintarListaValor(cont) {
  const conExistencia = DASH_MATERIALES.filter((m) => Number(m.existencia) > 0);
  const total = calcularValorInventario(DASH_MATERIALES).valor;
  const lista = conExistencia
    .map((m) => ({ ...m, valor: m.costo == null ? null : Number(m.existencia) * Number(m.costo) }))
    .sort((a, b) => (b.valor ?? -1) - (a.valor ?? -1) || a.codigo.localeCompare(b.codigo));

  const filas = lista.map((m) => `
    <tr>
      <td class="mono">${esc(m.codigo)}</td>
      <td>${esc(m.descripcion)}</td>
      <td class="num">${Number(m.existencia).toLocaleString('es-PA', { maximumFractionDigits: 4 })} ${esc(m.unidad_codigo)}</td>
      <td class="num">${m.costo == null ? '<span class="inv-sin-dato">sin costo</span>' : esc(moneyUnitario(m.costo))}</td>
      <td class="num">${m.valor == null ? '<span class="inv-sin-dato">—</span>' : `<strong>${esc(money(m.valor))}</strong>`}</td>
      <td class="num">${m.valor != null && total > 0 ? `${(m.valor / total * 100).toLocaleString('es-PA', { maximumFractionDigits: 1 })}%` : '—'}</td>
    </tr>`).join('');

  cont.innerHTML = `
    <div class="inv-table-wrap" style="margin-bottom:2rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap; padding:1rem 1.25rem; border-bottom:1px solid rgba(var(--texto-rgb),0.08);">
        <strong class="font-display" style="font-size:0.95rem;">
          Valor por material <span style="color:rgba(var(--texto-rgb),0.45); font-weight:400;">(total ${esc(money(total))})</span>
        </strong>
        <span class="inv-hint" style="margin:0;">Existencia × costo por unidad. El costo se pone al registrar una entrada o en Editar material.</span>
        <button type="button" class="btn btn-outline chip" style="padding:0.4rem 0.8rem; font-size:0.7rem;"
                onclick="alternarGrupoDashboard('valor')">Cerrar</button>
      </div>
      <table class="inv-table">
        <thead><tr><th>Código</th><th>Descripción</th><th>Existencia</th><th>Costo / unidad</th><th>Valor</th><th>% del total</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="6"><div class="inv-empty">No hay materiales con existencia.</div></td></tr>`}</tbody>
      </table>
    </div>`;
}

/** Abre la lista de una tarjeta, o la cierra si ya estaba abierta. */
function alternarGrupoDashboard(id) {
  DASH_GRUPO_ABIERTO = DASH_GRUPO_ABIERTO === id ? null : id;
  pintarTarjetasDashboard();
  pintarValorDashboard();
  pintarListaDashboard();
  if (DASH_GRUPO_ABIERTO) {
    document.getElementById('dashLista').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/** La lista de materiales del grupo abierto, con sus botones de acción. */
function pintarListaDashboard() {
  const cont = document.getElementById('dashLista');
  if (DASH_GRUPO_ABIERTO === 'valor') { pintarListaValor(cont); return; }
  const grupo = GRUPOS_DASHBOARD.find((g) => g.id === DASH_GRUPO_ABIERTO);

  if (!grupo) { cont.innerHTML = ''; return; }

  const lista = DASH_MATERIALES.filter(grupo.filtro)
    .slice()
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  const cuerpo = lista.length
    ? lista.map(filaMaterial).join('')
    : `<tr><td colspan="7"><div class="inv-empty">No hay materiales en este grupo. Buena señal.</div></td></tr>`;

  cont.innerHTML = `
    <div class="inv-table-wrap" style="margin-bottom:2rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap; padding:1rem 1.25rem; border-bottom:1px solid rgba(var(--texto-rgb),0.08);">
        <strong class="font-display" style="font-size:0.95rem;">
          ${esc(grupo.titulo)} <span style="color:rgba(var(--texto-rgb),0.45); font-weight:400;">(${lista.length})</span>
        </strong>
        <button type="button" class="btn btn-outline chip" style="padding:0.4rem 0.8rem; font-size:0.7rem;"
                onclick="alternarGrupoDashboard('${grupo.id}')">Cerrar</button>
      </div>
      <table class="inv-table">
        <thead><tr>
          <th>Código</th><th>Descripción</th><th>Categoría</th><th>Existencia</th><th>Unidad</th><th>Estado</th><th>Acciones</th>
        </tr></thead>
        <tbody>${cuerpo}</tbody>
      </table>
    </div>
  `;
}

// --- Configuración (ahora sí editable: crear y eliminar) ---
async function renderConfig() {
  // Proveedores con cuántas entradas tiene cada uno (se pide de nuevo: pudo
  // cambiar desde la última vez). Si falla, casi seguro falta la migración 005.
  let errorProveedores = '';
  try {
    CATALOGOS.proveedores = await api.get('/catalogos/proveedores');
  } catch (err) {
    errorProveedores = err.message;
  }
  const escribe = puedeEscribir();

  const bloqueSimple = (titulo, items, tipo) => `
    <div class="inv-table-wrap" style="padding:1.25rem;">
      <h3 class="font-display" style="font-size:1rem; margin:0 0 1rem;">${titulo}</h3>
      <ul style="margin:0 0 1rem; padding-left:1.1rem; font-size:0.875rem; color:rgba(var(--texto-rgb),0.7);">
        ${items.map((i) => `
          <li style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; padding:0.25rem 0;">
            <span>${esc(i.label)}</span>
            ${esAdmin() ? `<button onclick="eliminarCatalogo('${tipo}', ${i.id})" style="border:none;background:none;color:var(--color-magenta);cursor:pointer;font-size:0.75rem;">Eliminar</button>` : ''}
          </li>`).join('')}
      </ul>
      ${escribe ? `<form onsubmit="return crearCatalogoSimple(event, '${tipo}')" style="display:flex; gap:0.5rem;">
        <input type="text" placeholder="Nombre nuevo..." required style="flex:1; padding:0.5rem 0.7rem; border:1px solid rgba(var(--texto-rgb),0.15); border-radius:6px; font-size:0.85rem;">
        <button type="submit" class="btn btn-outline chip" style="padding:0.5rem 0.9rem;">+ Agregar</button>
      </form>` : ''}
    </div>
  `;

  // Proveedores: muestra cuántas entradas tiene cada uno. El que ya tiene
  // compras no se puede eliminar (el histórico perdería a quién se le compró).
  const proveedores = CATALOGOS.proveedores || [];
  const bloqueProveedores = `
    <div class="inv-table-wrap" style="padding:1.25rem;">
      <h3 class="font-display" style="font-size:1rem; margin:0 0 1rem;">Proveedores</h3>
      ${errorProveedores ? `
        <div class="inv-error is-visible">
          No se pudieron cargar los proveedores (${esc(errorProveedores)}).
          Si es la primera vez, falta correr <code>database/migracion-005-proveedores-y-documento.sql</code>.
        </div>` : `
      <ul style="margin:0 0 1rem; padding-left:1.1rem; font-size:0.875rem; color:rgba(var(--texto-rgb),0.7);">
        ${proveedores.length ? proveedores.map((p) => `
          <li style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; padding:0.25rem 0;">
            <span>${esc(p.nombre)}
              <span style="color:rgba(var(--texto-rgb),0.4); font-size:0.75rem;">
                ${Number(p.movimientos) ? `· ${p.movimientos} entrada${Number(p.movimientos) === 1 ? '' : 's'}` : '· sin compras'}
              </span>
            </span>
            ${esAdmin() && !Number(p.movimientos)
              ? `<button onclick="eliminarCatalogo('proveedores', ${p.id})" style="border:none;background:none;color:var(--color-magenta);cursor:pointer;font-size:0.75rem;">Eliminar</button>`
              : ''}
          </li>`).join('') : '<li style="list-style:none; margin-left:-1.1rem;">Todavía no hay proveedores.</li>'}
      </ul>
      ${escribe ? `<form onsubmit="return crearCatalogoSimple(event, 'proveedores')" style="display:flex; gap:0.5rem;">
        <input type="text" placeholder="Nombre del proveedor..." required maxlength="120" style="flex:1; padding:0.5rem 0.7rem; border:1px solid rgba(var(--texto-rgb),0.15); border-radius:6px; font-size:0.85rem;">
        <button type="submit" class="btn btn-outline chip" style="padding:0.5rem 0.9rem;">+ Agregar</button>
      </form>` : ''}`}
    </div>
  `;

  const bloqueCategorias = `
    <div class="inv-table-wrap" style="padding:1.25rem;">
      <h3 class="font-display" style="font-size:1rem; margin:0 0 1rem;">Categorías y subcategorías</h3>
      ${CATALOGOS.categorias.map((c) => `
        <div style="margin-bottom:1rem;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:0.9rem;">${esc(c.nombre)}</strong>
            ${esAdmin() ? `<button onclick="eliminarCatalogo('categorias', ${c.id})" style="border:none;background:none;color:var(--color-magenta);cursor:pointer;font-size:0.75rem;">Eliminar categoría</button>` : ''}
          </div>
          <ul style="margin:0.4rem 0; padding-left:1.1rem; font-size:0.8rem; color:rgba(var(--texto-rgb),0.65);">
            ${c.subcategorias.map((s) => `
              <li style="display:flex; justify-content:space-between; align-items:center;">
                <span>${esc(s.nombre)}</span>
                ${esAdmin() ? `<button onclick="eliminarCatalogo('subcategorias', ${s.id})" style="border:none;background:none;color:var(--color-magenta);cursor:pointer;font-size:0.7rem;">Eliminar</button>` : ''}
              </li>`).join('')}
          </ul>
          ${escribe ? `<form onsubmit="return crearSubcategoria(event, ${c.id})" style="display:flex; gap:0.5rem;">
            <input type="text" placeholder="Nueva subcategoría..." required style="flex:1; padding:0.4rem 0.6rem; border:1px solid rgba(var(--texto-rgb),0.15); border-radius:6px; font-size:0.8rem;">
            <button type="submit" class="btn btn-outline chip" style="padding:0.4rem 0.7rem; font-size:0.7rem;">+ Agregar</button>
          </form>` : ''}
        </div>
      `).join('')}
      ${escribe ? `<hr style="border:none; border-top:1px solid rgba(var(--texto-rgb),0.08); margin:1rem 0;">
      <form onsubmit="return crearCatalogoSimple(event, 'categorias')" style="display:flex; gap:0.5rem;">
        <input type="text" placeholder="Nueva categoría..." required style="flex:1; padding:0.5rem 0.7rem; border:1px solid rgba(var(--texto-rgb),0.15); border-radius:6px; font-size:0.85rem;">
        <button type="submit" class="btn btn-magenta chip" style="padding:0.5rem 0.9rem;">+ Categoría</button>
      </form>` : ''}
    </div>
  `;

  const bloqueUnidades = `
    <div class="inv-table-wrap" style="padding:1.25rem;">
      <h3 class="font-display" style="font-size:1rem; margin:0 0 1rem;">Unidades de medida</h3>
      <ul style="margin:0 0 1rem; padding-left:1.1rem; font-size:0.875rem; color:rgba(var(--texto-rgb),0.7);">
        ${CATALOGOS.unidades.map((u) => `
          <li style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; padding:0.25rem 0;">
            <span>${esc(u.codigo)} — ${esc(u.nombre)}</span>
            ${esAdmin() && !['PIE LINEAL', 'METRO LINEAL', 'LAMINA'].includes(u.codigo)
              ? `<button onclick="eliminarCatalogo('unidades', ${u.id})" style="border:none;background:none;color:var(--color-magenta);cursor:pointer;font-size:0.75rem;">Eliminar</button>`
              : ['PIE LINEAL', 'METRO LINEAL', 'LAMINA'].includes(u.codigo) ? '<span style="color:rgba(var(--texto-rgb),0.4); font-size:0.7rem;" title="La usan los rollos y las láminas: no se puede eliminar">del sistema</span>' : ''}
          </li>`).join('')}
      </ul>
      ${escribe ? `<form onsubmit="return crearUnidad(event)" style="display:flex; gap:0.5rem;">
        <input type="text" id="cfg-unidad-codigo" placeholder="Código (ej. CAJA)" required style="width:35%; padding:0.5rem 0.7rem; border:1px solid rgba(var(--texto-rgb),0.15); border-radius:6px; font-size:0.85rem;">
        <input type="text" id="cfg-unidad-nombre" placeholder="Nombre legible" required style="flex:1; padding:0.5rem 0.7rem; border:1px solid rgba(var(--texto-rgb),0.15); border-radius:6px; font-size:0.85rem;">
        <button type="submit" class="btn btn-outline chip" style="padding:0.5rem 0.9rem;">+ Agregar</button>
      </form>` : ''}
    </div>
  `;

  document.getElementById('configLists').innerHTML =
    bloqueCategorias +
    bloqueProveedores +
    bloqueSimple('Bodegas', CATALOGOS.bodegas.map((b) => ({ id: b.id, label: b.nombre })), 'bodegas') +
    bloqueSimple('Áreas', CATALOGOS.areas.map((a) => ({ id: a.id, label: a.nombre })), 'areas') +
    bloqueUnidades;
}

async function crearCatalogoSimple(e, tipo) {
  e.preventDefault();
  const input = e.target.querySelector('input');
  try {
    await api.post(`/catalogos/${tipo}`, { nombre: input.value.trim() });
    await cargarCatalogos();
    await renderConfig();
  } catch (err) {
    alert(err.message);
  }
  return false;
}

async function crearSubcategoria(e, categoriaId) {
  e.preventDefault();
  const input = e.target.querySelector('input');
  try {
    await api.post(`/catalogos/categorias/${categoriaId}/subcategorias`, { nombre: input.value.trim() });
    await cargarCatalogos();
    await renderConfig();
  } catch (err) {
    alert(err.message);
  }
  return false;
}

async function crearUnidad(e) {
  e.preventDefault();
  try {
    await api.post('/catalogos/unidades', {
      codigo: document.getElementById('cfg-unidad-codigo').value.trim().toUpperCase(),
      nombre: document.getElementById('cfg-unidad-nombre').value.trim(),
    });
    await cargarCatalogos();
    await renderConfig();
  } catch (err) {
    alert(err.message);
  }
  return false;
}

async function eliminarCatalogo(tipo, id) {
  if (!confirm('¿Eliminar este elemento? Esta acción no se puede deshacer.')) return;
  try {
    await api.delete(`/catalogos/${tipo}/${id}`);
    await cargarCatalogos();
    await renderConfig();
  } catch (err) {
    alert(err.message);
  }
}
