// ==========================================================================
// inventario.js — tabla de inventario, búsqueda y filtros
// ==========================================================================

function chipEstado(estado) {
  const legibles = {
    NORMAL: 'Normal', BAJO: 'Bajo', CRITICO: 'Crítico', AGOTADO: 'Agotado',
    NEGATIVO: 'Negativo', SIN_MINIMO: 'Sin mínimo', POR_CONFIRMAR: 'Por confirmar',
    POR_MEDIR: 'Por medir', FALTAN_POR_MEDIR: 'Faltan por medir',
  };
  return `<span class="inv-chip inv-chip-${esc(estado)}">${esc(legibles[estado] || estado)}</span>`;
}

async function renderInventario() {
  const materiales = await api.get('/materiales');
  CATALOGOS.materiales = materiales;

  // Poblar filtro de categorías una sola vez
  // Se rearma en cada carga (puede haber categorías nuevas) conservando lo
  // elegido, y con el nombre escapado: una categoría con < > rompía la
  // pantalla — y era una puerta para colar código.
  const selCat = document.getElementById('invFiltroCategoria');
  const elegida = selCat.value;
  const opciones = '<option value="">Todas las categorías</option>' +
    CATALOGOS.categorias
      .map((c) => `<option value="${esc(c.id)}" ${String(c.id) === elegida ? 'selected' : ''}>${esc(c.nombre)}</option>`)
      .join('');
  if (selCat.innerHTML !== opciones) selCat.innerHTML = opciones;

  pintarTablaInventario(materiales);
}

function pintarTablaInventario(materiales) {
  const buscar = (document.getElementById('invBuscar').value || '').toLowerCase();
  const catFiltro = document.getElementById('invFiltroCategoria').value;
  const estadoFiltro = document.getElementById('invFiltroEstado').value;

  const filtrados = materiales.filter((m) => {
    if (buscar && !`${m.codigo} ${m.descripcion}`.toLowerCase().includes(buscar)) return false;
    if (catFiltro && String(m.categoria_id) !== catFiltro) return false;
    if (estadoFiltro && m.estado !== estadoFiltro) return false;
    return true;
  });

  const tbody = document.getElementById('invBody');
  if (!filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="inv-empty">No hay materiales que coincidan.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(filaMaterial).join('');
}

/**
 * Una fila de material con sus acciones. Se usa en la pestaña Inventario y
 * también en las listas que se abren desde las tarjetas del Dashboard, para
 * que se pueda editar desde los dos lados sin duplicar código.
 */
function filaMaterial(m) {
  return `
    <tr>
      <td class="mono">${esc(m.codigo)}</td>
      <td class="inv-td-texto">${esc(m.descripcion)}</td>
      <td class="inv-td-texto">${esc(m.categoria)}${m.subcategoria ? ' / ' + esc(m.subcategoria) : ''}</td>
      <td class="num">${m.existencia == null ? '—' : esc(m.existencia)}${esMaterialDeLamina(m) && m.existencia != null
        ? `<div class="inv-sub">${esc(numero(aPies2(m.existencia)))} pie²</div>` : ''}</td>
      <td>${esc(m.unidad_codigo)}${esMaterialDeLamina(m) && m.espesor_mm != null ? `<div class="inv-sub">${esc(numero(m.espesor_mm))} mm</div>` : ''}</td>
      <td>${chipEstado(m.estado)}</td>
      <td>
        <div class="inv-row-actions">
          ${puedeEscribir() ? `
            <button onclick="abrirModalEditarMaterial(${m.id})">Editar</button>
            <button onclick="abrirModalEntrada(${m.id})">Entrada</button>
            <button onclick="abrirModalSalida(${m.id})">Salida</button>
            <button onclick="abrirModalMerma(${m.id})">Merma</button>
            <button onclick="abrirModalAjuste(${m.id})">Ajuste</button>
          ` : ''}
          <button onclick="verMermasDe(${m.id})" title="Ver en Movimientos toda la merma registrada de este material">Mermas</button>
          ${esAdmin() ? `<button onclick="abrirModalEliminarMaterial(${m.id})" style="color:var(--color-magenta-dark);">Eliminar</button>` : ''}
        </div>
      </td>
    </tr>
  `;
}

function initInventarioListeners() {
  document.getElementById('btnExportarInv').addEventListener('click', async (e) => {
    const btn = e.target; const texto = btn.textContent;
    btn.disabled = true; btn.textContent = 'Generando...';
    try { await descargar('/materiales/exportar.csv', 'inventario.csv'); }
    catch (err) { alert(err.message); }
    finally { btn.disabled = false; btn.textContent = texto; }
  });

  document.getElementById('invBuscar').addEventListener('input', () => pintarTablaInventario(CATALOGOS.materiales));
  document.getElementById('invFiltroCategoria').addEventListener('change', () => pintarTablaInventario(CATALOGOS.materiales));
  document.getElementById('invFiltroEstado').addEventListener('change', () => pintarTablaInventario(CATALOGOS.materiales));
  document.getElementById('btnNuevoMaterial').addEventListener('click', () => abrirModalNuevoMaterial());
  document.getElementById('btnImportarExcel').addEventListener('click', () => abrirModalImportarExcel());
}
