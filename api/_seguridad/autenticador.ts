/**
 * Estado del autenticador (TOTP) de cada USUARIO de monday, guardado en el tablero
 * "🔐 Seguridad · Autenticador (no editar)".
 *
 * La fila es por usuario de monday y no por fila de la Lista Blanca. Esa es la diferencia que hace
 * que la cuenta que comparten los administradores tenga UN solo autenticador: todas sus filas
 * tienen el mismo ID de usuario, así que todas llegan al mismo secreto y al mismo código.
 *
 * Qué hay en ese tablero y por qué leerlo no sirve de nada:
 *
 * - El secreto TOTP está CIFRADO con AES-256-GCM y la clave vive sólo en el entorno de Vercel. Quien
 *   lea el tablero ve texto ilegible, y si lo edita, descifrar falla en vez de devolver otro secreto.
 * - Los códigos de recuperación NO están: están sus HMAC con una clave del servidor. Un hash común
 *   no alcanzaría —son códigos cortos y se podrían probar todos—; sin la clave, ni eso.
 *
 * Borrar la fila de un perfil es la forma de resetearle el autenticador: en el próximo ingreso se
 * le vuelve a mostrar el QR.
 */
import {
  aBase32,
  aBase64Url,
  aleatorio,
  claveDerivada,
  hmacSha256,
  igualesSeguro,
} from './cripto'
import {
  CANTIDAD_CODIGOS_RECUPERACION,
  COL_AUTENTICADOR,
  configSeguridad,
  MAX_INTENTOS,
  VENTANA_INTENTOS_MS,
} from './config'
import { consultarMonday, textoDe, type ColumnaTexto } from './mondayServidor'

export interface EstadoAutenticador {
  itemId: string
  /** Secreto confirmado, cifrado. Vacío si el perfil todavía no terminó de configurarlo. */
  secretoCifrado: string
  /** Secreto recién generado que espera el primer código para confirmarse, cifrado. */
  pendienteCifrado: string
  /** HMAC de los códigos de recuperación todavía sin usar. */
  recuperacion: string[]
  /** Último período TOTP aceptado. Un código de ese período o anterior ya no sirve. */
  ultimoPeriodo: number
  /** Momentos (ms) de los intentos fallidos recientes. */
  intentos: number[]
}

const COLUMNAS = Object.values(COL_AUTENTICADOR)

function leerJsonLista<T>(texto: string): T[] {
  try {
    const valor = JSON.parse(texto) as unknown
    return Array.isArray(valor) ? (valor as T[]) : []
  } catch {
    return []
  }
}

function aEstado(item: { id: string; column_values: ColumnaTexto[] }): EstadoAutenticador {
  const c = item.column_values
  return {
    itemId: item.id,
    secretoCifrado: textoDe(c, COL_AUTENTICADOR.secreto),
    pendienteCifrado: textoDe(c, COL_AUTENTICADOR.secretoPendiente),
    recuperacion: leerJsonLista<string>(textoDe(c, COL_AUTENTICADOR.recuperacion)).filter(
      (h) => typeof h === 'string',
    ),
    ultimoPeriodo: Number(textoDe(c, COL_AUTENTICADOR.ultimoPeriodo)) || 0,
    intentos: leerJsonLista<number>(textoDe(c, COL_AUTENTICADOR.intentos)).filter(
      (n) => typeof n === 'number',
    ),
  }
}

/**
 * Estado del autenticador de un usuario de monday, o `null` si nunca empezó a configurarlo.
 *
 * Si por una carrera quedaran dos filas para el mismo usuario, manda la que tiene el secreto
 * confirmado: nunca se elige una fila vacía por sobre una configurada, porque eso equivaldría a
 * resetearle el autenticador a alguien sin que lo haya pedido.
 */
export async function leerAutenticador(usuarioId: string): Promise<EstadoAutenticador | null> {
  const { tableroAutenticador } = configSeguridad()
  const datos = await consultarMonday<{
    items_page_by_column_values: { items: { id: string; column_values: ColumnaTexto[] }[] }
  }>(
    `query ($tablero: ID!, $columna: String!, $valor: [String]!, $columnas: [String!]) {
      items_page_by_column_values(
        board_id: $tablero
        limit: 10
        columns: [{ column_id: $columna, column_values: $valor }]
      ) { items { id column_values(ids: $columnas) { id text } } }
    }`,
    { tablero: tableroAutenticador, columna: COL_AUTENTICADOR.usuarioId, valor: [usuarioId], columnas: COLUMNAS },
  )
  const filas = datos.items_page_by_column_values.items
    .filter((i) => textoDe(i.column_values, COL_AUTENTICADOR.usuarioId) === usuarioId)
    .map(aEstado)
  return filas.find((f) => f.secretoCifrado) ?? filas[0] ?? null
}

type Cambios = Partial<{
  secretoCifrado: string
  pendienteCifrado: string
  recuperacion: string[]
  ultimoPeriodo: number
  intentos: number[]
  configuradoHoy: boolean
}>

function valoresDe(cambios: Cambios): Record<string, unknown> {
  const v: Record<string, unknown> = {}
  if (cambios.secretoCifrado !== undefined) v[COL_AUTENTICADOR.secreto] = cambios.secretoCifrado
  if (cambios.pendienteCifrado !== undefined) v[COL_AUTENTICADOR.secretoPendiente] = cambios.pendienteCifrado
  if (cambios.recuperacion !== undefined) {
    v[COL_AUTENTICADOR.recuperacion] = { text: JSON.stringify(cambios.recuperacion) }
  }
  if (cambios.ultimoPeriodo !== undefined) v[COL_AUTENTICADOR.ultimoPeriodo] = String(cambios.ultimoPeriodo)
  if (cambios.intentos !== undefined) v[COL_AUTENTICADOR.intentos] = { text: JSON.stringify(cambios.intentos) }
  if (cambios.configuradoHoy) v[COL_AUTENTICADOR.configurado] = { date: new Date().toISOString().slice(0, 10) }
  return v
}

/** Crea la fila del perfil o actualiza la existente. */
export async function guardarAutenticador(
  perfil: { id: string; nombre: string; usuarioId: string },
  existente: EstadoAutenticador | null,
  cambios: Cambios,
): Promise<void> {
  const { tableroAutenticador } = configSeguridad()
  const valores = valoresDe(cambios)

  if (existente) {
    await consultarMonday(
      `mutation ($tablero: ID!, $item: ID!, $valores: JSON!) {
        change_multiple_column_values(board_id: $tablero, item_id: $item, column_values: $valores) { id }
      }`,
      { tablero: tableroAutenticador, item: existente.itemId, valores: JSON.stringify(valores) },
    )
    return
  }

  await consultarMonday(
    `mutation ($tablero: ID!, $nombre: String!, $valores: JSON!) {
      create_item(board_id: $tablero, item_name: $nombre, column_values: $valores) { id }
    }`,
    {
      tablero: tableroAutenticador,
      nombre: perfil.nombre,
      valores: JSON.stringify({
        ...valores,
        [COL_AUTENTICADOR.perfilId]: perfil.id,
        [COL_AUTENTICADOR.usuarioId]: perfil.usuarioId,
      }),
    },
  )
}

/* ------------------------------------------------------------------ *
 * Límite de intentos
 * ------------------------------------------------------------------ */

/** Intentos fallidos dentro de la ventana de 15 minutos. Los más viejos se descartan. */
export const intentosVigentes = (estado: EstadoAutenticador | null, ahora = Date.now()): number[] =>
  (estado?.intentos ?? []).filter((t) => ahora - t < VENTANA_INTENTOS_MS)

export const estaBloqueado = (estado: EstadoAutenticador | null, ahora = Date.now()): boolean =>
  intentosVigentes(estado, ahora).length >= MAX_INTENTOS

/* ------------------------------------------------------------------ *
 * Códigos de recuperación
 * ------------------------------------------------------------------ */

/**
 * Normaliza un código tal como lo tipeó el usuario: sin guiones ni espacios y en mayúsculas.
 * Así "abcde-fghij", "ABCDE FGHIJ" y "ABCDEFGHIJ" son el mismo código.
 */
const normalizarCodigo = (codigo: string): string => codigo.toUpperCase().replace(/[^A-Z2-7]/g, '')

async function hashCodigo(codigo: string): Promise<string> {
  const clave = await claveDerivada('codigos-recuperacion')
  return aBase64Url(await hmacSha256(clave, new TextEncoder().encode(normalizarCodigo(codigo))))
}

/**
 * Genera los códigos de recuperación. Devuelve los códigos en claro —para mostrarlos UNA vez— y
 * sus hashes, que es lo único que se guarda.
 *
 * Cada código tiene 50 bits (10 caracteres base32) y se muestra partido en dos para leerlo y
 * dictarlo sin equivocarse: `ABCDE-FGHIJ`.
 */
export async function generarCodigosRecuperacion(): Promise<{ codigos: string[]; hashes: string[] }> {
  const codigos = Array.from({ length: CANTIDAD_CODIGOS_RECUPERACION }, () => {
    const crudo = aBase32(aleatorio(7)).slice(0, 10)
    return `${crudo.slice(0, 5)}-${crudo.slice(5)}`
  })
  return { codigos, hashes: await Promise.all(codigos.map(hashCodigo)) }
}

/**
 * Busca un código de recuperación entre los vigentes. Devuelve la lista SIN ese código si lo
 * encuentra —cada código sirve una sola vez—, o `null` si no coincide con ninguno.
 */
export async function consumirCodigoRecuperacion(
  estado: EstadoAutenticador,
  codigo: string,
): Promise<string[] | null> {
  if (normalizarCodigo(codigo).length !== 10) return null
  const hash = await hashCodigo(codigo)
  let indice = -1
  estado.recuperacion.forEach((h, i) => {
    if (igualesSeguro(h, hash) && indice < 0) indice = i
  })
  return indice < 0 ? null : estado.recuperacion.filter((_, i) => i !== indice)
}
