/**
 * Proxy server-side hacia la API de Monday.
 *
 * Cumple tres funciones, y las tres son de seguridad:
 *
 * 1. El token de la API NO viaja en el bundle del navegador. En desarrollo lo resuelve el proxy
 *    de Vite con `VITE_MONDAY_TOKEN` (archivo local, fuera del repositorio); acá lo pone
 *    `MONDAY_TOKEN`, una variable de entorno del deploy que el cliente nunca ve.
 *
 * 2. Comprueba QUIÉN pregunta: sin un `sessionToken` de monday válido y de la cuenta habilitada,
 *    la request no llega a Monday. Abrir la URL del deploy en un navegador suelto no devuelve
 *    nada.
 *
 * 3. Comprueba QUÉ se pregunta. Antes reenviaba el cuerpo tal cual, y eso convertía a este
 *    endpoint en una API completa de la cuenta: cualquier usuario de BERGER con sesión —incluso
 *    uno de sólo lectura— podía abrir las herramientas del navegador y ejecutar la consulta que
 *    quisiera con el token de la cuenta. Ahora el cliente manda el NOMBRE de una operación del
 *    catálogo y el texto de la consulta lo pone este archivo, así que no se puede falsificar.
 *    Las variables, que sí siguen viniendo de afuera, las valida el propio catálogo.
 */
import { porton } from './_seguridad/porton'
/* OJO: desde acá sólo se puede importar código que NO use el alias `@/`. El empaquetador de las
   funciones edge de Vercel no lo resuelve —Vite sí—, así que un import de más rompe el deploy sin
   que el build local diga nada. `columns` y `operaciones` cuelgan de imports relativos. */
import { COL_DESPACHANTE, NACIONALIZADO } from '../src/services/monday/columns'
import {
  OperacionInvalida,
  operacionPermitida,
  resolverOperacion,
} from '../src/services/monday/operaciones'
import {
  COLUMNAS_CUENTA_AUTOMATICA,
  esCuentaAutomatica,
} from '../src/services/monday/cuentaAutomatica'
import { COL_CRM_CUENTA, TABLEROS_CRM } from '../src/services/monday/columns'
import {
  alcanceDe,
  asignacionAlCrear,
  conColumnasDeAlcance,
  filtrarRespuesta,
  itemDeLaOperacion,
  LECTURAS_CON_ALCANCE,
  problemaDeEscrituraDePedido,
  SOBRE_UN_ITEM,
  tercerosDe,
  veCuentaPropia,
  COLUMNAS_DE_CUENTA_PROPIA,
  veElItem,
  type Alcance,
} from '../src/services/monday/alcance'
import { esDeAdministracion } from './_seguridad/modulos'

const API = 'https://api.monday.com/v2'
const API_VERSION = '2024-10'

/**
 * Runtime declarado a mano. Sin esto Vercel toma el runtime de Node, que espera la firma
 * `(req, res)` de Express y no la de `Request`/`Response` que usa este handler: el deploy
 * compila igual y la función falla recién en la primera llamada.
 */
export const config = { runtime: 'edge' }

/** Respuesta de error con la forma que ya entiende el cliente (`{ errors: [{ message }] }`). */
const error = (status: number, message: string): Response =>
  new Response(JSON.stringify({ errors: [{ message }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/**
 * Nacionalizar exige el N° de Despacho de Importación.
 *
 * Se mira el estado FINAL: el que trae la escritura, o el que la OP ya tiene. Y el número final,
 * igual. Una OP que ya tenía el número y a la que sólo se le cambia el estado pasa sin problemas;
 * la que quedaría nacionalizada con la celda vacía, no.
 *
 * Devuelve el motivo del rechazo, o `null` si puede escribir.
 */
async function reglaDeNacionalizado(
  variables: Record<string, unknown>,
  consultar: (q: string, v: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> }>,
): Promise<string | null> {
  const item = variables.item
  if (typeof item !== 'string' || typeof variables.valores !== 'string') return null

  let valores: Record<string, unknown>
  try {
    valores = JSON.parse(variables.valores) as Record<string, unknown>
  } catch {
    return null
  }

  const estado = valores[COL_DESPACHANTE.estadoCarga]
  const nacionalizaAhora =
    typeof estado === 'object' &&
    estado !== null &&
    (estado as { label?: string }).label === NACIONALIZADO
  // Sólo se paga la lectura cuando la escritura intenta nacionalizar.
  if (!nacionalizaAhora) return null

  const numeroEnElPedido = valores[COL_DESPACHANTE.nroDespachoImpo]
  if (typeof numeroEnElPedido === 'string' && numeroEnElPedido.trim()) return null

  const r = await consultar(
    `query ($ids: [ID!]!, $cols: [String!]) {
       items(ids: $ids) { column_values(ids: $cols) { id text } }
     }`,
    { ids: [item], cols: [COL_DESPACHANTE.nroDespachoImpo] },
  )
  const items = (r.data?.items ?? []) as { column_values?: { text?: string | null }[] }[]
  const yaTiene = items[0]?.column_values?.[0]?.text?.trim()
  if (yaTiene) return null

  return 'Para pasar a "Nacionalizado" hace falta el N° Despacho Importación.'
}

/**
 * El único borrado de la app: la cuenta que crea sola la automatización de monday por el dominio
 * del mail. Antes de borrar se lee la cuenta y se exige que lo sea —recién creada, sin CUIT, con
 * dominio, en el tablero de Cuentas de los concesionarios—. Un pedido armado a mano con el id de
 * cualquier otra cuenta se rechaza acá.
 */
async function reglaDeCuentaAutomatica(
  operacion: unknown,
  variables: Record<string, unknown>,
  consultar: (q: string, v: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> }>,
): Promise<string | null> {
  if (operacion !== 'descartarCuentaAutomatica') return null
  const r = await consultar(
    `query ($ids: [ID!], $cols: [String!]) {
       items(ids: $ids) { created_at board { id } column_values(ids: $cols) { id text } }
     }`,
    { ids: [variables.item], cols: COLUMNAS_CUENTA_AUTOMATICA },
  )
  const items = (r.data?.items ?? []) as {
    created_at?: string
    board?: { id?: string }
    column_values?: { id: string; text?: string | null }[]
  }[]
  const i = items[0]
  if (!i) return 'Esa cuenta no existe.'
  const col = (id: string) => i.column_values?.find((c) => c.id === id)?.text ?? ''
  const es = esCuentaAutomatica({
    tablero: String(i.board?.id ?? ''),
    creada: i.created_at ?? '',
    cuit: col(COL_CRM_CUENTA.cuit),
    dominio: col(COL_CRM_CUENTA.dominio),
  })
  return es ? null : 'Sólo se pueden borrar las cuentas que creó sola la automatización de monday.'
}

/**
 * Qué ve y a nombre de quién escribe cada uno (`src/services/monday/alcance.ts`).
 *
 * Los tableros del workspace Concesionarios son de todos los concesionarios. Esto es lo que hace
 * que cada uno vea sólo lo suyo y que lo que carga quede a su nombre, y vive acá y no en la
 * pantalla: una pantalla que filtra es una cortina, cualquiera puede pedir el dato igual.
 *
 * Antes de la consulta: agrega las columnas que hacen falta para filtrar, firma las altas con el
 * comercial y el team de la Lista Blanca, controla los pedidos y, en las operaciones sobre un ítem
 * que ya existe, que ese ítem sea de los que ve. Devuelve el rechazo, o las variables listas.
 */
export async function aplicarAlcance(
  operacion: string,
  variables: Record<string, unknown>,
  alcance: Alcance,
  consultar: (q: string, v: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> }>,
): Promise<{ rechazo: string } | { variables: Record<string, unknown> }> {
  let v = conColumnasDeAlcance(operacion, variables)

  const problema = problemaDeEscrituraDePedido(operacion, v.valores, alcance)
  if (problema) return { rechazo: problema }

  const extra = asignacionAlCrear(operacion, alcance)
  if (Object.keys(extra).length > 0 && typeof v.valores === 'string') {
    v = { ...v, valores: JSON.stringify({ ...(JSON.parse(v.valores) as object), ...extra }) }
  }

  /* El cliente final del pedido: una cuenta propia que este usuario ve, y de 💼Cuentas. */
  const terceros = tercerosDe(operacion, v.valores)
  if (terceros.length > 0 && alcance.tipo !== 'todo') {
    const r = await consultar(
      `query ($ids: [ID!], $cols: [String!]) {
         items(ids: $ids) { id board { id } column_values(ids: $cols) { id value } }
       }`,
      { ids: terceros, cols: COLUMNAS_DE_CUENTA_PROPIA },
    )
    const items = (r.data?.items ?? []) as {
      board?: { id?: string }
      column_values?: { id: string; value?: string | null }[]
    }[]
    const todosPropios =
      items.length === terceros.length &&
      items.every(
        (i) =>
          String(i.board?.id ?? '') === TABLEROS_CRM.cuentas &&
          veCuentaPropia(alcance, i.column_values ?? []),
      )
    if (!todosPropios) return { rechazo: 'El cliente final tiene que ser uno de tus clientes.' }
  }

  const sobre = SOBRE_UN_ITEM[operacion]
  if (sobre && alcance.tipo !== 'todo') {
    const item = itemDeLaOperacion(operacion, v)
    const r = await consultar(
      `query ($ids: [ID!], $cols: [String!]) {
         items(ids: $ids) { column_values(ids: $cols) { id value ... on BoardRelationValue { linked_item_ids } } }
       }`,
      { ids: [item], cols: sobre.regla.columnas },
    )
    const items = (r.data?.items ?? []) as { column_values?: { id: string; value?: string | null }[] }[]
    if (!items[0] || !veElItem(operacion, items[0].column_values ?? [], alcance)) {
      return { rechazo: 'No tenés acceso a ese ítem.' }
    }
  }
  return { variables: v }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return error(405, 'Método no permitido.')

  // Portón: sesión de monday, sesión del día y Lista Blanca, ANTES de leer el cuerpo o de tocar el
  // token de la API. Devuelve además los módulos habilitados de quien pregunta.
  const paso = await porton(req)
  if (paso.rechazo) return paso.rechazo

  const token = process.env.MONDAY_TOKEN
  if (!token) return error(500, 'Falta MONDAY_TOKEN en el entorno.')

  let pedido: { operacion?: unknown; variables?: unknown }
  try {
    pedido = (await req.json()) as typeof pedido
  } catch {
    return error(400, 'El cuerpo del pedido no es JSON válido.')
  }

  /* Acá está el candado: la consulta sale del catálogo, no del cuerpo. Un cliente que mande su
     propio GraphQL no obtiene nada, porque este archivo no lee ningún campo `query`. */
  let query: string
  let variables: Record<string, unknown>
  let version = API_VERSION
  try {
    const operacion = resolverOperacion(pedido.operacion)
    /* Y acá está el segundo candado, el que separa a las dos poblaciones. */
    if (!operacionPermitida(operacion, paso.modulos)) {
      return error(403, 'No tenés acceso a esta aplicación. Contactá al administrador.')
    }
    query = operacion.query
    version = operacion.apiVersion ?? API_VERSION
    variables = operacion.validar((pedido.variables ?? {}) as Record<string, unknown>)
  } catch (e: unknown) {
    if (e instanceof OperacionInvalida) return error(400, e.message)
    return error(400, 'Pedido inválido.')
  }

  /** Ejecuta una consulta contra monday con el token de la cuenta. */
  const consultar = async (q: string, v: Record<string, unknown>) => {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': version },
      body: JSON.stringify({ query: q, variables: v }),
    })
    return (await r.json()) as { data?: Record<string, unknown> }
  }

  /* Reglas de negocio que NO se pueden decidir mirando sólo el pedido.
     La pantalla ya las aplica, pero un pedido armado a mano se la saltea, y ésta en particular
     deja un estado que no se puede respaldar ante la aduana. Cuesta una lectura del item y
     sólo en la escritura que intenta nacionalizar. */
  const problema =
    (await reglaDeNacionalizado(variables, consultar)) ??
    (await reglaDeCuentaAutomatica(pedido.operacion, variables, consultar))
  if (problema) return error(400, problema)

  const nombreOperacion = String(pedido.operacion)
  const alcance = alcanceDe({ ...paso.perfil, esAdministracion: esDeAdministracion(paso.perfil) })
  const conAlcance = await aplicarAlcance(nombreOperacion, variables, alcance, consultar)
  if ('rechazo' in conAlcance) return error(403, conAlcance.rechazo)
  variables = conAlcance.variables

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // El token del usuario NO se reenvía: acá se cambia por el de la cuenta, del lado servidor.
      Authorization: token,
      'API-Version': version,
    },
    body: JSON.stringify({ query, variables }),
  })

  /* Las listas se filtran antes de salir: lo que no ve, no viaja. */
  if (LECTURAS_CON_ALCANCE[nombreOperacion] && alcance.tipo !== 'todo' && res.ok) {
    const cuerpo = (await res.json()) as Parameters<typeof filtrarRespuesta>[1]
    return new Response(JSON.stringify(filtrarRespuesta(nombreOperacion, cuerpo, alcance)), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
