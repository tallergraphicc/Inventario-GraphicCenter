// ==========================================================================
// materiales.js — catálogos compartidos + todos los modales de movimiento
// ==========================================================================

const CATALOGOS = { categorias: [], unidades: [], bodegas: [], areas: [], proveedores: [], materiales: [] };

const MOTIVOS_MERMA = [
  'Error de impresión', 'Error de corte', 'Error de medida', 'Daño durante producción',
  'Daño durante instalación', 'Material defectuoso', 'Material vencido', 'Prueba de impresión',
  'Calibración', 'Retazo no aprovechable', 'Daño por almacenamiento', 'Error humano', 'Otro',
];
const TIPOS_ENTRADA = [
  ['COMPRA', 'Compra'], ['DEVOLUCION_PRODUCCION', 'Devolución de producción'],
  ['TRASLADO', 'Traslado'], ['DEVOLUCION_CLIENTE', 'Devolución de cliente'],
  ['INVENTARIO_INICIAL', 'Inventario inicial'], ['REINGRESO_RETAZO', 'Reingreso de retazo'],
];
// Ojo: "Traslado entre bodegas" ya NO está aquí. La bodega es ubicación, no
// un almacén con stock propio, así que mover algo de sitio no consume nada.
// Para eso está el botón "Trasladar", que solo cambia dónde está.
const TIPOS_SALIDA = [
  ['PRODUCCION', 'Producción'], ['INSTALACION', 'Instalación'], ['MUESTRA', 'Muestra'],
  ['GARANTIA_REPROCESO', 'Garantía / Reproceso'],
  ['VENTA_DIRECTA', 'Venta directa'], ['PRESTAMO', 'Préstamo'],
  // Sobre todo para retazos de lámina que se usan para empacar
  ['EMBALAJE', 'Embalaje'],
];

async function cargarCatalogos() {
  const [categorias, unidades, bodegas, areas, materiales, proveedores] = await Promise.all([
    api.get('/catalogos/categorias'), api.get('/catalogos/unidades'),
    api.get('/catalogos/bodegas'), api.get('/catalogos/areas'), api.get('/materiales'),
    // Si todavía no se corrió la migración 005, la tabla de proveedores no
    // existe y esto falla. No debe tumbar todo el sistema: se sigue sin
    // proveedores y ya.
    api.get('/catalogos/proveedores').catch(() => []),
  ]);
  Object.assign(CATALOGOS, { categorias, unidades, bodegas, areas, materiales, proveedores });
}

/**
 * Fecha de hoy como AAAA-MM-DD, en hora de Panamá.
 * Con toISOString() salía la fecha de Greenwich: después de las 7 p. m. las
 * entradas quedaban con fecha de mañana.
 */
function fechaLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}
const hoy = () => fechaLocal(new Date());

function opt(items, valueKey, labelKey, selected) {
  return items
    .map((i) => `<option value="${esc(i[valueKey])}" ${i[valueKey] == selected ? 'selected' : ''}>${esc(i[labelKey])}</option>`)
    .join('');
}

// --- Infraestructura de modal genérica ---
function abrirModal(html, opciones = {}) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="inv-modal-overlay" id="modalOverlay"><div class="inv-modal">${html}</div></div>`;
  if (opciones.fijo) return; // no se cierra haciendo clic afuera

  // Solo se cierra si el clic EMPIEZA y TERMINA en el fondo gris. Antes,
  // seleccionar texto dentro del formulario y soltar el mouse afuera cerraba
  // la ventana y se perdía todo lo escrito.
  const overlay = document.getElementById('modalOverlay');
  let empezoAfuera = false;
  overlay.addEventListener('mousedown', (e) => { empezoAfuera = e.target.id === 'modalOverlay'; });
  overlay.addEventListener('click', (e) => {
    if (empezoAfuera && e.target.id === 'modalOverlay') cerrarModal();
    empezoAfuera = false;
  });
}

/**
 * Opciones de material para los desplegables: "CÓDIGO — descripción".
 * Antes solo se veía el código y era fácil elegir el vinil equivocado.
 */
function optMateriales(materiales, seleccionado) {
  return materiales
    .map((m) => `<option value="${esc(m.id)}" ${m.id == seleccionado ? 'selected' : ''}>${esc(m.codigo)} — ${esc(m.descripcion)}</option>`)
    .join('');
}
function cerrarModal() {
  document.getElementById('modalRoot').innerHTML = '';
}

// ==========================================================================
// Modal: Nuevo material
// ==========================================================================
function abrirModalNuevoMaterial() {
  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Nuevo material</h3>
    <form id="formNuevoMaterial">
      <div class="form-two-col">
        <div class="form-row"><label>Código *</label><input type="text" id="m-codigo" required placeholder="VIN-BRI-001"></div>
        <div class="form-row"><label>Unidad *</label><select id="m-unidad" required>
          <option value="">Elige la unidad…</option>${opt(CATALOGOS.unidades, 'id', 'nombre')}</select></div>
      </div>
      <div class="form-row"><label>Descripción *</label><input type="text" id="m-descripcion" required></div>
      <div class="form-two-col">
        <div class="form-row"><label>Categoría *</label><select id="m-categoria" required onchange="onCambiaCategoria()">
          <option value="">Elige la categoría…</option>${opt(CATALOGOS.categorias, 'id', 'nombre')}</select></div>
        <div class="form-row"><label>Subcategoría</label><select id="m-subcategoria"></select></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Bodega</label><select id="m-bodega"><option value="">Sin definir</option>${opt(CATALOGOS.bodegas, 'id', 'nombre')}</select></div>
        <div class="form-row"><label>Ubicación</label><input type="text" id="m-ubicacion" placeholder="Estante 3"></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Inventario inicial</label><input type="number" step="any" id="m-inicial" placeholder="Déjalo vacío si no se conoce"></div>
        <div class="form-row"><label>Stock mínimo</label><input type="number" step="any" id="m-minimo"></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Costo de referencia</label><input type="number" step="any" id="m-costo"></div>
        <div class="form-row"><label>Espesor (mm)</label><input type="number" step="any" min="0" id="m-espesor" placeholder="Solo láminas, ej. 3"></div>
      </div>
      <p class="inv-hint" style="margin-top:-0.5rem;">Para acrílico, MDF, coroplast, caucho, foam o PVC usa la unidad
        <strong>Lámina</strong>: se cuentan por láminas de 4×8 y en la salida se ponen las medidas del corte.
        Un material por color y espesor (ej. "Acrílico negro 3 mm").</p>
      <div class="form-row"><label>Observaciones</label><textarea id="m-obs" rows="2"></textarea></div>
      <div id="m-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Guardar material</button>
      </div>
    </form>
  `);
  onCambiaCategoria();

  document.getElementById('formNuevoMaterial').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('m-error');
    try {
      await api.post('/materiales', {
        codigo: document.getElementById('m-codigo').value,
        descripcion: document.getElementById('m-descripcion').value,
        categoriaId: document.getElementById('m-categoria').value,
        subcategoriaId: document.getElementById('m-subcategoria').value || null,
        unidadId: document.getElementById('m-unidad').value,
        bodegaId: document.getElementById('m-bodega').value || null,
        ubicacion: document.getElementById('m-ubicacion').value || null,
        inventarioInicial: document.getElementById('m-inicial').value || null,
        stockMinimo: document.getElementById('m-minimo').value || null,
        costo: document.getElementById('m-costo').value || null,
        espesorMm: document.getElementById('m-espesor').value || null,
        observaciones: document.getElementById('m-obs').value || null,
      });
      cerrarModal();
      await refrescarVistas();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

function onCambiaCategoria() {
  const catId = document.getElementById('m-categoria').value;
  const cat = CATALOGOS.categorias.find((c) => c.id == catId);
  const sel = document.getElementById('m-subcategoria');
  sel.innerHTML = '<option value="">Sin subcategoría</option>' + (cat ? opt(cat.subcategorias, 'id', 'nombre') : '');
}

// ==========================================================================
// Modal: Importar materiales desde Excel
// ==========================================================================

// Columna del Excel -> campo que espera el backend (ver materiales.controller.js importar())
const COLUMNAS_IMPORTAR = {
  'Código': 'codigo', 'Descripción': 'descripcion', 'Categoría': 'categoria',
  'Subcategoría': 'subcategoria', 'Unidad': 'unidad', 'Existencia inicial': 'existenciaInicial',
  'Stock mínimo': 'stockMinimo', 'Costo de referencia': 'costo', 'Bodega': 'bodega',
  'Ubicación': 'ubicacion', 'Espesor (mm)': 'espesorMm', 'Observaciones': 'observaciones',
};

/**
 * Arma y descarga la plantilla de Excel. Lleva una segunda hoja con los
 * catálogos que ya existen en el sistema (categorías, subcategorías,
 * unidades, bodegas), para no tener que adivinar cómo está escrito algo.
 */
function descargarPlantillaImportar() {
  const encabezados = Object.keys(COLUMNAS_IMPORTAR);
  const ejemplo = [
    'EJEMPLO-BORRAR', 'Borra esta fila antes de importar', 'VINILES', '',
    'PIE LINEAL', 100, '', '', '', '', '', 'Esta fila es solo de ejemplo',
  ];
  const hojaMateriales = XLSX.utils.aoa_to_sheet([encabezados, ejemplo]);

  const categoriasFlat = [];
  CATALOGOS.categorias.forEach((c) => {
    if (!c.subcategorias || !c.subcategorias.length) categoriasFlat.push(c.nombre);
    else c.subcategorias.forEach((s) => categoriasFlat.push(`${c.nombre}  >  ${s.nombre}`));
  });
  const unidadesFlat = CATALOGOS.unidades.map((u) => `${u.codigo} — ${u.nombre}`);
  const bodegasFlat = CATALOGOS.bodegas.map((b) => b.nombre);
  const maxFilas = Math.max(categoriasFlat.length, unidadesFlat.length, bodegasFlat.length, 1);

  const filasAyuda = [['Categorías (y subcategorías) válidas', 'Unidades válidas', 'Bodegas válidas']];
  for (let i = 0; i < maxFilas; i++) {
    filasAyuda.push([categoriasFlat[i] || '', unidadesFlat[i] || '', bodegasFlat[i] || '']);
  }
  const hojaAyuda = XLSX.utils.aoa_to_sheet(filasAyuda);

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hojaMateriales, 'Materiales');
  XLSX.utils.book_append_sheet(libro, hojaAyuda, 'Ayuda');
  XLSX.writeFile(libro, 'plantilla-inventario.xlsx');
}

function abrirModalImportarExcel() {
  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Importar materiales desde Excel</h3>
    <p class="inv-hint">
      Para materiales nuevos, con su existencia inicial — igual que "+ Nuevo material" pero de a
      muchos. Si un código ya existe en el sistema, esa fila se rechaza: nunca pisa un material que
      ya tenías. No crea rollos ni láminas individuales; esos se siguen agregando uno por uno en su
      propia pestaña.
    </p>
    <p><button type="button" class="btn btn-outline chip" onclick="descargarPlantillaImportar()">Descargar plantilla</button></p>
    <form id="formImportarExcel">
      <div class="form-row"><label>Archivo (.xlsx) *</label><input type="file" id="imp-archivo" accept=".xlsx,.xls" required></div>
      <div id="imp-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Importar</button>
      </div>
    </form>
    <div id="imp-resultado"></div>
  `);

  document.getElementById('formImportarExcel').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('imp-error');
    errBox.textContent = '';
    errBox.classList.remove('is-visible');
    const archivo = document.getElementById('imp-archivo').files[0];
    if (!archivo) return;

    try {
      const buffer = await archivo.arrayBuffer();
      const libro = XLSX.read(buffer, { type: 'array' });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      if (!hoja) throw new Error('El archivo no tiene ninguna hoja con datos.');
      const filasCrudas = XLSX.utils.sheet_to_json(hoja, { defval: '' });

      const materiales = filasCrudas
        .map((fila) => {
          const mapeada = {};
          for (const [col, clave] of Object.entries(COLUMNAS_IMPORTAR)) {
            mapeada[clave] = fila[col] !== undefined ? fila[col] : '';
          }
          return mapeada;
        })
        .filter((f) => String(f.codigo || '').trim().toUpperCase() !== 'EJEMPLO-BORRAR');

      if (!materiales.length) {
        throw new Error('El archivo no tiene filas para importar (¿solo quedó el encabezado?).');
      }

      const resultado = await api.post('/materiales/importar', { materiales });
      mostrarResultadoImportar(resultado);
      await refrescarVistas();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

function mostrarResultadoImportar(resultado) {
  const { creados, rechazados } = resultado;
  document.getElementById('formImportarExcel').classList.add('inv-hidden');

  let html = `<p class="inv-hint"><strong>${creados.length}</strong> material(es) importado(s) correctamente.</p>`;
  if (rechazados.length) {
    html += `
      <p class="inv-hint"><strong>${rechazados.length}</strong> fila(s) rechazada(s) — nada de esto se importó:</p>
      <div class="inv-table-wrap"><table class="inv-table"><thead><tr>
        <th>Fila del Excel</th><th>Código</th><th>Motivo</th>
      </tr></thead><tbody>
        ${rechazados.map((r) => `<tr><td>${esc(r.fila)}</td><td class="mono">${esc(r.codigo)}</td><td>${esc(r.motivos.join('; '))}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  html += `<div class="inv-modal-actions"><button type="button" class="btn btn-magenta chip" onclick="cerrarModal()">Cerrar</button></div>`;
  document.getElementById('imp-resultado').innerHTML = html;
}

// ==========================================================================
// Modal: Editar material (incluye el stock mínimo)
// ==========================================================================
function abrirModalEditarMaterial(materialId) {
  const m = CATALOGOS.materiales.find((x) => x.id === materialId);
  if (!m) return;

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Editar material — <span class="mono">${esc(m.codigo)}</span></h3>
    <form id="formEditarMaterial">
      <div class="form-row"><label>Descripción *</label><input type="text" id="em-descripcion" required value="${esc(m.descripcion)}"></div>
      <div class="form-row"><label>Unidad de medida *</label>
        <select id="em-unidad" required ${!esAdmin() && m.estado !== 'POR_MEDIR' ? 'disabled' : ''}>${opt(CATALOGOS.unidades, 'id', 'nombre', m.unidad_id)}</select>
        <p class="inv-hint" style="margin:0.3rem 0 0;">
          ${!esAdmin() && m.estado !== 'POR_MEDIR'
            ? 'Este material ya tiene existencia registrada: cambiarle la unidad solo lo puede hacer un administrador.'
            : `Para corregir un error al dar de alta el material. Si ya tiene movimientos
          registrados, cambiarla deja el histórico sin sentido y solo lo puede hacer
          un administrador.`}
        </p>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Categoría *</label><select id="em-categoria" required onchange="onCambiaCategoriaEditar()">${opt(CATALOGOS.categorias, 'id', 'nombre', m.categoria_id)}</select></div>
        <div class="form-row"><label>Subcategoría</label><select id="em-subcategoria"></select></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Bodega</label><select id="em-bodega"><option value="">Sin definir</option>${opt(CATALOGOS.bodegas, 'id', 'nombre', m.bodega_id)}</select></div>
        <div class="form-row"><label>Ubicación</label><input type="text" id="em-ubicacion" value="${esc(m.ubicacion)}"></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Stock mínimo</label><input type="number" step="any" id="em-minimo" value="${esc(m.stock_minimo ?? '')}" placeholder="Sin mínimo definido"></div>
        <div class="form-row"><label>Costo por ${esc((m.unidad_codigo || 'unidad').toLowerCase())}</label><input type="number" step="any" id="em-costo" value="${esc(m.costo ?? '')}"></div>
      </div>
      <div class="form-row"><label>Espesor (mm)</label><input type="number" step="any" min="0" id="em-espesor" value="${esc(m.espesor_mm ?? '')}" placeholder="Solo láminas, ej. 3"></div>
      ${esMaterialDeLamina(m) ? `<p class="inv-hint" style="margin-top:-0.5rem;">
        Material por láminas: la existencia y el costo van <strong>por lámina de 4×8</strong> (32 pie²).</p>` : ''}
      ${esMaterialDeRollo(m) ? `<p class="inv-hint" style="margin-top:-0.5rem;">
        ¿Tienes el costo del rollo completo y no por pie? Ponlo en <strong>Rollos → Editar</strong>
        el rollo, en "Costo del rollo completo", y el costo por pie se calcula solo.</p>` : ''}
      <div class="form-row"><label>Observaciones</label><textarea id="em-obs" rows="2">${esc(m.observaciones)}</textarea></div>
      <div id="em-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Guardar cambios</button>
      </div>
    </form>
  `);

  onCambiaCategoriaEditar(m.subcategoria_id);

  document.getElementById('formEditarMaterial').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('em-error');
    try {
      await api.put(`/materiales/${materialId}`, {
        descripcion: document.getElementById('em-descripcion').value,
        // Si el campo está bloqueado (no admin), no se manda: no cambia
        ...(document.getElementById('em-unidad').disabled ? {} : { unidadId: document.getElementById('em-unidad').value }),
        categoriaId: document.getElementById('em-categoria').value,
        subcategoriaId: document.getElementById('em-subcategoria').value || null,
        bodegaId: document.getElementById('em-bodega').value || null,
        ubicacion: document.getElementById('em-ubicacion').value || null,
        stockMinimo: document.getElementById('em-minimo').value || null,
        costo: document.getElementById('em-costo').value || null,
        espesorMm: document.getElementById('em-espesor').value,
        observaciones: document.getElementById('em-obs').value || null,
      });
      cerrarModal();
      await refrescarVistas();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

function onCambiaCategoriaEditar(subSeleccionada) {
  const catId = document.getElementById('em-categoria').value;
  const cat = CATALOGOS.categorias.find((c) => c.id == catId);
  const sel = document.getElementById('em-subcategoria');
  sel.innerHTML = '<option value="">Sin subcategoría</option>' + (cat ? opt(cat.subcategorias, 'id', 'nombre', subSeleccionada) : '');
}

// ==========================================================================
// Modal: Registrar entrada
// ==========================================================================
/** ¿Este material se maneja por rollos? (pie lineal o metro lineal) */
function esMaterialDeRollo(m) {
  return !!m && (m.unidad_codigo === 'PIE LINEAL' || m.unidad_codigo === 'METRO LINEAL');
}

/** ¿Se maneja por láminas de 4x8? (unidad "Lámina": acrílico, MDF, foam, PVC...) */
function esMaterialDeLamina(m) {
  return !!m && m.unidad_codigo === 'LAMINA';
}

/**
 * Campo de costo con dos modos: el costo TOTAL de la compra (lo normal en el
 * taller: "el rollo me costó B/. 100") o el costo por unidad. Muestra al lado
 * cuánto sale la otra cifra, para que se vea en el momento si está bien.
 *
 * prefijo: el prefijo de los ids (ej. 'e' → e-costo-modo, e-costo-valor...)
 * idCantidad: de dónde sacar la cantidad para hacer la división
 */
function campoCosto(prefijo, modoPorDefecto, unidad) {
  return `
    <div class="form-row">
      <label>Costo</label>
      <div style="display:flex; gap:0.5rem;">
        <select id="${prefijo}-costo-modo" style="flex:0 0 46%;">
          <option value="total" ${modoPorDefecto === 'total' ? 'selected' : ''}>Costo total de la compra</option>
          <option value="unidad" ${modoPorDefecto === 'unidad' ? 'selected' : ''}>Costo por unidad</option>
        </select>
        <input type="number" step="any" min="0" id="${prefijo}-costo-valor" placeholder="B/." style="flex:1;">
      </div>
      <p class="inv-hint" id="${prefijo}-costo-calculo" style="margin:0.35rem 0 0;">
        ${esc(unidad ? `Si pones el total, el sistema calcula cuánto sale cada ${nombreUnidad(unidad)}.` : '')}
      </p>
    </div>`;
}

// ==========================================================================
// Proveedor y documento de respaldo (N° de factura o cotización)
//
// Se usan en la entrada y en "Editar proveedor y factura" del detalle del
// movimiento. Si el proveedor no está en la lista, se agrega ahí mismo sin
// tener que ir a Configuración.
// ==========================================================================
const TIPOS_DOCUMENTO = [['FACTURA', 'Factura'], ['COTIZACION', 'Cotización'], ['OTRO', 'Otro']];
const NUEVO_PROVEEDOR = '__nuevo__';

function opcionesProveedor(seleccionado) {
  return '<option value="">— Sin proveedor —</option>' +
    opt(CATALOGOS.proveedores || [], 'id', 'nombre', seleccionado) +
    (puedeEscribir() ? `<option value="${NUEVO_PROVEEDOR}">+ Agregar proveedor nuevo…</option>` : '');
}

function camposProveedorDocumento(prefijo, valores = {}) {
  return `
    <div class="form-row"><label>Proveedor</label>
      <select id="${prefijo}-proveedor">${opcionesProveedor(valores.proveedorId)}</select>
      <div id="${prefijo}-proveedor-nuevo" class="inv-hidden" style="display:flex; gap:0.5rem; margin-top:0.5rem;">
        <input type="text" id="${prefijo}-proveedor-nombre" placeholder="Nombre del proveedor" style="flex:1;">
        <button type="button" class="btn btn-outline chip" id="${prefijo}-proveedor-agregar" style="padding:0.5rem 0.9rem;">Agregar</button>
      </div>
    </div>
    <div class="form-two-col">
      <div class="form-row"><label>Documento</label>
        <select id="${prefijo}-doc-tipo">${TIPOS_DOCUMENTO.map(([v, l]) =>
          `<option value="${v}" ${v === (valores.documentoTipo || 'FACTURA') ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="form-row"><label>N° de factura / cotización</label>
        <input type="text" id="${prefijo}-doc-numero" maxlength="60" placeholder="Ej. F-001234" value="${esc(valores.documentoNumero || '')}">
      </div>
    </div>`;
}

function activarCamposProveedor(prefijo) {
  const sel = document.getElementById(`${prefijo}-proveedor`);
  const caja = document.getElementById(`${prefijo}-proveedor-nuevo`);
  const nombre = document.getElementById(`${prefijo}-proveedor-nombre`);

  sel.addEventListener('change', () => {
    const nuevo = sel.value === NUEVO_PROVEEDOR;
    caja.classList.toggle('inv-hidden', !nuevo);
    if (nuevo) nombre.focus();
  });

  const boton = document.getElementById(`${prefijo}-proveedor-agregar`);
  const agregar = async () => {
    const texto = nombre.value.trim();
    if (!texto) { nombre.focus(); return; }
    if (boton.disabled) return; // doble clic: el primero ya lo está guardando

    // Si ya existe (con otras mayúsculas o espacios), se elige ese y listo
    const normal = (t) => t.trim().replace(/\s+/g, ' ').toUpperCase();
    const existente = (CATALOGOS.proveedores || []).find((p) => normal(p.nombre) === normal(texto));
    if (existente) {
      sel.value = String(existente.id);
      caja.classList.add('inv-hidden');
      nombre.value = '';
      return;
    }

    boton.disabled = true;
    try {
      const p = await api.post('/catalogos/proveedores', { nombre: texto });
      CATALOGOS.proveedores = await api.get('/catalogos/proveedores');
      sel.innerHTML = opcionesProveedor(p.id);
      caja.classList.add('inv-hidden');
      nombre.value = '';
    } catch (err) {
      alert(err.message);
    } finally {
      boton.disabled = false;
    }
  };
  boton.addEventListener('click', agregar);
  // Enter en la caja agrega el proveedor, no manda todo el formulario
  nombre.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); agregar(); }
  });
}

function leerCamposProveedor(prefijo) {
  const prov = document.getElementById(`${prefijo}-proveedor`).value;
  if (prov === NUEVO_PROVEEDOR && document.getElementById(`${prefijo}-proveedor-nombre`).value.trim()) {
    throw new Error('Escribiste un proveedor nuevo pero falta pulsar "Agregar" (o elige uno de la lista).');
  }
  const numero = document.getElementById(`${prefijo}-doc-numero`).value.trim();
  return {
    proveedorId: prov && prov !== NUEVO_PROVEEDOR ? prov : null,
    documentoTipo: numero ? document.getElementById(`${prefijo}-doc-tipo`).value : null,
    documentoNumero: numero || null,
  };
}

/** Nombre de la unidad para las frases de ayuda ("cada lámina", "cada pie lineal"). */
function nombreUnidad(unidad) {
  if (unidad === 'LAMINA') return 'lámina';
  return (unidad || 'unidad').toLowerCase();
}

/** Recalcula la línea de ayuda del costo cada vez que cambia algo. */
function actualizarCalculoCosto(prefijo, idCantidad, unidad) {
  const modo = document.getElementById(`${prefijo}-costo-modo`).value;
  const valor = parseFloat(document.getElementById(`${prefijo}-costo-valor`).value);
  const cantidad = parseFloat(document.getElementById(idCantidad).value);
  const caja = document.getElementById(`${prefijo}-costo-calculo`);
  const u = nombreUnidad(unidad);

  if (isNaN(valor)) {
    caja.textContent = modo === 'total'
      ? `Pon lo que costó la compra completa y el sistema calcula cuánto sale cada ${u}.`
      : `Pon lo que cuesta cada ${u}.`;
    return;
  }
  if (isNaN(cantidad) || cantidad <= 0) {
    caja.textContent = 'Escribe la cantidad para ver el cálculo.';
    return;
  }
  // En láminas se ve también cuánto sale el pie² (una lámina de 4x8 = 32 pie²)
  const porUnidad = modo === 'total' ? valor / cantidad : valor;
  const piePorLamina = unidad === 'LAMINA' ? ` · ${esc(money(porUnidad / 32))} el pie²` : '';
  caja.innerHTML = modo === 'total'
    ? `= <strong>${esc(money(valor / cantidad))}</strong> por ${esc(u)}${piePorLamina} &nbsp;(${esc(money(valor))} ÷ ${cantidad})`
    : `= <strong>${esc(money(valor * cantidad))}</strong> en total${piePorLamina} &nbsp;(${cantidad} × ${esc(money(valor))})`;
}

// ==========================================================================
// Modal: Registrar entrada
//
// Para materiales por rollo, la entrada CREA EL ROLLO por omisión. Antes era
// una casilla desmarcada que se pasaba por alto: los pies entraban a la
// existencia sin estar en ningún rollo, y al ir después a Rollos y medir el
// rollo físico se sumaban otra vez. Así se duplicaba la existencia.
// ==========================================================================
async function abrirModalEntrada(materialIdPreseleccionado) {
  const mats = CATALOGOS.materiales;
  const inicial = mats.find((x) => x.id === materialIdPreseleccionado) || mats[0];
  const esRollo = esMaterialDeRollo(inicial);

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Registrar entrada</h3>
    <form id="formEntrada">
      <div class="form-row"><label>Material *</label>
        <select id="e-material" required>${optMateriales(mats, inicial && inicial.id)}</select>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label id="e-cantidad-label">Cantidad *</label><input type="number" step="any" id="e-cantidad" required></div>
        <div class="form-row"><label>Fecha *</label><input type="date" id="e-fecha" required value="${hoy()}"></div>
      </div>

      <div id="e-rollo-bloque">
        <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; margin-bottom:0.75rem;">
          <input type="checkbox" id="e-esrollo" ${esRollo ? 'checked' : ''}> Esta entrada es un rollo nuevo (crea el rollo)
        </label>
        <div id="e-rollo-fields" class="${esRollo ? '' : 'inv-hidden'}">
          <div class="form-row">
            <label>¿La factura trae metros? Escríbelo aquí y se convierte a pies</label>
            <input type="number" step="any" id="e-rollo-metros" placeholder="Ej. 50 (metros de fábrica)">
            <p class="inv-hint" style="margin-top:0.3rem;">1 metro = 3.28084 pies. Llena la Cantidad de arriba solo.</p>
          </div>
          <div class="form-two-col">
            <div class="form-row"><label>ID del rollo</label>
              <input type="text" id="e-rollo-id" placeholder="Se genera solo">
              <p class="inv-hint" style="margin:0.3rem 0 0;" id="e-rollo-id-hint">Déjalo vacío y se asigna el siguiente.</p>
            </div>
            <div class="form-row"><label>Ancho (pulgadas)</label><input type="number" step="any" id="e-rollo-ancho" placeholder="Ej. 60"></div>
          </div>
        </div>
        <p class="inv-hint" id="e-sin-rollo-aviso" style="color:var(--color-magenta-dark); display:none; margin-top:-0.25rem;">
          Sin crear el rollo, estos pies quedan en la existencia pero en ningún rollo.
          Cuando después midas el rollo físico, el sistema los va a reconocer — no se suman dos veces.
        </p>
      </div>

      <p class="inv-hint" id="e-lamina-aviso" style="display:none; color:var(--color-cyan-dark);">
        Se registra cada lámina por separado (completas de 4×8 pies = 48×96 pulg., 32 pie² cada una).
      </p>

      <div id="e-costo-bloque"></div>

      <div class="form-two-col">
        <div class="form-row"><label>Tipo de entrada</label><select id="e-movimiento">${TIPOS_ENTRADA.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div class="form-row"><label>Quién recibe</label><input type="text" id="e-quien" value="${esc(nombreUsuario())}"></div>
      </div>
      ${camposProveedorDocumento('e')}
      <div class="form-row"><label>Observaciones</label><textarea id="e-obs" rows="2"></textarea></div>
      <div id="e-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Registrar entrada</button>
      </div>
    </form>
  `);

  const selMat = document.getElementById('e-material');
  const chk = document.getElementById('e-esrollo');
  const campos = document.getElementById('e-rollo-fields');
  const bloqueRollo = document.getElementById('e-rollo-bloque');
  const aviso = document.getElementById('e-sin-rollo-aviso');

  const materialActual = () => mats.find((x) => String(x.id) === String(selMat.value));

  /** Rearma la pantalla según el material: rollo o no, unidad, modo de costo. */
  async function prepararPara(m) {
    const rollo = esMaterialDeRollo(m);
    const lamina = esMaterialDeLamina(m);
    bloqueRollo.style.display = rollo ? '' : 'none';
    chk.checked = rollo;
    campos.classList.toggle('inv-hidden', !rollo);
    aviso.style.display = 'none';
    document.getElementById('e-lamina-aviso').style.display = lamina ? '' : 'none';
    document.getElementById('e-cantidad').step = lamina ? '1' : 'any';
    document.getElementById('e-cantidad-label').textContent = lamina
      ? 'Cantidad (láminas completas de 4×8) *'
      : `Cantidad${m ? ` (${m.unidad_codigo.toLowerCase()})` : ''} *`;

    // En rollos y láminas lo normal es el costo total de la compra; en lo demás, por unidad
    document.getElementById('e-costo-bloque').innerHTML =
      campoCosto('e', rollo || lamina ? 'total' : 'unidad', m && m.unidad_codigo);
    const recalcular = () => actualizarCalculoCosto('e', 'e-cantidad', m && m.unidad_codigo);
    document.getElementById('e-costo-modo').addEventListener('change', recalcular);
    document.getElementById('e-costo-valor').addEventListener('input', recalcular);
    recalcular();

    // Sugerir el ID que se le va a asignar
    const hint = document.getElementById('e-rollo-id-hint');
    if (rollo && m) {
      try {
        const r = await api.get(`/rollos/siguiente-id?materialId=${m.id}`);
        document.getElementById('e-rollo-id').placeholder = r.id;
        hint.textContent = `Si lo dejas vacío se asigna ${r.id}.`;
      } catch (err) { /* solo es una sugerencia */ }
    }
  }

  selMat.addEventListener('change', () => prepararPara(materialActual()));

  chk.addEventListener('change', () => {
    campos.classList.toggle('inv-hidden', !chk.checked);
    // Desmarcar la casilla en un material por rollo es justo lo que causaba
    // la existencia suelta. Se permite, pero avisando.
    aviso.style.display = (!chk.checked && esMaterialDeRollo(materialActual())) ? '' : 'none';
  });

  document.getElementById('e-rollo-metros').addEventListener('input', () => {
    convertirMetrosAPies('e-rollo-metros', 'e-cantidad');
  });
  document.getElementById('e-cantidad').addEventListener('input', () => {
    const m = materialActual();
    actualizarCalculoCosto('e', 'e-cantidad', m && m.unidad_codigo);
  });

  // El formulario queda activo desde el primer momento: prepararPara() le
  // pregunta al servidor el siguiente ID de rollo, y si alguien pulsaba Enter
  // antes de que contestara, la página se recargaba y se perdía lo escrito.
  document.getElementById('formEntrada').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('e-error');
    const m = materialActual();
    const crearRollo = esMaterialDeRollo(m) && chk.checked;
    const modo = document.getElementById('e-costo-modo').value;
    const valorCosto = document.getElementById('e-costo-valor').value;

    try {
      const r = await api.post('/movimientos/entrada', {
        materialId: selMat.value,
        cantidad: document.getElementById('e-cantidad').value,
        fecha: document.getElementById('e-fecha').value,
        movimiento: document.getElementById('e-movimiento').value,
        costoTotal: valorCosto !== '' && modo === 'total' ? valorCosto : null,
        costo: valorCosto !== '' && modo === 'unidad' ? valorCosto : null,
        quien: document.getElementById('e-quien').value || null,
        observaciones: document.getElementById('e-obs').value || null,
        ...leerCamposProveedor('e'),
        crearRollo,
        nuevoRolloId: crearRollo ? (document.getElementById('e-rollo-id').value.trim() || null) : null,
        ancho: crearRollo ? (document.getElementById('e-rollo-ancho').value || null) : null,
      });
      cerrarModal();
      await refrescarVistas();
      if (r.rolloId) alert(`Entrada registrada. Se creó el rollo ${r.rolloId}.`);
      if (r.laminasCreadas && r.laminasCreadas.length) {
        const ls = r.laminasCreadas;
        alert(`Entrada registrada. Se ${ls.length === 1 ? 'creó la lámina' : `crearon ${ls.length} láminas`}: ` +
          (ls.length > 3 ? `${ls[0]} a ${ls[ls.length - 1]}` : ls.join(', ')) + '.');
      }
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });

  // Los campos de proveedor se activan antes de esperar la sugerencia del ID
  // del rollo (si el servidor tardaba, "+ Agregar proveedor" no respondía)
  activarCamposProveedor('e');
  await prepararPara(materialActual());
}

// ==========================================================================
// Modal: Registrar salida
//
// Para materiales por rollo hay dos formas:
//   - Por cantidad: el sistema toma de los rollos que tengan material.
//   - Rollo completo: se elige UN rollo y sale entero. Útil cuando se vende
//     o se entrega el rollo tal cual, sin cortarlo.
// ==========================================================================
async function abrirModalSalida(materialIdPreseleccionado) {
  const mats = CATALOGOS.materiales;
  const inicial = mats.find((x) => x.id === materialIdPreseleccionado) || mats[0];
  // Láminas: la salida se hace por piezas (ancho × alto), en su propio formulario
  if (esMaterialDeLamina(inicial)) return abrirModalCorteLamina(inicial.id, 'SALIDA');

  let rollos = [];
  try { rollos = await api.get('/rollos?soloDisponibles=1'); } catch (err) { rollos = []; }

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Registrar salida</h3>
    <form id="formSalida">
      <div class="form-row"><label>Material *</label>
        <select id="s-material" required>${optMateriales(mats, inicial && inicial.id)}</select>
      </div>

      <div id="s-rollo-bloque" style="display:none;">
        <div class="form-row"><label>¿Qué sale?</label>
          <select id="s-forma">
            <option value="cantidad">Una cantidad (el sistema toma de los rollos que tengan)</option>
            <option value="completo">Un rollo completo</option>
          </select>
        </div>
        <div class="form-row" id="s-rollo-fila" style="display:none;">
          <label>Rollo que sale *</label>
          <select id="s-rollo"></select>
          <p class="inv-hint" style="margin:0.3rem 0 0;">Sale entero: se descuenta todo lo que le queda y queda como agotado.</p>
        </div>
      </div>

      <div class="form-two-col">
        <div class="form-row"><label id="s-cantidad-label">Cantidad *</label><input type="number" step="any" id="s-cantidad" required></div>
        <div class="form-row"><label>Fecha *</label><input type="date" id="s-fecha" required value="${hoy()}"></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Tipo de salida</label><select id="s-movimiento">${TIPOS_SALIDA.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div class="form-row"><label>Área</label><select id="s-area"><option value="">—</option>${opt(CATALOGOS.areas, 'id', 'nombre')}</select></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>OT</label><input type="text" id="s-ot"></div>
        <div class="form-row"><label>Cliente</label><input type="text" id="s-cliente"></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Proyecto</label><input type="text" id="s-proyecto"></div>
        <div class="form-row"><label>Cotización</label><input type="text" id="s-cotizacion"></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Quién retira *</label><input type="text" id="s-retira" required placeholder="Nombre de quien se lo lleva"></div>
        <div class="form-row"><label>Quién entrega *</label><input type="text" id="s-entrega" required value="${esc(nombreUsuario())}"></div>
      </div>
      <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; margin-bottom:1rem;" id="s-forzar-fila">
        <input type="checkbox" id="s-forzar"> Forzar aunque quede negativo (requiere autorización)
      </label>
      <div id="s-autoriza-field" class="form-row inv-hidden"><label>Autoriza *</label>
        <select id="s-autoriza">${opcionesAutoriza()}</select>
      </div>
      <div class="form-row"><label>Observaciones</label><textarea id="s-obs" rows="2"></textarea></div>
      <div id="s-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Registrar salida</button>
      </div>
    </form>
  `);

  const selMat = document.getElementById('s-material');
  const forma = document.getElementById('s-forma');
  const selRollo = document.getElementById('s-rollo');
  const cantidad = document.getElementById('s-cantidad');
  const materialActual = () => mats.find((x) => String(x.id) === String(selMat.value));

  function rollosDe(m) {
    return rollos.filter((r) => String(r.material_id) === String(m.id) && r.restante != null && r.restante > 0.0001);
  }

  /** Rollo completo: la cantidad es exactamente lo que le queda, y no se toca a mano. */
  function aplicarRolloElegido() {
    const r = rollos.find((x) => x.id === selRollo.value);
    if (forma.value === 'completo' && r) {
      cantidad.value = r.restante;
      cantidad.readOnly = true;
      cantidad.style.background = 'rgba(var(--texto-rgb),0.04)';
    } else {
      cantidad.readOnly = false;
      cantidad.style.background = '';
    }
  }

  function prepararPara(m) {
    const esRollo = esMaterialDeRollo(m);
    const disponibles = esRollo ? rollosDe(m) : [];
    document.getElementById('s-rollo-bloque').style.display = esRollo ? '' : 'none';
    document.getElementById('s-cantidad-label').textContent =
      `Cantidad${m ? ` (${m.unidad_codigo.toLowerCase()})` : ''} *`;

    selRollo.innerHTML = disponibles.length
      ? disponibles.map((r) => `<option value="${esc(r.id)}">${esc(r.id)} — quedan ${esc(r.restante)}${r.ancho ? ` · ${esc(r.ancho)}"` : ''}</option>`).join('')
      : '<option value="">No hay rollos con material</option>';

    forma.value = 'cantidad';
    cantidad.required = true;
    document.getElementById('s-rollo-fila').style.display = 'none';
    document.getElementById('s-forzar-fila').style.display = '';
    // La casilla de "forzar negativo" vuelve a verse al cambiar de material
    document.getElementById('s-forzar-fila').style.display = '';
    cantidad.value = '';
    aplicarRolloElegido();
  }

  forma.addEventListener('change', () => {
    const completo = forma.value === 'completo';
    // En "rollo completo" la cantidad la pone el rollo: no se le pide al usuario
    cantidad.required = !completo;
    document.getElementById('s-rollo-fila').style.display = completo ? '' : 'none';
    // Un rollo completo sale exacto: no tiene sentido forzar negativo
    document.getElementById('s-forzar-fila').style.display = completo ? 'none' : '';
    if (!completo) cantidad.value = '';
    aplicarRolloElegido();
  });
  selRollo.addEventListener('change', aplicarRolloElegido);
  selMat.addEventListener('change', () => {
    const m = materialActual();
    if (esMaterialDeLamina(m)) { abrirModalCorteLamina(m.id, 'SALIDA'); return; }
    prepararPara(m);
  });

  document.getElementById('s-forzar').addEventListener('change', (e) => {
    document.getElementById('s-autoriza-field').classList.toggle('inv-hidden', !e.target.checked);
  });

  prepararPara(materialActual());

  document.getElementById('formSalida').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('s-error');
    const completo = forma.value === 'completo';
    if (completo && !selRollo.value) {
      errBox.textContent = 'Elige qué rollo sale completo.';
      errBox.classList.add('is-visible');
      return;
    }
    try {
      const resultado = await api.post('/movimientos/salida', {
        materialId: selMat.value,
        cantidad: cantidad.value,
        rolloId: completo ? selRollo.value : null,
        fecha: document.getElementById('s-fecha').value,
        movimiento: document.getElementById('s-movimiento').value,
        areaId: document.getElementById('s-area').value || null,
        ot: document.getElementById('s-ot').value || null,
        cliente: document.getElementById('s-cliente').value || null,
        proyecto: document.getElementById('s-proyecto').value || null,
        cotizacion: document.getElementById('s-cotizacion').value || null,
        observaciones: document.getElementById('s-obs').value || null,
        retira: document.getElementById('s-retira').value,
        entrega: document.getElementById('s-entrega').value,
        forzadoNegativo: !completo && document.getElementById('s-forzar').checked,
        autoriza: document.getElementById('s-autoriza').value || null,
      });
      cerrarModal();
      await refrescarVistas();
      if (completo) {
        alert(`Salió el rollo ${selRollo.value} completo. Quedó como agotado.`);
      } else if (resultado.multiRollo) {
        alert(`Se tomó de ${resultado.rollosUsados.length} rollos distintos porque el primero no alcanzaba: ${resultado.rollosUsados.join(', ')}`);
      }
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

// ==========================================================================
// Modal: Registrar merma
// ==========================================================================
async function abrirModalMerma(materialIdPreseleccionado) {
  const mats = CATALOGOS.materiales;
  const inicialMerma = mats.find((x) => x.id === materialIdPreseleccionado) || mats[0];
  if (esMaterialDeLamina(inicialMerma)) return abrirModalCorteLamina(inicialMerma.id, 'MERMA');

  // Los rollos se piden aquí para poder anotar (opcionalmente) de cuál rollo
  // salió la merma. Es solo informativo: el rollo NO se descuenta.
  let rollos = [];
  try {
    rollos = await api.get('/rollos');
  } catch (err) {
    rollos = [];
  }

  const opcionesRollo = (materialId) => {
    // Solo rollos medidos y con material: de uno agotado o sin medir no puede salir merma
    const delMaterial = rollos.filter((r) => String(r.material_id) === String(materialId)
      && r.restante != null && r.restante > 0.0001);
    return '<option value="">Sin especificar</option>' + delMaterial
      .map((r) => `<option value="${esc(r.id)}">${esc(r.id)}${r.restante != null ? ` (restante ${r.restante})` : ''}</option>`)
      .join('');
  };

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Registrar merma</h3>
    <div class="inv-error is-visible" style="background:rgba(31,173,224,0.08); border-left-color:var(--color-cyan); color:var(--color-cyan-dark);">
      La merma <strong>sí descuenta</strong> del material y del rollo, y queda registrada en
      Movimientos con su motivo. Nunca puede dejar la existencia en negativo: si no cabe en lo
      que queda, primero hay que hacer un <em>Ajuste</em> por conteo físico.
    </div>
    <form id="formMerma">
      <div class="form-row"><label>Material *</label>
        <select id="me-material" required>${optMateriales(mats, materialIdPreseleccionado)}</select>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Cantidad *</label><input type="number" step="any" id="me-cantidad" required></div>
        <div class="form-row"><label>Fecha *</label><input type="date" id="me-fecha" required value="${hoy()}"></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Motivo *</label><select id="me-motivo" required>${MOTIVOS_MERMA.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select></div>
        <div class="form-row"><label>Rollo (opcional)</label>
          <select id="me-rollo">${opcionesRollo(materialIdPreseleccionado || (mats[0] && mats[0].id))}</select>
          <p class="inv-hint" style="margin:0.3rem 0 0;">Si lo dejas vacío, el sistema descuenta solo del rollo que tenga material.</p>
        </div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Área</label><select id="me-area"><option value="">—</option>${opt(CATALOGOS.areas, 'id', 'nombre')}</select></div>
        <div class="form-row"><label>OT</label><input type="text" id="me-ot"></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Responsable *</label><input type="text" id="me-quien" required value="${esc(nombreUsuario())}"></div>
        <div class="form-row"><label>Autoriza *</label>
          <select id="me-autoriza" required>${opcionesAutoriza()}</select>
        </div>
      </div>
      <div class="form-row"><label>Observaciones</label><textarea id="me-obs" rows="2"></textarea></div>
      <div id="me-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Registrar merma</button>
      </div>
    </form>
  `);

  // Al cambiar de material, la lista de rollos se rearma con los de ese material
  document.getElementById('me-material').addEventListener('change', (e) => {
    const m = mats.find((x) => String(x.id) === String(e.target.value));
    if (esMaterialDeLamina(m)) { abrirModalCorteLamina(m.id, 'MERMA'); return; }
    document.getElementById('me-rollo').innerHTML = opcionesRollo(e.target.value);
  });

  document.getElementById('formMerma').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('me-error');
    try {
      const resultado = await api.post('/movimientos/merma', {
        materialId: document.getElementById('me-material').value,
        cantidad: document.getElementById('me-cantidad').value,
        fecha: document.getElementById('me-fecha').value,
        motivo: document.getElementById('me-motivo').value,
        rolloId: document.getElementById('me-rollo').value || null,
        areaId: document.getElementById('me-area').value || null,
        ot: document.getElementById('me-ot').value || null,
        quien: document.getElementById('me-quien').value,
        autorizaResponsable: document.getElementById('me-autoriza').value,
        observaciones: document.getElementById('me-obs').value || null,
      });
      cerrarModal();
      await refrescarVistas();
      if (resultado && resultado.multiRollo) {
        alert(`La merma se descontó de ${resultado.rollosUsados.length} rollos porque el primero no alcanzaba: ${resultado.rollosUsados.join(', ')}`);
      }
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

// ==========================================================================
// Modal: Ajuste (conteo físico)
// ==========================================================================
function abrirModalAjuste(materialIdPreseleccionado) {
  const mats = CATALOGOS.materiales;
  const m = mats.find((x) => x.id === materialIdPreseleccionado);
  // En láminas el conteo se hace lámina por lámina: un ajuste del total no
  // diría a cuál lámina le falta o le sobra.
  if (esMaterialDeLamina(m)) {
    abrirModal(`
      <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
      <h3 class="font-display">Conteo de láminas — <span class="mono">${esc(m.codigo)}</span></h3>
      <p class="inv-hint">Las láminas se cuentan una por una en la pestaña <strong>Láminas</strong>:</p>
      <ul class="inv-hint" style="padding-left:1.1rem; line-height:1.6;">
        <li>A una lámina le queda otra cantidad → <strong>Corregir</strong> (puedes medir el pedazo).</li>
        <li>Una lámina no existe → <strong>Eliminar</strong> (administrador).</li>
        <li>Hay láminas que no están en el sistema → <strong>+ Registrar láminas existentes</strong>.</li>
      </ul>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cerrar</button>
        <button type="button" class="btn btn-magenta chip" onclick="cerrarModal(); cambiarTab('laminas')">Ir a Láminas</button>
      </div>
    `);
    return;
  }
  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Ajuste por conteo físico</h3>
    <form id="formAjuste">
      <div class="form-row"><label>Material *</label>
        <select id="a-material" required>${optMateriales(mats, materialIdPreseleccionado)}</select>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Cantidad contada *</label><input type="number" step="any" id="a-conteo" required></div>
        <div class="form-row"><label>Fecha *</label><input type="date" id="a-fecha" required value="${hoy()}"></div>
      </div>
      <div class="form-row"><label>Quién contó *</label><input type="text" id="a-quien" required value="${esc(nombreUsuario())}"></div>
      <div class="form-row"><label>Quién autoriza (si hay diferencia)</label>
        <select id="a-autoriza">${opcionesAutoriza()}</select>
      </div>
      <div class="form-row"><label>Observaciones</label><textarea id="a-obs" rows="2"></textarea></div>
      <div id="a-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Registrar ajuste</button>
      </div>
    </form>
  `);

  // Si eligen un material por láminas, se explica dónde se cuenta
  document.getElementById('a-material').addEventListener('change', (e) => {
    const elegido = mats.find((x) => String(x.id) === String(e.target.value));
    if (esMaterialDeLamina(elegido)) abrirModalAjuste(elegido.id);
  });

  document.getElementById('formAjuste').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('a-error');
    try {
      const resultado = await api.post('/movimientos/ajuste', {
        materialId: document.getElementById('a-material').value,
        conteo: document.getElementById('a-conteo').value,
        fecha: document.getElementById('a-fecha').value,
        quien: document.getElementById('a-quien').value,
        autoriza: document.getElementById('a-autoriza').value || null,
        observaciones: document.getElementById('a-obs').value || null,
      });
      cerrarModal();
      await refrescarVistas();
      if (resultado.mensaje) alert(resultado.mensaje);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

// ==========================================================================
// Modal: Eliminar material (solo administradores)
// ==========================================================================
function abrirModalEliminarMaterial(materialId) {
  const m = CATALOGOS.materiales.find((x) => x.id === materialId);
  if (!m) return;

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Eliminar material</h3>
    <div class="inv-error is-visible">
      Vas a eliminar <strong class="mono">${esc(m.codigo)}</strong> — ${esc(m.descripcion)}.
      Desaparece del inventario y de los desplegables. Sus movimientos <strong>no</strong> se borran:
      el histórico sigue completo.
    </div>
    <p class="inv-hint">Existencia actual: <strong>${m.existencia == null ? '—' : esc(m.existencia)}</strong> ${esc(m.unidad_codigo)}</p>
    <form id="formEliminarMaterial">
      <label style="display:flex; align-items:flex-start; gap:0.5rem; font-size:0.85rem; margin-bottom:1rem;">
        <input type="checkbox" id="dm-confirmar" style="margin-top:0.2rem;">
        <span>Confirmo eliminarlo aunque todavía tenga existencia o rollos activos.</span>
      </label>
      <div id="dm-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Sí, eliminar</button>
      </div>
    </form>
  `);

  document.getElementById('formEliminarMaterial').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('dm-error');
    try {
      const r = await api.delete(`/materiales/${materialId}`, {
        confirmar: document.getElementById('dm-confirmar').checked,
      });
      cerrarModal();
      await refrescarVistas();
      alert(r.mensaje);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}
