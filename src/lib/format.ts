/** Formateo en convención argentina: punto de miles, coma decimal. */

const NUM = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ENTERO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

/** Importe con dos decimales. `null` se muestra como raya: no hay dato, no es cero. */
export const importe = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : NUM.format(n)

export const cantidad = (n: number): string => ENTERO.format(n)

/** `YYYY-MM-DD` → `DD/MM/AAAA`. Sin `new Date()`: parsear ISO corre el día por zona horaria. */
export function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

/** Fecha de hoy en ISO local. `toISOString()` no sirve: convierte a UTC y puede correr el día. */
/**
 * Argentina no tiene horario de verano desde 2009: siempre UTC-3. Se fija a mano y no se usa la
 * zona del navegador porque el turno es en el puerto, no donde esté abierta la app.
 */
const HUSO_AR = '-03:00'

/**
 * Pasa una fecha y una hora locales al formato que guarda monday.
 *
 * Una columna de fecha con hora **guarda la hora en UTC** y la muestra en la zona de la cuenta:
 * un turno de las 09:00 se escribe como `12:00:00` —comprobado leyendo un turno cargado a mano—.
 * La conversión puede correr el DÍA (un turno de las 22:00 cae al día siguiente en UTC), y por eso
 * se calcula con una fecha real en vez de sumarle tres a la hora.
 */
export function aFechaHoraMonday(fecha: string, hora: string): { date: string; time: string } {
  const momento = new Date(`${fecha}T${hora.length === 5 ? hora : hora.slice(0, 5)}:00${HUSO_AR}`)
  if (Number.isNaN(momento.getTime()))
    throw new Error('La fecha o la hora del turno no son válidas.')
  const iso = momento.toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) }
}

/** La hora local de un texto de monday ("2026-09-01 09:00" → "09:00"). Vacío si no la trae. */
export const horaDelTexto = (texto: string): string => texto.match(/\b(\d{2}:\d{2})\b/)?.[1] ?? ''

export function hoyISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Lee un número tipeado por el usuario.
 *
 * El punto en español es ambiguo: en `1.500` separa miles y en `0.7` es el decimal. Se resuelve
 * en dos reglas: si hay coma, la coma manda como decimal y los puntos son miles; sin coma, el
 * punto sólo es separador de miles si el texto tiene la forma exacta de grupos de tres.
 */
export function aNumero(entrada: string): number | null {
  const texto = entrada.trim().replace(/\s/g, '')
  if (!texto) return null

  let normalizado: string
  if (texto.includes(',')) {
    normalizado = texto.replace(/\./g, '').replace(',', '.')
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(texto)) {
    normalizado = texto.replace(/\./g, '')
  } else {
    normalizado = texto
  }

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/**
 * Serializa un número para las columnas `numbers` de Monday: punto decimal, sin separador de
 * miles y sin notación científica.
 */
export const aTextoMonday = (n: number): string => {
  if (!Number.isFinite(n)) return ''
  const fijo = Math.abs(n) < 1e-6 && n !== 0 ? n.toFixed(6) : String(n)
  return fijo.includes('e') ? n.toFixed(6) : fijo
}

/** Normaliza texto para buscar sin acentos ni mayúsculas. */
export const normalizar = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

/** Tamaño de archivo legible, para el recuadro de la transferencia. */
export function pesoArchivo(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
