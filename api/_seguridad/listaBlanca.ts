/**
 * Lectura de la 🔒Lista Blanca: quién puede entrar, a qué apps, y con qué exigencias.
 *
 * Cada fila es una persona habilitada. Los administradores comparten una misma cuenta de monday,
 * así que puede haber varias filas con el mismo ID de usuario: en ese caso comparten el acceso y
 * el autenticador, porque para monday —y para la app— son el mismo usuario.
 */
import { COL_LISTA_BLANCA, configSeguridad, ETIQUETA } from './config'
import { consultarMonday, textoDe, type ColumnaTexto } from './mondayServidor'

export interface Perfil {
  /** Id del item de la Lista Blanca. Es el identificador del perfil en todo el sistema. */
  id: string
  nombre: string
  nombreCompleto: string
  usuarioId: string
  email: string
  activo: boolean
  /** Ids de las apps habilitadas (columna "ID APP Habilitadas"). */
  apps: string[]
  /** Equipos de la columna "Team": deciden qué módulos de la app ve. */
  teams: string[]
  /** Id del equipo en monday, tal como quedó cargado en la fila. */
  idTeam: string
  tipoUsuario: string
  autenticadorDesactivado: boolean
  /** "Comercial" y/o "Administrador", si es de un concesionario. */
  rolConcesionario: string[]
  /** Id del team de monday de su concesionario. Un comercial no está en ese team, pero trabaja para él. */
  idTeamConcesionario: string
  nombreTeamConcesionario: string
  /** La cuenta de su concesionario en 🌐Cuentas (normalmente una). */
  concesionarioIds: string[]
  /**
   * Los equipos de monday que le sirven a la pantalla para saber de qué concesionario es: los suyos
   * si es un concesionario, todos si es de Administración (puede cargar a nombre de cualquiera).
   * Se completa al ingresar (`equiposVisibles`); la Lista Blanca no lo trae.
   */
  equiposMonday?: { id: string; nombre: string }[]
}

interface ItemCrudo {
  id: string
  name: string
  board: { id: string } | null
  column_values: ColumnaTexto[]
}

const COLUMNAS = Object.values(COL_LISTA_BLANCA)

const CAMPOS = `id name board { id } column_values(ids: $columnas) { id text ... on BoardRelationValue { linked_item_ids } }`

/** El texto de un `dropdown` son las etiquetas separadas por coma. */
const lista = (texto: string): string[] =>
  texto
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * El texto de una columna `email` es "email - texto visible". Se toma la primera dirección que
 * aparezca, porque el texto visible puede ser cualquier cosa.
 */
const primerEmail = (texto: string): string => /[^\s@]+@[^\s@]+\.[^\s@]+/.exec(texto)?.[0] ?? ''

function aPerfil(item: ItemCrudo): Perfil {
  const c = item.column_values
  return {
    id: item.id,
    nombre: item.name.trim(),
    nombreCompleto: textoDe(c, COL_LISTA_BLANCA.nombreCompleto),
    usuarioId: textoDe(c, COL_LISTA_BLANCA.usuarioId),
    email: primerEmail(textoDe(c, COL_LISTA_BLANCA.email)),
    activo: textoDe(c, COL_LISTA_BLANCA.estado) === ETIQUETA.ACTIVO,
    apps: lista(textoDe(c, COL_LISTA_BLANCA.appsIds)),
    teams: lista(textoDe(c, COL_LISTA_BLANCA.team)),
    idTeam: textoDe(c, COL_LISTA_BLANCA.idTeam),
    tipoUsuario: textoDe(c, COL_LISTA_BLANCA.tipoUsuario),
    autenticadorDesactivado:
      textoDe(c, COL_LISTA_BLANCA.desactivarAutenticador) === ETIQUETA.AUTENTICADOR_DESACTIVADO,
    rolConcesionario: lista(textoDe(c, COL_LISTA_BLANCA.rolConcesionario)),
    idTeamConcesionario: textoDe(c, COL_LISTA_BLANCA.idTeamConcesionario).trim(),
    nombreTeamConcesionario: textoDe(c, COL_LISTA_BLANCA.nombreTeamConcesionario).trim(),
    concesionarioIds: (
      (c.find((x) => x.id === COL_LISTA_BLANCA.concesionario) as
        | (ColumnaTexto & { linked_item_ids?: string[] | null })
        | undefined)?.linked_item_ids ?? []
    ).map(String),
  }
}

/** Todas las filas de un usuario de monday, estén o no habilitadas. */
export async function perfilesDeUsuario(usuarioId: string): Promise<Perfil[]> {
  const { tableroListaBlanca } = configSeguridad()
  const datos = await consultarMonday<{ items_page_by_column_values: { items: ItemCrudo[] } }>(
    `query ($tablero: ID!, $columna: String!, $valor: [String]!, $columnas: [String!]) {
      items_page_by_column_values(
        board_id: $tablero
        limit: 50
        columns: [{ column_id: $columna, column_values: $valor }]
      ) { items { ${CAMPOS} } }
    }`,
    { tablero: tableroListaBlanca, columna: COL_LISTA_BLANCA.usuarioId, valor: [usuarioId], columnas: COLUMNAS },
  )
  return datos.items_page_by_column_values.items
    .map(aPerfil)
    // Se vuelve a comparar acá aunque monday ya filtró: el filtro de monday sobre columnas de
    // texto no está documentado como coincidencia exacta, y "11442835" no puede colarse como
    // si fuera "114428359".
    .filter((p) => p.usuarioId === usuarioId)
}

/**
 * Un perfil por id, o `null`.
 *
 * Se comprueba que el item sea DE la Lista Blanca. El id llega dentro de una sesión firmada por
 * el servidor, así que en principio es confiable; la comprobación cuesta nada y cubre el día que
 * alguien reutilice este código con otro origen para el id.
 */
export async function leerPerfil(perfilId: string): Promise<Perfil | null> {
  if (!/^\d{1,20}$/.test(perfilId)) return null
  const { tableroListaBlanca } = configSeguridad()
  const datos = await consultarMonday<{ items: ItemCrudo[] }>(
    `query ($ids: [ID!], $columnas: [String!]) { items(ids: $ids) { ${CAMPOS} } }`,
    { ids: [perfilId], columnas: COLUMNAS },
  )
  const item = datos.items[0]
  if (!item || item.board?.id !== tableroListaBlanca) return null
  return aPerfil(item)
}

/** ¿Este perfil puede entrar a esta app? Activo y con la app en su lista. */
export const habilitadoParaApp = (perfil: Perfil, appId: string): boolean =>
  perfil.activo && perfil.apps.includes(appId)

/** Email de un usuario de la cuenta, para el registro de intentos de quien no está en la lista. */
export async function emailDeUsuario(usuarioId: string): Promise<string> {
  try {
    const datos = await consultarMonday<{ users: { email: string }[] }>(
      `query ($ids: [ID!]) { users(ids: $ids) { email } }`,
      { ids: [usuarioId] },
    )
    return datos.users[0]?.email ?? ''
  } catch {
    return ''
  }
}
