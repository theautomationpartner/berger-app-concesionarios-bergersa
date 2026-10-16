/**
 * El cliente final de una venta directa: elegirlo entre las cuentas del concesionario.
 *
 * Desde el 16/10/2026 el cliente final es una cuenta del CRM PROPIO del concesionario (💼Cuentas
 * del workspace Concesionarios), no de 🌐Cuentas de BERGER. Lo que se ofrece es lo que el servidor
 * deja ver: las cuentas de su concesionario (ver `alcance.ts`). Así cada cliente final queda con su
 * concesionario, y uno no ve los clientes de otro.
 *
 * Si el cliente no existe, "Cliente nuevo" abre la operación de Cuentas y contactos sin perder el
 * pedido (lo maneja `CrearPedido`): ahí se carga completo —con su contacto, si hace falta—, como
 * cliente final, y vuelve elegido.
 *
 * Se pueden cargar varios: un tractor a nombre de dos hermanos o de una sociedad y su titular es
 * algo que pasa seguido, y partir el pedido en dos por eso no tendría sentido.
 */
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import type { CuentaCrm } from '@/services/monday/crmPropio'
import { FichaCuenta } from './FichaCuenta'

interface Props {
  /** Las cuentas del CRM propio que este usuario ve. */
  cuentas: CuentaCrm[]
  /** Los que ya están elegidos. */
  elegidos: { id: string; nombre: string }[]
  onCambiar: (clientes: { id: string; nombre: string }[]) => void
  cargando?: boolean
  /** Abrir el alta de cuentas para cargar uno nuevo. */
  onCrearNuevo: () => void
}

export function ClienteFinal({ cuentas, elegidos, onCambiar, cargando, onCrearNuevo }: Props) {
  const sumar = (c: { id: string; nombre: string }) => {
    if (elegidos.some((x) => x.id === c.id)) return
    onCambiar([...elegidos, { id: c.id, nombre: c.nombre }])
  }

  return (
    <div className="ficha ficha--elegir">
      <div className="ficha-head">
        <span className="ficha-rotulo">
          Cliente final <span className="campo-req">· obligatorio</span>
        </span>
        <button
          type="button"
          className="btn btn--borde btn--chico"
          disabled={cargando}
          onClick={onCrearNuevo}
        >
          <i className="fa-solid fa-plus" aria-hidden="true" /> Cliente nuevo
        </button>
      </div>

      {/* Cada uno con su "Quitar": si se eligió mal, se saca y se elige otro. Uno que no está en la
          lista leída (porque se recargó) igual se muestra, para poder sacarlo. */}
      {elegidos.map((c) => {
        const ficha = cuentas.find((x) => x.id === c.id)
        const quitar = () => onCambiar(elegidos.filter((x) => x.id !== c.id))
        return ficha ? (
          <FichaCuenta
            key={c.id}
            cuenta={{ ...ficha, concesionarioIds: [], concesionLimite: ficha.concesionLimite ?? 0 }}
            rotulo=""
            onQuitar={quitar}
            textoQuitar="Quitar"
          />
        ) : (
          <div key={c.id} className="ficha ficha--fila">
            <span className="ficha-nombre">{c.nombre}</span>
            <button type="button" className="btn btn--texto btn--chico btn--quitar" onClick={quitar}>
              <i className="fa-solid fa-xmark" aria-hidden="true" /> Quitar
            </button>
          </div>
        )
      })}

      <SelectorBuscable
        valor=""
        opciones={cuentas
          .filter((c) => !elegidos.some((e) => e.id === c.id))
          .map((c) => ({
            valor: c.id,
            rotulo: c.nombre,
            detalle: [c.cuit && `CUIT ${c.cuit}`, c.categoria, c.ciudad, c.provincia]
              .filter(Boolean)
              .join(' · '),
          }))}
        vacio={cargando ? 'Cargando tus clientes…' : 'Buscar entre tus clientes, por nombre o CUIT…'}
        queSon="clientes"
        bloqueado={cargando}
        onCambiar={(v) => {
          const c = cuentas.find((x) => x.id === v)
          if (c) sumar(c)
        }}
      />
      <span className="campo-ayuda">
        Son las cuentas de tu concesionario. Si no está, «Cliente nuevo» la carga como cliente final
        y vuelve a este pedido. Se puede poner más de uno: el pedido queda a nombre de todos.
      </span>
    </div>
  )
}
