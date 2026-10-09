/**
 * 🔐 Registro de Accesos: cada ingreso y cada intento fallido, con fecha, email e IP.
 *
 * Existe para detectar a alguien que está tanteando: un mismo usuario o una misma IP con varios
 * "Acceso denegado" o "Código incorrecto" seguidos es la señal. Por eso se registra en un tablero
 * de monday y no en un log del servidor: los administradores lo revisan donde ya trabajan, y
 * pueden ordenarlo y filtrarlo sin pedirle nada a nadie.
 */
import { COL_REGISTRO, configSeguridad, type Evento } from './config'
import { consultarMonday } from './mondayServidor'

export interface DatosRegistro {
  email?: string
  ip?: string
  usuarioId?: string
  perfil?: string
  cuentaId?: string | number
  /** Detalle técnico del motivo. Queda SÓLO en el registro: al usuario nunca se le muestra. */
  detalle?: string
}

/**
 * IP de quien hace el pedido.
 *
 * Detrás de Vercel la conexión la abre el proxy de Vercel, así que la IP real viene en
 * `x-forwarded-for` (la primera de la lista es la del cliente) o en `x-real-ip`.
 */
export function ipDe(req: Request): string {
  const reenviada = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return reenviada || req.headers.get('x-real-ip') || ''
}

/** Fecha y hora UTC en el formato de la columna `date` de monday. */
function ahoraMonday(): { date: string; time: string } {
  const iso = new Date().toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) }
}

/**
 * Registra un evento. NUNCA lanza.
 *
 * Que el registro falle —monday caído, un límite de la API— no puede impedir que alguien entre ni
 * convertir un "código incorrecto" en un error distinto que delate algo. Se deja constancia en el
 * log del servidor y se sigue.
 */
export async function registrar(evento: Evento, datos: DatosRegistro): Promise<void> {
  try {
    const { tableroRegistro, appId } = configSeguridad()
    const quien = datos.perfil || datos.email || datos.usuarioId || 'desconocido'
    await consultarMonday(
      `mutation ($tablero: ID!, $nombre: String!, $valores: JSON!) {
        create_item(board_id: $tablero, item_name: $nombre, column_values: $valores) { id }
      }`,
      {
        tablero: tableroRegistro,
        nombre: `${evento} · ${quien}`.slice(0, 255),
        valores: JSON.stringify({
          [COL_REGISTRO.fecha]: ahoraMonday(),
          [COL_REGISTRO.evento]: { label: evento },
          [COL_REGISTRO.email]: datos.email ?? '',
          [COL_REGISTRO.ip]: datos.ip ?? '',
          [COL_REGISTRO.usuarioId]: datos.usuarioId ?? '',
          [COL_REGISTRO.perfil]: datos.perfil ?? '',
          [COL_REGISTRO.cuentaId]: datos.cuentaId == null ? '' : String(datos.cuentaId),
          [COL_REGISTRO.appId]: appId,
          [COL_REGISTRO.detalle]: (datos.detalle ?? '').slice(0, 250),
        }),
      },
    )
  } catch (e) {
    console.error('[registro] no se pudo registrar el evento', evento, e)
  }
}
