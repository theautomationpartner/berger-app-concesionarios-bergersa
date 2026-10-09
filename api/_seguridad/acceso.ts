/**
 * Decisiones de acceso, compartidas por el endpoint de ingreso (`/api/acceso`) y por los proxies
 * de datos (`/api/monday`, `/api/monday-file`).
 *
 * La regla de oro de este archivo: el MOTIVO de un rechazo es para el Registro de Accesos, nunca
 * para quien intenta entrar. Hacia afuera todos los rechazos son iguales. Decir "tu usuario está
 * inactivo" o "no tenés esta app habilitada" le confirma a alguien que está tanteando que el
 * usuario existe y qué hay adentro.
 */
import type { SesionMonday } from '../_guard'
import { configSeguridad, ETIQUETA } from './config'
import { habilitadoParaApp, leerPerfil, perfilesDeUsuario, type Perfil } from './listaBlanca'
import { modulosSegunLaLista, type Modulo } from './modulos'
import { registrar } from './registro'
import { verificarSesionApp, type SesionApp } from './sesionApp'

/** Rechazo de acceso. `detalle` va al registro; al usuario le llega un mensaje genérico. */
export class AccesoDenegado extends Error {
  constructor(readonly detalle: string) {
    super('Acceso denegado')
  }
}

/** La sesión del día falta, venció o no alcanza: hay que volver a pasar por el ingreso. */
export class SesionRequerida extends Error {}

/**
 * La fila de la Lista Blanca con la que este usuario de monday entra a ESTA app.
 *
 * La cuenta de los administradores la comparten varias personas, así que puede haber más de una
 * fila con el mismo ID de usuario. Para monday —y por lo tanto para la app— son el MISMO usuario:
 * comparten el acceso y el autenticador. Se toma la primera fila habilitada, que es la que aporta
 * el nombre y las condiciones; si hubiera diferencias entre filas del mismo usuario, no habría
 * forma de saber cuál es "la verdadera", y la app no puede inventarla.
 */
export async function identidadHabilitada(usuarioId: string): Promise<Perfil> {
  const { appId } = configSeguridad()
  const todos = await perfilesDeUsuario(usuarioId)
  const habilitados = todos.filter((p) => habilitadoParaApp(p, appId))

  if (todos.length === 0) throw new AccesoDenegado('No figura en la Lista Blanca.')
  if (habilitados.length === 0) {
    throw new AccesoDenegado(
      todos.some((p) => p.activo) ? 'No tiene esta app habilitada.' : 'Usuario inactivo.',
    )
  }
  return habilitados[0]
}

/**
 * ¿Puede configurar el autenticador con una clave que YA tiene, en vez del QR que genera la app?
 *
 * Sólo los ADMIN. Es la cuenta operativa que comparten varias personas y que ya tiene su clave en
 * el gestor de contraseñas del equipo: pegarla ahí evita repartir un QR entre varios. Para el
 * resto, la única forma es escanear el QR, que es la que garantiza que el secreto lo generó la app
 * y nadie más lo vio.
 */
export const puedeImportarClave = (perfil: Perfil): boolean =>
  perfil.tipoUsuario === ETIQUETA.ADMIN

/** ¿Esta sesión cumple lo que el perfil exige HOY? */
export const sesionAlcanza = (sesion: SesionApp, perfil: Perfil): boolean =>
  sesion.pid === perfil.id && (sesion.mfa || perfil.autenticadorDesactivado)

/**
 * Guardián de los proxies de datos: exige una sesión del día válida para un perfil habilitado.
 *
 * Vuelve a leer el perfil en CADA pedido. Es un viaje más a monday, y es lo que hace que dar de
 * baja a alguien —pasarlo a Inactivo, quitarle la app— corte su acceso en el acto y no recién
 * mañana, cuando venza su sesión. Lo mismo si el admin vuelve a encender el autenticador de alguien
 * que había entrado sin él.
 */
export async function exigirSesionApp(
  req: Request,
  sesionMonday: SesionMonday,
  ip: string,
): Promise<{ perfil: Perfil; modulos: Modulo[] }> {
  const { appId } = configSeguridad()
  const usuarioId = String(sesionMonday.userId)

  const sesion = await verificarSesionApp(req.headers.get('x-sesion-app'), usuarioId, appId)
  if (!sesion) throw new SesionRequerida('Falta la sesión del día.')

  const perfil = await leerPerfil(sesion.pid)
  if (!perfil || perfil.usuarioId !== usuarioId || !habilitadoParaApp(perfil, appId)) {
    await registrar('Acceso denegado', {
      usuarioId,
      perfil: perfil?.nombre,
      email: perfil?.email,
      cuentaId: sesionMonday.accountId,
      ip,
      detalle: 'Perfil dado de baja o sin la app mientras tenía una sesión abierta.',
    })
    throw new AccesoDenegado('Perfil dado de baja durante la sesión.')
  }

  if (!sesionAlcanza(sesion, perfil)) throw new SesionRequerida('El perfil ahora exige el autenticador.')

  /* Los módulos vigentes son los que la sesión trae Y la Lista Blanca sigue habilitando. La sesión
     ya comprobó el equipo de monday al ingresar; la lista se relee en vivo, así que cambiarle el
     tipo o el equipo a alguien le corta el módulo en el acto, sin esperar a mañana. */
  const deLaLista = modulosSegunLaLista(perfil)
  const modulos = sesion.mods.filter((mod) => deLaLista.includes(mod))

  /* Sin módulos en común no se rechaza: se pide renovar la sesión. Pasa en dos casos, y los dos se
     arreglan volviendo a ingresar, no negando el acceso: una sesión emitida antes de que
     existieran los módulos (no trae ninguno), y una persona que cambió de equipo con la sesión
     abierta (trae los del equipo anterior). Si de verdad ya no tiene acceso, el ingreso se lo dirá
     con el mismo cartel genérico de siempre. */
  if (modulos.length === 0) throw new SesionRequerida('La sesión no tiene módulos vigentes.')

  return { perfil, modulos }
}
