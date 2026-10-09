/**
 * Portón de los proxies de datos. Todo pedido a `/api/monday` y a `/api/monday-file` pasa por acá
 * ANTES de leer el cuerpo o de tocar el token de la API.
 *
 * Son tres comprobaciones, en orden:
 *
 *   1. ¿Viene de monday, de un usuario real de la cuenta de BERGER?   (sessionToken firmado)
 *   2. ¿Tiene la sesión del día, emitida por el ingreso?              (X-Sesion-App firmado)
 *   3. ¿Su perfil sigue activo, con la app, y cumple el autenticador?  (Lista Blanca, en vivo)
 *
 * Está en un solo lugar a propósito: un endpoint que se olvida una de las tres es una puerta
 * abierta, y con el portón repetido en cada proxy alcanza con que alguien agregue un endpoint
 * nuevo copiando el más viejo.
 */
import { MalConfigurado, NoAutorizado, verificarSesion } from '../_guard'
import { AccesoDenegado, exigirSesionApp, SesionRequerida } from './acceso'
import { ErrorDeConfiguracion } from './cripto'
import type { Modulo } from './modulos'
import { ipDe, registrar } from './registro'

/**
 * Respuesta de error con la forma que ya entiende el cliente (`{ errors: [{ message }] }`), más un
 * `codigo` para las que requieren que la app haga algo —volver a pedir el código del día—.
 */
const error = (status: number, message: string, codigo?: string): Response =>
  new Response(JSON.stringify({ errors: [{ message }], ...(codigo ? { codigo } : {}) }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

/** Mensaje único para cualquier rechazo de acceso: no dice por qué. */
const SIN_ACCESO = 'No tenés acceso a esta aplicación. Contactá al administrador.'

/** Lo que el portón deja pasar: quién es y qué módulos tiene habilitados hoy. */
export interface Paso {
  rechazo?: undefined
  modulos: Modulo[]
}

/** Rechazo: el pedido no sigue y esta es la respuesta que se devuelve tal cual. */
export interface Rechazo {
  rechazo: Response
}

/** Deja pasar con los módulos del perfil, o devuelve la respuesta de rechazo. */
export async function porton(req: Request): Promise<Paso | Rechazo> {
  const ip = ipDe(req)

  let sesionMonday
  try {
    sesionMonday = await verificarSesion(req.headers.get('authorization'))
  } catch (e) {
    if (e instanceof MalConfigurado) {
      console.error('[porton] configuración:', e.message)
      return { rechazo: error(500, 'No se pudo verificar el acceso.') }
    }
    const rechazo = e instanceof NoAutorizado ? e : null
    await registrar('Acceso denegado', {
      usuarioId: rechazo?.usuarioId,
      cuentaId: rechazo?.cuentaId,
      ip,
      detalle: `Proxy de datos: ${rechazo?.message ?? 'token de sesión de monday inválido.'}`,
    })
    return { rechazo: error(401, SIN_ACCESO, 'SIN_ACCESO') }
  }

  try {
    const { modulos } = await exigirSesionApp(req, sesionMonday, ip)
    return { modulos }
  } catch (e) {
    if (e instanceof SesionRequerida) {
      return { rechazo: error(403, 'Tu sesión venció. Volvé a ingresar el código.', 'SESION_REQUERIDA') }
    }
    if (e instanceof AccesoDenegado) return { rechazo: error(403, SIN_ACCESO, 'SIN_ACCESO') }
    console.error('[porton]', e instanceof ErrorDeConfiguracion ? e.message : e)
    return { rechazo: error(500, 'No se pudo verificar el acceso.') }
  }
}
