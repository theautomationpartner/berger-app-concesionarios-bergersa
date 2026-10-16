/**
 * Quién ve qué, y a nombre de quién queda lo que se crea.
 *
 * Los tableros del workspace Concesionarios son de TODOS los concesionarios: el CRM propio, los
 * pedidos y las unidades. Lo que separa a cada uno es lo que dice su fila de la 🔒Lista Blanca:
 *
 * - **Team Administracion** (BERGER): ve todo, de todos los concesionarios y comerciales.
 * - **Team Concesionario, rol Administrador**: es el que está en el team de monday de su
 *   concesionario. Ve todo lo de su concesionario —lo suyo y lo de sus comerciales— y es el ÚNICO
 *   del concesionario que puede cargar pedidos.
 * - **Team Concesionario, rol Comercial**: trabaja para el concesionario pero no está en su team.
 *   Ve sólo lo que cargó él, y no carga ni ve pedidos.
 *
 * Al crear una cuenta o un contacto quedan escritos el comercial (la persona que lo carga) y el
 * team de su concesionario. Lo escribe el SERVIDOR con lo que dice la Lista Blanca, no la pantalla:
 * si lo eligiera la pantalla, cualquiera podría cargar algo a nombre de otro.
 *
 * Todo esto se aplica en `api/monday.ts`, sobre la respuesta de monday y antes de escribir. Este
 * archivo no usa el alias `@/` porque lo importa el servidor.
 */
import { COL_CRM_ACTIVIDAD, COL_CRM_CONTACTO, COL_CRM_CUENTA, COL_PEDIDO, COL_VENTA } from './columns'

export const ROL_CONCESIONARIO = { ADMINISTRADOR: 'Administrador', COMERCIAL: 'Comercial' } as const

/** Lo que hace falta del perfil de la Lista Blanca. */
export interface PerfilDeAlcance {
  usuarioId: string
  /** De Administración de BERGER, ya comprobado contra el equipo de monday. */
  esAdministracion: boolean
  teams: string[]
  rolConcesionario: string[]
  idTeamConcesionario: string
  concesionarioIds: string[]
}

export type Alcance =
  | { tipo: 'todo'; usuarioId: string }
  | {
      tipo: 'administrador' | 'comercial'
      usuarioId: string
      /** El team de monday del concesionario. */
      teamId: string
      /** Su cuenta en 🌐Cuentas de BERGER. */
      cuentaIds: string[]
    }
  | { tipo: 'nada'; usuarioId: string }

export function alcanceDe(p: PerfilDeAlcance): Alcance {
  const usuarioId = String(p.usuarioId)
  if (p.esAdministracion) return { tipo: 'todo', usuarioId }
  if (!p.teams.some((t) => t.toLowerCase().includes('concesionario'))) {
    return { tipo: 'nada', usuarioId }
  }
  const base = { usuarioId, teamId: p.idTeamConcesionario.trim(), cuentaIds: p.concesionarioIds }
  /* Si la fila dice las dos cosas, manda Administrador: es el que más ve. */
  if (p.rolConcesionario.includes(ROL_CONCESIONARIO.ADMINISTRADOR)) {
    return { tipo: 'administrador', ...base }
  }
  if (p.rolConcesionario.includes(ROL_CONCESIONARIO.COMERCIAL)) return { tipo: 'comercial', ...base }
  /* Concesionario sin rol: no hay a qué concesionario atarlo, así que no ve nada. */
  return { tipo: 'nada', usuarioId }
}

/** ¿Puede cargar pedidos? Administración, o el administrador de un concesionario. */
export const puedeCargarPedidos = (a: Alcance): boolean =>
  a.tipo === 'todo' || a.tipo === 'administrador'

/* ------------------------------------------------------------------ *
 * Leer una columna cruda
 * ------------------------------------------------------------------ */

export interface ColumnaCrudaDeAlcance {
  id: string
  value?: string | null
  linked_item_ids?: (string | number)[] | null
}

/** Personas y teams de una columna `people`, desde su JSON crudo. */
export function personasYTeams(c: ColumnaCrudaDeAlcance | undefined): {
  personas: string[]
  teams: string[]
} {
  try {
    const v = JSON.parse(c?.value ?? '') as {
      personsAndTeams?: { id: number | string; kind?: string }[]
    }
    const todos = v.personsAndTeams ?? []
    return {
      personas: todos.filter((x) => x.kind !== 'team').map((x) => String(x.id)),
      teams: todos.filter((x) => x.kind === 'team').map((x) => String(x.id)),
    }
  } catch {
    return { personas: [], teams: [] }
  }
}

const conectados = (c: ColumnaCrudaDeAlcance | undefined): string[] =>
  (c?.linked_item_ids ?? []).map(String)

type Columnas = Record<string, ColumnaCrudaDeAlcance>

/* ------------------------------------------------------------------ *
 * Qué ítem ve cada uno
 * ------------------------------------------------------------------ */

/** Un ítem del CRM propio: lo ve quien lo cargó, el administrador de su team, y Administración. */
const veDelCrm =
  (colComercial: string, colTeam: string) =>
  (a: Alcance, c: Columnas): boolean => {
    if (a.tipo === 'todo') return true
    if (a.tipo === 'nada') return false
    const cargo = personasYTeams(c[colComercial]).personas.includes(a.usuarioId)
    if (a.tipo === 'comercial') return cargo
    return cargo || (Boolean(a.teamId) && personasYTeams(c[colTeam]).teams.includes(a.teamId))
  }

/** Un pedido o una unidad: lo ve su concesionario (el administrador) y Administración. */
const veDelConcesionario =
  (colCuenta: string) =>
  (a: Alcance, c: Columnas): boolean => {
    if (a.tipo === 'todo') return true
    if (a.tipo !== 'administrador') return false
    return conectados(c[colCuenta]).some((id) => a.cuentaIds.includes(id))
  }

/** Una actividad: la ve su responsable, y Administración. "Mis Pendientes" es de cada uno. */
const veActividad = (a: Alcance, c: Columnas): boolean =>
  a.tipo === 'todo' || personasYTeams(c[COL_CRM_ACTIVIDAD.responsable]).personas.includes(a.usuarioId)

interface ReglaDeLectura {
  /** Las columnas que hacen falta para decidir. El servidor las agrega a la consulta. */
  columnas: string[]
  ve: (a: Alcance, c: Columnas) => boolean
}

const CUENTAS: ReglaDeLectura = {
  columnas: [COL_CRM_CUENTA.comercial, COL_CRM_CUENTA.concesionario],
  ve: veDelCrm(COL_CRM_CUENTA.comercial, COL_CRM_CUENTA.concesionario),
}
const CONTACTOS: ReglaDeLectura = {
  columnas: [COL_CRM_CONTACTO.comercial, COL_CRM_CONTACTO.concesionario],
  ve: veDelCrm(COL_CRM_CONTACTO.comercial, COL_CRM_CONTACTO.concesionario),
}
const ACTIVIDADES: ReglaDeLectura = {
  columnas: [COL_CRM_ACTIVIDAD.responsable],
  ve: veActividad,
}
const PEDIDOS: ReglaDeLectura = {
  columnas: [COL_PEDIDO.cuenta],
  ve: veDelConcesionario(COL_PEDIDO.cuenta),
}
const UNIDADES: ReglaDeLectura = {
  columnas: [COL_VENTA.concesionario],
  ve: veDelConcesionario(COL_VENTA.concesionario),
}

/** Las lecturas de listas que se filtran, y con qué regla. */
export const LECTURAS_CON_ALCANCE: Record<string, ReglaDeLectura> = {
  cuentasCrmPropio: CUENTAS,
  contactosCrmPropio: CONTACTOS,
  actividadesDelTablero: ACTIVIDADES,
  pedidosCargados: PEDIDOS,
  novedadesDePedidos: PEDIDOS,
  unidadesDeVenta: UNIDADES,
}

/**
 * Las operaciones sobre UN ítem que ya existe: sólo si ese ítem es de los que ve.
 * El valor dice qué regla aplica y de qué variable sale el id del ítem.
 */
export const SOBRE_UN_ITEM: Record<string, { regla: ReglaDeLectura; variable: 'item' | 'ids' }> = {
  actualizarCuentaCrmPropio: { regla: CUENTAS, variable: 'item' },
  actualizarContactoCrmPropio: { regla: CONTACTOS, variable: 'item' },
  reconectarContactoCrmPropio: { regla: CONTACTOS, variable: 'item' },
  vinculosDeContactoPropio: { regla: CONTACTOS, variable: 'ids' },
  completarActividadCrm: { regla: ACTIVIDADES, variable: 'item' },
}

/** El id del ítem sobre el que trabaja una operación de `SOBRE_UN_ITEM`. */
export function itemDeLaOperacion(operacion: string, variables: Record<string, unknown>): string {
  const sobre = SOBRE_UN_ITEM[operacion]
  if (!sobre) return ''
  const v = variables[sobre.variable]
  return String(Array.isArray(v) ? (v[0] ?? '') : (v ?? ''))
}

/** Agrega a la consulta las columnas que hacen falta para filtrar. */
export function conColumnasDeAlcance(
  operacion: string,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const regla = LECTURAS_CON_ALCANCE[operacion]
  if (!regla || !Array.isArray(variables.columnas)) return variables
  return {
    ...variables,
    columnas: [...new Set([...(variables.columnas as string[]), ...regla.columnas])],
  }
}

type RespuestaDeLista = {
  data?: { boards?: { items_page?: { items?: { column_values?: ColumnaCrudaDeAlcance[] }[] } }[] }
}

/** Saca de la respuesta los ítems que este perfil no ve. */
export function filtrarRespuesta<T extends RespuestaDeLista>(
  operacion: string,
  respuesta: T,
  a: Alcance,
): T {
  const regla = LECTURAS_CON_ALCANCE[operacion]
  if (!regla || a.tipo === 'todo') return respuesta
  for (const b of respuesta.data?.boards ?? []) {
    const pagina = b.items_page
    if (!pagina?.items) continue
    pagina.items = pagina.items.filter((i) =>
      regla.ve(a, Object.fromEntries((i.column_values ?? []).map((c) => [c.id, c]))),
    )
  }
  return respuesta
}

/** ¿Este ítem, con estas columnas, es de los que ve? Para las operaciones sobre un ítem. */
export function veElItem(operacion: string, columnas: ColumnaCrudaDeAlcance[], a: Alcance): boolean {
  const sobre = SOBRE_UN_ITEM[operacion]
  if (!sobre) return true
  return sobre.regla.ve(a, Object.fromEntries(columnas.map((c) => [c.id, c])))
}

/* ------------------------------------------------------------------ *
 * Lo que se escribe al crear
 * ------------------------------------------------------------------ */

const persona = (id: string) => ({ personsAndTeams: [{ id: Number(id), kind: 'person' }] })
const team = (id: string) => ({ personsAndTeams: [{ id: Number(id), kind: 'team' }] })

/** Las columnas de asignación que el servidor le agrega a un alta del CRM propio. */
export function asignacionAlCrear(operacion: string, a: Alcance): Record<string, unknown> {
  /* El pedido y sus unidades van firmados con el team del concesionario de la Lista Blanca: el que
     manda la pantalla se reemplaza. Administración carga a nombre de cualquiera y deja el suyo. */
  if (operacion === 'crearPedido' || operacion === 'crearUnidadDeVenta') {
    if (a.tipo !== 'administrador' || !/^\d+$/.test(a.teamId)) return {}
    return {
      [operacion === 'crearPedido' ? COL_PEDIDO.equipo : COL_VENTA.concesionarioPersonas]: team(a.teamId),
    }
  }
  const cols =
    operacion === 'crearCuentaCrmPropio'
      ? COL_CRM_CUENTA
      : operacion === 'crearContactoCrmPropio'
        ? COL_CRM_CONTACTO
        : null
  if (!cols) return {}
  const valores: Record<string, unknown> = {}
  if (/^\d+$/.test(a.usuarioId)) valores[cols.comercial] = persona(a.usuarioId)
  if (a.tipo !== 'todo' && a.tipo !== 'nada' && /^\d+$/.test(a.teamId)) {
    valores[cols.concesionario] = team(a.teamId)
  }
  return valores
}

/**
 * Lo que impide una escritura de pedido, o `null` si se puede.
 *
 * El pedido lo carga sólo el administrador del concesionario (o Administración), y siempre a nombre
 * de SU concesionario: la cuenta y el team tienen que ser los de su fila de la Lista Blanca.
 */
export function problemaDeEscrituraDePedido(
  operacion: string,
  valoresJson: unknown,
  a: Alcance,
): string | null {
  if (!['crearPedido', 'crearSubitemDePedido', 'crearUnidadDeVenta'].includes(operacion)) return null
  if (a.tipo === 'todo') return null
  if (a.tipo !== 'administrador') {
    return 'Sólo el administrador del concesionario puede cargar pedidos.'
  }
  if (operacion === 'crearSubitemDePedido') return null

  let v: Record<string, { item_ids?: (string | number)[] }>
  try {
    v = JSON.parse(String(valoresJson ?? '{}'))
  } catch {
    return 'Pedido inválido.'
  }
  const colCuenta = operacion === 'crearPedido' ? COL_PEDIDO.cuenta : COL_VENTA.concesionario
  const cuentas = (v[colCuenta]?.item_ids ?? []).map(String)
  if (cuentas.length === 0 || cuentas.some((id) => !a.cuentaIds.includes(id))) {
    return 'El pedido tiene que ser de tu concesionario.'
  }
  return null
}
