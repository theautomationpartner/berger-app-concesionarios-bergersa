/**
 * Qué parte de la app puede usar cada persona.
 *
 * Esta es la app de los concesionarios: tiene un solo módulo, `pedidos`, y la pregunta es sólo
 * quién lo recibe. Lo reciben dos poblaciones:
 *
 * - el comercial de un concesionario, que es para quien existe la app;
 * - Administración de BERGER, para poder probarla y dar soporte mirando lo mismo que ve el
 *   concesionario.
 *
 * Nadie más. En la app de BERGER S.A. una fila sin equipo se quedaba con Despacho; acá no hay
 * Despacho, y una fila que no dice de qué concesionario es no tiene qué ver. Sin módulos, el
 * ingreso rechaza con el mismo cartel genérico de siempre.
 *
 * La decisión se toma UNA vez, al ingresar, y viaja firmada dentro de la sesión del día. Los
 * pedidos de datos la vuelven a comprobar contra la Lista Blanca en vivo, así que sacarle a
 * alguien el equipo en el tablero le corta el módulo en el acto.
 */
import type { ModuloApp } from '../../src/services/monday/operaciones'
import { TEAM, TEAM_MONDAY } from './config'
import { consultarMonday } from './mondayServidor'
import type { Perfil } from './listaBlanca'

/**
 * Los módulos de la app. El tipo se define junto al catálogo de operaciones, que es donde cada
 * consulta declara a qué módulo pertenece: así no hay dos listas de módulos que se puedan separar.
 */
export type Modulo = ModuloApp

export const MODULOS: Modulo[] = ['pedidos']

/** Que el valor venga de afuera y sea uno de los módulos conocidos. */
export const esModulo = (v: unknown): v is Modulo => MODULOS.includes(v as Modulo)

/**
 * ¿Es el comercial de un concesionario?
 *
 * Alcanza con que su fila diga "Concesionario" en la columna de equipo. Se mira que CONTENGA la
 * palabra y no que sea igual, porque cada concesionario tiene su propia etiqueta —"Concesionario
 * 1", "Concesionario Rosario"— y van a seguir apareciendo: exigir una lista cerrada obligaría a
 * tocar el código cada vez que BERGER suma uno.
 */
const esConcesionario = (perfil: Perfil): boolean =>
  perfil.teams.some((t) => t.toLowerCase().includes('concesionario'))

/** ¿Está en el equipo de Administración de BERGER? */
const esAdministracion = (perfil: Perfil): boolean => perfil.teams.includes(TEAM.ADMINISTRACION)

/**
 * Los módulos que habilita la FILA de la Lista Blanca, sin preguntarle nada a monday.
 *
 * Es lo que se vuelve a comprobar en cada pedido de datos: es gratis —el perfil ya se leyó— y es
 * lo que hace que un cambio en el tablero valga en el acto.
 */
export function modulosSegunLaLista(perfil: Perfil): Modulo[] {
  if (esConcesionario(perfil) || esAdministracion(perfil)) return ['pedidos']
  return []
}

/** ¿Este usuario de monday está en ese equipo? */
async function estaEnElEquipo(usuarioId: string, equipoId: string): Promise<boolean> {
  const datos = await consultarMonday<{ teams: { users: { id: string }[] | null }[] | null }>(
    `query ($ids: [ID!]) { teams(ids: $ids) { users(kind: all) { id } } }`,
    { ids: [equipoId] },
  )
  return (datos.teams?.[0]?.users ?? []).some((u) => String(u.id) === usuarioId)
}

/**
 * Los módulos definitivos de un perfil, ya con el equipo de monday comprobado.
 *
 * Se calcula sólo al ingresar, porque es el único que consulta monday.
 *
 * Al concesionario le alcanza con la fila: es la regla de la app de BERGER S.A., y su permiso real
 * por pedido lo da el equipo del concesionario en cada item. A Administración, en cambio, se le
 * pide además estar en el equipo de monday: entra a una app de terceros mirando pedidos de todos
 * los concesionarios, y eso no puede sostenerse sólo en lo que diga una fila del tablero. Si el
 * equipo no se puede leer, no se otorga: ante la duda, menos acceso.
 */
export async function modulosDelPerfil(perfil: Perfil, usuarioId: string): Promise<Modulo[]> {
  if (esConcesionario(perfil)) return ['pedidos']
  if (!esAdministracion(perfil)) return []

  try {
    return (await estaEnElEquipo(usuarioId, TEAM_MONDAY.ADMINISTRACION)) ? ['pedidos'] : []
  } catch {
    return []
  }
}
