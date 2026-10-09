/**
 * Primitivas criptográficas del acceso: TOTP, cifrado de secretos y firmas.
 *
 * Todo está hecho sobre WebCrypto (`crypto.subtle`) y sin dependencias. No es por prurito: las
 * funciones corren en el runtime edge de Vercel, donde no existe el módulo `crypto` de Node del que
 * dependen las librerías TOTP habituales (otplib, speakeasy). Compilarían igual y fallarían recién
 * en el primer ingreso.
 *
 * El TOTP sigue la RFC 6238 al pie de la letra —HMAC-SHA1, 6 dígitos, períodos de 30 segundos—,
 * que es lo que esperan Google Authenticator, Microsoft Authenticator, Authy y 1Password. Está
 * verificado contra los vectores de prueba de la propia RFC.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Bytes aleatorios criptográficamente seguros. */
export const aleatorio = (n: number): Uint8Array<ArrayBuffer> =>
  crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))

/* ------------------------------------------------------------------ *
 * Codificaciones
 * ------------------------------------------------------------------ */

export function aBase64Url(bytes: Uint8Array): string {
  let binario = ''
  for (const b of bytes) binario += String.fromCharCode(b)
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function desdeBase64Url(texto: string): Uint8Array<ArrayBuffer> {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/')
  const binario = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(binario.length))
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i)
  return bytes
}

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Base32 (RFC 4648) sin relleno: es el formato en que las apps de autenticación leen el secreto. */
export function aBase32(bytes: Uint8Array): string {
  let bits = 0
  let valor = 0
  let salida = ''
  for (const b of bytes) {
    valor = (valor << 8) | b
    bits += 8
    while (bits >= 5) {
      salida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) salida += ALFABETO_BASE32[(valor << (5 - bits)) & 31]
  return salida
}

export function desdeBase32(texto: string): Uint8Array<ArrayBuffer> {
  const limpio = texto.toUpperCase().replace(/[\s=-]/g, '')
  const bytes: number[] = []
  let bits = 0
  let valor = 0
  for (const letra of limpio) {
    const indice = ALFABETO_BASE32.indexOf(letra)
    if (indice < 0) throw new Error('Secreto base32 inválido.')
    valor = (valor << 5) | indice
    bits += 5
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(bytes)
}

/* ------------------------------------------------------------------ *
 * Claves
 * ------------------------------------------------------------------ */

/**
 * Lee la clave maestra del entorno.
 *
 * Es UNA sola variable (`SEGURIDAD_CLAVE_MAESTRA`) y de ella se derivan las claves de cada uso. Así
 * hay un único secreto que custodiar, y aun así una clave filtrada en un uso no compromete los
 * otros. Rotarla invalida todo a la vez —secretos cifrados, sesiones y códigos de recuperación—,
 * que es exactamente lo que se quiere si alguna vez se filtra.
 */
function claveMaestra(): Uint8Array<ArrayBuffer> {
  const texto = process.env.SEGURIDAD_CLAVE_MAESTRA?.trim()
  if (!texto) throw new ErrorDeConfiguracion('Falta SEGURIDAD_CLAVE_MAESTRA en el entorno.')
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = desdeBase64Url(texto)
  } catch {
    // Sin esto, una clave mal pegada falla con el error del decodificador, que no dice qué
    // variable revisar.
    throw new ErrorDeConfiguracion('SEGURIDAD_CLAVE_MAESTRA no es base64url válido.')
  }
  if (bytes.length < 32) {
    throw new ErrorDeConfiguracion('SEGURIDAD_CLAVE_MAESTRA tiene que tener al menos 32 bytes.')
  }
  return bytes
}

export class ErrorDeConfiguracion extends Error {}

export type Proposito = 'cifrado-totp' | 'sesion-app' | 'codigos-recuperacion'

const cacheClaves = new Map<Proposito, Promise<Uint8Array<ArrayBuffer>>>()

/** Clave derivada para un uso: HMAC-SHA256(maestra, propósito). */
export function claveDerivada(proposito: Proposito): Promise<Uint8Array<ArrayBuffer>> {
  let clave = cacheClaves.get(proposito)
  if (!clave) {
    clave = hmacSha256(claveMaestra(), encoder.encode(`berger-ops/${proposito}/v1`))
    cacheClaves.set(proposito, clave)
  }
  return clave
}

/* ------------------------------------------------------------------ *
 * HMAC y comparación
 * ------------------------------------------------------------------ */

async function hmac(
  hash: 'SHA-1' | 'SHA-256',
  clave: Uint8Array<ArrayBuffer>,
  datos: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, datos))
}

export const hmacSha256 = (clave: Uint8Array<ArrayBuffer>, datos: Uint8Array<ArrayBuffer>) =>
  hmac('SHA-256', clave, datos)

/**
 * Comparación en tiempo constante.
 *
 * Un `===` corta en el primer carácter distinto, y el tiempo que tarda en fallar le dice a quien
 * prueba cuántos caracteres acertó. Acá se recorren siempre todos.
 */
export function igualesSeguro(a: string, b: string): boolean {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  let diferencia = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diferencia |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diferencia === 0
}

/* ------------------------------------------------------------------ *
 * Cifrado de secretos (AES-256-GCM)
 * ------------------------------------------------------------------ */

/**
 * Cifra un texto con AES-256-GCM. El resultado es `iv.textoCifrado` en base64url.
 *
 * GCM además de cifrar AUTENTICA: si alguien edita el valor guardado en el tablero, descifrar
 * falla en lugar de devolver un secreto alterado.
 */
export async function cifrar(texto: string): Promise<string> {
  const clave = await crypto.subtle.importKey('raw', await claveDerivada('cifrado-totp'), 'AES-GCM', false, ['encrypt'])
  const iv = aleatorio(12)
  const cifrado = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, encoder.encode(texto)),
  )
  return `${aBase64Url(iv)}.${aBase64Url(cifrado)}`
}

export async function descifrar(sobre: string): Promise<string> {
  const [ivTexto, datosTexto] = sobre.split('.')
  if (!ivTexto || !datosTexto) throw new Error('Valor cifrado mal formado.')
  const clave = await crypto.subtle.importKey('raw', await claveDerivada('cifrado-totp'), 'AES-GCM', false, ['decrypt'])
  const plano = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: desdeBase64Url(ivTexto) },
    clave,
    desdeBase64Url(datosTexto),
  )
  return decoder.decode(plano)
}

/* ------------------------------------------------------------------ *
 * TOTP (RFC 6238)
 * ------------------------------------------------------------------ */

export const PERIODO_SEGUNDOS = 30
export const DIGITOS = 6

/** Período TOTP de un instante: cuántos bloques de 30 segundos pasaron desde 1970. */
export const periodoDe = (ms: number): number => Math.floor(ms / 1000 / PERIODO_SEGUNDOS)

/** Código TOTP de un período. `digitos` es parámetro sólo para poder probar contra la RFC. */
export async function codigoTotp(
  secreto: Uint8Array<ArrayBuffer>,
  periodo: number,
  digitos = DIGITOS,
): Promise<string> {
  // El contador va en 8 bytes big-endian. Se arma en dos mitades porque los operadores de bits
  // de JavaScript trabajan con 32 bits y el período no entra en uno solo.
  const contador = new Uint8Array(new ArrayBuffer(8))
  const vista = new DataView(contador.buffer)
  vista.setUint32(0, Math.floor(periodo / 2 ** 32))
  vista.setUint32(4, periodo >>> 0)

  const firma = await hmac('SHA-1', secreto, contador)
  const desplazamiento = firma[firma.length - 1] & 0x0f
  const binario =
    ((firma[desplazamiento] & 0x7f) << 24) |
    (firma[desplazamiento + 1] << 16) |
    (firma[desplazamiento + 2] << 8) |
    firma[desplazamiento + 3]

  return String(binario % 10 ** digitos).padStart(digitos, '0')
}

/**
 * Verifica un código y devuelve el período con el que coincidió, o `null`.
 *
 * Acepta el período actual y uno a cada lado (±30 segundos): los relojes de los celulares no
 * siempre están en hora, y sin esa tolerancia un usuario con el teléfono atrasado veinte segundos
 * no podría entrar nunca. Más ventana sería regalar intentos a quien prueba códigos al azar.
 *
 * Devolver el período —y no sólo "sí/no"— es lo que permite impedir que un mismo código se use
 * dos veces: quien llama guarda el último período aceptado y rechaza cualquiera que no sea mayor.
 */
export async function verificarTotp(
  secretoBase32: string,
  codigo: string,
  ahoraMs: number = Date.now(),
  ventana = 1,
): Promise<number | null> {
  const limpio = codigo.replace(/\s/g, '')
  if (!/^\d{6}$/.test(limpio)) return null

  const secreto = desdeBase32(secretoBase32)
  const actual = periodoDe(ahoraMs)
  let coincidencia: number | null = null
  // Se prueban TODOS los períodos de la ventana aunque uno ya coincida: cortar antes haría que
  // el tiempo de respuesta delate cuál de los tres era el correcto.
  for (let delta = -ventana; delta <= ventana; delta += 1) {
    const esperado = await codigoTotp(secreto, actual + delta)
    if (igualesSeguro(esperado, limpio) && coincidencia === null) coincidencia = actual + delta
  }
  return coincidencia
}

/** Secreto TOTP nuevo: 20 bytes (160 bits), el largo que recomienda la RFC 4226. */
export const nuevoSecretoTotp = (): string => aBase32(aleatorio(20))
