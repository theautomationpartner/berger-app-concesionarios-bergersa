/**
 * Proxy server-side para la SUBIDA DE ARCHIVOS a Monday.
 *
 * Es un handler aparte de `/api/monday` porque Monday separa los binarios de la API GraphQL: van
 * a `/v2/file` como `multipart/form-data`.
 *
 * Igual que el otro proxy, no reenvía lo que le mandan: el cliente sólo dice a QUÉ item y a QUÉ
 * columna va el archivo, y la mutation la escribe este archivo. La columna tiene que estar en la
 * lista de columnas de archivo habilitadas —hoy, sólo el contrato de un pedido en concesión— y quien
 * sube tiene que tener el módulo de esa columna; con el cuerpo reenviado tal cual, cualquiera podía
 * adjuntar archivos en cualquier columna de la cuenta.
 *
 * El formulario se arma de nuevo en vez de retocar el que llegó: así el `boundary` lo calcula
 * `fetch` y no hay que confiar en el `Content-Type` del cliente.
 */
import { porton } from './_seguridad/porton'
import {
  MUTATION_ARCHIVO,
  OperacionInvalida,
  validarDestinoArchivo,
} from '../src/services/monday/operaciones'

const API_ARCHIVO = 'https://api.monday.com/v2/file'
const API_VERSION = '2024-10'

export const config = { runtime: 'edge' }

/** Tope de tamaño del contrato. Es un PDF o una foto; 20 MB es holgado de sobra. */
const MAX_BYTES = 20 * 1024 * 1024

const error = (status: number, message: string): Response =>
  new Response(JSON.stringify({ errors: [{ message }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return error(405, 'Método no permitido.')

  const paso = await porton(req)
  if (paso.rechazo) return paso.rechazo

  const token = process.env.MONDAY_TOKEN
  if (!token) return error(500, 'Falta MONDAY_TOKEN en el entorno.')

  let entrada: FormData
  try {
    entrada = await req.formData()
  } catch {
    return error(400, 'La subida de archivos tiene que ser multipart/form-data.')
  }

  const archivo = entrada.get('archivo')
  if (!(archivo instanceof File)) return error(400, 'Falta el archivo.')
  if (archivo.size === 0) return error(400, 'El archivo está vacío.')
  if (archivo.size > MAX_BYTES) return error(413, 'El archivo supera los 20 MB.')

  let destino: { itemId: string; columnId: string; modulo: string }
  try {
    destino = validarDestinoArchivo(entrada.get('variables[itemId]'), entrada.get('variables[columnId]'))
  } catch (e: unknown) {
    if (e instanceof OperacionInvalida) return error(400, e.message)
    return error(400, 'Destino de archivo inválido.')
  }

  /* Cada columna de archivo pertenece a un módulo, y quien sube tiene que tenerlo. */
  if (!paso.modulos.includes(destino.modulo as (typeof paso.modulos)[number])) {
    return error(403, 'No tenés acceso a esta aplicación. Contactá al administrador.')
  }

  /*
   * El formato NO es el de la especificación de GraphQL multipart: Monday espera la mutation en
   * un campo `query` —con `operations` contesta "query not found in multipart form"—, las
   * variables como `variables[nombre]`, y un `map` que asocia la parte binaria con la variable de
   * archivo en texto plano, no en el array que pide la especificación.
   */
  const salida = new FormData()
  salida.append('query', MUTATION_ARCHIVO)
  salida.append('variables[itemId]', destino.itemId)
  salida.append('variables[columnId]', destino.columnId)
  salida.append('map', JSON.stringify({ archivo: 'variables.file' }))
  salida.append('archivo', archivo, archivo.name)

  const res = await fetch(API_ARCHIVO, {
    method: 'POST',
    // Sin `Content-Type` a mano: lo escribe `fetch` con el `boundary` del formulario nuevo.
    headers: { Authorization: token, 'API-Version': API_VERSION },
    body: salida,
  })

  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
