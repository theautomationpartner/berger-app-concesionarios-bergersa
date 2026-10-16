/**
 * 🌐Cuentas de BERGER, leídas desde la app de concesionarios.
 *
 * Es de donde sale la cuenta del concesionario que pide y su línea de crédito. Sólo se lee: el
 * cliente final ya no se da de alta acá sino en el CRM propio del concesionario (`crmPropio.ts`),
 * y un concesionario no tiene por qué escribir en el CRM de BERGER.
 */
import { COL_CUENTA, COL_CUENTA_VENTA } from './columns'
import { aNumeroEspejo, porId, texto, type ColumnaCruda } from './parse'
import { mondayApi } from './sdk'

/* ------------------------------------------------------------------ *
 * Lectura
 * ------------------------------------------------------------------ */

export interface CuentaCrm {
  id: string
  nombre: string
  cuit: string
  clasificacion: string
  categoria: string
  tipoPersona: string
  condicionFiscal: string
  direccion: string
  ciudad: string
  provincia: string
  /** El país tal como lo muestra monday: "Argentina". */
  pais: string
  descripcion: string
  estado: string
  /** La línea de crédito que BERGER le asignó, y cuánto lleva usado. */
  creditoAsignado: number | null
  creditoUtilizado: number | null
  /** El nombre del equipo de monday del concesionario, tal como está en la cuenta. */
  equipoNombre: string
  /** Cuántos pedidos en concesión puede tener. 0: ninguno. */
  concesionLimite: number
  concesionarioIds: string[]
  /** Ids de los contactos conectados. */
  contactoIds: string[]
}

export interface ContactoCrm {
  id: string
  nombre: string
  nombres: string
  apellidos: string
  email: string
  whatsapp: string
  categoria: string
  pais: string
  comentarios: string
  estado: string
  /** Ids de las cuentas a las que está conectado. */
  cuentaIds: string[]
}

/** Las columnas de conexión traen los ids del otro lado vía `... on BoardRelationValue`. */
type ColumnaConRelacion = ColumnaCruda & { linked_item_ids?: string[] | null }

interface ItemCrudo {
  id: string
  name: string
  column_values: ColumnaConRelacion[]
}

/* Se lee todo lo que el formulario puede escribir: es lo que permite abrir una cuenta que ya
   existe con sus datos cargados, para editarla o para copiarla. */
const COLUMNAS_CUENTA = [
  COL_CUENTA.cuit,
  COL_CUENTA.clasificacion,
  COL_CUENTA.categoria,
  COL_CUENTA.tipoPersona,
  COL_CUENTA.condicionFiscal,
  COL_CUENTA.direccionTexto,
  COL_CUENTA.ciudad,
  COL_CUENTA.provincia,
  COL_CUENTA.pais,
  COL_CUENTA.descripcion,
  COL_CUENTA.estado,
  COL_CUENTA_VENTA.creditoAsignado,
  COL_CUENTA_VENTA.creditoUtilizado,
  COL_CUENTA_VENTA.equipoNombre,
  COL_CUENTA_VENTA.concesionLimite,
  COL_CUENTA.concesionario,
  COL_CUENTA.contactos,
]

/** Ids conectados de una columna de conexión. */
const conectados = (c: ColumnaConRelacion | undefined): string[] =>
  (c?.linked_item_ids ?? []).map(String)

/** Todas las cuentas, para el buscador y para controlar que el CUIT no esté repetido. */
export async function cuentasDelCrm(): Promise<CuentaCrm[]> {
  const r = await mondayApi<{ boards: { items_page: { items: ItemCrudo[] } }[] }>('cuentasDelCrm', {
    columnas: COLUMNAS_CUENTA,
    limite: 500,
  })
  return (r.boards?.[0]?.items_page.items ?? [])
    .map((i) => {
      const c = porId(i.column_values)
      return {
        id: i.id,
        nombre: i.name.trim(),
        cuit: texto(c[COL_CUENTA.cuit]),
        clasificacion: texto(c[COL_CUENTA.clasificacion]),
        categoria: texto(c[COL_CUENTA.categoria]),
        tipoPersona: texto(c[COL_CUENTA.tipoPersona]),
        condicionFiscal: texto(c[COL_CUENTA.condicionFiscal]),
        direccion: texto(c[COL_CUENTA.direccionTexto]),
        ciudad: texto(c[COL_CUENTA.ciudad]),
        provincia: texto(c[COL_CUENTA.provincia]),
        pais: texto(c[COL_CUENTA.pais]),
        descripcion: texto(c[COL_CUENTA.descripcion]),
        estado: texto(c[COL_CUENTA.estado]),
        creditoAsignado: aNumeroEspejo(texto(c[COL_CUENTA_VENTA.creditoAsignado])),
        creditoUtilizado: aNumeroEspejo(texto(c[COL_CUENTA_VENTA.creditoUtilizado])),
        equipoNombre: texto(c[COL_CUENTA_VENTA.equipoNombre]),
        concesionLimite: aNumeroEspejo(texto(c[COL_CUENTA_VENTA.concesionLimite])) ?? 0,
        concesionarioIds: conectados(c[COL_CUENTA.concesionario]),
        contactoIds: conectados(c[COL_CUENTA.contactos]),
      }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}
