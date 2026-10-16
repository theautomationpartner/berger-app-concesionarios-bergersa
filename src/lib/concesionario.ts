/**
 * De qué concesionario es quien está cargando.
 *
 * Cada cuenta de 🌐Cuentas con categoría Concesionario dice en "✋Concesionario NOMBRE TEAM" cómo se
 * llama su equipo de monday. Por eso no hace falta preguntarlo: el servidor manda, al ingresar, los
 * equipos de monday del usuario, y acá se cruzan con esa columna. Si una cuenta todavía no la tiene
 * cargada, se compara con el nombre de la cuenta, que es como se armaron los equipos.
 *
 * - Un concesionario ve sólo la cuenta de su equipo, ya elegida: cargar a nombre de otro no es algo
 *   que tenga que poder hacer.
 * - Administración ve todos, porque carga pedidos a nombre de cualquiera, y cada uno con el equipo
 *   que le corresponde para que el pedido quede de ese concesionario.
 */
import type { CuentaCrm } from '@/services/monday/crm'

/** Para comparar nombres sin que molesten mayúsculas, tildes ni espacios de más. */
export const normalizarNombre = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

export interface EquipoMonday {
  id: string
  nombre: string
}

/**
 * El concesionario de quien usa la app, según su fila de la 🔒Lista Blanca.
 *
 * Es lo que manda desde el 16/10/2026: la cuenta (🌐CONCESIONARIOS) y el team del concesionario
 * salen de la fila, no de los equipos de monday en que está la persona. Un comercial trabaja para
 * el concesionario sin estar en su team, así que por los equipos no se lo podría ubicar.
 */
export interface ConcesionarioPropio {
  /** "Comercial" y/o "Administrador". */
  rol: string[]
  /** Id del team de monday del concesionario. */
  teamId: string
  teamNombre: string
  /** Su cuenta en 🌐Cuentas. */
  cuentaIds: string[]
}

/**
 * ¿Es un comercial de concesionario? Ve sólo lo suyo del CRM y no carga pedidos: los pedidos los
 * carga el administrador del concesionario. Administración de BERGER nunca lo es.
 */
export const esComercialDeConcesionario = (p: {
  esAdministracion?: boolean
  concesionario?: ConcesionarioPropio
}): boolean =>
  !p.esAdministracion &&
  Boolean(p.concesionario?.rol.includes('Comercial')) &&
  !p.concesionario?.rol.includes('Administrador')

/** El nombre de equipo con que se busca una cuenta: el de su columna, o su propio nombre. */
export const equipoDeLaCuenta = (c: CuentaCrm): string => c.equipoNombre?.trim() || c.nombre

/** Un concesionario que se puede elegir, con el equipo de monday que firma sus pedidos. */
export interface ConcesionarioElegible {
  cuenta: CuentaCrm
  /** Vacío si no hay equipo con su nombre: el pedido se carga igual, sin equipo. */
  equipoId: string
}

export const esConcesionario = (c: CuentaCrm): boolean =>
  c.categoria.toLowerCase().includes('concesionario')

export function concesionariosElegibles(
  cuentas: CuentaCrm[],
  equipos: EquipoMonday[],
  esAdministracion: boolean,
  /** El de su fila de la Lista Blanca. Si está, manda: su cuenta y su team, sin buscar por nombre. */
  propio?: ConcesionarioPropio,
): ConcesionarioElegible[] {
  if (!esAdministracion && propio && propio.cuentaIds.length > 0) {
    return cuentas
      .filter((c) => propio.cuentaIds.includes(c.id))
      .map((cuenta) => ({ cuenta, equipoId: propio.teamId }))
  }
  const porNombre = new Map(equipos.map((e) => [normalizarNombre(e.nombre), e.id]))
  return cuentas
    .filter(esConcesionario)
    .filter((c) => esAdministracion || porNombre.has(normalizarNombre(equipoDeLaCuenta(c))))
    .map((cuenta) => ({
      cuenta,
      equipoId: porNombre.get(normalizarNombre(equipoDeLaCuenta(cuenta))) ?? '',
    }))
    .sort((a, b) => a.cuenta.nombre.localeCompare(b.cuenta.nombre, 'es'))
}
