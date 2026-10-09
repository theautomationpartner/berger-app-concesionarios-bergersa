/**
 * Consultas a monday desde el servidor, con el token de la cuenta.
 *
 * Es la vía que usa la capa de seguridad para leer la Lista Blanca y escribir el estado del
 * autenticador y el registro. NO pasa por el catálogo de operaciones de `src/services/monday`: ese
 * catálogo existe para acotar lo que puede pedir el NAVEGADOR, y estas consultas no las arma el
 * navegador, las escribe este código.
 */
import { ErrorDeConfiguracion } from './cripto'

const API = 'https://api.monday.com/v2'
const API_VERSION = '2024-10'

export async function consultarMonday<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.MONDAY_TOKEN
  if (!token) throw new ErrorDeConfiguracion('Falta MONDAY_TOKEN en el entorno.')

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': API_VERSION },
    body: JSON.stringify({ query, variables }),
  })
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.message).join(' · ') || `monday respondió ${res.status}`)
  }
  if (!json.data) throw new Error('monday no devolvió datos.')
  return json.data
}

export interface ColumnaTexto {
  id: string
  text: string | null
}

/** Texto de una columna por id, nunca `null`. */
export const textoDe = (columnas: ColumnaTexto[], id: string): string =>
  (columnas.find((c) => c.id === id)?.text ?? '').trim()
