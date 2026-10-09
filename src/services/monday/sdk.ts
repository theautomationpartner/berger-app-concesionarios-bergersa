/**
 * Acceso a la API de Monday.
 *
 * El cliente NO arma consultas GraphQL: pide una operación por NOMBRE, de las que están en
 * `operaciones.ts`. En producción viaja sólo ese nombre más las variables, y el texto de la
 * consulta lo pone el proxy, que además valida las variables. Así `/api/monday` deja de ser una
 * API abierta de la cuenta: lo que no está en el catálogo, no se puede pedir.
 *
 * - En desarrollo pega contra `/monday-api` (y `/monday-file` para los binarios), los proxies de
 *   Vite hacia api.monday.com. Sin el proxy el navegador bloquea la request por CORS. Ahí la
 *   consulta se resuelve localmente, contra el mismo catálogo, y el token sale de `.env.local`
 *   —archivo que está en `.gitignore` y nunca llega al repositorio—.
 * - En producción pega contra `/api/monday`, función serverless que inyecta el token del lado del
 *   servidor (`MONDAY_TOKEN`), para que el secreto no quede incrustado en el bundle que descarga
 *   el navegador.
 */
import { EVENTO_REINGRESAR, EVENTO_SIN_ACCESO, sesionDelDia } from '@/services/acceso/sesionDelDia'
import { resolverOperacion, type NombreOperacion, type Variables } from './operaciones'

const TOKEN = (import.meta.env.VITE_MONDAY_TOKEN as string | undefined)?.trim() || undefined

const ENDPOINT = import.meta.env.DEV ? '/monday-api' : '/api/monday'
const API_VERSION = '2024-10'

/**
 * En desarrollo hay acceso real sólo si hay token local. En producción la autenticación la
 * resuelve el proxy server-side, así que se asume habilitado.
 */
export const mondayHabilitado = (): boolean => (import.meta.env.DEV ? Boolean(TOKEN) : true)

interface ApiError {
  message: string
}

interface Respuesta<T> {
  data?: T
  errors?: ApiError[]
}

/** Falla de autorización: el pedido no viene de una sesión válida de monday. */
export class SinAcceso extends Error {}

/**
 * Saca el motivo real de una respuesta fallida.
 *
 * Un `HTTP 500` pelado esconde justamente los errores más útiles: cuando falta una variable de
 * entorno, el proxy contesta con el motivo escrito en el JSON.
 */
async function motivoDelFallo(res: Response): Promise<string> {
  const cuerpo = await res.text().catch(() => '')
  try {
    const json = JSON.parse(cuerpo) as Respuesta<unknown>
    const mensajes = json.errors?.map((e) => e.message).filter(Boolean)
    if (mensajes?.length) return mensajes.join(' · ')
  } catch {
    // Cuerpo que no es JSON (una página de error del hosting): se usa tal cual.
  }
  const recorte = cuerpo.trim().slice(0, 200)
  return recorte ? `HTTP ${res.status} · ${recorte}` : `HTTP ${res.status}`
}

/**
 * Cabecera de autorización.
 *
 * En desarrollo va el token personal de `.env.local`, porque el pedido sale directo contra la
 * API por el proxy de Vite. En producción va el `sessionToken` de monday, que NO sirve para
 * consultar la API: sirve para que el proxy compruebe que del otro lado hay un usuario real de
 * la cuenta habilitada, y recién ahí lo cambia por el token de la cuenta.
 */
async function autorizacion(): Promise<Record<string, string>> {
  if (import.meta.env.DEV) return { Authorization: TOKEN ?? '' }
  const { obtenerSessionToken } = await import('./sesion')
  const sesion = sesionDelDia()
  return {
    Authorization: `Bearer ${await obtenerSessionToken()}`,
    // La sesión del día: la prueba de que este perfil pasó la Lista Blanca y el autenticador.
    // Sin ella el proxy rechaza el pedido aunque la sesión de monday sea válida.
    ...(sesion ? { 'X-Sesion-App': sesion } : {}),
  }
}

/**
 * Revisa si el servidor rechazó el pedido por acceso, y avisa a la pantalla de ingreso.
 *
 * Un rechazo así no es un error de la pantalla que hizo el pedido: la sesión venció —pasó la
 * medianoche con la app abierta— o al perfil lo dieron de baja. Por eso no se resuelve acá sino
 * con un evento que escucha el ingreso, que vuelve a pedir el código o muestra el cartel de
 * acceso denegado sin que cada pantalla tenga que saber de sesiones.
 */
async function revisarRechazo(res: Response): Promise<void> {
  if (res.status !== 401 && res.status !== 403) return
  const cuerpo = (await res
    .clone()
    .json()
    .catch(() => ({}))) as { codigo?: string }
  if (cuerpo.codigo === 'SESION_REQUERIDA') window.dispatchEvent(new Event(EVENTO_REINGRESAR))
  if (cuerpo.codigo === 'SIN_ACCESO') window.dispatchEvent(new Event(EVENTO_SIN_ACCESO))
  throw new SinAcceso(await motivoDelFallo(res))
}

/**
 * Ejecuta una operación del catálogo y devuelve `data`.
 *
 * El cuerpo cambia según el entorno, y esa es toda la diferencia: en desarrollo se le manda a
 * monday la consulta ya resuelta —del otro lado está la API, que no sabe de nombres de
 * operación—; en producción se manda el nombre, y el que la resuelve y valida es el proxy.
 */
export async function mondayApi<T>(
  operacion: NombreOperacion,
  variables: Variables = {},
): Promise<T> {
  let cabeceras: Record<string, string>
  try {
    cabeceras = await autorizacion()
  } catch {
    throw new SinAcceso('No hay una sesión de monday activa.')
  }

  /* La versión de la API sale de la operación cuando ésta pide una distinta de la de la app. En
     producción la resuelve el proxy; acá hace falta en desarrollo, donde el pedido sale directo. */
  const definicion = resolverOperacion(operacion)
  const version = definicion.apiVersion ?? API_VERSION

  const cuerpo = import.meta.env.DEV
    ? // Se valida también en desarrollo: si una variable no pasa el filtro del servidor,
      // conviene enterarse acá y no recién cuando la app está publicada.
      { query: definicion.query, variables: definicion.validar(variables) }
    : { operacion, variables }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...cabeceras,
      'API-Version': version,
    },
    body: JSON.stringify(cuerpo),
  })
  await revisarRechazo(res)
  if (!res.ok) throw new Error(await motivoDelFallo(res))

  const json = (await res.json()) as Respuesta<T>
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(' · '))
  if (!json.data) throw new Error('Monday no devolvió datos.')
  return json.data
}
