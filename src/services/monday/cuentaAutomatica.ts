/**
 * Las cuentas que crea monday solo, por el dominio del mail de un contacto.
 *
 * El CRM del workspace Concesionarios BERGER SA es el producto CRM de monday, y trae una
 * automatización que, cuando un contacto tiene mail, busca o crea una cuenta con el nombre del
 * dominio ("test@contacto.com" → cuenta "Contacto") y se la conecta. Lo hace unos segundos
 * DESPUÉS de crear el contacto, aunque ya tenga su cuenta. El resultado era una cuenta de más en
 * el tablero y el contacto conectado a dos.
 *
 * La app no puede apagar esa automatización (se apaga en monday). Lo que hace es deshacer su
 * efecto: después de guardar el contacto, le devuelve sus cuentas y borra la que se creó sola.
 *
 * Este archivo no usa el alias `@/`: lo importa también `api/monday.ts`, que es el que decide en
 * el servidor si una cuenta se puede borrar.
 */
import { COL_CRM_CUENTA, TABLEROS_CRM } from './columns'

/** Cuánto tiempo después de creada se la considera recién creada por la automatización. */
export const VENTANA_CUENTA_AUTOMATICA_MS = 15 * 60_000

export interface CuentaParaDescartar {
  tablero: string
  creada: string
  cuit: string
  dominio: string
}

/**
 * ¿Es una cuenta que creó la automatización, y por lo tanto se puede borrar?
 *
 * Las tres condiciones juntas: está en el tablero de Cuentas de los concesionarios, se creó hace
 * minutos, y tiene dominio pero no CUIT. Una cuenta cargada por la app siempre tiene CUIT; la de
 * la automatización nunca. Así, aunque alguien pida borrar otra cosa, no hay con qué.
 */
export function esCuentaAutomatica(c: CuentaParaDescartar, ahora = Date.now()): boolean {
  const creada = Date.parse(c.creada)
  return (
    c.tablero === TABLEROS_CRM.cuentas &&
    Number.isFinite(creada) &&
    ahora - creada < VENTANA_CUENTA_AUTOMATICA_MS &&
    !c.cuit.trim() &&
    Boolean(c.dominio.trim())
  )
}

/** Las columnas que hay que leer para decidirlo. */
export const COLUMNAS_CUENTA_AUTOMATICA = [COL_CRM_CUENTA.cuit, COL_CRM_CUENTA.dominio]
