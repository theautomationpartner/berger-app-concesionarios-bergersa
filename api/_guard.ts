/**
 * Guardián de acceso: verifica que el pedido venga de la app corriendo DENTRO de monday, con un
 * usuario real de la cuenta de BERGER S.A..
 *
 * Cada vez que monday carga la app le entrega al frontend un `sessionToken`: un JWT firmado con
 * la clave secreta de la app. Como la clave sólo la conocen monday y este servidor, el token no
 * se puede fabricar desde afuera. El frontend lo manda en cada request y acá se verifica la firma.
 *
 * Esto es lo que hace que abrir la URL del deploy en un navegador no sirva de nada: sin token
 * válido, la función no consulta ni escribe en Monday. Esconder la interfaz es sólo cortesía —
 * la barrera real es esta.
 *
 * La verificación se hace con WebCrypto y no con una librería de JWT porque la función corre en
 * el runtime edge, donde no está el `crypto` de Node del que dependen esas librerías.
 */

/** Datos del usuario que monday firma dentro del token. */
export interface SesionMonday {
  userId: number
  accountId: number
  slug: string
  appId: number
  isAdmin: boolean
  isGuest: boolean
  isViewOnly: boolean
}

/** Cuenta de monday habilitada: BERGER S.A. (slug `maquinariasagricolas`). */
const CUENTA_BERGER = 36618349

/**
 * El pedido no puede pasar.
 *
 * Cuando el token es auténtico pero de otra cuenta, lleva quién era: es un intento real de entrar
 * y tiene que quedar en el Registro de Accesos. Cuando el token es falso o está vencido no hay
 * identidad confiable que registrar, y los campos quedan vacíos.
 */
export class NoAutorizado extends Error {
  constructor(
    message: string,
    readonly usuarioId?: string,
    readonly cuentaId?: number,
  ) {
    super(message)
  }
}
export class MalConfigurado extends Error {}

interface PayloadToken {
  dat?: {
    user_id?: number | string
    account_id?: number | string
    slug?: string
    app_id?: number | string
    is_admin?: boolean
    is_guest?: boolean
    is_view_only?: boolean
  }
  exp?: number
}

/** Base64url → bytes. El JWT usa el alfabeto url-safe y sin relleno. */
function desdeBase64Url(texto: string): Uint8Array<ArrayBuffer> {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/')
  const relleno = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binario = atob(relleno)
  // El parámetro de `Uint8Array` es explícito: sin él, TypeScript infiere `ArrayBufferLike` —que
  // incluye `SharedArrayBuffer`— y `crypto.subtle.verify` no lo acepta como `BufferSource`.
  const bytes = new Uint8Array(new ArrayBuffer(binario.length))
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i)
  return bytes
}

const textoDe = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/**
 * Comprueba la firma HS256 de `datos` contra `firma` con una clave.
 *
 * La comparación la hace `crypto.subtle.verify`, no el código de acá: comparar dos firmas a mano
 * con `===` filtra información por el tiempo que tarda en fallar.
 */
async function firmaValida(
  clave: string,
  datos: string,
  firma: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(clave),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify('HMAC', key, firma, new TextEncoder().encode(datos))
}

/**
 * Claves con las que puede venir firmado el token.
 *
 * monday documenta el signing secret, pero según la app y el momento en que se creó el que
 * valida puede ser el client secret. Se prueban las dos: son ambas nuestras, así que aceptar
 * cualquiera de ellas no abre ninguna puerta, y evita el "invalid signature" que aparece cuando
 * se elige la equivocada. `secretoUsado` deja registrado cuál funcionó.
 */
function clavesPosibles(): { nombre: string; valor: string }[] {
  const candidatas = [
    { nombre: 'MONDAY_SIGNING_SECRET', valor: process.env.MONDAY_SIGNING_SECRET },
    { nombre: 'MONDAY_CLIENT_SECRET', valor: process.env.MONDAY_CLIENT_SECRET },
  ]
  return candidatas.filter((c): c is { nombre: string; valor: string } => Boolean(c.valor?.trim()))
}

/** Última clave que validó un token, sólo para diagnóstico. Nunca expone el valor. */
export let secretoUsado: string | null = null

/**
 * Verifica el `sessionToken` que mandó el frontend y devuelve quién es el usuario.
 * Lanza `NoAutorizado` si el token falta, está vencido, no valida o es de otra cuenta.
 */
export async function verificarSesion(authHeader: string | null): Promise<SesionMonday> {
  const claves = clavesPosibles()
  if (claves.length === 0) {
    throw new MalConfigurado(
      'Falta MONDAY_SIGNING_SECRET (o MONDAY_CLIENT_SECRET) en el entorno del deploy.',
    )
  }

  const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new NoAutorizado('Falta el token de sesión de monday.')

  const partes = token.split('.')
  if (partes.length !== 3) throw new NoAutorizado('El token de sesión está mal formado.')
  const [cabeceraB64, cuerpoB64, firmaB64] = partes

  // El algoritmo se valida ANTES de verificar: un token con `alg: none` no se acepta nunca.
  let algoritmo: string | undefined
  try {
    algoritmo = (JSON.parse(textoDe(desdeBase64Url(cabeceraB64))) as { alg?: string }).alg
  } catch {
    throw new NoAutorizado('El token de sesión está mal formado.')
  }
  if (algoritmo !== 'HS256') throw new NoAutorizado('Algoritmo de firma no admitido.')

  const datos = `${cabeceraB64}.${cuerpoB64}`
  const firma = desdeBase64Url(firmaB64)

  let valido = false
  for (const clave of claves) {
    if (await firmaValida(clave.valor, datos, firma)) {
      valido = true
      secretoUsado = clave.nombre
      break
    }
  }
  if (!valido) throw new NoAutorizado('La firma del token de sesión no es válida.')

  let payload: PayloadToken
  try {
    payload = JSON.parse(textoDe(desdeBase64Url(cuerpoB64))) as PayloadToken
  } catch {
    throw new NoAutorizado('El token de sesión está mal formado.')
  }

  // Vencimiento. Se permite un minuto de desfasaje de reloj entre monday y este servidor.
  if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp + 60) {
    throw new NoAutorizado('El token de sesión venció. Recargá la app dentro de monday.')
  }

  const dat = payload.dat
  if (!dat?.user_id || !dat?.account_id) throw new NoAutorizado('Token de sesión incompleto.')

  const accountId = Number(dat.account_id)

  /* Que el token sea válido sólo prueba que viene de nuestra app; podría ser de otra cuenta de
     monday que la tuviera instalada. Acá se exige que sea la de BERGER S.A.. */
  /* El id de la cuenta NO es un secreto —está también en el cliente, en `columns.ts`—, así que
     tiene un valor por defecto en vez de ser una variable obligatoria: una variable menos que
     cargar es una forma menos de dejar el deploy a medio configurar. `MONDAY_ACCOUNT_ID` sigue
     existiendo para poder cambiar la cuenta habilitada sin volver a compilar. */
  const cuentaEsperada = Number(process.env.MONDAY_ACCOUNT_ID) || CUENTA_BERGER
  if (accountId !== cuentaEsperada) {
    throw new NoAutorizado('Cuenta de monday no habilitada.', String(dat.user_id), accountId)
  }

  return {
    userId: Number(dat.user_id),
    accountId,
    slug: String(dat.slug ?? ''),
    appId: Number(dat.app_id ?? 0),
    isAdmin: Boolean(dat.is_admin),
    isGuest: Boolean(dat.is_guest),
    isViewOnly: Boolean(dat.is_view_only),
  }
}
