import type { ReactNode } from 'react'

interface Props {
  titulo: string
  bajada?: ReactNode
  children: ReactNode
  /** Tarjeta más ancha, para la pantalla con el QR y los códigos de recuperación. */
  ancha?: boolean
}

/**
 * Marco de todas las pantallas del ingreso: fondo bordó de BERGER, tarjeta blanca y el logo arriba.
 *
 * Es deliberadamente distinto del resto de la app —que es blanca—: el cambio de fondo marca que
 * todavía no se está ADENTRO, y que lo que se pide es para entrar. Una pantalla de ingreso que se
 * confunde con la app invita a escribir el código donde no va, o a no reconocer una pantalla falsa.
 */
export function MarcoIngreso({ titulo, bajada, children, ancha = false }: Props) {
  return (
    <div className="ingreso">
      <div className={`ingreso-tarjeta${ancha ? ' ingreso-tarjeta--ancha' : ''}`}>
        <img className="ingreso-logo" src="/logo-berger.svg" alt="BERGER S.A." />
        <h1 className="ingreso-tit">{titulo}</h1>
        {bajada && <p className="ingreso-bajada">{bajada}</p>}
        {children}
      </div>
      <p className="ingreso-pie">Importación Berger S.A.</p>
    </div>
  )
}
