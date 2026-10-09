/**
 * La sesión del día en el navegador.
 *
 * La emite el servidor cuando alguien pasa la Lista Blanca y el autenticador, y viaja en la
 * cabecera `X-Sesion-App` de cada pedido. Acá sólo se guarda y se entrega: el navegador no la
 * interpreta ni puede fabricarla, porque está firmada con una clave que sólo tiene el servidor.
 *
 * Se guarda en `localStorage` y no en una cookie: dentro del iframe de monday la app corre en otro
 * dominio, y las cookies de terceros se bloquean de forma distinta en cada navegador. Si algún
 * navegador bloquea también el `localStorage`, el efecto es que vuelve a pedir el código: molesto,
 * pero no roto.
 *
 * La clave incluye el usuario de monday: en una computadora compartida, la sesión de una persona
 * no se le ofrece a otra.
 */

const PREFIJO = 'berger-ops:sesion:'

let actual: string | null = null
let usuario: string | null = null

const clave = () => (usuario ? `${PREFIJO}${usuario}` : null)

/** Carga la sesión guardada del usuario de monday actual. */
export function cargarSesionDelDia(usuarioId: string): string | null {
  usuario = usuarioId
  try {
    actual = localStorage.getItem(`${PREFIJO}${usuarioId}`)
  } catch {
    actual = null
  }
  return actual
}

export function guardarSesionDelDia(token: string): void {
  actual = token
  const k = clave()
  if (!k) return
  try {
    localStorage.setItem(k, token)
  } catch {
    // Sin almacenamiento la sesión dura lo que la pestaña. Se sigue igual.
  }
}

export function borrarSesionDelDia(): void {
  actual = null
  const k = clave()
  if (!k) return
  try {
    localStorage.removeItem(k)
  } catch {
    // Nada que borrar.
  }
}

/** La sesión vigente, para la cabecera `X-Sesion-App`. */
export const sesionDelDia = (): string | null => actual

/**
 * Eventos que el cliente de la API dispara cuando el servidor rechaza un pedido de datos, para que
 * la pantalla de ingreso reaccione sin que cada pantalla tenga que saber de sesiones.
 */
export const EVENTO_REINGRESAR = 'berger:reingresar'
export const EVENTO_SIN_ACCESO = 'berger:sin-acceso'
