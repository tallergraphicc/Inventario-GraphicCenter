// ==========================================================================
// movimientos.js — historial de movimientos, filtros y resumen
// ==========================================================================

// Caché de los últimos movimientos que se pintaron en pantalla (Dashboard o
// pestaña Movimientos), indexado por id, para poder abrir el detalle sin
// tener que pedirlo de nuevo al backend.
const MOV_CACHE = {};

function guardarEnCache(movimientos) {
  movimientos.forEach((mv) => { MOV_CACHE[mv.id] = mv; });
}

function chipTipo(tipo) {
  const legibles = { ENTRADA: 'Entrada', SALIDA: 'Salida', MERMA: 'Merma', AJUSTE: 'Ajuste' };
  return `<span class="inv-chip inv-chip-tipo-${esc(tipo)}">${esc(legibles[tipo] || tipo)}</span>`;
}

// --------------------------------------------------------------------------
// Costo, proveedor y documento
// --------------------------------------------------------------------------
const LEGIBLES_DOCUMENTO = { FACTURA: 'Factura', COTIZACION: 'Cotización', OTRO: 'Doc.' };

/**
 * Costo por unidad de un movimiento: el que se guardó ese día; si es un
 * movimiento viejo que no lo guardó, el costo actual del material.
 * Devuelve { costo, delDia } o null si no hay ninguno.
 */
function costoDeMovimiento(mv) {
  if (mv.costo_unitario != null) return { costo: Number(mv.costo_unitario), delDia: true };
  if (mv.costo_actual_material != null) return { costo: Number(mv.costo_actual_material), delDia: false };
  return null;
}

/**
 * Costo por unidad con hasta 4 decimales: el pie de vinil cuesta B/. 0.6096,
 * y redondeado a B/. 0.61 ya no cuadra con el total del rollo.
 */
function moneyUnitario(valor) {
  if (valor === null || valor === undefined || valor === '' || Number.isNaN(Number(valor))) return null;
  return 'B/. ' + Number(valor).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function costoTotalDeMovimiento(mv) {
  const c = costoDeMovimiento(mv);
  return c ? Number(mv.cantidad) * c.costo : null;
}

/**
 * Cantidad de un movimiento para mostrar. En láminas la cantidad viene en
 * láminas de 4x8 (0.0313 = un corte de 12x12): se muestra en pies², que es
 * como se piensa el corte, y abajo en láminas.
 */
function cantidadMovimientoHtml(mv) {
  if (mv.unidad_codigo !== 'LAMINA') return `${esc(mv.cantidad)} ${esc(mv.unidad_codigo)}`;
  const lam = Number(mv.cantidad);
  const entera = Math.abs(lam - Math.round(lam)) < 0.0001 && Math.abs(lam) >= 1;
  return entera
    ? `${esc(Math.round(lam))} lámina${Math.abs(Math.round(lam)) === 1 ? '' : 's'}<div class="inv-sub">${esc(numero(aPies2(lam)))} pie²</div>`
    : `${esc(numero(aPies2(lam)))} pie²<div class="inv-sub">${esc(numero(lam, 4))} lám.</div>`;
}

function cantidadMovimientoTexto(mv) {
  if (mv.unidad_codigo !== 'LAMINA') return `${mv.cantidad} ${mv.unidad_codigo}`;
  return `${numero(aPies2(mv.cantidad))} pie² (${numero(mv.cantidad, 4)} lámina de 4×8)`;
}

/** "Factura F-00123", "Cotización 55"... o '' si no tiene número. */
function textoDocumento(mv) {
  if (!mv.documento_numero) return '';
  return `${LEGIBLES_DOCUMENTO[mv.documento_tipo] || 'Doc.'} ${mv.documento_numero}`;
}

// --------------------------------------------------------------------------
// Meses: para filtrar y exportar un mes completo con un solo clic
// --------------------------------------------------------------------------
const NOMBRES_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-09' del mes actual, en hora de Panamá. */
function mesActual() {
  return hoy().slice(0, 7);
}

/** '2026-09' → { desde: '2026-09-01', hasta: '2026-09-30' } */
function rangoDelMes(aaaamm) {
  const [a, m] = aaaamm.split('-').map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return { desde: `${aaaamm}-01`, hasta: `${aaaamm}-${String(ultimo).padStart(2, '0')}` };
}

/** '2026-09' → 'septiembre 2026' */
function nombreDelMes(aaaamm) {
  const [a, m] = aaaamm.split('-').map(Number);
  return `${NOMBRES_MES[m - 1]} ${a}`;
}

/** Si desde/hasta son exactamente un mes completo, devuelve ese mes ('2026-09'). */
function mesDelRango(desde, hasta) {
  if (!desde || !hasta || desde.slice(0, 7) !== hasta.slice(0, 7)) return '';
  const r = rangoDelMes(desde.slice(0, 7));
  return r.desde === desde && r.hasta === hasta ? desde.slice(0, 7) : '';
}

/** Opciones de los últimos N meses, del más reciente al más viejo. */
function opcionesDeMeses(seleccionado, cuantos = 24) {
  const [a, m] = mesActual().split('-').map(Number);
  let html = '';
  for (let i = 0; i < cuantos; i++) {
    const fecha = new Date(a, m - 1 - i, 1);
    const valor = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
    const texto = nombreDelMes(valor);
    html += `<option value="${valor}" ${valor === seleccionado ? 'selected' : ''}>${texto.charAt(0).toUpperCase() + texto.slice(1)}</option>`;
  }
  return html;
}

/** Fila de detalle solo-lectura para el modal. Se omite si el valor viene vacío. */
function filaDetalle(label, valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return `
    <div style="display:flex; justify-content:space-between; gap:1rem; padding:0.6rem 0; border-bottom:1px solid rgba(var(--texto-rgb),0.06);">
      <span style="color:rgba(var(--texto-rgb),0.5); font-size:0.8rem;">${esc(label)}</span>
      <span style="font-family:'Space Grotesk',sans-serif; text-align:right;">${esc(valor)}</span>
    </div>
  `;
}

function abrirDetalleMovimiento(id) {
  const mv = MOV_CACHE[id];
  if (!mv) return;

  const legiblesDetalle = {
    COMPRA: 'Compra', DEVOLUCION_PRODUCCION: 'Devolución de producción', TRASLADO: 'Traslado',
    DEVOLUCION_CLIENTE: 'Devolución de cliente', INVENTARIO_INICIAL: 'Inventario inicial',
    REINGRESO_RETAZO: 'Reingreso de retazo', PRODUCCION: 'Producción', INSTALACION: 'Instalación',
    MUESTRA: 'Muestra', GARANTIA_REPROCESO: 'Garantía / Reproceso',
    TRASLADO_ENTRE_BODEGAS: 'Traslado entre bodegas', VENTA_DIRECTA: 'Venta directa', PRESTAMO: 'Préstamo',
    EMBALAJE: 'Embalaje',
  };

  // Las mermas viejas, registradas mientras la merma no descontaba, siguen
  // marcadas así. Se avisa para que nadie se pregunte por qué esa no bajó
  // la existencia y las demás sí.
  const avisoMerma = mv.tipo === 'MERMA' && !mv.descuenta
    ? `<div class="inv-hint" style="margin:-0.5rem 0 1rem; color:var(--color-cyan-dark);">
         Merma antigua — quedó registrada <strong>sin descontar</strong> existencia.
         Las mermas nuevas sí descuentan.
       </div>`
    : '';

  const avisoAnulado = mv.anulado
    ? `<div class="inv-error is-visible">
         <strong>Movimiento anulado.</strong> Ya no cuenta para la existencia.
         ${mv.anulado_por ? `Lo anuló ${esc(mv.anulado_por)}` : ''}
         ${mv.anulado_en ? ` el ${esc(new Date(mv.anulado_en).toLocaleString())}` : ''}.
         ${mv.motivo_anulacion ? `<br>Motivo: ${esc(mv.motivo_anulacion)}` : ''}
       </div>`
    : mv.anula_movimiento_id
      ? `<div class="inv-error is-visible" style="background:rgba(31,173,224,0.08); border-left-color:var(--color-cyan); color:var(--color-cyan-dark);">
           Este registro es la <strong>anulación del movimiento #${esc(mv.anula_movimiento_id)}</strong>.
           No mueve existencia: queda solo como constancia.
         </div>`
      : '';

  // Anular es cosa de administradores, y solo tiene sentido en un movimiento
  // vigente que no sea ya una anulación.
  const puedeAnular = esAdmin() && !mv.anulado && !mv.anula_movimiento_id;
  // El proveedor y la factura de una entrada se pueden completar después
  // (la factura a veces llega días más tarde). No mueve existencia.
  const puedeEditarDocumento = puedeEscribir() && mv.tipo === 'ENTRADA'
    && !mv.anulado && !mv.anula_movimiento_id;
  const costo = costoDeMovimiento(mv);

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Detalle del movimiento</h3>
    <div style="margin-bottom:1rem;">${chipTipo(mv.tipo)} <span class="mono" style="color:rgba(var(--texto-rgb),0.45); font-size:0.85rem;">#${esc(mv.id)}</span></div>
    ${avisoAnulado}
    ${avisoMerma}
    <div>
      ${filaDetalle('Fecha', mv.fecha.slice(0, 10))}
      ${filaDetalle('Material', `${mv.material_codigo} — ${mv.material_descripcion || ''}`)}
      ${filaDetalle('Cantidad', cantidadMovimientoTexto(mv))}
      ${filaDetalle('Medidas', mv.medidas)}
      ${filaDetalle('Tipo de movimiento', legiblesDetalle[mv.movimiento_detalle] || mv.movimiento_detalle)}
      ${filaDetalle('Proveedor', mv.proveedor_nombre)}
      ${filaDetalle('Documento', textoDocumento(mv))}
      ${filaDetalle('Rollo', mv.rollo_id)}
      ${filaDetalle('Lámina', mv.lamina_id)}
      ${filaDetalle('OT', mv.ot)}
      ${filaDetalle('Cotización', mv.cotizacion)}
      ${filaDetalle('Cliente', mv.cliente)}
      ${filaDetalle('Proyecto', mv.proyecto)}
      ${filaDetalle('Área', mv.area_nombre)}
      ${filaDetalle('Bodega', mv.bodega_nombre)}
      ${filaDetalle('Motivo', mv.motivo)}
      ${filaDetalle('Costo por unidad', costo ? `${moneyUnitario(costo.costo)}${costo.delDia ? '' : ' (costo actual; no se guardó el del día)'}` : '')}
      ${filaDetalle('Costo total', costo ? money(costoTotalDeMovimiento(mv)) : '')}
      ${filaDetalle('Quién retira / cuenta', mv.quien)}
      ${filaDetalle('Quién entrega', mv.entrega)}
      ${filaDetalle('Autoriza', mv.autoriza)}
      ${filaDetalle('Afecta la existencia', mv.tipo === 'MERMA' ? (mv.descuenta ? 'Sí' : 'No — merma antigua, solo registro') : '')}
      ${filaDetalle('Forzado en negativo', mv.forzado_negativo ? 'Sí' : '')}
      ${filaDetalle('Observaciones', mv.observaciones)}
      ${filaDetalle('Registrado por', mv.registrado_por)}
      ${filaDetalle('Registrado el', mv.created_at ? new Date(mv.created_at).toLocaleString('es-PA') : '')}
    </div>
    <div class="inv-modal-actions">
      ${puedeEditarDocumento ? `<button type="button" class="btn btn-outline chip" onclick="abrirModalDocumento(${mv.id})">${mv.proveedor_nombre || mv.documento_numero ? 'Editar proveedor y factura' : 'Agregar proveedor y factura'}</button>` : ''}
      ${puedeAnular ? `<button type="button" class="btn btn-outline chip" style="color:var(--color-magenta-dark); border-color:var(--color-magenta);" onclick="abrirModalAnular(${mv.id})">Anular movimiento</button>` : ''}
      <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cerrar</button>
    </div>
  `);
}

// ==========================================================================
// Completar o corregir el proveedor y la factura de una entrada
// ==========================================================================
function abrirModalDocumento(id) {
  const mv = MOV_CACHE[id];
  if (!mv) return;

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Proveedor y factura <span class="mono">#${esc(mv.id)}</span></h3>
    <p class="inv-hint">
      ${chipTipo(mv.tipo)} de <strong>${esc(mv.cantidad)} ${esc(mv.unidad_codigo)}</strong>
      de <strong class="mono">${esc(mv.material_codigo)}</strong>, del ${esc(String(mv.fecha).slice(0, 10))}.
      Esto no cambia la existencia ni el costo; solo deja anotado de dónde vino el material.
      El cambio queda escrito en las observaciones con tu nombre.
    </p>
    <form id="formDocumento">
      ${camposProveedorDocumento('d', {
        proveedorId: mv.proveedor_id, documentoTipo: mv.documento_tipo, documentoNumero: mv.documento_numero,
      })}
      <div id="d-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="abrirDetalleMovimiento(${mv.id})">Volver</button>
        <button type="submit" class="btn btn-magenta chip">Guardar</button>
      </div>
    </form>
  `);
  activarCamposProveedor('d');

  document.getElementById('formDocumento').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('d-error');
    try {
      await api.put(`/movimientos/${id}/documento`, leerCamposProveedor('d'));
      cerrarModal();
      // Se vuelve a pedir ESE movimiento para que el detalle muestre lo
      // recién guardado, esté donde esté la lista (antes se releía de la
      // memoria de la pantalla y mostraba lo viejo).
      try {
        const r = await api.get(`/movimientos?id=${id}&incluirAnulados=1`);
        const lista = Array.isArray(r) ? r : r.movimientos;
        if (lista && lista.length) guardarEnCache(lista);
      } catch (err) { /* si falla, se queda con lo que tenía */ }
      await refrescarVistas();
      abrirDetalleMovimiento(id);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

// ==========================================================================
// Anular un movimiento (solo administradores)
//
// No se borra nada: el original queda marcado como anulado y se crea un
// contra-movimiento que apunta a él. Los dos siguen visibles en el histórico,
// pero ninguno de los dos cuenta para la existencia.
// ==========================================================================
function abrirModalAnular(id) {
  const mv = MOV_CACHE[id];
  if (!mv) return;

  // Solo lo que ya sacó material de bodega se puede pasar a merma: una
  // salida que en realidad fue desperdicio, o una merma con el motivo mal.
  const puedePasarAMerma = mv.tipo === 'SALIDA' || mv.tipo === 'MERMA';

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Anular movimiento <span class="mono">#${esc(mv.id)}</span></h3>
    <div class="inv-error is-visible">
      ${chipTipo(mv.tipo)} de <strong>${esc(mv.cantidad)} ${esc(mv.unidad_codigo)}</strong>
      de <strong class="mono">${esc(mv.material_codigo)}</strong>,
      del ${esc(String(mv.fecha).slice(0, 10))}${mv.quien ? `, registrado por ${esc(mv.quien)}` : ''}.
    </div>
    <form id="formAnular">
      ${puedePasarAMerma ? `
        <div class="form-row"><label>¿Qué hacer con este movimiento?</label>
          <select id="an-accion">
            <option value="anular">Solo anularlo (como si no hubiera pasado)</option>
            <option value="merma">Anularlo y pasarlo a merma</option>
          </select>
        </div>
        <p class="inv-hint" id="an-explica"></p>

        <div id="an-merma" style="display:none;">
          <div class="form-row"><label>Motivo de la merma *</label>
            <select id="an-motivo-merma">${MOTIVOS_MERMA.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select>
          </div>
          <div class="form-row"><label>Observación de la merma</label>
            <textarea id="an-obs-merma" rows="2" placeholder="Qué pasó con el material"></textarea>
          </div>
        </div>
      ` : `
        <p class="inv-hint">
          El movimiento no se borra: queda marcado como anulado y deja de contar para la
          existencia. Se agrega un registro de la anulación con tu nombre. Todo sigue
          visible marcando "Ver anulados".
        </p>
        ${mv.unidad_codigo === 'LAMINA' && (mv.tipo === 'ENTRADA' || mv.motivo === 'Alta de lámina existente') ? `
          <p class="inv-hint" style="color:var(--color-magenta-dark);">
            Este movimiento creó láminas: al anularlo, esas láminas también se dan de baja.
            Si ya se cortó de alguna, el sistema te va a pedir anular esos cortes primero.
          </p>` : ''}
        ${mv.tipo === 'ENTRADA' && mv.rollo_id ? `
          <p class="inv-hint" style="color:var(--color-magenta-dark);">
            Esta entrada creó el rollo <strong class="mono">${esc(mv.rollo_id)}</strong>: al anularla,
            ese rollo también se da de baja. Si el rollo ya tuvo salidas o mermas, el sistema
            te va a pedir anular esas primero.
          </p>` : ''}
      `}
      <div class="form-row"><label>¿Por qué se anula? *</label>
        <textarea id="an-motivo" rows="2" required placeholder="Ej. Error de captura: eran 15 pies, no 150"></textarea>
      </div>
      <div id="an-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip" id="an-boton">Sí, anular</button>
      </div>
    </form>
  `);

  if (puedePasarAMerma) {
    const accion = document.getElementById('an-accion');
    const explicar = () => {
      const merma = accion.value === 'merma';
      document.getElementById('an-merma').style.display = merma ? '' : 'none';
      document.getElementById('an-boton').textContent = merma ? 'Sí, pasar a merma' : 'Sí, anular';
      document.getElementById('an-explica').innerHTML = merma
        ? `El movimiento se anula y en su lugar queda una <strong>merma</strong> con la misma cantidad,
           fecha, rollo y OT. La existencia <strong>no cambia</strong> — el material sigue fuera — pero
           ahora cuenta como material perdido.`
        : `El movimiento no se borra: queda marcado como anulado y deja de contar para la existencia,
           que vuelve a subir ${esc(mv.cantidad)} ${esc(mv.unidad_codigo)}. Todo sigue visible marcando
           "Ver anulados".`;
      // Si pasa a merma y no se escribió el porqué, se propone uno
      const motivo = document.getElementById('an-motivo');
      if (merma && !motivo.value.trim()) motivo.value = `Se registró como ${mv.tipo.toLowerCase()} pero fue merma`;
    };
    accion.addEventListener('change', explicar);
    explicar();
  }

  document.getElementById('formAnular').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('an-error');
    const pasarAMerma = puedePasarAMerma && document.getElementById('an-accion').value === 'merma';
    try {
      const r = await api.post(`/movimientos/${id}/anular`, {
        motivo: document.getElementById('an-motivo').value.trim(),
        pasarAMerma,
        motivoMerma: pasarAMerma ? document.getElementById('an-motivo-merma').value : null,
        observacionesMerma: pasarAMerma ? document.getElementById('an-obs-merma').value.trim() : null,
      });
      cerrarModal();
      await filtrarDesdeCero();
      await refrescarVistas();
      alert(r.mensaje);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

// --------------------------------------------------------------------------
// Filtros
// --------------------------------------------------------------------------

/** Lee la barra de filtros y la convierte en los parámetros que espera la API. */
// Página que se está viendo. Vuelve a 1 cada vez que cambia un filtro.
let MOV_PAGINA = 1;

function parametrosDeFiltro(incluirPagina) {
  const params = new URLSearchParams();
  const q = document.getElementById('movBuscar').value.trim();
  const tipo = document.getElementById('movFiltroTipo').value;
  const materialId = document.getElementById('movFiltroMaterial').value;
  const ot = document.getElementById('movFiltroOt').value.trim();
  const desde = document.getElementById('movFiltroDesde').value;
  const hasta = document.getElementById('movFiltroHasta').value;
  const verAnulados = document.getElementById('movVerAnulados').checked;
  const proveedorId = document.getElementById('movFiltroProveedor').value;

  if (q) params.set('q', q);
  if (tipo) params.set('tipo', tipo);
  if (materialId) params.set('materialId', materialId);
  if (proveedorId) params.set('proveedorId', proveedorId);
  if (ot) params.set('ot', ot);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  if (verAnulados) params.set('incluirAnulados', '1');
  if (incluirPagina) params.set('pagina', String(MOV_PAGINA));
  return params;
}

/** Llena el desplegable de materiales una sola vez. */
function poblarFiltroMateriales() {
  // Se rearma en cada render conservando lo elegido: si no, un material
  // creado hace un momento no aparecía en el filtro y "Mermas" mostraba
  // las de otro material.
  const sel = document.getElementById('movFiltroMaterial');
  const materialElegido = sel.value;
  const opciones = '<option value="">Todos los materiales</option>' +
    (CATALOGOS.materiales || [])
      .map((m) => `<option value="${m.id}" ${String(m.id) === materialElegido ? 'selected' : ''}>${esc(m.codigo)} — ${esc(m.descripcion)}</option>`)
      .join('');
  if (sel.innerHTML !== opciones) sel.innerHTML = opciones;

  // Proveedores: se rearma cada vez (pueden haber agregado uno en una
  // entrada o en Configuración), conservando el que estaba elegido.
  const selProv = document.getElementById('movFiltroProveedor');
  const elegido = selProv.value;
  selProv.innerHTML = '<option value="">Todos los proveedores</option>' +
    (CATALOGOS.proveedores || [])
      .map((p) => `<option value="${p.id}" ${String(p.id) === elegido ? 'selected' : ''}>${esc(p.nombre)}</option>`)
      .join('');

  const selMes = document.getElementById('movFiltroMes');
  if (selMes.options.length <= 1) {
    selMes.innerHTML = '<option value="">Cualquier mes</option>' + opcionesDeMeses('');
  }
}

/**
 * Explica qué va a salir en el Excel: exactamente lo que está filtrado.
 * Así nadie tiene que adivinar si el archivo trae todo o solo el mes.
 */
function pintarInfoExportacion(total) {
  const info = document.getElementById('movExportaInfo');
  if (!info) return;
  const p = parametrosDeFiltro(false);
  const partes = [];

  const desde = p.get('desde');
  const hasta = p.get('hasta');
  const mes = mesDelRango(desde, hasta);
  if (mes) partes.push(nombreDelMes(mes));
  else if (desde && hasta) partes.push(`del ${desde} al ${hasta}`);
  else if (desde) partes.push(`desde el ${desde}`);
  else if (hasta) partes.push(`hasta el ${hasta}`);
  else partes.push('todas las fechas');

  if (p.get('tipo')) partes.push((LEGIBLES_TIPO[p.get('tipo')] || p.get('tipo')).toLowerCase() + 's');
  const selProv = document.getElementById('movFiltroProveedor');
  if (p.get('proveedorId')) partes.push(selProv.options[selProv.selectedIndex].text);
  const selMat = document.getElementById('movFiltroMaterial');
  if (p.get('materialId')) partes.push(selMat.options[selMat.selectedIndex].text.split(' — ')[0]);
  if (p.get('ot')) partes.push(`OT ${p.get('ot')}`);
  if (p.get('q')) partes.push(`"${p.get('q')}"`);

  info.innerHTML = `<strong>Exportar a Excel</strong> descarga lo que está filtrado:
    ${partes.map(esc).join(' · ')} — ${Number(total || 0).toLocaleString('es-PA')} movimiento${total === 1 ? '' : 's'}.`;
}

// --------------------------------------------------------------------------
// Resumen: cuánto hubo, de qué material
// --------------------------------------------------------------------------

const LEGIBLES_TIPO = { ENTRADA: 'Entrada', SALIDA: 'Salida', MERMA: 'Merma', AJUSTE: 'Ajuste' };

/**
 * Compras por proveedor en lo filtrado. Con un mes elegido responde
 * "¿cuánto le compramos a cada proveedor en septiembre?". Clic en una fila
 * filtra por ese proveedor.
 */
function tablaComprasPorProveedor(porProveedor) {
  const conProveedor = (porProveedor || []).filter((r) => r.proveedor_id);
  if (!conProveedor.length) return '';

  const p = parametrosDeFiltro(false);
  const mes = mesDelRango(p.get('desde'), p.get('hasta'));
  const periodo = mes ? nombreDelMes(mes)
    : (p.get('desde') || p.get('hasta')) ? 'el período filtrado' : 'todo el historial';
  const total = porProveedor.reduce((t, r) => t + (Number(r.valor) || 0), 0);

  const filas = porProveedor.map((r) => `
    <tr ${r.proveedor_id ? `class="inv-row-clickable" onclick="filtrarPorProveedor(${r.proveedor_id})" title="Ver solo las compras a este proveedor"` : ''}>
      <td>${r.proveedor_id ? `<strong>${esc(r.proveedor_nombre)}</strong>` : '<span style="color:rgba(var(--texto-rgb),0.45);">Sin proveedor anotado</span>'}</td>
      <td class="num">${r.registros}</td>
      <td class="num">${r.documentos || '—'}</td>
      <td class="num">${r.valor != null ? esc(money(r.valor)) : '<span style="color:rgba(var(--texto-rgb),0.35);">sin costo</span>'}${Number(r.sin_costo) > 0 ? ' <span title="Algunas entradas no tienen costo registrado" style="color:rgba(var(--texto-rgb),0.4);">*</span>' : ''}</td>
      <td class="num">${total > 0 && r.valor != null ? `${Math.round((Number(r.valor) / total) * 100)}%` : '—'}</td>
    </tr>`).join('');

  return `
    <div class="inv-table-wrap" style="margin-bottom:1.25rem;">
      <div style="padding:1rem 1.25rem; border-bottom:1px solid rgba(var(--texto-rgb),0.08); display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;">
        <strong class="font-display" style="font-size:0.95rem;">Compras por proveedor — ${esc(periodo)}</strong>
        <span class="inv-hint" style="margin:0;">Total comprado: <strong>${esc(money(total) || 'B/. 0.00')}</strong>. Clic en un proveedor para ver solo sus compras.</span>
      </div>
      <table class="inv-table">
        <thead><tr><th>Proveedor</th><th>Entradas</th><th>Facturas / cot.</th><th>Total comprado</th><th>% del total</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

function filtrarPorProveedor(proveedorId) {
  document.getElementById('movFiltroProveedor').value = String(proveedorId);
  document.getElementById('movFiltroTipo').value = 'ENTRADA';
  filtrarDesdeCero();
}

function pintarResumen(resumen, tipoFiltrado) {
  const cont = document.getElementById('movResumen');
  const { porMaterial = [], porTipo = [], porProveedor = [] } = resumen || {};

  if (!porMaterial.length) { cont.innerHTML = ''; return; }

  // Cuando hay un solo tipo filtrado (ej. Merma), el resumen es directo:
  // "de este material hubo tanta merma". Sin filtro de tipo, se agrupa igual
  // pero se muestra de qué tipo es cada línea.
  const unSoloTipo = !!tipoFiltrado;
  const titulo = unSoloTipo
    ? `Total de ${(LEGIBLES_TIPO[tipoFiltrado] || tipoFiltrado).toLowerCase()} por material`
    : 'Totales por material';

  // Sumar cantidades de materiales distintos no significa nada (pies +
  // láminas + unidades). Solo se muestra la cantidad cuando el filtro está
  // en UN material; si no, el dinero y cuántos movimientos hubo.
  const unSoloMaterial = !!document.getElementById('movFiltroMaterial').value;
  const unidadDelFiltro = unSoloMaterial && porMaterial.length ? porMaterial[0].unidad_codigo : '';
  const totales = porTipo.map((t) => `
    <div class="inv-stat-card" style="padding:1rem 1.2rem;">
      <div class="value" style="font-size:1.6rem;">${unSoloMaterial
        ? `${Number(t.total).toLocaleString('es-PA', { maximumFractionDigits: 4 })} <span style="font-size:0.9rem; color:rgba(var(--texto-rgb),0.5);">${esc(unidadDelFiltro)}</span>`
        : esc(money(t.valor) || 'sin costo')}</div>
      <div class="label">${esc(LEGIBLES_TIPO[t.tipo] || t.tipo)} · ${t.registros} registro${t.registros === 1 ? '' : 's'}</div>
      ${unSoloMaterial && t.valor != null ? `<div style="margin-top:0.45rem; font-family:'Space Grotesk',sans-serif; font-weight:600;">${esc(money(t.valor))}</div>` : ''}
    </div>
  `).join('');

  const filas = porMaterial.map((r) => `
    <tr>
      <td class="mono">${esc(r.material_codigo)}</td>
      <td>${esc(r.material_descripcion)}</td>
      ${unSoloTipo ? '' : `<td>${chipTipo(r.tipo)}</td>`}
      <td class="num"><strong>${Number(r.total).toLocaleString('es-PA', { maximumFractionDigits: 4 })}</strong> ${esc(r.unidad_codigo)}${r.unidad_codigo === 'LAMINA' ? `<div class="inv-sub">${esc(numero(aPies2(r.total)))} pie²</div>` : ''}</td>
      <td class="num">${r.valor != null
        ? `${esc(money(r.valor))}${Number(r.sin_costo) > 0 ? ' <span title="Algunos movimientos no tienen costo registrado" style="color:rgba(var(--texto-rgb),0.4);">*</span>' : ''}`
        : '<span style="color:rgba(var(--texto-rgb),0.35);">sin costo</span>'}</td>
      <td class="num">${r.registros}</td>
    </tr>
  `).join('');

  cont.innerHTML = `
    <div class="inv-stats" style="margin-bottom:1rem;">${totales}</div>
    ${tablaComprasPorProveedor(porProveedor)}
    <div class="inv-table-wrap" style="margin-bottom:1.25rem;">
      <div style="padding:1rem 1.25rem; border-bottom:1px solid rgba(var(--texto-rgb),0.08); display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;">
        <strong class="font-display" style="font-size:0.95rem;">${esc(titulo)}</strong>
        ${tipoFiltrado === 'MERMA'
          ? `<span class="inv-hint" style="margin:0;">Material perdido en el período filtrado. La merma descuenta del inventario.</span>`
          : document.getElementById('movVerAnulados').checked
            ? `<span class="inv-hint" style="margin:0;">Estos totales <strong>no</strong> incluyen los movimientos anulados, aunque la lista de abajo sí los muestre.</span>`
            : ''}
      </div>
      <table class="inv-table">
        <thead><tr>
          <th>Código</th><th>Material</th>${unSoloTipo ? '' : '<th>Tipo</th>'}<th>Total</th><th>Valor</th><th>Registros</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
}

// --------------------------------------------------------------------------
// Render principal
// --------------------------------------------------------------------------

// Columnas de la tabla de movimientos (para los mensajes de "no hay nada")
const COLUMNAS_MOV = 11;

// Cada búsqueda lleva número: si llega tarde la respuesta de una búsqueda
// vieja, se descarta en vez de pisar lo que ya se está viendo.
let MOV_TURNO = 0;

async function renderMovimientos() {
  const miTurno = ++MOV_TURNO;
  poblarFiltroMateriales();

  const tipoFiltrado = parametrosDeFiltro(false).get('tipo');
  const tbody = document.getElementById('movBody');
  const contResumen = document.getElementById('movResumen');
  const contPaginas = document.getElementById('movPaginacion');

  // La lista y el resumen se piden a la vez, y NO se pinta nada hasta saber
  // que esta sigue siendo la última búsqueda: si mientras tanto se cambió un
  // filtro, esta respuesta vieja se descarta entera (antes la lista se
  // descartaba, pero el resumen viejo igual se pintaba encima del nuevo).
  // Si el resumen falla, la lista igual se muestra.
  const [rLista, rResumen] = await Promise.allSettled([
    api.get(`/movimientos?${parametrosDeFiltro(true).toString()}`),
    api.get(`/movimientos/resumen?${parametrosDeFiltro(false).toString()}`),
  ]);
  if (miTurno !== MOV_TURNO) return;

  if (rLista.status === 'rejected') {
    contResumen.innerHTML = '';
    contPaginas.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="${COLUMNAS_MOV}"><div class="inv-empty">
      No se pudieron cargar los movimientos.<br>
      <span style="color:var(--color-magenta-dark);">${esc(rLista.reason.message)}</span>
    </div></td></tr>`;
    return;
  }

  const respuesta = rLista.value;
  const movimientos = Array.isArray(respuesta) ? respuesta : respuesta.movimientos;
  const total = Array.isArray(respuesta) ? movimientos.length : respuesta.total;
  const pagina = Array.isArray(respuesta) ? 1 : respuesta.pagina;
  const totalPaginas = Array.isArray(respuesta) ? 1 : respuesta.totalPaginas;

  guardarEnCache(movimientos);

  if (rResumen.status === 'fulfilled') {
    pintarResumen(rResumen.value, tipoFiltrado);
  } else {
    contResumen.innerHTML = `
      <div class="inv-error is-visible" style="background:rgba(31,173,224,0.08); border-left-color:var(--color-cyan); color:var(--color-cyan-dark);">
        Los totales por material no están disponibles (${esc(rResumen.reason.message)}).
        La lista de abajo sí está completa.
      </div>`;
  }

  pintarPaginacion(pagina, totalPaginas, total, movimientos.length);
  pintarInfoExportacion(total);

  if (!movimientos.length) {
    tbody.innerHTML = `<tr><td colspan="${COLUMNAS_MOV}"><div class="inv-empty">No hay movimientos que coincidan con el filtro.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = movimientos.map((mv) => {
    // Un movimiento anulado se ve tachado y apagado; su contra-movimiento
    // se marca para que quede claro que no es un movimiento real de material.
    const anulado = !!mv.anulado;
    const esAnulacion = !!mv.anula_movimiento_id;
    const estilo = anulado
      ? ' style="opacity:0.45; text-decoration:line-through;"'
      : esAnulacion ? ' style="opacity:0.7;"' : '';
    const marca = anulado
      ? ' <span class="inv-chip inv-chip-AGOTADO">anulado</span>'
      : esAnulacion ? ` <span class="inv-chip inv-chip-SIN_MINIMO">anula #${esc(mv.anula_movimiento_id)}</span>` : '';

    // Costo: el del día si se guardó; si no, el actual del material (con *)
    const costo = costoDeMovimiento(mv);
    const marcaCosto = costo && !costo.delDia
      ? ' <span title="Costo actual del material: este movimiento no guardó el costo del día" style="color:rgba(var(--texto-rgb),0.4);">*</span>'
      : '';
    const celdaCosto = costo ? `${esc(moneyUnitario(costo.costo))}${marcaCosto}` : '<span class="inv-sin-dato">—</span>';
    const celdaTotal = costo ? `<strong>${esc(money(costoTotalDeMovimiento(mv)))}</strong>` : '<span class="inv-sin-dato">—</span>';

    // Referencia: en una entrada, proveedor y factura; en lo demás, OT o motivo
    const documento = textoDocumento(mv);
    const referencia = mv.tipo === 'ENTRADA' && (mv.proveedor_nombre || documento)
      ? `${esc(mv.proveedor_nombre || '')}${documento ? `<div class="inv-sub">${esc(documento)}</div>` : ''}`
      : esc(mv.ot || mv.motivo || mv.movimiento_detalle || '—');

    return `
      <tr class="inv-row-clickable"${estilo} onclick="abrirDetalleMovimiento(${mv.id})">
        <td class="mono">${esc(mv.id)}</td>
        <td class="mono">${esc(String(mv.fecha).slice(0, 10))}</td>
        <td>${chipTipo(mv.tipo)}${marca}</td>
        <td class="mono">${esc(mv.material_codigo)}</td>
        <td class="num">${cantidadMovimientoHtml(mv)}</td>
        <td class="num">${celdaCosto}</td>
        <td class="num">${celdaTotal}</td>
        <td class="mono inv-td-corto">${esc(mv.rollo_id || mv.lamina_id || '—')}${mv.medidas ? `<div class="inv-sub" style="font-family:Inter,sans-serif;">${esc(mv.medidas)}</div>` : ''}</td>
        <td class="inv-td-corto">${referencia}</td>
        <td class="inv-td-corto">${esc(mv.quien || '—')}</td>
        <td class="inv-td-corto">${esc(mv.registrado_por || '—')}</td>
      </tr>
    `;
  }).join('');
}

/** Controles de página: antes cortaba en 500 filas sin avisar a nadie. */
function pintarPaginacion(pagina, totalPaginas, total, enPantalla) {
  const cont = document.getElementById('movPaginacion');
  if (!total) { cont.innerHTML = ''; return; }

  const desde = (pagina - 1) * 100 + 1;
  const hasta = desde + enPantalla - 1;

  cont.innerHTML = `
    <span class="inv-paginacion-texto">
      Mostrando <strong>${desde}-${hasta}</strong> de <strong>${total.toLocaleString('es-PA')}</strong>
      ${total === 1 ? 'movimiento' : 'movimientos'}
    </span>
    <span class="inv-paginacion-botones">
      <button class="btn btn-outline chip" ${pagina <= 1 ? 'disabled' : ''} onclick="irAPagina(${pagina - 1})">Anterior</button>
      <span class="inv-paginacion-texto">Página ${pagina} de ${totalPaginas}</span>
      <button class="btn btn-outline chip" ${pagina >= totalPaginas ? 'disabled' : ''} onclick="irAPagina(${pagina + 1})">Siguiente</button>
    </span>
  `;
}

function irAPagina(n) {
  MOV_PAGINA = Math.max(1, n);
  renderMovimientos().then(() => {
    document.getElementById('view-movimientos').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/** Cualquier cambio de filtro vuelve a la primera página. */
function filtrarDesdeCero() {
  MOV_PAGINA = 1;
  return renderMovimientos();
}

function initMovimientosListeners() {
  document.getElementById('btnFiltrarMov').addEventListener('click', filtrarDesdeCero);

  // Los desplegables, las fechas y las casillas filtran solos; el texto espera
  // a que dejes de escribir (para no disparar una consulta por cada tecla).
  ['movFiltroTipo', 'movFiltroMaterial', 'movFiltroProveedor', 'movVerAnulados'].forEach((id) => {
    document.getElementById(id).addEventListener('change', filtrarDesdeCero);
  });

  // Elegir un mes llena Desde y Hasta con el mes completo. Si después se
  // cambia una fecha a mano, el mes se ajusta solo (o queda en "Cualquier mes").
  document.getElementById('movFiltroMes').addEventListener('change', (e) => {
    const mes = e.target.value;
    const rango = mes ? rangoDelMes(mes) : { desde: '', hasta: '' };
    document.getElementById('movFiltroDesde').value = rango.desde;
    document.getElementById('movFiltroHasta').value = rango.hasta;
    filtrarDesdeCero();
  });
  ['movFiltroDesde', 'movFiltroHasta'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      document.getElementById('movFiltroMes').value = mesDelRango(
        document.getElementById('movFiltroDesde').value,
        document.getElementById('movFiltroHasta').value
      );
      filtrarDesdeCero();
    });
  });

  let temporizador;
  ['movBuscar', 'movFiltroOt'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(filtrarDesdeCero, 350);
    });
  });

  document.getElementById('btnLimpiarMov').addEventListener('click', () => {
    ['movBuscar', 'movFiltroOt'].forEach((id) => { document.getElementById(id).value = ''; });
    ['movFiltroTipo', 'movFiltroMaterial', 'movFiltroProveedor', 'movFiltroMes',
      'movFiltroDesde', 'movFiltroHasta'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    document.getElementById('movVerAnulados').checked = false;
    filtrarDesdeCero();
  });

  document.getElementById('btnExportarMov').addEventListener('click', async (e) => {
    const btn = e.target;
    const textoOriginal = btn.textContent;
    btn.disabled = true; btn.textContent = 'Generando...';
    try {
      await descargar(`/movimientos/exportar.csv?${parametrosDeFiltro(false).toString()}`, 'movimientos.csv');
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false; btn.textContent = textoOriginal;
    }
  });
}

/**
 * Atajo usado desde el Dashboard: abre Movimientos con un mes y un tipo ya
 * filtrados (ej. las compras de septiembre).
 */
function verMovimientosDelMes(tipo, mes) {
  cambiarTab('movimientos').then(() => {
    ['movBuscar', 'movFiltroOt'].forEach((id) => { document.getElementById(id).value = ''; });
    ['movFiltroMaterial', 'movFiltroProveedor'].forEach((id) => { document.getElementById(id).value = ''; });
    document.getElementById('movVerAnulados').checked = false;
    document.getElementById('movFiltroTipo').value = tipo || '';
    const rango = rangoDelMes(mes);
    document.getElementById('movFiltroMes').value = mes;
    document.getElementById('movFiltroDesde').value = rango.desde;
    document.getElementById('movFiltroHasta').value = rango.hasta;
    filtrarDesdeCero();
  });
}

/** Atajo usado desde Inventario/Rollos: abre Movimientos ya filtrado por merma. */
function verMermasDe(materialId) {
  cambiarTab('movimientos').then(() => {
    // Se limpia lo demás: con un filtro viejo puesto (una OT, un mes) se
    // veían las mermas de otro período sin darse cuenta.
    ['movBuscar', 'movFiltroOt'].forEach((id) => { document.getElementById(id).value = ''; });
    ['movFiltroProveedor', 'movFiltroMes', 'movFiltroDesde', 'movFiltroHasta'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    document.getElementById('movVerAnulados').checked = false;
    document.getElementById('movFiltroTipo').value = 'MERMA';
    if (materialId) document.getElementById('movFiltroMaterial').value = String(materialId);
    filtrarDesdeCero();
  });
}
