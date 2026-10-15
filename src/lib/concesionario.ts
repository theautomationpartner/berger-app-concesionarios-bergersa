/**
 * De qué concesionario es quien está cargando.
 *
 * Cada concesionario tiene en monday un equipo con el MISMO nombre que su cuenta del CRM ("BRUNO
 * MAQUINARIAS S.R.L." es la cuenta y es el equipo). Por eso no hace falta preguntarlo: el servidor
 * manda, al ingresar, los equipos de monday del usuario, y acá se cruzan con las cuentas.
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
): ConcesionarioElegible[] {
  const porNombre = new Map(equipos.map((e) => [normalizarNombre(e.nombre), e.id]))
  return cuentas
    .filter(esConcesionario)
    .filter((c) => esAdministracion || porNombre.has(normalizarNombre(c.nombre)))
    .map((cuenta) => ({ cuenta, equipoId: porNombre.get(normalizarNombre(cuenta.nombre)) ?? '' }))
    .sort((a, b) => a.cuenta.nombre.localeCompare(b.cuenta.nombre, 'es'))
}
