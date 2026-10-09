/**
 * La navegación, toda en el renglón del logo: la casa, y después un desplegable por nivel
 * (Operación → Pantalla), igual que en la app de BERGER S.A.
 *
 * Los desplegables aparecen de a uno: en el inicio no hay ninguno —la pantalla ya ofrece las
 * operaciones—, al entrar a una aparece el de operaciones, y el de pantallas cuando la operación
 * tiene pantallas adentro.
 */
import { useCallback, useRef, useState } from 'react'
import { useClickAfuera } from '@/hooks/useClickAfuera'
import { usePanelQueEntra } from '@/hooks/usePanelQueEntra'
import {
  OPERACIONES_PRINCIPALES,
  PANTALLAS_PEDIDOS,
  RUTA_INICIO,
  type OperacionPrincipal,
  type PantallaPedidos,
  type Ruta,
} from '@/lib/navegacion'

interface OpcionNav {
  valor: string
  rotulo: string
  icono: string
}

interface PropsSelector {
  etiqueta: string
  /** Lo elegido. `null` dibuja el "Seleccionar…". */
  actual: OpcionNav | null
  opciones: OpcionNav[]
  onElegir: (valor: string) => void
}

/** Un nivel de la navegación: la etiqueta arriba y el desplegable abajo. */
function SelectorNav({ etiqueta, actual, opciones, onElegir }: PropsSelector) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  /* Si abajo no hay lugar, el panel se abre para arriba (o hacia el otro costado). */
  const panel = usePanelQueEntra<HTMLUListElement>(abierto)
  const cerrar = useCallback(() => setAbierto(false), [])
  useClickAfuera(caja, abierto, cerrar)

  return (
    <div className="topnav-item" ref={caja}>
      <span className="topnav-lbl">{etiqueta}</span>
      <div className="topnav-sel">
        <button
          type="button"
          className={`topnav-btn${abierto ? ' topnav-btn--abierto' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={abierto}
          onClick={() => setAbierto((v) => !v)}
        >
          {actual ? (
            <>
              <i className={`${actual.icono} topnav-btn-ic`} aria-hidden="true" />
              <span className="topnav-btn-txt">{actual.rotulo}</span>
            </>
          ) : (
            <span className="topnav-btn-txt topnav-btn-txt--vacio">Seleccionar…</span>
          )}
          <i
            className={`fa-solid fa-chevron-${abierto ? 'up' : 'down'} topnav-btn-flecha`}
            aria-hidden="true"
          />
        </button>

        {abierto && (
          <ul ref={panel} className="topnav-panel" role="listbox">
            {opciones.map((o) => (
              <li key={o.valor}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.valor === actual?.valor}
                  className={`topnav-op${o.valor === actual?.valor ? ' topnav-op--elegida' : ''}`}
                  onClick={() => {
                    onElegir(o.valor)
                    cerrar()
                  }}
                >
                  <i className={o.icono} aria-hidden="true" />
                  <span>{o.rotulo}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

interface Props {
  ruta: Ruta
  onIr: (ruta: Ruta) => void
}

const comoOpcion = (o: { id: string; titulo: string; icono: string }): OpcionNav => ({
  valor: o.id,
  rotulo: o.titulo,
  icono: o.icono,
})

export function BarraNavegacion({ ruta, onIr }: Props) {
  const principal = OPERACIONES_PRINCIPALES.find((o) => o.id === ruta.principal) ?? null
  const pantalla = PANTALLAS_PEDIDOS.find((o) => o.id === ruta.pedidos) ?? null

  return (
    <nav className="topnav" aria-label="Navegación">
      {/* El atajo al inicio, suelto y grande: es el movimiento más repetido. */}
      <button
        type="button"
        className="topnav-icono topnav-icono--casa"
        title="Ir al inicio"
        aria-label="Ir al inicio"
        onClick={() => onIr(RUTA_INICIO)}
      >
        <i className="fa-solid fa-house" aria-hidden="true" />
      </button>

      <img className="topnav-logo" src="/logo-berger.svg" alt="BERGER S.A." />

      {principal && (
        <SelectorNav
          etiqueta="Operación:"
          actual={comoOpcion(principal)}
          opciones={OPERACIONES_PRINCIPALES.map(comoOpcion)}
          onElegir={(v) => onIr({ ...RUTA_INICIO, principal: v as OperacionPrincipal })}
        />
      )}

      {principal?.id === 'pedidos' && (
        <>
          <i className="fa-solid fa-chevron-right topnav-flecha" aria-hidden="true" />
          <SelectorNav
            etiqueta="Pantalla:"
            actual={pantalla ? comoOpcion(pantalla) : null}
            opciones={PANTALLAS_PEDIDOS.map(comoOpcion)}
            onElegir={(v) => onIr({ principal: 'pedidos', pedidos: v as PantallaPedidos })}
          />
        </>
      )}
    </nav>
  )
}
