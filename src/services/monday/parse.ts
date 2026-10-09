/**
 * Lectura de `column_values` crudos de Monday.
 *
 * Todo lo que entra a la app pasa por acá: es el único lugar que sabe que un mirror viene en
 * `display_value` y un `status` en `text`.
 */

export interface ColumnaCruda {
  id: string
  type?: string
  text?: string | null
  value?: string | null
  /** Sólo lo traen las columnas mirror, vía el fragmento `... on MirrorValue`. */
  display_value?: string | null
}

/** Indexa las columnas de un item por id, para no recorrer el array una vez por dato. */
export const porId = (columnas: ColumnaCruda[]): Record<string, ColumnaCruda> =>
  Object.fromEntries(columnas.map((c) => [c.id, c]))

/** Texto plano de una columna. Nunca `null`: la interfaz no tiene que defenderse de eso. */
export const texto = (c: ColumnaCruda | undefined): string => (c?.text ?? '').trim()

/**
 * Valor visible de una columna MIRROR.
 *
 * Las mirror devuelven `text: null` SIEMPRE —incluso teniendo dato— y exponen el valor en
 * `display_value`. Es la trampa más cara de este tablero: los importes se leerían todos vacíos
 * sin darse cuenta, porque `null` no es un error.
 */
export const espejo = (c: ColumnaCruda | undefined): string => (c?.display_value ?? '').trim()

/**
 * Convierte a número un importe que llegó como texto.
 *
 * Los mirror no traen el número: traen lo que se ve en pantalla, y el separador depende de cómo
 * esté configurada la columna original. Se resuelve mirando cuál separador aparece más a la
 * derecha —ese es el decimal— y descartando el otro como separador de miles. Con un solo
 * separador, un grupo final de exactamente tres dígitos se lee como miles (`1.500`) y cualquier
 * otro largo como decimal (`7216.37`).
 */
export function aNumeroEspejo(valor: string): number | null {
  const limpio = valor.replace(/[^\d,.-]/g, '')
  if (!limpio) return null

  const ultimaComa = limpio.lastIndexOf(',')
  const ultimoPunto = limpio.lastIndexOf('.')

  let normalizado: string
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    const decimal = ultimaComa > ultimoPunto ? ',' : '.'
    const miles = decimal === ',' ? '.' : ','
    normalizado = limpio.split(miles).join('').replace(decimal, '.')
  } else if (ultimaComa >= 0) {
    normalizado = /,\d{3}$/.test(limpio) ? limpio.split(',').join('') : limpio.replace(',', '.')
  } else if (ultimoPunto >= 0) {
    normalizado = /\.\d{3}$/.test(limpio) ? limpio.split('.').join('') : limpio
  } else {
    normalizado = limpio
  }

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/** Fecha ISO (`YYYY-MM-DD`) de una columna `date`, o `''` si el item no la tiene cargada. */
export function fechaISO(c: ColumnaCruda | undefined): string {
  /* Una columna de fecha CON HORA devuelve "2026-09-01 09:00", así que no alcanza con exigir que
     el texto entero sea una fecha: hay que quedarse con la parte del día. */
  const t = texto(c)
  const dia = t.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : ''
}
