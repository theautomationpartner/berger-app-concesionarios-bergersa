/**
 * VENTA · alta de cuentas y contactos en el CRM.
 *
 * Es el único lugar donde se dan de alta: en los tableros se puede cargar una fila a mano, pero
 * ahí nadie comprueba que el CUIT exista ni que el contacto no esté repetido. Acá sí, y por eso
 * esta pantalla existe en vez de mandar a la gente al tablero.
 *
 * **La regla de los duplicados**, que es la razón de ser de casi todo este archivo: un contacto se
 * identifica por su mail o por su WhatsApp. Dentro de UNA cuenta no puede haber dos contactos que
 * compartan alguno de los dos —sería la misma persona cargada dos veces—. Entre cuentas distintas
 * sí: el mismo señor puede ser el comprador de dos empresas, y son dos contactos legítimos con los
 * mismos datos de contacto.
 */
import { CRM, COL_CONTACTO, COL_CUENTA, COL_CUENTA_VENTA } from './columns'
import { aNumeroEspejo, porId, texto, type ColumnaCruda } from './parse'
import { mondayApi } from './sdk'

const hoy = (): string => {
  const ahora = new Date()
  const en = (opcion: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', ...opcion })
  return en({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)
}

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
        concesionarioIds: conectados(c[COL_CUENTA.concesionario]),
        contactoIds: conectados(c[COL_CUENTA.contactos]),
      }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

export interface Concesionario {
  id: string
  nombre: string
}

/**
 * Las etiquetas de los desplegables de los dos tableros.
 *
 * Se leen de monday y nunca se escriben desde el código: una etiqueta que no existe hace fallar la
 * escritura ENTERA del item, no sólo esa columna.
 */
export async function etiquetasDelCrm(): Promise<{
  tipoPersona: string[]
  clasificacion: string[]
  categoriaCuenta: string[]
  condicionFiscal: string[]
  categoriaContacto: string[]
}> {
  const r = await mondayApi<{
    boards: {
      id: string
      cuenta: { id: string; settings_str: string }[]
      contacto: { id: string; settings_str: string }[]
    }[]
  }>('etiquetasDelCrm', {
    columnasCuenta: [
      COL_CUENTA.tipoPersona,
      COL_CUENTA.clasificacion,
      COL_CUENTA.categoria,
      COL_CUENTA.condicionFiscal,
    ],
    columnasContacto: [COL_CONTACTO.categoria],
  })

  const etiquetas = (id: string): string[] => {
    /* Las dos listas de columnas se piden sobre los dos tableros, así que de cada tablero vuelven
       las que tiene y vacías las del otro. Se recorre todo y se queda con la que aparezca. */
    for (const b of r.boards ?? []) {
      const col = [...(b.cuenta ?? []), ...(b.contacto ?? [])].find((c) => c.id === id)
      if (!col?.settings_str) continue
      try {
        const ajustes = JSON.parse(col.settings_str) as {
          labels?: { id: number; name: string }[] | Record<string, string>
        }
        const l = ajustes.labels
        if (Array.isArray(l)) return l.map((x) => x.name).filter(Boolean)
        if (l && typeof l === 'object') return Object.values(l).filter(Boolean)
      } catch {
        /* una columna ilegible no tiene por qué dejar sin opciones a las otras cuatro */
      }
    }
    return []
  }

  return {
    tipoPersona: etiquetas(COL_CUENTA.tipoPersona),
    clasificacion: etiquetas(COL_CUENTA.clasificacion),
    categoriaCuenta: etiquetas(COL_CUENTA.categoria),
    condicionFiscal: etiquetas(COL_CUENTA.condicionFiscal),
    categoriaContacto: etiquetas(COL_CONTACTO.categoria),
  }
}

/** ¿Ya existe una cuenta con este CUIT? El CUIT es la llave: no puede haber dos. */
export function cuentaConElMismoCuit(cuentas: CuentaCrm[], cuit: string): CuentaCrm | null {
  const d = cuit.replace(/\D/g, '')
  if (!d) return null
  return cuentas.find((c) => c.cuit.replace(/\D/g, '') === d) ?? null
}

export interface AltaCuenta {
  razonSocial: string
  cuit: string
  tipoPersona: string
  clasificacion: string
  categorias: string[]
  condicionFiscal: string
  direccion: string
  ciudad: string
  provincia: string
  paisCodigo: string
  paisNombre: string
  descripcion: string
  concesionarioIds: string[]
  /** Contactos que ya existen y se conectan a la cuenta nueva. */
  contactoIds: string[]
}

export async function crearCuenta(d: AltaCuenta): Promise<{ id: string; nombre: string }> {
  const valores: Record<string, unknown> = {
    [COL_CUENTA.cuit]: d.cuit.trim(),
    [COL_CUENTA.estado]: { label: CRM.CUENTA_ACTIVA },
    [COL_CUENTA.fechaAlta]: { date: hoy() },
  }
  if (d.tipoPersona) valores[COL_CUENTA.tipoPersona] = { label: d.tipoPersona }
  if (d.clasificacion) valores[COL_CUENTA.clasificacion] = { label: d.clasificacion }
  if (d.categorias.length > 0) valores[COL_CUENTA.categoria] = { labels: d.categorias }
  if (d.condicionFiscal) valores[COL_CUENTA.condicionFiscal] = { label: d.condicionFiscal }

  /* La dirección va en texto y no en la columna de ubicación: la de ubicación necesita latitud y
     longitud, y lo que devuelve ARCA es una dirección escrita. Cargarla ahí con coordenadas
     inventadas pondría a todos los clientes en el mismo punto del mapa. */
  if (d.direccion.trim()) valores[COL_CUENTA.direccionTexto] = d.direccion.trim()
  if (d.ciudad.trim()) valores[COL_CUENTA.ciudad] = d.ciudad.trim()
  if (d.provincia.trim()) valores[COL_CUENTA.provincia] = d.provincia.trim()
  if (d.paisCodigo) {
    valores[COL_CUENTA.pais] = { countryCode: d.paisCodigo, countryName: d.paisNombre }
  }
  if (d.descripcion.trim()) valores[COL_CUENTA.descripcion] = d.descripcion.trim()
  if (d.concesionarioIds.length > 0) {
    valores[COL_CUENTA.concesionario] = { item_ids: d.concesionarioIds }
  }
  if (d.contactoIds.length > 0) valores[COL_CUENTA.contactos] = { item_ids: d.contactoIds }

  const r = await mondayApi<{ create_item: { id: string; name: string } }>('crearCuentaCrm', {
    nombre: d.razonSocial.trim(),
    valores: JSON.stringify(valores),
  })
  return { id: r.create_item.id, nombre: r.create_item.name }
}
