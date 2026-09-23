// ==========================================================================
// rollos.js — listado, registro y edición de rollos
// ==========================================================================

const ROLLOS_CACHE = {};

/** Nombres legibles del estado de un rollo (en la tabla salía el ENUM crudo). */
const ESTADOS_ROLLO = {
  POR_CONFIRMAR: 'Por confirmar',
  SELLADO: 'Sellado',
  ABIERTO: 'Abierto',
  AGOTADO: 'Agotado',
};

/**
 * Cuánto vale en dinero lo que hay de este material: existencia x costo.
 *
 * El costo es el de la última compra registrada — cada entrada con costo lo
 * sobrescribe. Si el material nunca tuvo una entrada con costo, no se inventa
 * un número: se dice que falta el costo.
 */
function valorDelMaterial(m) {
  const costo = m.costo == null ? null : Number(m.costo);
  const existencia = m.existencia == null ? null : Number(m.existencia);

  if (costo == null || existencia == null) {
    return `<span class="inv-chip inv-chip-AGOTADO" title="Este material todavía no tiene un costo registrado. Se llena solo al registrar una entrada con costo unitario.">sin costo</span>`;
  }

  const total = money(existencia * costo);
  return `<span style="font-size:0.85rem; color:rgba(var(--texto-rgb),0.6);"
                title="${esc(existencia)} ${esc(m.unidad_codigo)} x ${esc(money(costo))} (costo de la última compra)">
            Valor: <strong class="mono" style="color:var(--texto);">${esc(total)}</strong>
          </span>`;
}

/**
 * Existencia que el sistema cuenta pero que no está en ningún rollo medido.
 *
 * Si hay, se muestra: es material que existe (una compra registrada sin crear
 * el rollo, o un conteo del material entero) pero que no se sabe en qué rollo
 * está. Al medir el rollo que falta, el sistema lo reconoce y no lo suma dos
 * veces. Si la cifra no tiene sentido, se corrige con un Ajuste.
 */
function avisoSinRollo(m) {
  if (m.en_rollos == null || m.existencia == null) return '';
  const sinRollo = Math.round((Number(m.existencia) - Number(m.en_rollos)) * 10000) / 10000;
  // Diferencias de centésimas vienen de redondeos viejos (el largo del rollo
  // se guardaba con 2 decimales); no vale la pena alarmar por eso.
  if (Math.abs(sinRollo) < 0.01) return '';
  const titulo = sinRollo > 0
    ? `En los rollos medidos hay ${m.en_rollos}; los otros ${sinRollo} están contados en la existencia pero no en ningún rollo. Cuando midas el rollo donde están, se reconocen solos.`
    : `Los rollos suman más (${m.en_rollos}) que la existencia (${m.existencia}). Revisa con un Ajuste por conteo físico.`;
  return `<span class="inv-chip ${sinRollo > 0 ? 'inv-chip-BAJO' : 'inv-chip-NEGATIVO'}" title="${esc(titulo)}">
            ${sinRollo > 0 ? `${esc(sinRollo)} sin rollo` : 'rollos no cuadran'}
          </span>`;
}

function etiquetaEstadoRollo(estado) {
  const clase = estado === 'POR_CONFIRMAR' ? 'inv-chip-POR_CONFIRMAR'
    : estado === 'AGOTADO' ? 'inv-chip-AGOTADO'
    : estado === 'ABIERTO' ? 'inv-chip-SIN_MINIMO'
    : 'inv-chip-NORMAL';
  return `<span class="inv-chip ${clase}">${esc(ESTADOS_ROLLO[estado] || estado)}</span>`;
}

/** 1 metro = 3.28084 pies. Convierte y dispara 'input' para que otros listeners se enteren. */
function convertirMetrosAPies(idCampoMetros, idCampoLargo) {
  const metros = parseFloat(document.getElementById(idCampoMetros).value);
  if (isNaN(metros)) return;
  const pies = Math.round(metros * 3.28084 * 10000) / 10000;
  const largoInput = document.getElementById(idCampoLargo);
  largoInput.value = pies;
  largoInput.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Lee la barra de filtros de Rollos. */
function parametrosRollos() {
  const params = new URLSearchParams();
  const material = document.getElementById('rollosFiltroMaterial');
  const ancho = document.getElementById('rollosAnchoMinimo');
  const soloDisp = document.getElementById('rollosSoloDisponibles');
  if (material && material.value) params.set('materialId', material.value);
  if (ancho && ancho.value) params.set('anchoMinimo', ancho.value);
  if (soloDisp && soloDisp.checked) params.set('soloDisponibles', '1');
  return params;
}

async function renderRollos() {
  const params = parametrosRollos();
  const [rollos, materiales] = await Promise.all([
    api.get(`/rollos?${params.toString()}`),
    api.get('/materiales'),
  ]);
  rollos.forEach((r) => { ROLLOS_CACHE[r.id] = r; });
  CATALOGOS.materiales = materiales;

  // Llenar una sola vez el desplegable de materiales del filtro
  const selMat = document.getElementById('rollosFiltroMaterial');
  if (selMat) {
    const elegido = selMat.value;
    const opciones = '<option value="">Todos los materiales</option>' +
      materiales.map((m) => `<option value="${esc(m.id)}" ${String(m.id) === elegido ? 'selected' : ''}>${esc(m.codigo)} — ${esc(m.descripcion)}</option>`).join('');
    if (selMat.innerHTML !== opciones) selMat.innerHTML = opciones;
  }

  // Aviso del filtro de ancho: los rollos sin ancho registrado se muestran
  // igual, porque no saber el ancho no es lo mismo que ser angosto. Hay que
  // ir a medirlos, y conviene decirlo en vez de esconderlos.
  const anchoPedido = document.getElementById('rollosAnchoMinimo');
  const aviso = document.getElementById('rollosAviso');
  if (aviso) {
    if (anchoPedido && anchoPedido.value) {
      const sinAncho = rollos.filter((r) => r.ancho == null).length;
      const conAncho = rollos.length - sinAncho;
      aviso.innerHTML = `Mostrando <strong>${conAncho}</strong> rollo(s) de ancho ${esc(anchoPedido.value)} o más` +
        (sinAncho ? `, más <strong>${sinAncho}</strong> sin ancho registrado (hay que ir a medirlos).` : '.');
    } else {
      aviso.textContent = '';
    }
  }

  const porMaterial = {};
  rollos.forEach((r) => {
    if (!porMaterial[r.material_id]) porMaterial[r.material_id] = [];
    porMaterial[r.material_id].push(r);
  });

  const cont = document.getElementById('rollosBody');
  const materialesConRollos = materiales
    .filter((m) => porMaterial[m.id] && porMaterial[m.id].length)
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  if (!materialesConRollos.length) {
    cont.innerHTML = `<div class="inv-empty">No hay rollos registrados todavía.</div>`;
    return;
  }

  cont.innerHTML = materialesConRollos.map((m) => {
    const rollosDeEste = porMaterial[m.id].slice().sort((a, b) => a.id.localeCompare(b.id));
    return `
      <div class="inv-table-wrap" style="margin-bottom:1.5rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; padding:1rem 1.25rem; border-bottom:1px solid rgba(var(--texto-rgb),0.08);">
          <div>
            <span class="mono" style="font-weight:600;">${esc(m.codigo)}</span>
            <span style="color:rgba(var(--texto-rgb),0.55); margin-left:0.5rem;">${esc(m.descripcion)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap;">
            <span style="font-size:0.85rem; color:rgba(var(--texto-rgb),0.6);">
              Existencia total: <strong class="mono">${m.existencia == null ? '—' : esc(m.existencia)}</strong> ${esc(m.unidad_codigo)}
            </span>
            ${valorDelMaterial(m)}
            ${avisoSinRollo(m)}
            ${chipEstado(m.estado)}
          </div>
        </div>
        <table class="inv-table">
          <thead><tr><th>ID Rollo</th><th>Ancho</th><th>Largo inicial</th><th>Restante</th><th>Bodega</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            ${rollosDeEste.map((r) => `
              <tr>
                <td class="mono">${esc(r.id)}</td>
                <td class="num">${r.ancho != null ? `<strong>${esc(r.ancho)}</strong>` : '<span style="color:rgba(var(--texto-rgb),0.35);">sin medir</span>'}</td>
                <td class="num">${r.largo ?? '—'}</td>
                <td class="num">${r.restante ?? '—'}</td>
                <td>${esc(r.bodega_nombre || '—')}</td>
                <td>${etiquetaEstadoRollo(r.estado)}</td>
                <td><div class="inv-row-actions">
                  ${puedeEscribir() ? `<button onclick="abrirModalEditarRollo(${argJs(r.id)})">Editar</button>` : ''}
                  ${esAdmin() ? `<button onclick="abrirModalEliminarRollo(${argJs(r.id)})" style="color:var(--color-magenta-dark);">Eliminar</button>` : ''}
                </div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }).join('');
}

function abrirModalNuevoRollo() {
  // Solo los materiales que se miden por largo (pie o metro lineal) llevan rollos
  const mats = CATALOGOS.materiales.filter(esMaterialDeRollo);
  if (!mats.length) {
    alert('No hay materiales en pie lineal o metro lineal. Crea el material con esa unidad primero.');
    return;
  }
  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Registrar rollo ya existente en bodega</h3>
    <p class="inv-hint">Úsalo cuando el rollo ya está físicamente en el taller pero nunca se registró (no cuando llega una compra nueva — eso va por "Registrar entrada").</p>
    <form id="formNuevoRollo">
      <div class="form-two-col">
        <div class="form-row"><label>ID del rollo</label><input type="text" id="r-id" placeholder="Se genera solo">
          <p class="inv-hint" style="margin:0.3rem 0 0;" id="r-id-hint">Déjalo vacío y se asigna el siguiente.</p></div>
        <div class="form-row"><label>Material *</label><select id="r-material" required>${optMateriales(mats)}</select></div>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Ancho</label><input type="number" step="any" id="r-ancho"></div>
        <div class="form-row"><label>Largo en pies lineales (si se conoce)</label><input type="number" step="any" id="r-largo"></div>
      </div>
      <div class="form-row">
        <label>¿Lo tienes en metros? Escríbelo aquí y se convierte solo</label>
        <input type="number" step="any" id="r-metros" placeholder="Ej. 50 (metros de fábrica)" oninput="convertirMetrosAPies('r-metros', 'r-largo')">
        <p class="inv-hint" style="margin-top:0.3rem;">1 metro = 3.28084 pies. El campo "Largo" de arriba se llena solo — igual lo puedes ajustar a mano.</p>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Estado</label>
          <select id="r-estado">
            <option value="POR_CONFIRMAR">Por confirmar</option>
            <option value="SELLADO">Sellado</option>
            <option value="ABIERTO">Abierto</option>
          </select>
        </div>
        <div class="form-row"><label>Precisión de la medida</label>
          <select id="r-precision">
            <option value="POR_CONFIRMAR">Por confirmar</option>
            <option value="ESTIMADO">Estimado</option>
            <option value="EXACTO">Exacto</option>
          </select>
        </div>
      </div>
      <div class="form-row"><label>Costo del rollo completo (opcional)</label>
        <input type="number" step="any" min="0" id="r-costo" placeholder="B/. — lo que costó el rollo entero">
        <p class="inv-hint" style="margin:0.3rem 0 0;" id="r-costo-calculo">Si lo pones, el sistema calcula el costo por pie y se lo asigna al material.</p>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Bodega</label>
          <select id="r-bodega"><option value="">Sin definir</option>${opt(CATALOGOS.bodegas, 'id', 'nombre')}</select></div>
        <div class="form-row"><label>Ubicación</label>
          <input type="text" id="r-ubicacion" placeholder="Ej. Estante 3"></div>
      </div>
      <div id="r-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Guardar rollo</button>
      </div>
    </form>
  `);

  // Sugerir el ID libre del material elegido, y mostrar el costo por pie
  const selMat = document.getElementById('r-material');
  async function sugerirId() {
    try {
      const r = await api.get(`/rollos/siguiente-id?materialId=${selMat.value}`);
      document.getElementById('r-id').placeholder = r.id;
      document.getElementById('r-id-hint').textContent = `Si lo dejas vacío se asigna ${r.id}.`;
    } catch (err) { /* solo es una sugerencia */ }
  }
  function calcularCostoRollo(idCosto, idLargo, idCaja) {
    const costo = parseFloat(document.getElementById(idCosto).value);
    const largo = parseFloat(document.getElementById(idLargo).value);
    const caja = document.getElementById(idCaja);
    if (isNaN(costo)) { caja.textContent = 'Si lo pones, el sistema calcula el costo por pie y se lo asigna al material.'; return; }
    if (isNaN(largo) || largo <= 0) { caja.textContent = 'Escribe el largo para calcular el costo por pie.'; return; }
    caja.innerHTML = `= <strong>${esc(money(costo / largo))}</strong> por pie &nbsp;(${esc(money(costo))} ÷ ${largo} pies)`;
  }
  selMat.addEventListener('change', sugerirId);
  ['r-costo', 'r-largo'].forEach((id) => document.getElementById(id).addEventListener('input',
    () => calcularCostoRollo('r-costo', 'r-largo', 'r-costo-calculo')));
  sugerirId();

  document.getElementById('formNuevoRollo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('r-error');
    try {
      const creado = await api.post('/rollos', {
        id: document.getElementById('r-id').value.trim() || null,
        costoRollo: document.getElementById('r-costo').value || null,
        materialId: document.getElementById('r-material').value,
        ancho: document.getElementById('r-ancho').value || null,
        largo: document.getElementById('r-largo').value || null,
        estado: document.getElementById('r-estado').value,
        precisionMedida: document.getElementById('r-precision').value,
        bodegaId: document.getElementById('r-bodega').value || null,
        ubicacion: document.getElementById('r-ubicacion').value || null,
      });
      cerrarModal();
      await refrescarVistas();
      if (creado && creado.mensaje) alert(creado.mensaje);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

// ==========================================================================
// Modal: Editar rollo — si cambia el largo, pide quién/autoriza y queda
// registrado como un AJUSTE en Movimientos (nunca en silencio).
// ==========================================================================
function abrirModalEditarRollo(rolloId) {
  const r = ROLLOS_CACHE[rolloId];
  if (!r) return;

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Editar rollo — <span class="mono">${esc(r.id)}</span></h3>
    <p class="inv-hint">Material: <strong>${esc(r.material_codigo)}</strong> — ${esc(r.material_descripcion)}</p>
    <form id="formEditarRollo">
      <div class="form-two-col">
        <div class="form-row"><label>Ancho</label><input type="number" step="any" id="er-ancho" value="${r.ancho ?? ''}"></div>
        <div class="form-row"><label>Largo en pies lineales</label><input type="number" step="any" id="er-largo" value="${r.largo ?? ''}"></div>
      </div>
      <div class="form-row">
        <label>¿Lo vas a corregir con metros? Escríbelo aquí y se convierte solo</label>
        <input type="number" step="any" id="er-metros" placeholder="Ej. 50 (metros de fábrica)" oninput="convertirMetrosAPies('er-metros', 'er-largo')">
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Estado</label>
          <select id="er-estado">
            <option value="POR_CONFIRMAR" ${r.estado === 'POR_CONFIRMAR' ? 'selected' : ''}>Por confirmar</option>
            <option value="SELLADO" ${r.estado === 'SELLADO' ? 'selected' : ''}>Sellado</option>
            <option value="ABIERTO" ${r.estado === 'ABIERTO' ? 'selected' : ''}>Abierto</option>
            <option value="AGOTADO" ${r.estado === 'AGOTADO' ? 'selected' : ''}>Agotado</option>
          </select>
        </div>
        <div class="form-row"><label>Precisión de la medida</label>
          <select id="er-precision">
            <option value="POR_CONFIRMAR" ${r.precision_medida === 'POR_CONFIRMAR' ? 'selected' : ''}>Por confirmar</option>
            <option value="ESTIMADO" ${r.precision_medida === 'ESTIMADO' ? 'selected' : ''}>Estimado</option>
            <option value="EXACTO" ${r.precision_medida === 'EXACTO' ? 'selected' : ''}>Exacto</option>
          </select>
        </div>
      </div>
      <div class="form-row"><label>Costo del rollo completo (opcional)</label>
        <input type="number" step="any" min="0" id="er-costo" placeholder="B/. — déjalo vacío para no cambiarlo">
        <p class="inv-hint" style="margin:0.3rem 0 0;" id="er-costo-calculo">
          ${(() => {
            const mat = (CATALOGOS.materiales || []).find((x) => x.id === r.material_id);
            return mat && mat.costo != null
              ? `Costo actual: ${esc(money(mat.costo))} por pie${r.largo ? ` → este rollo vale ${esc(money(Number(mat.costo) * Number(r.largo)))}` : ''}.`
              : 'Este material todavía no tiene costo. Pon lo que costó el rollo entero y se calcula por pie.';
          })()}
        </p>
      </div>
      <div class="form-two-col">
        <div class="form-row"><label>Bodega</label><select id="er-bodega"><option value="">Sin definir</option>${opt(CATALOGOS.bodegas, 'id', 'nombre', r.bodega_id)}</select></div>
        <div class="form-row"><label>Ubicación</label><input type="text" id="er-ubicacion" value="${esc(r.ubicacion)}"></div>
      </div>

      <p class="inv-hint" style="margin-top:0.25rem;">
        Cualquier corrección de <strong>largo o ancho</strong> queda registrada en Movimientos.
        Además, un rollo con largo ya no se queda en "por confirmar": al guardar, su estado y su
        precisión se ajustan solos, y si todos los rollos de este material ya están medidos,
        el material también deja de salir como "por confirmar".
      </p>

      <div id="er-ajuste-fields" class="inv-hidden">
        <div class="inv-hint" style="color:var(--color-magenta-dark);">Cambiar el largo genera un ajuste visible en Movimientos — por eso pedimos estos dos datos.</div>
        <div class="form-two-col">
          <div class="form-row"><label>Quién hace el cambio *</label>
            <input type="text" id="er-quien" value="${esc(nombreUsuario())}"></div>
          <div class="form-row"><label>Quién autoriza *</label>
            <select id="er-autoriza">${opcionesAutoriza()}</select></div>
        </div>
      </div>

      <div id="er-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Guardar cambios</button>
      </div>
    </form>
  `);

  const largoOriginal = r.largo;
  const largoInput = document.getElementById('er-largo');
  const ajusteFields = document.getElementById('er-ajuste-fields');

  // Solo el LARGO mueve existencia, así que solo él pide quién/autoriza.
  // El ancho igual queda registrado en Movimientos, pero sin pedir permiso.
  function revisarSiCambioLargo() {
    const nuevo = largoInput.value === '' ? null : Number(largoInput.value);
    const cambio = nuevo !== null && nuevo !== (largoOriginal === null ? null : Number(largoOriginal));
    ajusteFields.classList.toggle('inv-hidden', !cambio);
    document.getElementById('er-quien').required = cambio;
    document.getElementById('er-autoriza').required = cambio;
  }
  largoInput.addEventListener('input', revisarSiCambioLargo);

  // Costo del rollo → costo por pie, en vivo
  function calcularCostoEditar() {
    const costo = parseFloat(document.getElementById('er-costo').value);
    const largo = parseFloat(largoInput.value);
    if (isNaN(costo)) return;
    const caja = document.getElementById('er-costo-calculo');
    caja.innerHTML = (isNaN(largo) || largo <= 0)
      ? 'Hace falta el largo del rollo para calcular el costo por pie.'
      : `= <strong>${esc(money(costo / largo))}</strong> por pie &nbsp;(${esc(money(costo))} ÷ ${largo} pies). Pasa a ser el costo del material.`;
  }
  document.getElementById('er-costo').addEventListener('input', calcularCostoEditar);
  largoInput.addEventListener('input', calcularCostoEditar);

  document.getElementById('formEditarRollo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('er-error');
    try {
      await api.put(`/rollos/${encodeURIComponent(rolloId)}`, {
        ancho: document.getElementById('er-ancho').value,
        largo: document.getElementById('er-largo').value,
        estado: document.getElementById('er-estado').value,
        precisionMedida: document.getElementById('er-precision').value,
        bodegaId: document.getElementById('er-bodega').value || null,
        ubicacion: document.getElementById('er-ubicacion').value || null,
        quien: document.getElementById('er-quien').value || null,
        autoriza: document.getElementById('er-autoriza').value || null,
        costoRollo: document.getElementById('er-costo').value || null,
      });
      cerrarModal();
      await renderRollos();
      await refrescarVistas();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}

function initRollosListeners() {
  document.getElementById('btnNuevoRollo').addEventListener('click', abrirModalNuevoRollo);
  document.getElementById('btnFiltrarRollos').addEventListener('click', renderRollos);

  ['rollosFiltroMaterial', 'rollosSoloDisponibles'].forEach((id) => {
    document.getElementById(id).addEventListener('change', renderRollos);
  });

  let temporizador;
  document.getElementById('rollosAnchoMinimo').addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(renderRollos, 350);
  });

  document.getElementById('btnLimpiarRollos').addEventListener('click', () => {
    document.getElementById('rollosFiltroMaterial').value = '';
    document.getElementById('rollosAnchoMinimo').value = '';
    document.getElementById('rollosSoloDisponibles').checked = false;
    renderRollos();
  });

  document.getElementById('btnExportarRollos').addEventListener('click', async (e) => {
    const btn = e.target; const texto = btn.textContent;
    btn.disabled = true; btn.textContent = 'Generando...';
    try { await descargar('/rollos/exportar.csv', 'rollos.csv'); }
    catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.textContent = texto; }
  });
}

// ==========================================================================
// Modal: Eliminar rollo (desactiva + registra merma del restante si aplica)
// ==========================================================================
function abrirModalEliminarRollo(rolloId) {
  const r = ROLLOS_CACHE[rolloId];
  if (!r) return;

  abrirModal(`
    <button class="inv-modal-close" onclick="cerrarModal()">&times;</button>
    <h3 class="font-display">Eliminar rollo — <span class="mono">${esc(r.id)}</span></h3>
    <p class="inv-hint" style="color:var(--color-magenta-dark);">
      ${r.restante && r.restante > 0
        ? `Este rollo tiene ${esc(r.restante)} restantes — al eliminarlo se descuentan del material con un AJUSTE "Rollo eliminado" que queda registrado en Movimientos.`
        : `Este rollo ya no tiene restante; se marcará como eliminado y solo quedará la constancia en Movimientos.`}
    </p>
    <form id="formEliminarRollo">
      <div class="form-two-col">
        <div class="form-row"><label>Quién elimina *</label>
          <input type="text" id="del-quien" required value="${esc(nombreUsuario())}"></div>
        <div class="form-row"><label>Quién autoriza *</label>
          <select id="del-autoriza" required>${opcionesAutoriza()}</select></div>
      </div>
      <div class="form-row"><label>Observaciones</label><textarea id="del-obs" rows="2" placeholder="Ej. dato de prueba, no es inventario real"></textarea></div>
      <div id="del-error" class="inv-error"></div>
      <div class="inv-modal-actions">
        <button type="button" class="btn btn-outline chip" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-magenta chip">Sí, eliminar rollo</button>
      </div>
    </form>
  `);

  document.getElementById('formEliminarRollo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('del-error');
    try {
      await api.delete(`/rollos/${encodeURIComponent(rolloId)}`, {
        quien: document.getElementById('del-quien').value,
        autoriza: document.getElementById('del-autoriza').value,
        observaciones: document.getElementById('del-obs').value || null,
      });
      cerrarModal();
      await refrescarVistas();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('is-visible');
    }
  });
}
