/**
 * VENTA · los pedidos del concesionario.
 *
 * Un pedido se guarda en TRES lugares, y no por capricho del tablero:
 *
 *   🔖Pedidos            el pedido: quién, para quién, cómo paga y los totales.
 *   └ subelementos       un renglón por modelo, con su cantidad y sus precios.
 *   🛍️Ventas             un item por UNIDAD.
 *
 * La tercera es la que importa entender. Un pedido de tres tractores no se aprueba ni se asigna
 * como un bloque: BERGER puede tener dos en stock y el tercero pedirlo a fábrica. Con las
 * unidades sueltas eso se registra; con el pedido entero habría que elegir entre mentir o
 * rechazarlo completo.
 *
 * Tres preguntas definen un pedido (desde el 15/10/2026):
 *
 *   Tipo de pedido   COMPRA o CONCESIÓN. En concesión el concesionario se lleva el tractor sin
 *                    pagarlo: no hay forma de pago ni factura, y sí un contrato firmado.
 *   Pedido para      COMPRA STOCK (para el concesionario) o VENTA DIRECTA (BERGER le factura a un
 *                    cliente final, al precio que pone el concesionario).
 *   Tipo de factura  INMEDIATA o DIFERIDA. Sólo en COMPRA.
 *
 * Si algo falla a mitad, no se deshace nada: se informa qué quedó sin crear. Borrar un pedido ya
 * escrito es peor —queda media información en tres tableros y nadie sabe cuál es la buena— y
 * además el concesionario ya vio que lo mandó.
 */
import { aTextoMonday } from '@/lib/format'
import {
  enOrden,
  precioDeUnidad,
  redondear,
  totalesDePedido,
  type DescuentoConfigurado,
  type PrecioDeUnidad,
  type RenglonDePedido,
  type TotalesDePedido,
} from '@/lib/precios'
import type { OperatoriaEspecial } from './catalogoVenta'
import {
  COL_PEDIDO,
  COL_PEDIDO_SUB,
  COL_VENTA,
  ESTADO_PEDIDO,
  ESTADO_UNIDAD,
  esContado,
  PEDIDO_PARA,
  POLITICA_CONTADO,
  TIPO_PEDIDO,
} from './columns'
import type { CuentaCrm } from './crm'
import { mondayApi, subirArchivoAColumna } from './sdk'
import type { PedidoLeido } from './seguimientoPedidos'
import { obtenerDatosSesion } from './sesion'

const motivo = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Hoy, en Argentina. */
export function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Un renglón del pedido tal como lo arma la pantalla. */
export interface RenglonElegido {
  productoId: string
  /** Para el nombre del subelemento y para mostrar. */
  nombre: string
  modelo: string
  cantidad: number
  precioLista: number
  iva: number
}

export interface AltaPedido {
  /** La cuenta del concesionario que pide. */
  cuentaId: string
  /** El equipo de monday de ese concesionario. Sale de la sesión, no de la pantalla. */
  equipoId: string
  /** El usuario de monday que está cargando. También sale de la sesión. */
  comercialId?: string
  /** Cómo se llama, para el nombre del item. */
  cuentaNombre: string
  /** COMPRA o CONCESIÓN. */
  tipoPedido: string
  /** COMPRA STOCK o VENTA DIRECTA. */
  pedidoPara: string
  /** INMEDIATA o DIFERIDA. Sólo en COMPRA. */
  tipoFactura: string
  /**
   * Los clientes finales. Sólo en VENTA DIRECTA, y puede ser más de uno: un tractor se vende a
   * nombre de dos hermanos o de una sociedad y su titular más veces de las que uno creería.
   */
  clientes: { id: string; nombre: string }[]
  /** Cómo paga el cliente final (VENTA DIRECTA). */
  condicionVenta: string
  banco: string
  plazo: string
  /** Cómo paga el concesionario (COMPRA STOCK). */
  conceptoPago: string
  /**
   * La Operatoria Especial: el porcentaje que tipeó el concesionario para el cuarto descuento de
   * contado. \`null\` = no la tildó, y el pedido va con la Política Estándar.
   */
  descuentoEspecial: number | null
  /** Por qué se usa la Operatoria Especial. Obligatoria si se tildó. */
  observacionEspecial: string
  /** VENTA DIRECTA: a cuánto le vende UNA unidad de cada producto al cliente final, sin IVA. */
  preciosClienteFinal: Record<string, number>
  renglones: RenglonElegido[]
}

export const esConcesion = (d: Pick<AltaPedido, 'tipoPedido'>): boolean =>
  d.tipoPedido === TIPO_PEDIDO.CONCESION
export const esVentaDirecta = (d: Pick<AltaPedido, 'pedidoPara'>): boolean =>
  d.pedidoPara === PEDIDO_PARA.DIRECTA

/**
 * La forma de pago que corresponde. Es la que decide si hay descuento.
 *
 * En concesión no hay: el concesionario no paga el tractor al llevárselo.
 */
export const pagoDelPedido = (d: AltaPedido): string =>
  esConcesion(d) ? '' : esVentaDirecta(d) ? d.condicionVenta : d.conceptoPago

/**
 * Los descuentos que se aplican a ESTE pedido: los de contado y, si se tildó la Operatoria
 * Especial, el cuarto, en el lugar de la cascada que diga ⚙️Configuración.
 */
export function descuentosDelPedido(
  d: AltaPedido,
  base: DescuentoConfigurado[],
  especial: OperatoriaEspecial | null,
): { descuentos: DescuentoConfigurado[]; delEspecial: DescuentoConfigurado | null } {
  if (!esContado(pagoDelPedido(d)) || !especial || d.descuentoEspecial == null) {
    return { descuentos: base, delEspecial: null }
  }
  const pct = Math.min(Math.max(d.descuentoEspecial, 0), especial.maximo)
  if (pct <= 0) return { descuentos: base, delEspecial: null }
  const delEspecial = { orden: especial.orden, porcentaje: pct }
  return { descuentos: enOrden([...base, delEspecial]), delEspecial }
}

/** Un renglón con su precio calculado y, en venta directa, el precio al cliente final. */
export interface RenglonCalculado extends RenglonDePedido {
  nombre: string
  modelo: string
  /** Cuánto se descontó por la Operatoria Especial en UNA unidad, en pesos. */
  dtoEspecial: number
  /** VENTA DIRECTA: el precio por unidad que puso el concesionario. \`null\` si no aplica o falta. */
  clienteFinal: number | null
  /** Cantidad × (precio al cliente final − lo que BERGER le factura por unidad). */
  comision: number
}

/** Los renglones con su precio ya calculado, listos para mostrar y para escribir. */
export function calcularRenglones(
  d: AltaPedido,
  base: DescuentoConfigurado[],
  especial: OperatoriaEspecial | null,
): RenglonCalculado[] {
  const contado = esContado(pagoDelPedido(d))
  const { descuentos, delEspecial } = descuentosDelPedido(d, base, especial)
  const indiceEspecial = delEspecial ? descuentos.indexOf(delEspecial) : -1
  const directa = esVentaDirecta(d)
  return d.renglones.map((r) => {
    const precio = precioDeUnidad(r.precioLista, r.iva, descuentos, contado)
    const tipeado = directa ? d.preciosClienteFinal[r.productoId] : undefined
    const clienteFinal = tipeado != null && Number.isFinite(tipeado) && tipeado > 0 ? tipeado : null
    return {
      productoId: r.productoId,
      nombre: r.nombre,
      modelo: r.modelo,
      cantidad: r.cantidad,
      precio,
      dtoEspecial: indiceEspecial >= 0 ? (precio.descuentos[indiceEspecial] ?? 0) : 0,
      clienteFinal,
      /* La comisión del concesionario es lo que gana por unidad —lo que le cobra al cliente menos
         lo que BERGER le factura— por la cantidad. */
      comision:
        clienteFinal != null ? redondear(r.cantidad * (clienteFinal - precio.facturaSinIva)) : 0,
    }
  })
}

/**
 * Entre qué valores puede estar el precio al cliente final de UNA unidad: como mucho el de lista,
 * como poco lo que BERGER le factura al concesionario (con los descuentos, sin IVA).
 */
export const rangoClienteFinal = (p: PrecioDeUnidad): { minimo: number; maximo: number } => ({
  minimo: p.facturaSinIva,
  maximo: p.listaSinIva,
})

/** Si un precio al cliente final está fuera de su rango, por qué. Vacío = está bien. */
export function problemaClienteFinal(r: RenglonCalculado): string {
  if (r.clienteFinal == null) return 'falta el precio de venta al cliente final'
  const { minimo, maximo } = rangoClienteFinal(r.precio)
  if (r.clienteFinal > maximo) return 'supera el precio de lista'
  if (r.clienteFinal < minimo) return 'es menor que el precio a facturar'
  return ''
}

/** Si se tildó la Operatoria Especial (y aplica: sólo con contado). */
export const usaOperatoriaEspecial = (d: AltaPedido): boolean =>
  d.descuentoEspecial != null && !esConcesion(d) && esContado(pagoDelPedido(d))

/** Lo que BERGER le factura al cliente final y la comisión del concesionario, en todo el pedido. */
export function totalesVentaDirecta(renglones: RenglonCalculado[]): {
  clienteFinal: number
  comision: number
} {
  return {
    clienteFinal: redondear(renglones.reduce((a, r) => a + (r.clienteFinal ?? 0) * r.cantidad, 0)),
    comision: redondear(renglones.reduce((a, r) => a + r.comision, 0)),
  }
}

/** Qué falta para poder mandarlo. Vacío = se puede. */
export function faltaParaElPedido(
  d: AltaPedido,
  renglones: RenglonCalculado[],
  extras: { conContrato: boolean; especial: OperatoriaEspecial | null },
): string[] {
  const faltan: string[] = []
  if (!d.cuentaId) faltan.push('el concesionario')
  if (!d.tipoPedido) faltan.push('el tipo de pedido')
  if (!d.pedidoPara) faltan.push('para quién es el pedido')
  if (esVentaDirecta(d) && d.clientes.length === 0) faltan.push('el cliente final')
  if (esConcesion(d)) {
    if (!extras.conContrato) faltan.push('el contrato de concesión')
  } else if (d.tipoPedido) {
    if (!d.tipoFactura) faltan.push('el tipo de factura')
    if (esVentaDirecta(d) && !d.condicionVenta) faltan.push('la condición de venta')
    if (!esVentaDirecta(d) && d.pedidoPara && !d.conceptoPago) faltan.push('el concepto de pago')
  }
  if (d.renglones.length === 0) faltan.push('al menos un tractor')
  if (d.renglones.some((r) => r.cantidad < 1)) faltan.push('una cantidad válida en cada tractor')
  if (d.descuentoEspecial != null && extras.especial) {
    if (d.descuentoEspecial < 0 || d.descuentoEspecial > extras.especial.maximo) {
      faltan.push(`un descuento especial entre 0% y ${extras.especial.maximo}%`)
    }
  }
  if (usaOperatoriaEspecial(d) && !d.observacionEspecial.trim()) {
    faltan.push('las observaciones de la operatoria especial')
  }
  if (esVentaDirecta(d) && renglones.some((r) => problemaClienteFinal(r))) {
    faltan.push('un precio de venta al cliente final válido en cada tractor')
  }
  return faltan
}

/**
 * La línea de crédito del concesionario frente a este pedido.
 *
 * Se mide con el total CON IVA, que es lo que va a deber. En concesión no se factura, así que no
 * usa línea. Sin línea asignada, lo disponible es cero. No bloquea la carga —el pedido se registra
 * igual—, pero BERGER no lo va a poder aprobar hasta que la línea alcance.
 */
export function lineaDeCredito(
  cuenta: CuentaCrm | null,
  totales: TotalesDePedido,
  concesion: boolean,
) {
  const asignado = cuenta?.creditoAsignado ?? 0
  const disponible = asignado - (cuenta?.creditoUtilizado ?? 0)
  const monto = totales.facturaConIva
  return {
    asignado,
    disponible,
    monto,
    quedaria: disponible - monto,
    insuficiente: Boolean(cuenta) && !concesion && monto > 0 && monto > disponible,
  }
}

/** Estados con los que un pedido en concesión ya no ocupa lugar del tope. */
const CONCESION_LIBERADA: string[] = [ESTADO_PEDIDO.RECHAZADO, 'Cancelado']

/**
 * Cuántos pedidos en concesión tiene abiertos el concesionario, frente a su tope.
 *
 * El tope está en 🌐Cuentas ("Pedidos x Concesión Permitidos"). Cuentan los pedidos con Tipo de
 * Pedido CONCESIÓN que no se rechazaron ni cancelaron. Con el tope en 0, o ya alcanzado, la opción
 * no se puede elegir.
 */
export function concesionesDe(cuenta: CuentaCrm | null, pedidos: PedidoLeido[]) {
  const limite = cuenta?.concesionLimite ?? 0
  const enUso = cuenta
    ? pedidos.filter(
        (p) =>
          p.cuentaId === cuenta.id &&
          p.tipoPedido === TIPO_PEDIDO.CONCESION &&
          !CONCESION_LIBERADA.includes(p.estado),
      ).length
    : 0
  return { limite, enUso, puede: limite > 0 && enUso < limite }
}

export interface ResultadoPedido {
  pedidoId: string
  nombre: string
  /** Un item de 🛍️Ventas por cada unidad. */
  unidades: number
  totales: TotalesDePedido
  /** VENTA DIRECTA: lo que se le factura al cliente final y la comisión. */
  ventaDirecta: { clienteFinal: number; comision: number } | null
  /** Si el contrato de concesión quedó adjunto. */
  contratoAdjunto: boolean
  advertencias: string[]
}

/**
 * El nombre del item, en 🔖Pedidos y en 🛍️Ventas: \`Concesionario - Cliente final\`.
 *
 * Es lo que se lee en el tablero sin abrir nada, y son las dos puntas del pedido. Sin cliente
 * final —compra de stock, donde BERGER le factura al concesionario— queda sólo el concesionario.
 */
const nombreDelPedido = (concesionario: string, clientes: { nombre: string }[]): string => {
  const finales = clientes
    .map((c) => c.nombre.trim())
    .filter(Boolean)
    .join(', ')
  return [concesionario.trim(), finales].filter(Boolean).join(' - ')
}

/** Las columnas de precio de un subelemento del pedido. */
function preciosDelSubitem(r: RenglonCalculado): Record<string, unknown> {
  const p = r.precio
  return {
    [COL_PEDIDO_SUB.listaSinIva]: aTextoMonday(p.listaSinIva),
    [COL_PEDIDO_SUB.listaConIva]: aTextoMonday(p.listaConIva),
    [COL_PEDIDO_SUB.dto1]: aTextoMonday(p.descuentos[0] ?? 0),
    [COL_PEDIDO_SUB.dto2]: aTextoMonday(p.descuentos[1] ?? 0),
    [COL_PEDIDO_SUB.dto3]: aTextoMonday(p.descuentos[2] ?? 0),
    ...(r.dtoEspecial > 0 ? { [COL_PEDIDO_SUB.dto4]: aTextoMonday(r.dtoEspecial) } : {}),
    [COL_PEDIDO_SUB.contadoSinIva]: aTextoMonday(p.contadoSinIva),
    [COL_PEDIDO_SUB.contadoConIva]: aTextoMonday(p.contadoConIva),
    [COL_PEDIDO_SUB.facturaSinIva]: aTextoMonday(p.facturaSinIva),
    [COL_PEDIDO_SUB.facturaConIva]: aTextoMonday(p.facturaConIva),
    ...(r.clienteFinal != null
      ? {
          [COL_PEDIDO_SUB.precioClienteFinal]: aTextoMonday(r.clienteFinal),
          [COL_PEDIDO_SUB.precioMaximoUnidad]: aTextoMonday(p.facturaSinIva),
          [COL_PEDIDO_SUB.comision]: aTextoMonday(r.comision),
        }
      : {}),
  }
}

/** Las mismas, con los ids del tablero de Ventas. */
function preciosDeLaUnidad(r: RenglonCalculado): Record<string, unknown> {
  const p = r.precio
  return {
    [COL_VENTA.listaSinIva]: aTextoMonday(p.listaSinIva),
    [COL_VENTA.listaConIva]: aTextoMonday(p.listaConIva),
    [COL_VENTA.dto1]: aTextoMonday(p.descuentos[0] ?? 0),
    [COL_VENTA.dto2]: aTextoMonday(p.descuentos[1] ?? 0),
    [COL_VENTA.dto3]: aTextoMonday(p.descuentos[2] ?? 0),
    ...(r.dtoEspecial > 0 ? { [COL_VENTA.dto4]: aTextoMonday(r.dtoEspecial) } : {}),
    [COL_VENTA.contadoSinIva]: aTextoMonday(p.contadoSinIva),
    [COL_VENTA.contadoConIva]: aTextoMonday(p.contadoConIva),
    /* El total de una unidad es su precio por uno: es la misma cuenta que en 🔖Pedidos, donde se
       suma cada renglón por su cantidad. */
    [COL_VENTA.totalContadoSinIva]: aTextoMonday(p.contadoSinIva),
    [COL_VENTA.totalContadoConIva]: aTextoMonday(p.contadoConIva),
    [COL_VENTA.facturaSinIva]: aTextoMonday(p.facturaSinIva),
    [COL_VENTA.facturaConIva]: aTextoMonday(p.facturaConIva),
    ...(r.clienteFinal != null
      ? {
          [COL_VENTA.precioClienteFinal]: aTextoMonday(r.clienteFinal),
          [COL_VENTA.precioMaximoUnidad]: aTextoMonday(p.facturaSinIva),
        }
      : {}),
  }
}

/**
 * Crea el pedido entero.
 *
 * El orden es el del circuito: primero el pedido —para tener su ID—, después el contrato si es en
 * concesión, un subelemento por modelo, y por cada subelemento tantas unidades en 🛍️Ventas como
 * diga la cantidad.
 */
export async function crearPedido(
  d: AltaPedido,
  base: DescuentoConfigurado[],
  especial: OperatoriaEspecial | null,
  contrato: File | null,
): Promise<ResultadoPedido> {
  const renglones = calcularRenglones(d, base, especial)
  const faltan = faltaParaElPedido(d, renglones, { conContrato: Boolean(contrato), especial })
  if (faltan.length > 0) throw new Error(`Falta ${faltan.join(', ')}.`)

  const advertencias: string[] = []
  const concesion = esConcesion(d)
  const directa = esVentaDirecta(d)
  const contado = esContado(pagoDelPedido(d))
  const conEspecial = renglones.some((r) => r.dtoEspecial > 0)
  const totales = totalesDePedido(renglones)
  const ventaDirecta = directa ? totalesVentaDirecta(renglones) : null

  /* El comercial que pide es quien está usando la app. No se pregunta: el dato que importa es
     quién lo pidió de verdad, y preguntarlo sería dejar cargar a nombre de otro. Primero el de la
     sesión de la app; el del SDK de monday es el respaldo. */
  let comercialId = Number(d.comercialId ?? 0) || 0
  if (!comercialId) {
    try {
      comercialId = (await obtenerDatosSesion()).userId ?? 0
    } catch {
      /* Sin ninguno de los dos el pedido se crea igual, sin comercial. */
    }
  }

  const valores: Record<string, unknown> = {
    /* El concesionario y el tercero van en columnas distintas: el primero es quien pide y el
       segundo a quién se le vende. */
    [COL_PEDIDO.cuenta]: { item_ids: [d.cuentaId] },
    [COL_PEDIDO.tipoPedido]: { label: d.tipoPedido },
    [COL_PEDIDO.pedidoPara]: { label: d.pedidoPara },
    [COL_PEDIDO.estado]: { label: ESTADO_PEDIDO.CARGADA },
    [COL_PEDIDO.fechaSolicitud]: { date: hoy() },
    [COL_PEDIDO.totalListaSinIva]: aTextoMonday(totales.listaSinIva),
    [COL_PEDIDO.totalListaConIva]: aTextoMonday(totales.listaConIva),
    [COL_PEDIDO.totalContadoSinIva]: aTextoMonday(totales.contadoSinIva),
    [COL_PEDIDO.totalContadoConIva]: aTextoMonday(totales.contadoConIva),
    [COL_PEDIDO.totalFacturaSinIva]: aTextoMonday(totales.facturaSinIva),
    [COL_PEDIDO.totalFacturaConIva]: aTextoMonday(totales.facturaConIva),
  }
  /* El cliente final va sólo en la venta directa: en la compra de stock BERGER le factura al
     concesionario. Se escribe con el mismo id en 🔖Pedidos y en 🛍️Ventas. */
  const clienteIds = directa ? [...new Set(d.clientes.map((c) => c.id).filter(Boolean))] : []
  if (clienteIds.length > 0) valores[COL_PEDIDO.tercero] = { item_ids: clienteIds }
  if (ventaDirecta) {
    valores[COL_PEDIDO.totalClienteFinal] = aTextoMonday(ventaDirecta.clienteFinal)
    valores[COL_PEDIDO.totalComision] = aTextoMonday(ventaDirecta.comision)
  }
  if (comercialId) {
    valores[COL_PEDIDO.comercial] = { personsAndTeams: [{ id: comercialId, kind: 'person' }] }
  }
  /* El equipo del concesionario además de la persona: la persona dice quién lo cargó y el equipo,
     de quién es el pedido. */
  if (d.equipoId) {
    valores[COL_PEDIDO.equipo] = { personsAndTeams: [{ id: Number(d.equipoId), kind: 'team' }] }
  }
  /* En concesión no hay pago ni factura: no se escribe nada de eso. */
  if (!concesion) {
    if (d.tipoFactura) valores[COL_PEDIDO.tipoFactura] = { label: d.tipoFactura }
    if (directa) {
      if (d.condicionVenta) valores[COL_PEDIDO.condicionVenta] = { labels: [d.condicionVenta] }
      if (d.banco) valores[COL_PEDIDO.banco] = { label: d.banco }
    } else if (d.conceptoPago) {
      valores[COL_PEDIDO.conceptoPago] = { label: d.conceptoPago }
    }
    if (d.plazo) valores[COL_PEDIDO.plazo] = { label: d.plazo }
    /* Queda como dato propio del pedido para poder filtrar y contar cuántos fueron por Operatoria
       Especial y cuántos por la política estándar. Sólo tiene sentido en contado. */
    if (contado) {
      valores[COL_PEDIDO.politicaContado] = {
        label: conEspecial ? POLITICA_CONTADO.ESPECIAL : POLITICA_CONTADO.ESTANDAR,
      }
      if (usaOperatoriaEspecial(d) && d.observacionEspecial.trim()) {
        valores[COL_PEDIDO.observacionEspecial] = { text: d.observacionEspecial.trim() }
      }
    }
  }

  const nombre = nombreDelPedido(d.cuentaNombre, directa ? d.clientes : [])
  const creado = await mondayApi<{ create_item: { id: string } }>('crearPedido', {
    nombre,
    valores: JSON.stringify(valores),
  })
  const pedidoId = creado.create_item.id

  /* El contrato, enseguida: si falla, el pedido ya existe y se avisa para adjuntarlo a mano en
     monday, en vez de dejar un pedido en concesión sin papeles sin que nadie lo sepa. */
  let contratoAdjunto = false
  if (concesion && contrato) {
    try {
      await subirArchivoAColumna(pedidoId, COL_PEDIDO.contratoConcesion, contrato)
      contratoAdjunto = true
    } catch (e) {
      advertencias.push(
        `No se pudo adjuntar el contrato (${motivo(e)}). Adjuntalo en el pedido desde monday.`,
      )
    }
  }

  let unidades = 0
  for (const r of renglones) {
    let subitemId = ''
    try {
      const sub = await mondayApi<{ create_subitem: { id: string } }>('crearSubitemDePedido', {
        padre: pedidoId,
        nombre: r.nombre,
        valores: JSON.stringify({
          [COL_PEDIDO_SUB.catalogo]: { item_ids: [r.productoId] },
          [COL_PEDIDO_SUB.estado]: { label: ESTADO_UNIDAD.PENDIENTE },
          [COL_PEDIDO_SUB.cantidad]: aTextoMonday(r.cantidad),
          ...preciosDelSubitem(r),
        }),
      })
      subitemId = sub.create_subitem.id
    } catch (e) {
      advertencias.push(`No se pudo cargar ${r.nombre}: ${motivo(e)}`)
      continue
    }

    /* Una fila de 🛍️Ventas por UNIDAD: es lo que después se aprueba y se asigna de a una. */
    for (let i = 0; i < r.cantidad; i += 1) {
      try {
        await mondayApi<{ create_item: { id: string } }>('crearUnidadDeVenta', {
          nombre,
          valores: JSON.stringify({
            [COL_VENTA.concesionario]: { item_ids: [d.cuentaId] },
            ...(clienteIds.length > 0 ? { [COL_VENTA.tercero]: { item_ids: clienteIds } } : {}),
            [COL_VENTA.catalogo]: { item_ids: [r.productoId] },
            [COL_VENTA.subitemPedido]: { item_ids: [subitemId] },
            [COL_VENTA.pedido]: { item_ids: [pedidoId] },
            [COL_VENTA.estado]: { label: ESTADO_UNIDAD.PENDIENTE },
            ...(comercialId
              ? {
                  [COL_VENTA.comercial]: { personsAndTeams: [{ id: comercialId, kind: 'person' }] },
                }
              : {}),
            ...(d.equipoId
              ? {
                  [COL_VENTA.concesionarioPersonas]: {
                    personsAndTeams: [{ id: Number(d.equipoId), kind: 'team' }],
                  },
                }
              : {}),
            ...preciosDeLaUnidad(r),
          }),
        })
        unidades += 1
      } catch (e) {
        advertencias.push(`No se pudo crear una unidad de ${r.nombre}: ${motivo(e)}`)
      }
    }
  }

  return { pedidoId, nombre, unidades, totales, ventaDirecta, contratoAdjunto, advertencias }
}
