import { useEffect, useState } from 'react'
import { CUENTA_BERGER } from '@/services/monday/columns'
import { obtenerDatosSesion } from '@/services/monday/sesion'

/**
 * Resultado de la verificación de monday.
 *
 * - `verificando`: todavía se está esperando la respuesta de monday.
 * - `habilitado`: hay sesión de monday de la cuenta de BERGER. Falta el ingreso (Lista Blanca y
 *   autenticador), que decide el servidor.
 * - `fuera-de-monday`: nadie contestó el pedido de sesión. Pasa cuando se abre la URL del deploy
 *   directo en el navegador: no hay iframe padre que responda.
 * - `sin-acceso`: hay sesión de monday, pero de una cuenta que no es la de BERGER.
 */
export type Acceso = 'verificando' | 'habilitado' | 'fuera-de-monday' | 'sin-acceso'

export interface EstadoMonday {
  acceso: Acceso
  /** Usuario de monday, cuando se conoce. Es la llave de la sesión del día en este navegador. */
  usuarioId: string | null
}

/**
 * Primera barrera, en el navegador: ¿estamos dentro del monday de BERGER?
 *
 * Corre ANTES de dibujar nada. Si la interfaz se dibujara primero y recién fallara al pedir datos,
 * quien abre la URL suelta vería la forma del circuito interno de la empresa con un cartel encima.
 *
 * No es la barrera de verdad —esa está en el servidor, que verifica la firma del token—: es la que
 * evita mostrar una pantalla que igual no iba a funcionar.
 *
 * En desarrollo se saltea: ahí no hay iframe de monday que pueda contestar, y el token local ya
 * define quién tiene acceso.
 */
export function useAccesoMonday(): EstadoMonday {
  const [estado, setEstado] = useState<EstadoMonday>(
    import.meta.env.DEV
      ? { acceso: 'habilitado', usuarioId: 'desarrollo' }
      : { acceso: 'verificando', usuarioId: null },
  )

  useEffect(() => {
    if (import.meta.env.DEV) return

    let vigente = true
    obtenerDatosSesion()
      .then((datos) => {
        if (!vigente) return
        setEstado(
          datos.accountId === CUENTA_BERGER
            ? { acceso: 'habilitado', usuarioId: String(datos.userId) }
            : { acceso: 'sin-acceso', usuarioId: null },
        )
      })
      .catch(() => {
        // Fuera de monday el pedido de sesión no se responde nunca; lo corta el propio tiempo
        // límite de `sesion.ts`, y ese vencimiento llega acá como un rechazo más.
        if (vigente) setEstado({ acceso: 'fuera-de-monday', usuarioId: null })
      })

    return () => {
      vigente = false
    }
  }, [])

  return estado
}
