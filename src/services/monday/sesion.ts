/**
 * Sesión de monday.
 *
 * Cuando la app se abre dentro de monday —en el navegador o en la app del celular—, monday le
 * entrega un `sessionToken` firmado con la clave secreta de la aplicación. Ese token viaja en
 * cada request a `/api/monday`, que verifica la firma antes de consultar nada.
 *
 * Fuera de monday el pedido simplemente no se responde: no hay iframe padre que lo conteste, así
 * que la promesa nunca resuelve. Por eso hay un tiempo límite: sin él, alguien que abre la URL
 * del deploy en un navegador se quedaría con la app colgada en "cargando" en vez de recibir un
 * cartel claro.
 */
import mondaySdk from 'monday-sdk-js'

const monday = mondaySdk()

/** Datos del usuario que vienen dentro del token. Sólo para mostrar y registrar. */
export interface DatosSesion {
  userId: number
  accountId: number
  slug: string
  esInvitado: boolean
  soloLectura: boolean
}

interface TokenEnCache {
  token: string
  /** Momento (ms) en el que el token deja de servir. */
  vence: number
  datos: DatosSesion
}

let cache: TokenEnCache | null = null

/**
 * Cuánto se espera a que monday conteste.
 *
 * El pedido de sesión es un `postMessage` a la ventana padre. Si la app NO está embebida,
 * `window.parent` es ella misma: el mensaje no llega a nadie y la espera se agota siempre. Ese es
 * justo el caso de quien abre la URL del deploy en el navegador, y hacerlo mirar un spinner seis
 * segundos antes del cartel de acceso denegado no aporta nada.
 *
 * Por eso hay dos tiempos. Embebida, se le da aire de sobra a monday. Suelta, alcanza con un
 * momento: la respuesta, si llegara, sería un ida y vuelta local de milisegundos. El tiempo corto
 * no se decide sólo con "no estoy en un iframe" —no hay garantía de cómo monta la vista la app
 * del celular—: se sigue preguntando igual, sólo que sin esperar de más.
 */
const EMBEBIDA = (() => {
  try {
    return window.self !== window.top
  } catch {
    // Un `SecurityError` al leer `window.top` significa que hay un padre de otro origen: o sea,
    // sí está embebida.
    return true
  }
})()

const ESPERA_MS = EMBEBIDA ? 6000 : 1500

/** Lee el cuerpo del JWT sin verificarlo: la verificación de verdad ocurre en el servidor. */
function leerDatos(token: string): { datos: DatosSesion; vence: number } {
  const cuerpo = token.split('.')[1]
  if (!cuerpo) throw new Error('El token de sesión está mal formado.')

  const base64 = cuerpo.replace(/-/g, '+').replace(/_/g, '/')
  const payload = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as {
    dat?: {
      user_id?: number
      account_id?: number
      slug?: string
      is_guest?: boolean
      is_view_only?: boolean
    }
    exp?: number
  }

  const dat = payload.dat ?? {}
  return {
    datos: {
      userId: Number(dat.user_id ?? 0),
      accountId: Number(dat.account_id ?? 0),
      slug: String(dat.slug ?? ''),
      esInvitado: Boolean(dat.is_guest),
      soloLectura: Boolean(dat.is_view_only),
    },
    // Sin `exp` se toma un minuto: mejor pedirlo de más que usar uno vencido.
    vence: payload.exp ? payload.exp * 1000 : Date.now() + 60_000,
  }
}

/** Promesa que se rinde si monday no contesta: fuera del iframe no contesta nunca. */
function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<T>((_, rechazar) =>
      setTimeout(() => rechazar(new Error('monday no respondió el pedido de sesión.')), ms),
    ),
  ])
}

/**
 * Devuelve el `sessionToken` vigente, pidiéndole uno nuevo a monday cuando está por vencer.
 * Se renueva un minuto antes del vencimiento para que nunca se mande uno expirado.
 */
export async function obtenerSessionToken(): Promise<string> {
  if (cache && Date.now() < cache.vence - 60_000) return cache.token

  const res = await conLimite(monday.get('sessionToken'), ESPERA_MS)
  const token = (res as { data?: string })?.data
  if (!token) throw new Error('monday no devolvió un token de sesión.')

  const { datos, vence } = leerDatos(token)
  cache = { token, vence, datos }
  return token
}

/** Datos del usuario de la sesión actual, pidiéndola si todavía no se pidió. */
export async function obtenerDatosSesion(): Promise<DatosSesion> {
  await obtenerSessionToken()
  if (!cache) throw new Error('No hay sesión de monday.')
  return cache.datos
}

/** Datos ya conocidos, sin pedir nada. `null` si todavía no se resolvió la sesión. */
export const sesionConocida = (): DatosSesion | null => cache?.datos ?? null
