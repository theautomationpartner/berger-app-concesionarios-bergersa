/**
 * Los pedidos después de cargados, del lado del concesionario: en qué anda cada uno y cada unidad,
 * y las novedades que dejó BERGER.
 *
 * Es sólo lectura. Aprobar y asignar son de BERGER y viven en la app de BERGER S.A.; acá el
 * concesionario mira lo suyo.
 */
import { aNumeroEspejo, porId, texto, type ColumnaCruda } from './parse'
import { APROBACION, COL_PEDIDO, COL_PEDIDO_SUB, COL_VENTA } from './columns'
import { mondayApi } from './sdk'

type ItemCrudo = {
  id: string
  name: string
  column_values: ColumnaCruda[]
  subitems?: ItemCrudo[]
}

type ConRelacion = ColumnaCruda & { linked_item_ids?: string[] | null }

const enlazados = (c: ColumnaCruda | undefined): string[] =>
  ((c as ConRelacion | undefined)?.linked_item_ids ?? []).map(String)

/**
 * El nombre de lo que hay del otro lado de una conexión.
 *
 * Las columnas de conexión devuelven `text: null` igual que los mirrors, y ponen los nombres en
 * `display_value`. Leerlas con `texto()` da siempre vacío, y vacío no parece un error: parece un
 * pedido sin concesionario.
 */
const nombreEnlazado = (c: ColumnaCruda | undefined): string =>
  (c?.display_value ?? c?.text ?? '').trim()

const numero = (c: ColumnaCruda | undefined): number => aNumeroEspejo(texto(c)) ?? 0

/**
 * El id de monday de la primera persona de una columna `people`.
 *
 * Vive en el JSON crudo de la columna y no en su texto: el texto trae el nombre, y con un nombre
 * no se puede mencionar a nadie.
 */
function idDePersona(c: ColumnaCruda | undefined): string {
  try {
    const v = JSON.parse(c?.value ?? '') as {
      personsAndTeams?: { id: number | string; kind?: string }[]
    }
    const persona = (v.personsAndTeams ?? []).find((x) => !x.kind || x.kind === 'person')
    return persona ? String(persona.id) : ''
  } catch {
    return ''
  }
}

/* ------------------------------------------------------------------ *
 * Lo que se lee
 * ------------------------------------------------------------------ */

/** Un renglón del pedido: un modelo con su cantidad. */
export interface RenglonLeido {
  id: string
  nombre: string
  estado: string
  cantidad: number
  catalogoId: string
  facturaSinIva: number
}

export interface PedidoLeido {
  id: string
  nombre: string
  estado: string
  tipoPedido: string
  tipoVenta: string
  /** Cómo se paga: la condición de venta o el concepto, según el tipo. */
  pago: string
  banco: string
  plazo: string
  cuentaId: string
  cuentaNombre: string
  terceroNombre: string
  comercial: string
  /** Su id de monday, para mencionarlo cuando el pedido cambia. */
  comercialId: string
  equipo: string
  aprobComercial: string
  aprobFinanciera: string
  fechaSolicitud: string
  fechaAprobacion: string
  motivo: string
  totalListaSinIva: number
  totalFacturaSinIva: number
  totalFacturaConIva: number
  /** Qué porcentaje de las unidades ya tiene tractor (0 a 100), según lo dejó Asignar. */
  porcentajeAsignacion: number
  renglones: RenglonLeido[]
}

/** Una unidad de 🛍️Ventas: un tractor pedido, que se aprueba y se asigna de a uno. */
export interface UnidadLeida {
  id: string
  nombre: string
  estado: string
  pedidoId: string
  renglonId: string
  catalogoId: string
  catalogoNombre: string
  /** El tractor del inventario con el que se la cumple. Vacío = todavía sin asignar. */
  inventarioId: string
  inventarioNombre: string
  facturaSinIva: number
}

const COLUMNAS_PEDIDO = [
  COL_PEDIDO.estado,
  COL_PEDIDO.tipoPedido,
  COL_PEDIDO.tipoVenta,
  COL_PEDIDO.condicionVenta,
  COL_PEDIDO.conceptoPago,
  COL_PEDIDO.banco,
  COL_PEDIDO.plazo,
  COL_PEDIDO.cuenta,
  COL_PEDIDO.tercero,
  COL_PEDIDO.comercial,
  COL_PEDIDO.equipo,
  COL_PEDIDO.fechaSolicitud,
  COL_PEDIDO.fechaAprobacion,
  COL_PEDIDO.aprobComercial,
  COL_PEDIDO.aprobFinanciera,
  COL_PEDIDO.motivo,
  COL_PEDIDO.totalListaSinIva,
  COL_PEDIDO.totalFacturaSinIva,
  COL_PEDIDO.totalFacturaConIva,
  COL_PEDIDO.porcentajeAsignacion,
]

const COLUMNAS_RENGLON = [
  COL_PEDIDO_SUB.estado,
  COL_PEDIDO_SUB.cantidad,
  COL_PEDIDO_SUB.catalogo,
  COL_PEDIDO_SUB.facturaSinIva,
]

const COLUMNAS_UNIDAD = [
  COL_VENTA.estado,
  COL_VENTA.pedido,
  COL_VENTA.subitemPedido,
  COL_VENTA.catalogo,
  COL_VENTA.inventario,
  COL_VENTA.facturaSinIva,
]

/** Los pedidos, con sus renglones. */
export async function pedidosCargados(limite = 200): Promise<PedidoLeido[]> {
  const r = await mondayApi<{ boards: { items_page: { items: ItemCrudo[] } }[] }>(
    'pedidosCargados',
    { columnas: COLUMNAS_PEDIDO, subColumnas: COLUMNAS_RENGLON, limite },
  )

  return (r.boards[0]?.items_page.items ?? []).map((it) => {
    const c = porId(it.column_values)
    const tipoPedido = texto(c[COL_PEDIDO.tipoPedido])
    return {
      id: it.id,
      nombre: it.name,
      estado: texto(c[COL_PEDIDO.estado]),
      tipoPedido,
      tipoVenta: texto(c[COL_PEDIDO.tipoVenta]),
      /* Según el tipo de pedido, la forma de pago vive en una columna o en la otra. */
      pago: texto(c[COL_PEDIDO.condicionVenta]) || texto(c[COL_PEDIDO.conceptoPago]),
      banco: texto(c[COL_PEDIDO.banco]),
      plazo: texto(c[COL_PEDIDO.plazo]),
      cuentaId: enlazados(c[COL_PEDIDO.cuenta])[0] ?? '',
      cuentaNombre: nombreEnlazado(c[COL_PEDIDO.cuenta]),
      terceroNombre: nombreEnlazado(c[COL_PEDIDO.tercero]),
      comercial: texto(c[COL_PEDIDO.comercial]),
      comercialId: idDePersona(c[COL_PEDIDO.comercial]),
      equipo: texto(c[COL_PEDIDO.equipo]),
      aprobComercial: texto(c[COL_PEDIDO.aprobComercial]) || APROBACION.PENDIENTE,
      aprobFinanciera: texto(c[COL_PEDIDO.aprobFinanciera]) || APROBACION.PENDIENTE,
      fechaSolicitud: texto(c[COL_PEDIDO.fechaSolicitud]),
      fechaAprobacion: texto(c[COL_PEDIDO.fechaAprobacion]),
      motivo: texto(c[COL_PEDIDO.motivo]),
      totalListaSinIva: numero(c[COL_PEDIDO.totalListaSinIva]),
      totalFacturaSinIva: numero(c[COL_PEDIDO.totalFacturaSinIva]),
      totalFacturaConIva: numero(c[COL_PEDIDO.totalFacturaConIva]),
      porcentajeAsignacion: numero(c[COL_PEDIDO.porcentajeAsignacion]),
      renglones: (it.subitems ?? []).map((s) => {
        const sc = porId(s.column_values)
        return {
          id: s.id,
          nombre: s.name,
          estado: texto(sc[COL_PEDIDO_SUB.estado]),
          cantidad: numero(sc[COL_PEDIDO_SUB.cantidad]),
          catalogoId: enlazados(sc[COL_PEDIDO_SUB.catalogo])[0] ?? '',
          facturaSinIva: numero(sc[COL_PEDIDO_SUB.facturaSinIva]),
        }
      }),
    }
  })
}

/** Las unidades, todas. Se agrupan por pedido del lado de la pantalla. */
export async function unidadesDeVenta(limite = 500): Promise<UnidadLeida[]> {
  const r = await mondayApi<{ boards: { items_page: { items: ItemCrudo[] } }[] }>(
    'unidadesDeVenta',
    {
      columnas: COLUMNAS_UNIDAD,
      limite,
    },
  )

  return (r.boards[0]?.items_page.items ?? []).map((it) => {
    const c = porId(it.column_values)
    return {
      id: it.id,
      nombre: it.name,
      estado: texto(c[COL_VENTA.estado]),
      pedidoId: enlazados(c[COL_VENTA.pedido])[0] ?? '',
      renglonId: enlazados(c[COL_VENTA.subitemPedido])[0] ?? '',
      catalogoId: enlazados(c[COL_VENTA.catalogo])[0] ?? '',
      catalogoNombre: nombreEnlazado(c[COL_VENTA.catalogo]),
      inventarioId: enlazados(c[COL_VENTA.inventario])[0] ?? '',
      inventarioNombre: nombreEnlazado(c[COL_VENTA.inventario]),
      facturaSinIva: numero(c[COL_VENTA.facturaSinIva]),
    }
  })
}

/* ------------------------------------------------------------------ *
 * Novedades
 * ------------------------------------------------------------------ */

/** Una novedad: lo que BERGER escribió en un pedido. */
export interface Novedad {
  id: string
  pedidoId: string
  pedidoNombre: string
  texto: string
  autor: string
  /** ISO con hora, tal como lo devuelve monday. */
  cuando: string
  /** Si menciona a quien está mirando. Las suyas van primero. */
  paraMi: boolean
}

type ItemConUpdates = ItemCrudo & {
  updates?: {
    id: string
    text_body?: string | null
    created_at: string
    creator?: { id: string; name: string } | null
  }[]
}

/**
 * Las novedades de los pedidos de una cuenta.
 *
 * Salen de los updates del item, que es donde quedan escritos los cambios de estado: la API de
 * monday no deja leer las notificaciones de una persona, así que la bandeja se arma con lo que sí
 * se puede leer. El resultado es el mismo para quien lo mira, y además queda en el tablero.
 */
export async function novedadesDePedidos(
  cuentaIds: string[],
  miUsuarioId = '',
  limite = 200,
): Promise<Novedad[]> {
  const r = await mondayApi<{ boards: { items_page: { items: ItemConUpdates[] } }[] }>(
    'novedadesDePedidos',
    { columnas: [COL_PEDIDO.cuenta, COL_PEDIDO.comercial], limite },
  )

  const novedades: Novedad[] = []
  for (const it of r.boards[0]?.items_page.items ?? []) {
    const c = porId(it.column_values)
    const cuentaId = enlazados(c[COL_PEDIDO.cuenta])[0] ?? ''
    if (cuentaIds.length > 0 && !cuentaIds.includes(cuentaId)) continue

    /* "Para mí" es el pedido que cargué yo: es a quien menciona el update que escribe BERGER. */
    const mio = Boolean(miUsuarioId) && idDePersona(c[COL_PEDIDO.comercial]) === miUsuarioId

    for (const u of it.updates ?? []) {
      const texto = (u.text_body ?? '').trim()
      if (!texto) continue
      novedades.push({
        id: u.id,
        pedidoId: it.id,
        pedidoNombre: it.name,
        texto,
        autor: u.creator?.name ?? 'BERGER',
        cuando: u.created_at,
        paraMi: mio,
      })
    }
  }

  return novedades.sort((a, b) => b.cuando.localeCompare(a.cuando))
}

/**
 * Cuáles ya se leyeron.
 *
 * Vive en el navegador y no en monday porque "leído" es de cada persona y de cada máquina, y
 * escribirlo en el tablero significaría una columna más que nadie mira y una escritura por cada
 * vez que alguien abre la pantalla. Si se borran los datos del navegador, se vuelven a ver como
 * nuevas: molesto, no grave.
 */
const CLAVE_LEIDAS = 'berger.novedades.leidas'

export function novedadesLeidas(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_LEIDAS) ?? '[]') as unknown
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export function marcarLeidas(ids: string[]): void {
  try {
    /* Se guardan las últimas 500: la lista crece con cada update y nadie va a volver a mirar una
       novedad de hace medio año. */
    const todas = [...new Set([...novedadesLeidas(), ...ids])].slice(-500)
    localStorage.setItem(CLAVE_LEIDAS, JSON.stringify(todas))
  } catch {
    /* Sin localStorage —ventana privada, datos bloqueados— todo se ve como nuevo. */
  }
}
