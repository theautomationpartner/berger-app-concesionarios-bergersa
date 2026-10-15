/**
 * La tarjeta de un pedido, del lado del concesionario.
 *
 * Plegada dice lo primordial en una mirada: a quién, en qué anda, qué tractores y cuánto. Lo demás
 * —los datos, cada unidad, los totales— está al desplegarla: con diez pedidos en pantalla, el
 * detalle de todos a la vez no se lee.
 *
 * No muestra el precio de lista: el pedido ya está hecho, y lo que importa es lo que se factura.
 */
import type { ReactNode } from 'react'
import { Plata } from '@/components/ui/Plata'
import { ESTADO_PEDIDO, PEDIDO_PARA, POLITICA_CONTADO, TIPO_PEDIDO } from '@/services/monday/columns'
import type { PedidoLeido, UnidadLeida } from '@/services/monday/seguimientoPedidos'

/** El color del estado. Es lo primero que se mira, y conviene no tener que leerlo para saberlo. */
export function tonoDeEstado(estado: string): string {
  switch (estado) {
    case ESTADO_PEDIDO.APROBADO:
      return 'chip--verde'
    case ESTADO_PEDIDO.RECHAZADO:
      return 'chip--rojo'
    case ESTADO_PEDIDO.ASIGNADO:
      return 'chip--azul'
    case ESTADO_PEDIDO.ASIGNADO_PARCIAL:
      return 'chip--teal'
    case ESTADO_PEDIDO.A_FABRICA:
      return 'chip--violeta'
    default:
      return 'chip--ambar'
  }
}

/**
 * A quién le factura BERGER: al cliente final en la venta directa; al concesionario en la compra
 * de stock. En concesión no se factura.
 */
export function aQuienSeLeFactura(pedido: PedidoLeido): string {
  if (pedido.tipoPedido === TIPO_PEDIDO.CONCESION) return 'No se factura (concesión)'
  if (pedido.pedidoPara === PEDIDO_PARA.DIRECTA) return pedido.terceroNombre || 'el cliente final'
  return pedido.cuentaNombre || 'el concesionario'
}

/** "2026-10-15" → "15/10/2026". */
const fecha = (iso: string): string => (iso ? iso.split('-').reverse().join('/') : '')

interface Props {
  pedido: PedidoLeido
  /** Las unidades de ESTE pedido. */
  unidades: UnidadLeida[]
  abierto?: boolean
  onAbrir?: () => void
  children?: ReactNode
}

export function TarjetaPedido({ pedido, unidades, abierto = false, onAbrir, children }: Props) {
  const asignadas = unidades.filter((u) => u.inventarioId).length
  const iva = pedido.totalFacturaConIva - pedido.totalFacturaSinIva
  /* El título: el cliente final si lo hay, que es como el concesionario recuerda la venta. */
  const quien = pedido.terceroNombre || pedido.cuentaNombre || pedido.nombre

  return (
    <div
      className={`pedido-card pedido-card--${tonoDeEstado(pedido.estado).replace('chip--', '')}`}
    >
      <button
        type="button"
        className="pedido-card-head pedido-card-head--compacta"
        aria-expanded={abierto}
        onClick={onAbrir}
        disabled={!onAbrir}
      >
        <span className="pedido-card-tit">
          <span className="pedido-card-linea">
            <b className="pedido-card-nom">{quien}</b>
            <span className={`chip ${tonoDeEstado(pedido.estado)}`}>{pedido.estado || 'Sin estado'}</span>
            {pedido.estado === ESTADO_PEDIDO.ASIGNADO_PARCIAL && (
              <span className="chip chip--teal">{pedido.porcentajeAsignacion}% con tractor</span>
            )}
            {pedido.tipoPedido === TIPO_PEDIDO.CONCESION && (
              <span className="chip chip--violeta">En concesión</span>
            )}
            {pedido.politicaContado === POLITICA_CONTADO.ESPECIAL && (
              <span className="chip chip--ambar">Operatoria especial</span>
            )}
            {pedido.fechaSolicitud && (
              <span className="pedido-card-fecha">{fecha(pedido.fechaSolicitud)}</span>
            )}
          </span>
          {/* Un chip por modelo: qué se pidió, sin abrir nada. */}
          <span className="pedido-card-items">
            {pedido.renglones.map((r) => (
              <span key={r.id} className="chip chip--gris">
                {r.cantidad} × {r.nombre}
              </span>
            ))}
          </span>
        </span>

        <span className="pedido-card-chips">
          <Plata valor={pedido.totalFacturaSinIva} nota="+ IVA" grande />
          {onAbrir && (
            <i className={`fa-solid fa-chevron-${abierto ? 'up' : 'down'}`} aria-hidden="true" />
          )}
        </span>
      </button>

      {abierto && (
        <div className="pedido-card-cuerpo">
          <div className="pedido-card-principal">
            <dl className="datos-pares">
              <div>
                <dt>Tipo</dt>
                <dd>
                  {[pedido.tipoPedido, pedido.pedidoPara].filter(Boolean).join(' · ') || '—'}
                </dd>
              </div>
              {pedido.tipoFactura && (
                <div>
                  <dt>Factura</dt>
                  <dd>{pedido.tipoFactura}</dd>
                </div>
              )}
              {pedido.politicaContado && (
                <div>
                  <dt>Política contado</dt>
                  <dd>{pedido.politicaContado}</dd>
                </div>
              )}
              <div>
              </div>
              <div>
                <dt>Se le factura a</dt>
                <dd>{aQuienSeLeFactura(pedido)}</dd>
              </div>
              <div>
                <dt>Forma de pago</dt>
                <dd>
                  {pedido.pago || '—'}
                  {pedido.banco ? ` · ${pedido.banco}` : ''}
                  {pedido.plazo ? ` · ${pedido.plazo}` : ''}
                </dd>
              </div>
              <div>
                <dt>Cargado por</dt>
                <dd>{pedido.comercial || '—'}</dd>
              </div>
              {pedido.fechaAprobacion && (
                <div>
                  <dt>Aprobado el</dt>
                  <dd>{fecha(pedido.fechaAprobacion)}</dd>
                </div>
              )}
              {unidades.length > 0 && (
                <div>
                  <dt>Con tractor</dt>
                  <dd>
                    {asignadas} de {unidades.length}
                  </dd>
                </div>
              )}
            </dl>

            {/* El motivo del rechazo es lo único que le sirve a quien tiene que volver a cargarlo. */}
            {pedido.motivo && (
              <div className="aviso aviso--alerta">
                <i className="fa-solid fa-comment-dots" aria-hidden="true" />
                <span>
                  <b>Observación de BERGER:</b> {pedido.motivo}
                </span>
              </div>
            )}

            {children}

            <div className="totales-pedido totales-pedido--tres">
              <div className="total-cuadro">
                <small>IVA</small>
                <Plata valor={iva} apagado />
              </div>
              <div className="total-cuadro total-cuadro--fuerte">
                <small>A facturar s/IVA</small>
                <Plata valor={pedido.totalFacturaSinIva} grande />
              </div>
              <div className="total-cuadro total-cuadro--fuerte">
                <small>Total con IVA</small>
                <Plata valor={pedido.totalFacturaConIva} grande />
              </div>
            </div>

            {/* La venta directa factura al cliente final al precio que puso el concesionario. */}
            {pedido.pedidoPara === PEDIDO_PARA.DIRECTA && pedido.totalClienteFinal > 0 && (
              <div className="totales-pedido totales-pedido--dos">
                <div className="total-cuadro">
                  <small>Factura al cliente final s/IVA</small>
                  <Plata valor={pedido.totalClienteFinal} />
                </div>
                <div className="total-cuadro">
                  <small>Tu comisión</small>
                  <Plata valor={pedido.totalComision} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
