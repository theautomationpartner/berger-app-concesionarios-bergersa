/**
 * PEDIDOS · Crear pedido.
 *
 * Cuatro pasos —el pedido, los tractores, el pago, revisar y mandar— porque lo que se pregunta en
 * cada uno depende de lo anterior. La pantalla se parte en dos: a la izquierda lo que se completa,
 * a la derecha lo que se va formando (en el primer paso, la línea de crédito; después, el pedido con
 * sus totales). Así casi nunca hace falta bajar para ver cómo viene.
 *
 * El concesionario no se elige: sale del equipo de monday del usuario (`lib/concesionario`). Sólo
 * Administración puede cargar a nombre de cualquiera.
 *
 * Tres preguntas arman el pedido: Tipo de pedido (COMPRA o CONCESIÓN), Pedido para (COMPRA STOCK o
 * VENTA DIRECTA) y, en compra, el Tipo de factura. En concesión no hay pago ni factura: en su lugar
 * se adjunta el contrato. En venta directa el concesionario pone a cuánto le vende cada tractor al
 * cliente final, entre lo que BERGER le factura y el precio de lista.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Desplegable } from '@/components/ui/Desplegable'
import { ZonaArchivo } from '@/components/ui/ZonaArchivo'
import { useSalidaProtegida } from '@/hooks/useSalidaProtegida'
import {
  concesionariosElegibles,
  type ConcesionarioPropio,
  type EquipoMonday,
} from '@/lib/concesionario'
import { aNumero, importe as aMoneda, pesoArchivo } from '@/lib/format'
import { descuentoTotalEnPorcentaje, totalesDePedido, type DescuentoConfigurado } from '@/lib/precios'
import {
  catalogoDeVenta,
  configuracionDeContado,
  type OperatoriaEspecial,
  type ProductoDeCatalogo,
} from '@/services/monday/catalogoVenta'
import {
  esContado,
  PEDIDO_PARA,
  POLITICA_CONTADO,
  TIPO_FACTURA,
  TIPO_PEDIDO,
} from '@/services/monday/columns'
import { cuentasDelCrm, etiquetasDelCrm, type CuentaCrm } from '@/services/monday/crm'
import {
  calcularRenglones,
  concesionesDe,
  crearPedido,
  descuentosDelPedido,
  esConcesion,
  esVentaDirecta,
  faltaParaElPedido,
  lineaDeCredito,
  pagoDelPedido,
  problemaClienteFinal,
  rangoClienteFinal,
  totalesVentaDirecta,
  type AltaPedido,
  type ResultadoPedido,
} from '@/services/monday/pedidos'
import { SinAcceso } from '@/services/monday/sdk'
import { pedidosCargados, type PedidoLeido } from '@/services/monday/seguimientoPedidos'
import { CatalogoTractores } from '@/features/ventas/CatalogoTractores'
import { ClienteFinal } from '@/features/ventas/ClienteFinal'
import { FichaCuenta, tonoDeCredito } from '@/features/ventas/FichaCuenta'

const mensaje = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Las condiciones de venta y los conceptos de pago, tal como están en el tablero. */
const CONDICIONES = [
  'CONTADO',
  'BANCO',
  'BANCO - CANJE CEREAL',
  'BANCO - FINANCIACIÓN DEALER',
  'CANJE CEREAL',
  'CANJE CEREAL - BANCO',
  'CANJE CEREAL - FINANCIACIÓN CLIENTE',
  'CANJE CEREAL - FINANCIACIÓN DEALER',
  'FINANCIACIÓN CLIENTE',
  'FINANCIACIÓN DEALER - FINANCIACIÓN CLIENTE',
  'LEASING',
  'PLAN CHEQUE',
  'PLAN CHEQUE - BANCO',
  'PLAN CHEQUE - CANJE',
  'PLAN CHEQUE - CONTADO',
  'PLAN CHEQUE - DEALER',
  'PLAN CHEQUE - FINANCIACIÓN CLIENTE',
  'WHOLESALES',
]
const CONCEPTOS = [
  'Contado',
  'Transferencia Seña',
  'Plan Cheque',
  'Crédito Bancario',
  'Mutuo USD',
  'Crédito Retail',
  'Canje de Cereal',
  'Leasing',
  'Factura de Comisión',
]
const BANCOS = [
  'Banco BICE',
  'Banco Credicoop',
  'Banco de La Pampa',
  'Banco Galicia',
  'Banco Patagonia',
  'Banco Santander Rio',
  'BBVA Banco Francés',
  'GST',
]
const PLAZOS = ['30 días', '60 días', '90 días', '120 días', '12 Cuotas', '24 Cuotas', 'A Convenir']

/** El contrato: un PDF o una foto del papel firmado. */
const ACEPTA_CONTRATO = '.pdf,.jpg,.jpeg,.png'

const VACIO: AltaPedido = {
  cuentaId: '',
  cuentaNombre: '',
  equipoId: '',
  /* Compra es lo que se pide casi siempre; concesión es la excepción. */
  tipoPedido: TIPO_PEDIDO.COMPRA,
  pedidoPara: '',
  /* La factura inmediata es la regla: diferida se elige a propósito. */
  tipoFactura: TIPO_FACTURA.INMEDIATA,
  clientes: [],
  condicionVenta: '',
  banco: '',
  plazo: '',
  conceptoPago: '',
  descuentoEspecial: null,
  observacionEspecial: '',
  preciosClienteFinal: {},
  renglones: [],
}

const PASOS = ['El pedido', 'Los tractores', 'El pago', 'Revisar y mandar']

interface Props {
  /** Sus equipos de monday: de ahí sale de qué concesionario es. */
  equipos: EquipoMonday[]
  /** Su concesionario según la Lista Blanca: manda sobre los equipos de monday. */
  propio?: ConcesionarioPropio
  /** Administración carga a nombre de cualquier concesionario. */
  esAdministracion: boolean
  /** El usuario de monday que carga. Queda como comercial del pedido y recibe los avisos. */
  comercialId?: string
  /** Después de mandar, para ir directo a seguirlo. */
  onIrAMisPedidos: () => void
}

export function CrearPedido({ equipos, propio, esAdministracion, comercialId = '', onIrAMisPedidos }: Props) {
  const [paso, setPaso] = useState(1)
  const [cuentas, setCuentas] = useState<CuentaCrm[]>([])
  const [catalogo, setCatalogo] = useState<ProductoDeCatalogo[]>([])
  const [descuentos, setDescuentos] = useState<DescuentoConfigurado[]>([])
  const [especial, setEspecial] = useState<OperatoriaEspecial | null>(null)
  const [condicionesFiscales, setCondicionesFiscales] = useState<string[]>([])
  /** Los pedidos ya cargados: de ahí sale cuántas concesiones tiene abiertas. */
  const [pedidos, setPedidos] = useState<PedidoLeido[]>([])
  const [sinPedidos, setSinPedidos] = useState(false)

  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [listo, setListo] = useState<ResultadoPedido | null>(null)
  /** Si al mandarlo la línea no alcanzaba: el aviso se repite en la pantalla de cargado. */
  const [listoSinLinea, setListoSinLinea] = useState(false)

  const [datos, setDatos] = useState<AltaPedido>(VACIO)
  const [contrato, setContrato] = useState<File | null>(null)
  /** Lo que se está tipeando, tal cual: el número se lee de acá. */
  const [textoEspecial, setTextoEspecial] = useState('')
  const [textoPrecios, setTextoPrecios] = useState<Record<string, string>>({})
  /** Se intentó seguir o mandar con la operatoria especial sin observaciones. */
  const [errorObservacion, setErrorObservacion] = useState(false)
  const [detalle, setDetalle] = useState<ProductoDeCatalogo | null>(null)
  const [foto, setFoto] = useState(0)

  const recargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [c, cat, conf, et] = await Promise.all([
        cuentasDelCrm(),
        catalogoDeVenta(),
        configuracionDeContado(),
        etiquetasDelCrm(),
      ])
      setCuentas(c)
      setCondicionesFiscales(et.condicionFiscal)
      setCatalogo(cat.filter((p) => p.vigente))
      setDescuentos(conf.descuentos)
      setEspecial(conf.especial)
    } catch (e) {
      setError(
        e instanceof SinAcceso
          ? 'la app tiene que abrirse desde monday para leer el catálogo.'
          : mensaje(e),
      )
    } finally {
      setCargando(false)
    }
    /* Los pedidos sólo hacen falta para contar las concesiones: si no se pueden leer, se sigue
       igual y la concesión queda bloqueada en vez de ofrecerse sin saber si hay lugar. */
    try {
      setPedidos(await pedidosCargados(500))
      setSinPedidos(false)
    } catch {
      setSinPedidos(true)
    }
  }, [])

  useEffect(() => {
    void recargar()
  }, [recargar])

  /* Los concesionarios que puede usar: el suyo (por su equipo de monday) o todos si es de
     Administración. Con uno solo, queda elegido. */
  const elegibles = useMemo(
    () => concesionariosElegibles(cuentas, equipos, esAdministracion, propio),
    [cuentas, equipos, esAdministracion, propio],
  )

  useEffect(() => {
    if (!datos.cuentaId && elegibles.length === 1) {
      const e = elegibles[0]
      setDatos((d) => ({ ...d, cuentaId: e.cuenta.id, cuentaNombre: e.cuenta.nombre, equipoId: e.equipoId }))
    }
  }, [elegibles, datos.cuentaId])

  const miConcesionario = cuentas.find((c) => c.id === datos.cuentaId) ?? null
  const concesion = esConcesion(datos)
  const directa = esVentaDirecta(datos)
  const pago = pagoDelPedido(datos)
  const contado = esContado(pago)
  /* "BANCO" aparece suelto y dentro de combinaciones: alcanza con que la condición lo mencione. */
  const pideBanco = directa && !concesion && datos.condicionVenta.toUpperCase().includes('BANCO')

  /* La concesión sólo si el concesionario tiene tope y le queda lugar. */
  const concesiones = useMemo(
    () => concesionesDe(miConcesionario, pedidos),
    [miConcesionario, pedidos],
  )
  const puedeConcesion = concesiones.puede && !sinPedidos

  /* Si cambia el concesionario (Administración) y el nuevo no puede pedir en concesión, vuelve a
     compra: un pedido no puede quedar en una opción que ya no se ofrece. */
  useEffect(() => {
    if (concesion && !cargando && !puedeConcesion) {
      setDatos((d) => ({ ...d, tipoPedido: TIPO_PEDIDO.COMPRA }))
    }
  }, [concesion, cargando, puedeConcesion])

  const renglones = useMemo(
    () => calcularRenglones(datos, descuentos, especial),
    [datos, descuentos, especial],
  )
  const efectivos = useMemo(
    () => descuentosDelPedido(datos, descuentos, especial).descuentos,
    [datos, descuentos, especial],
  )
  const totales = useMemo(() => totalesDePedido(renglones), [renglones])
  /* Sólo los precios al cliente que están dentro del rango: uno mal tipeado no se suma. */
  const venta = useMemo(
    () => totalesVentaDirecta(renglones.filter((r) => !problemaClienteFinal(r))),
    [renglones],
  )
  const faltan = faltaParaElPedido(datos, renglones, { conContrato: Boolean(contrato), especial })
  const terceros = cuentas.filter((c) => datos.clientes.some((x) => x.id === c.id))
  const credito = lineaDeCredito(miConcesionario, totales, concesion)

  /* La Operatoria Especial: tildada, se tipea el porcentaje entre 0 y el tope de Configuración. */
  const usaEspecial = datos.descuentoEspecial != null
  const faltaObservacion = usaEspecial && contado && !concesion && !datos.observacionEspecial.trim()
  const especialInvalido =
    usaEspecial &&
    especial != null &&
    (aNumero(textoEspecial) == null ||
      (aNumero(textoEspecial) ?? 0) < 0 ||
      (aNumero(textoEspecial) ?? 0) > especial.maximo)

  /* Salir a mitad de camino pregunta antes: mientras se escribe en monday —el pedido son tres
     tableros— y con un pedido armado sin mandar, porque lo elegido vive sólo en esta pantalla. */
  const armado = Boolean(datos.pedidoPara) || datos.renglones.length > 0 || Boolean(contrato)
  useSalidaProtegida(
    enviando
      ? 'Se está cargando el pedido en monday: el pedido, sus renglones y una unidad por tractor. Si salís ahora puede quedar cargado a medias, y no vas a ver qué faltó.'
      : armado && !listo
        ? 'Tenés un pedido a medio armar que todavía no mandaste. Si salís, se pierde todo lo que cargaste.'
        : null,
  )

  const cantidadDe = (id: string) => datos.renglones.find((r) => r.productoId === id)?.cantidad ?? 0
  const productoDe = (id: string) => catalogo.find((p) => p.id === id)

  const cambiarCantidad = (p: ProductoDeCatalogo, delta: number) => {
    setDatos((d) => {
      const actual = d.renglones.find((r) => r.productoId === p.id)
      const nueva = (actual?.cantidad ?? 0) + delta
      if (nueva <= 0) return { ...d, renglones: d.renglones.filter((r) => r.productoId !== p.id) }
      if (actual) {
        return {
          ...d,
          renglones: d.renglones.map((r) => (r.productoId === p.id ? { ...r, cantidad: nueva } : r)),
        }
      }
      return {
        ...d,
        renglones: [
          ...d.renglones,
          { productoId: p.id, nombre: p.nombre, modelo: p.modelo, cantidad: nueva, precioLista: p.precio, iva: p.iva },
        ],
      }
    })
  }

  const cambiarPrecioClienteFinal = (productoId: string, texto: string) => {
    setTextoPrecios((t) => ({ ...t, [productoId]: texto }))
    const n = aNumero(texto)
    setDatos((d) => {
      const precios = { ...d.preciosClienteFinal }
      if (n == null) delete precios[productoId]
      else precios[productoId] = n
      return { ...d, preciosClienteFinal: precios }
    })
  }

  const cambiarEspecial = (texto: string) => {
    setTextoEspecial(texto)
    const n = aNumero(texto)
    setDatos((d) => ({ ...d, descuentoEspecial: n ?? 0 }))
  }

  const empezarOtro = () => {
    setListo(null)
    setListoSinLinea(false)
    setErrorEnvio(null)
    setPaso(1)
    setContrato(null)
    setTextoEspecial('')
    setTextoPrecios({})
    setErrorObservacion(false)
    /* El concesionario queda: el próximo pedido casi siempre es del mismo. */
    setDatos({ ...VACIO, cuentaId: datos.cuentaId, cuentaNombre: datos.cuentaNombre, equipoId: datos.equipoId })
    /* Uno nuevo en concesión cambia la cuenta de las que quedan. */
    void recargar()
  }

  const mandar = async () => {
    if (faltaObservacion) {
      setErrorObservacion(true)
      setErrorEnvio('Se requieren las observaciones para la operatoria especial.')
      return
    }
    setEnviando(true)
    setErrorEnvio(null)
    try {
      const r = await crearPedido({ ...datos, comercialId }, descuentos, especial, concesion ? contrato : null)
      setListoSinLinea(credito.insuficiente)
      setListo(r)
    } catch (e) {
      setErrorEnvio(mensaje(e))
    } finally {
      setEnviando(false)
    }
  }

  const usadoSiSeAprueba =
    credito.asignado > 0
      ? Math.min(100, Math.round(((credito.asignado - credito.quedaria) / credito.asignado) * 100))
      : 100

  /** El aviso de línea insuficiente. No bloquea: el pedido se carga igual. */
  const avisoSinLinea = (
    <div className="aviso aviso--error">
      <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
      <span>
        <b>Tu línea de crédito no alcanza para este pedido.</b> Se va a registrar igual, pero BERGER
        no lo va a poder aprobar hasta que regularices la línea: necesitás {aMoneda(credito.monto)} con
        IVA y tenés {aMoneda(Math.max(0, credito.disponible))} disponibles.
      </span>
    </div>
  )

  /* ============ El costado: el pedido que se va formando ============ */
  const resumen = (editable: boolean) => (
    <div className="cp-resumen">
      <div className="cp-resumen-head">
        <span>
          <i className="fa-solid fa-receipt" aria-hidden="true" /> Tu pedido
        </span>
        <span className="chip chip--gris">
          {totales.unidades} unidad{totales.unidades === 1 ? '' : 'es'}
        </span>
      </div>

      {renglones.length === 0 ? (
        <p className="cp-resumen-vacio">Todavía no agregaste ningún tractor.</p>
      ) : (
        <ul className="cp-renglones">
          {renglones.map((r) => {
            const p = productoDe(r.productoId)
            return (
              <li key={r.productoId} className="cp-renglon">
                <span className="cp-renglon-nom">
                  <b>{r.modelo || r.nombre}</b>
                  <small>
                    {aMoneda(r.precio.facturaSinIva)} c/u + IVA {p?.iva ?? 0}%
                  </small>
                  {r.clienteFinal != null && !problemaClienteFinal(r) && (
                    <small className="cp-renglon-cf">Al cliente: {aMoneda(r.clienteFinal)} c/u</small>
                  )}
                </span>
                {editable && p ? (
                  <span className="contador contador--chico">
                    <button type="button" aria-label="Uno menos" onClick={() => cambiarCantidad(p, -1)}>
                      −
                    </button>
                    <b>{r.cantidad}</b>
                    <button type="button" aria-label="Uno más" onClick={() => cambiarCantidad(p, 1)}>
                      +
                    </button>
                  </span>
                ) : (
                  <span className="cp-renglon-cant">× {r.cantidad}</span>
                )}
                <span className="cp-renglon-plata">{aMoneda(r.precio.facturaSinIva * r.cantidad)}</span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="cp-totales">
        <div className="pedido-linea">
          <span>Lista s/IVA</span>
          <b>{aMoneda(totales.listaSinIva)}</b>
        </div>
        {contado && totales.listaSinIva > totales.contadoSinIva && (
          <div className="pedido-linea pedido-linea--resta">
            <span>
              Desc. contado ({descuentoTotalEnPorcentaje(efectivos)}%)
              {usaEspecial && (datos.descuentoEspecial ?? 0) > 0 ? ' · con especial' : ''}
            </span>
            <b>− {aMoneda(totales.listaSinIva - totales.contadoSinIva)}</b>
          </div>
        )}
        <div className="pedido-linea">
          <span>IVA</span>
          <b>{aMoneda(totales.facturaConIva - totales.facturaSinIva)}</b>
        </div>
        <div className="pedido-linea pedido-linea--total">
          <span>{concesion ? 'Valor s/IVA (no se factura)' : 'A facturar s/IVA'}</span>
          <span>{aMoneda(totales.facturaSinIva)}</span>
        </div>
        <div className="pedido-linea pedido-linea--suave">
          <span>Con IVA</span>
          <b>{aMoneda(totales.facturaConIva)}</b>
        </div>
        {/* La venta directa factura al cliente final al precio que puso el concesionario. */}
        {directa && venta.clienteFinal > 0 && (
          <>
            <div className="pedido-linea pedido-linea--total">
              <span>Factura al cliente final s/IVA</span>
              <span>{aMoneda(venta.clienteFinal)}</span>
            </div>
            <div className="pedido-linea pedido-linea--suave">
              <span>Tu comisión</span>
              <b>{aMoneda(venta.comision)}</b>
            </div>
          </>
        )}
      </div>

      {/* El crédito, resumido: lo que importa mientras se arma es si entra o no. */}
      {miConcesionario && (
        <div
          className={`linea-credito linea-credito--${concesion ? 'verde' : credito.insuficiente ? 'rojo' : tonoDeCredito(usadoSiSeAprueba)}`}
        >
          {concesion ? (
            <span>
              <i className="fa-solid fa-handshake" aria-hidden="true" /> En concesión: no usa línea
              de crédito
            </span>
          ) : credito.asignado > 0 ? (
            <>
              <span>
                Línea disponible <b>{aMoneda(credito.disponible)}</b>
              </span>
              <span>
                Con este pedido queda{' '}
                <b className={credito.quedaria < 0 ? 'rojo' : undefined}>{aMoneda(credito.quedaria)}</b>
              </span>
              {credito.insuficiente && <span className="rojo">No alcanza: BERGER no podrá aprobarlo</span>}
            </>
          ) : (
            <span>Sin línea de crédito asignada{totales.unidades > 0 ? ': BERGER no podrá aprobarlo' : ''}</span>
          )}
        </div>
      )}
    </div>
  )

  /* ============ Pedido cargado ============ */
  if (listo) {
    return (
      <div className="scroll">
        <div className="view">
          <div className="cp-exito">
            <span className="cp-exito-ic">
              <i className="fa-solid fa-circle-check" aria-hidden="true" />
            </span>
            <h2 className="cp-exito-tit">¡Pedido cargado!</h2>
            <p className="cp-exito-det">
              <b>{listo.nombre}</b> quedó cargado con {listo.unidades} unidad
              {listo.unidades === 1 ? '' : 'es'}
              {concesion ? ', en concesión' : ''}. Ahora espera la aprobación de BERGER —comercial y
              financiera—, y te avisamos en Novedades cuando cambie.
            </p>
            {/* El aviso de la línea va acá también: es lo último que lee antes de irse. */}
            {listoSinLinea && (
              <div className="aviso aviso--error">
                <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                <span>
                  <b>Atención:</b> tu línea de crédito no alcanza para este pedido. Quedó registrado,
                  pero BERGER no lo va a poder aprobar hasta que regularices la línea.
                </span>
              </div>
            )}
            <div className="cp-exito-cifras">
              <span>
                <small>{concesion ? 'Valor s/IVA' : 'A facturar s/IVA'}</small>
                <b>{aMoneda(listo.totales.facturaSinIva)}</b>
              </span>
              {listo.ventaDirecta ? (
                <>
                  <span>
                    <small>Al cliente final s/IVA</small>
                    <b>{aMoneda(listo.ventaDirecta.clienteFinal)}</b>
                  </span>
                  <span>
                    <small>Tu comisión</small>
                    <b>{aMoneda(listo.ventaDirecta.comision)}</b>
                  </span>
                </>
              ) : (
                <span>
                  <small>Con IVA</small>
                  <b>{aMoneda(listo.totales.facturaConIva)}</b>
                </span>
              )}
              <span>
                <small>{concesion ? 'Contrato' : 'Forma de pago'}</small>
                <b>{concesion ? (listo.contratoAdjunto ? 'Adjunto' : 'Falta adjuntar') : pago || '—'}</b>
              </span>
            </div>
            {listo.advertencias.length > 0 && (
              <div className="aviso aviso--alerta">
                <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                <span>
                  Algo no se pudo hacer:
                  <ul className="lista-compacta">
                    {listo.advertencias.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </span>
              </div>
            )}
            <div className="cp-exito-botones">
              <button type="button" className="btn btn--borde" onClick={empezarOtro}>
                <i className="fa-solid fa-cart-plus" aria-hidden="true" /> Cargar otro pedido
              </button>
              <button type="button" className="btn btn--primario" onClick={onIrAMisPedidos}>
                <i className="fa-solid fa-list-check" aria-hidden="true" /> Ir a mis pedidos
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const preciosOk = !directa || renglones.every((r) => !problemaClienteFinal(r))
  const puedeSeguir =
    !cargando &&
    ((paso === 1 &&
      Boolean(datos.cuentaId) &&
      Boolean(datos.tipoPedido) &&
      Boolean(datos.pedidoPara) &&
      (concesion ? Boolean(contrato) : Boolean(datos.tipoFactura)) &&
      (!directa || terceros.length > 0)) ||
      (paso === 2 && datos.renglones.length > 0) ||
      (paso === 3 && (concesion || Boolean(pago)) && !especialInvalido && preciosOk))

  return (
    <div className="scroll">
      <div className="view">
        <div className="cp-head">
          <span className="sec-txt">
            <span className="sec-tit">Crear pedido</span>
            <span className="sec-det">Cuatro pasos: el pedido, los tractores, el pago y mandar.</span>
          </span>
          <ol className="pasos">
            {PASOS.map((p, i) => (
              <li
                key={p}
                className={`paso${i + 1 === paso ? ' paso--actual' : i + 1 < paso ? ' paso--hecho' : ''}`}
              >
                <span className="paso-num">{i + 1 < paso ? '✓' : i + 1}</span>
                <span className="paso-txt">{i === 2 && concesion ? 'Condiciones' : p}</span>
              </li>
            ))}
          </ol>
        </div>

        {error && (
          <div className="aviso aviso--error">
            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
            <span>No se pudo leer el catálogo: {error}</span>
          </div>
        )}
        {errorEnvio && (
          <div className="aviso aviso--error">
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
            <span>No se pudo cargar el pedido: {errorEnvio}</span>
          </div>
        )}
        {/* Un concesionario que no está en el equipo de ninguno no tiene a nombre de quién cargar.
            Se dice qué falta en vez de mostrar una lista vacía. */}
        {!cargando && !esAdministracion && elegibles.length === 0 && (
          <div className="aviso aviso--alerta">
            <i className="fa-solid fa-users-slash" aria-hidden="true" />
            <span>
              Tu usuario no está en el equipo de ningún concesionario en monday, así que no hay a
              nombre de quién cargar el pedido. Pedile a BERGER que te sume al equipo de tu
              concesionario.
            </span>
          </div>
        )}

        <div className="cp-grid">
          <div className="cp-principal">
            {/* ============ 1. Qué clase de pedido es ============ */}
            {paso === 1 && (
              <div className="card cp-card">
                <div className="cp-card-tit">
                  <i className="fa-solid fa-file-invoice" aria-hidden="true" /> Qué clase de pedido es
                </div>
                <div className="cp-campos">
                  <div className="campo">
                    <span className="campo-lbl">Concesionario</span>
                    {esAdministracion && elegibles.length > 1 ? (
                      <Desplegable
                        valor={datos.cuentaId}
                        opciones={elegibles.map((e) => ({
                          valor: e.cuenta.id,
                          rotulo: e.cuenta.nombre,
                          detalle: e.cuenta.cuit ? `CUIT ${e.cuenta.cuit}` : '',
                        }))}
                        vacio="Elegir…"
                        bloqueado={cargando}
                        buscable
                        onCambiar={(v) => {
                          const e = elegibles.find((x) => x.cuenta.id === v)
                          setDatos({
                            ...datos,
                            cuentaId: v,
                            cuentaNombre: e?.cuenta.nombre ?? '',
                            equipoId: e?.equipoId ?? '',
                            clientes: [],
                          })
                        }}
                      />
                    ) : (
                      <span className="cp-fijo">
                        <i className="fa-solid fa-store" aria-hidden="true" />{' '}
                        {miConcesionario?.nombre ?? (cargando ? 'Buscando tu concesionario…' : '—')}
                      </span>
                    )}
                    {esAdministracion && (
                      <span className="campo-ayuda">
                        Administración: el pedido queda a nombre del concesionario elegido.
                      </span>
                    )}
                  </div>

                  {/* Lo primero: compra o concesión. Cambia todo lo que sigue. */}
                  <div className="campo">
                    <span className="campo-lbl">
                      Tipo de pedido <span className="campo-req">· obligatorio</span>
                    </span>
                    {/* Viene en COMPRA: la otra opción se ve recién al abrirlo. CONCESIÓN aparece
                        sólo si el concesionario tiene tope y le queda lugar. */}
                    <Desplegable
                      valor={datos.tipoPedido}
                      opciones={puedeConcesion ? [TIPO_PEDIDO.COMPRA, TIPO_PEDIDO.CONCESION] : [TIPO_PEDIDO.COMPRA]}
                      sinVacio
                      onCambiar={(v) =>
                        setDatos({
                          ...datos,
                          tipoPedido: v,
                          /* En concesión no hay pago: lo que se haya elegido no se arrastra. */
                          ...(v === TIPO_PEDIDO.CONCESION
                            ? {
                                condicionVenta: '',
                                banco: '',
                                conceptoPago: '',
                                plazo: '',
                                descuentoEspecial: null,
                                observacionEspecial: '',
                              }
                            : {}),
                        })
                      }
                    />
                    <span className="campo-ayuda">
                      {miConcesionario && !sinPedidos
                        ? concesiones.limite > 0
                          ? `Concesión: ${concesiones.enUso} de ${concesiones.limite} pedidos en concesión en uso${concesiones.puede ? '.' : ' — llegaste al tope.'}`
                          : 'Concesión: este concesionario no tiene pedidos en concesión habilitados.'
                        : sinPedidos
                          ? 'No se pudieron leer tus pedidos, así que la concesión queda bloqueada por ahora.'
                          : 'En concesión el tractor se lleva sin pagarlo ni facturarlo.'}
                    </span>
                  </div>

                  <div className="campo">
                    <span className="campo-lbl">
                      Pedido para <span className="campo-req">· obligatorio</span>
                    </span>
                    <Desplegable
                      valor={datos.pedidoPara}
                      opciones={[PEDIDO_PARA.STOCK, PEDIDO_PARA.DIRECTA]}
                      vacio="Elegir…"
                      onCambiar={(v) =>
                        setDatos({
                          ...datos,
                          pedidoPara: v,
                          clientes: v === PEDIDO_PARA.DIRECTA ? datos.clientes : [],
                          condicionVenta: '',
                          banco: '',
                          conceptoPago: '',
                          descuentoEspecial: null,
                        })
                      }
                    />
                    <span className="campo-ayuda">
                      {datos.pedidoPara === PEDIDO_PARA.DIRECTA
                        ? 'BERGER le factura directo al cliente final, al precio que vos pongas.'
                        : datos.pedidoPara === PEDIDO_PARA.STOCK
                          ? 'Para el stock de ustedes: BERGER les factura a ustedes.'
                          : 'Stock es para ustedes; venta directa, para un cliente final.'}
                    </span>
                  </div>

                  {/* La factura en compra; en concesión, en su lugar, el contrato. */}
                  {concesion ? (
                    <div className="campo">
                      <span className="campo-lbl">
                        Contrato de concesión <span className="campo-req">· obligatorio</span>
                      </span>
                      <ZonaArchivo
                        archivo={contrato}
                        onElegir={setContrato}
                        acepta={ACEPTA_CONTRATO}
                        titulo="Arrastrá el contrato firmado o hacé clic para buscarlo"
                      />
                      <span className="campo-ayuda">
                        En concesión te llevás el tractor sin pagarlo y sin factura ahora. El contrato
                        queda adjunto en el pedido.
                      </span>
                    </div>
                  ) : (
                    <div className="campo">
                      <span className="campo-lbl">
                        Tipo de factura <span className="campo-req">· obligatorio</span>
                      </span>
                      <Desplegable
                        valor={datos.tipoFactura}
                        opciones={[TIPO_FACTURA.INMEDIATA, TIPO_FACTURA.DIFERIDA]}
                        sinVacio
                        onCambiar={(v) => setDatos({ ...datos, tipoFactura: v })}
                      />
                    </div>
                  )}

                  {/* A quién se le vende, sólo en venta DIRECTA: ahí BERGER le factura al cliente. */}
                  {directa && miConcesionario && (
                    <ClienteFinal
                      cuentas={cuentas}
                      condicionesFiscales={condicionesFiscales}
                      elegidos={datos.clientes}
                      /* Con la función y no con `datos`: el alta de un cliente nuevo espera a
                         monday, y para cuando vuelve `datos` puede ser el de un render anterior. */
                      onCambiar={(clientes) => setDatos((d) => ({ ...d, clientes }))}
                      excluirId={datos.cuentaId}
                      cargando={cargando}
                      onCuentaNueva={(c) => setCuentas((v) => [...v, c])}
                    />
                  )}
                </div>
              </div>
            )}

            {/* ============ 2. Los tractores ============ */}
            {paso === 2 && (
              <div className="card cp-card">
                <div className="cp-card-tit">
                  <i className="fa-solid fa-tractor" aria-hidden="true" /> Elegí los tractores
                  <span className="chip chip--indigo">{catalogo.length} modelos</span>
                </div>
                <CatalogoTractores
                  productos={catalogo}
                  cantidadDe={cantidadDe}
                  onCambiarCantidad={cambiarCantidad}
                  onVerDetalle={(p) => {
                    setDetalle(p)
                    setFoto(0)
                  }}
                  cargando={cargando}
                />
              </div>
            )}

            {/* ============ 3. El pago ============ */}
            {paso === 3 && (
              <div className="card cp-card">
                <div className="cp-card-tit">
                  <i className="fa-solid fa-money-bill-wave" aria-hidden="true" />{' '}
                  {concesion ? 'Condiciones de la concesión' : 'Cómo se paga'}
                </div>

                {concesion ? (
                  <div className="aviso aviso--neutro">
                    <i className="fa-solid fa-handshake" aria-hidden="true" />
                    <span>
                      En concesión no hay forma de pago ni factura en este momento: el tractor se
                      lleva con el contrato que adjuntaste
                      {contrato ? ` (${contrato.name})` : ''}.
                    </span>
                  </div>
                ) : (
                  <div className="cp-campos">
                    {directa ? (
                      <div className="campo">
                        <span className="campo-lbl">
                          Condición de venta <span className="campo-req">· obligatorio</span>
                        </span>
                        <Desplegable
                          valor={datos.condicionVenta}
                          opciones={CONDICIONES}
                          vacio="Elegir…"
                          buscable
                          onCambiar={(v) =>
                            setDatos({
                              ...datos,
                              condicionVenta: v,
                              banco: v.toUpperCase().includes('BANCO') ? datos.banco : '',
                              descuentoEspecial: esContado(v) ? datos.descuentoEspecial : null,
                            })
                          }
                        />
                        <span className="campo-ayuda">Cómo paga el cliente final.</span>
                      </div>
                    ) : (
                      <div className="campo">
                        <span className="campo-lbl">
                          Concepto de pago <span className="campo-req">· obligatorio</span>
                        </span>
                        <Desplegable
                          valor={datos.conceptoPago}
                          opciones={CONCEPTOS}
                          vacio="Elegir…"
                          onCambiar={(v) =>
                            setDatos({
                              ...datos,
                              conceptoPago: v,
                              descuentoEspecial: esContado(v) ? datos.descuentoEspecial : null,
                            })
                          }
                        />
                        <span className="campo-ayuda">Cómo pagan ustedes la compra de stock.</span>
                      </div>
                    )}

                    {pideBanco && (
                      <div className="campo">
                        <span className="campo-lbl">Banco</span>
                        <Desplegable
                          valor={datos.banco}
                          opciones={BANCOS}
                          vacio="Elegir…"
                          buscable
                          onCambiar={(v) => setDatos({ ...datos, banco: v })}
                        />
                      </div>
                    )}

                    <div className="campo">
                      <span className="campo-lbl">Plazo propuesto</span>
                      <Desplegable
                        valor={datos.plazo}
                        opciones={PLAZOS}
                        vacio="Elegir…"
                        onCambiar={(v) => setDatos({ ...datos, plazo: v })}
                      />
                      <span className="campo-ayuda">Es una propuesta: BERGER lo confirma al aprobar.</span>
                    </div>
                  </div>
                )}

                {!concesion && contado && (descuentos.length > 0 || especial) && (
                  <div className="descuentos">
                    <span className="descuentos-tit">
                      <i className="fa-solid fa-tags" aria-hidden="true" /> Descuentos por contado
                    </span>
                    <div className="descuentos-lista">
                      {descuentos.map((d) => (
                        <span key={d.orden} className="descuento">
                          <b>{d.porcentaje}%</b>
                          <small>Descuento {d.orden}</small>
                        </span>
                      ))}
                      {usaEspecial && (datos.descuentoEspecial ?? 0) > 0 && !especialInvalido && (
                        <span className="descuento descuento--especial">
                          <b>{datos.descuentoEspecial}%</b>
                          <small>Especial</small>
                        </span>
                      )}
                      <span className="descuento descuento--total">
                        <b>{descuentoTotalEnPorcentaje(efectivos)}%</b>
                        <small>en total</small>
                      </span>
                    </div>

                    {/* La Operatoria Especial: una casillita. Tildada, aparece el cuarto descuento,
                        que se tipea entre 0 y el tope que puso BERGER en Configuración. */}
                    {especial && (
                      <div className="especial">
                        <label className="especial-check">
                          <input
                            type="checkbox"
                            checked={usaEspecial}
                            onChange={(e) => {
                              setTextoEspecial('')
                              setErrorObservacion(false)
                              setDatos({
                                ...datos,
                                descuentoEspecial: e.target.checked ? 0 : null,
                                observacionEspecial: e.target.checked ? datos.observacionEspecial : '',
                              })
                            }}
                          />
                          Operatoria especial
                        </label>
                        {usaEspecial && (
                          <span className="especial-campo">
                            <input
                              className={`input input--chico especial-input${especialInvalido ? ' input--error' : ''}`}
                              inputMode="decimal"
                              placeholder="0"
                              autoFocus
                              value={textoEspecial}
                              onChange={(e) => cambiarEspecial(e.target.value)}
                            />
                            <span>% (de 0 a {especial.maximo}%)</span>
                          </span>
                        )}
                        {especialInvalido && (
                          <span className="campo-ayuda campo-ayuda--falta">
                            El descuento especial tiene que estar entre 0% y {especial.maximo}%.
                          </span>
                        )}
                      </div>
                    )}
                    {/* Con la casilla tildada hay que decir por qué: queda en el pedido. */}
                    {usaEspecial && (
                      <label className="campo especial-obs">
                        <span className="campo-lbl">
                          Observaciones de la operatoria especial{' '}
                          <span className="campo-req">· obligatorio</span>
                        </span>
                        <textarea
                          className={`input textarea${errorObservacion && !datos.observacionEspecial.trim() ? ' input--error' : ''}`}
                          rows={2}
                          placeholder="Por qué este pedido va con operatoria especial…"
                          value={datos.observacionEspecial}
                          onChange={(e) => {
                            setErrorObservacion(false)
                            setDatos({ ...datos, observacionEspecial: e.target.value })
                          }}
                        />
                        {errorObservacion && !datos.observacionEspecial.trim() && (
                          <span className="campo-ayuda campo-ayuda--falta">
                            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" /> Se
                            requieren las observaciones para la operatoria especial.
                          </span>
                        )}
                      </label>
                    )}
                    <span className="campo-ayuda">Descuentos de Contado se aplican en cascada</span>
                  </div>
                )}

                {/* Venta directa: a cuánto le vende cada tractor al cliente final. Entre lo que
                    BERGER le factura (el piso) y la lista (el techo), por UNIDAD. */}
                {directa && renglones.length > 0 && (
                  <div className="precios-cf">
                    <span className="descuentos-tit">
                      <i className="fa-solid fa-user-tag" aria-hidden="true" /> Precio de venta al
                      cliente final <span className="campo-req">· obligatorio</span>
                    </span>
                    <div className="precios-cf-tabla">
                      <span className="precios-cf-cab">Modelo</span>
                      <span className="precios-cf-cab">A facturar x unidad</span>
                      <span className="precios-cf-cab">Lista x unidad</span>
                      <span className="precios-cf-cab">Tu precio x unidad s/IVA</span>
                      {renglones.map((r) => {
                        const { minimo, maximo } = rangoClienteFinal(r.precio)
                        const texto = textoPrecios[r.productoId] ?? ''
                        const problema = texto.trim() ? problemaClienteFinal(r) : ''
                        return (
                          <div key={r.productoId} className="precios-cf-fila">
                            <span className="precios-cf-mod">
                              <b>{r.modelo || r.nombre}</b>
                              <small>× {r.cantidad}</small>
                            </span>
                            <span className="precios-cf-num">{aMoneda(minimo)}</span>
                            <span className="precios-cf-num">{aMoneda(maximo)}</span>
                            <span className="precios-cf-in">
                              <input
                                className={`input input--chico${problema ? ' input--error' : ''}`}
                                inputMode="decimal"
                                placeholder={aMoneda(maximo)}
                                value={texto}
                                onChange={(e) => cambiarPrecioClienteFinal(r.productoId, e.target.value)}
                              />
                              {problema && (
                                <small className="campo-ayuda--falta">
                                  {problema === 'supera el precio de lista'
                                    ? `Máximo ${aMoneda(maximo)}`
                                    : `Mínimo ${aMoneda(minimo)}`}
                                </small>
                              )}
                              {!problema && r.clienteFinal != null && (
                                <small>
                                  Comisión {aMoneda(r.comision)}
                                  {r.cantidad > 1 ? ` (${r.cantidad} u.)` : ''}
                                </small>
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <span className="campo-ayuda">
                      Por unidad y sin IVA: como mucho el precio de lista, como poco lo que BERGER te
                      factura con los descuentos. BERGER le factura al cliente final con este precio.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ============ 4. Revisar y mandar ============ */}
            {paso === 4 && (
              <div className="card cp-card">
                <div className="cp-card-tit">
                  <i className="fa-solid fa-clipboard-check" aria-hidden="true" /> El pedido que se va a mandar
                </div>
                <dl className="datos-pares">
                  <div>
                    <dt>Concesionario</dt>
                    <dd>{datos.cuentaNombre || '—'}</dd>
                  </div>
                  <div>
                    <dt>Tipo de pedido</dt>
                    <dd>{concesion ? 'Concesión' : 'Compra'}</dd>
                  </div>
                  <div>
                    <dt>Pedido para</dt>
                    <dd>{datos.pedidoPara || '—'}</dd>
                  </div>
                  {concesion ? (
                    <div>
                      <dt>Contrato</dt>
                      <dd>{contrato ? `${contrato.name} · ${pesoArchivo(contrato.size)}` : '—'}</dd>
                    </div>
                  ) : (
                    <div>
                      <dt>Factura</dt>
                      <dd>{datos.tipoFactura || '—'}</dd>
                    </div>
                  )}
                  {terceros.length > 0 && (
                    <div>
                      <dt>Cliente final</dt>
                      <dd>{terceros.map((c) => c.nombre).join(', ')}</dd>
                    </div>
                  )}
                  {!concesion && (
                    <div>
                      <dt>Forma de pago</dt>
                      <dd>{pago || '—'}</dd>
                    </div>
                  )}
                  {!concesion && contado && (
                    <div>
                      <dt>Política</dt>
                      <dd>
                        {usaEspecial && (datos.descuentoEspecial ?? 0) > 0
                          ? `${POLITICA_CONTADO.ESPECIAL} (${datos.descuentoEspecial}%)`
                          : POLITICA_CONTADO.ESTANDAR}
                      </dd>
                    </div>
                  )}
                  {!concesion && contado && usaEspecial && (
                    <div>
                      <dt>Observaciones</dt>
                      <dd>{datos.observacionEspecial.trim() || '—'}</dd>
                    </div>
                  )}
                  {datos.banco && (
                    <div>
                      <dt>Banco</dt>
                      <dd>{datos.banco}</dd>
                    </div>
                  )}
                  {datos.plazo && (
                    <div>
                      <dt>Plazo propuesto</dt>
                      <dd>{datos.plazo}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Unidades</dt>
                    <dd>
                      {totales.unidades} · {renglones.length} modelo{renglones.length === 1 ? '' : 's'}
                    </dd>
                  </div>
                  {directa && (
                    <div>
                      <dt>Al cliente final s/IVA</dt>
                      <dd>
                        {aMoneda(venta.clienteFinal)} · comisión {aMoneda(venta.comision)}
                      </dd>
                    </div>
                  )}
                </dl>
                {credito.insuficiente && avisoSinLinea}
                <div className="aviso aviso--neutro">
                  <i className="fa-solid fa-circle-info" aria-hidden="true" />
                  <span>
                    Al mandarlo se crea el pedido y <b>{totales.unidades}</b> unidad
                    {totales.unidades === 1 ? '' : 'es'} —una por tractor— para que BERGER las apruebe
                    y les asigne inventario.
                  </span>
                </div>
                {faltan.length > 0 && (
                  <span className="campo-ayuda campo-ayuda--falta">
                    <i className="fa-solid fa-lock" aria-hidden="true" /> Falta {faltan.join(', ')}.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* El costado: el crédito al empezar, después el pedido que se va formando. */}
          <aside className="cp-lado">
            {paso === 1 ? (
              miConcesionario ? (
                <FichaCuenta cuenta={miConcesionario} rotulo="Concesionario que pide" conCredito />
              ) : (
                <div className="cp-resumen">
                  <p className="cp-resumen-vacio">
                    {cargando ? 'Buscando tu concesionario…' : 'Elegí el concesionario para ver su línea de crédito.'}
                  </p>
                </div>
              )
            ) : (
              resumen(paso === 2)
            )}
          </aside>
        </div>

        {/* La barra de abajo: volver, cuánto va y qué sigue. */}
        <div className="barra-pasos">
          {paso > 1 ? (
            <button
              type="button"
              className="btn btn--texto btn--chico"
              disabled={enviando}
              onClick={() => setPaso(paso - 1)}
            >
              ← Volver
            </button>
          ) : (
            <span />
          )}
          <span className="barra-pasos-total">
            {totales.unidades > 0 ? (
              <>
                {totales.unidades} unidad{totales.unidades === 1 ? '' : 'es'} ·{' '}
                <b>{aMoneda(totales.facturaSinIva)}</b> + IVA
              </>
            ) : (
              'Todavía no agregaste ningún tractor'
            )}
          </span>
          {paso < 4 ? (
            <button
              type="button"
              className="btn btn--primario"
              disabled={!puedeSeguir}
              onClick={() => {
                /* Las observaciones no bloquean el botón: al intentar seguir se dice qué falta. */
                if (paso === 3 && faltaObservacion) {
                  setErrorObservacion(true)
                  return
                }
                setPaso(paso + 1)
              }}
            >
              Seguir →
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primario"
              disabled={enviando || faltan.length > 0}
              onClick={() => void mandar()}
            >
              <i className="fa-solid fa-paper-plane" aria-hidden="true" />{' '}
              {enviando ? 'Mandando…' : 'Mandar el pedido'}
            </button>
          )}
        </div>

        {/* La ficha completa de un tractor, con sus fotos, sin salir del catálogo. */}
        {detalle && (
          <>
            <button className="lateral-fondo" aria-label="Cerrar" onClick={() => setDetalle(null)} />
            <div className="ventanita ventanita--ancha" role="dialog" aria-modal="true">
              <div className="ventanita-head">
                <span>
                  {detalle.modelo || detalle.nombre}
                  {detalle.codigo && <small className="cp-detalle-cod"> {detalle.codigo}</small>}
                </span>
                <button type="button" onClick={() => setDetalle(null)} aria-label="Cerrar">
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
              <div className="ventanita-cuerpo ventanita-cuerpo--scroll cp-detalle">
                <div className="cp-detalle-foto">
                  {detalle.imagenes.length > 0 ? (
                    <>
                      <img src={detalle.imagenes[foto]} alt={detalle.modelo} />
                      {detalle.imagenes.length > 1 && (
                        <div className="cp-detalle-miniaturas">
                          {detalle.imagenes.map((u, i) => (
                            <button
                              key={u}
                              type="button"
                              className={i === foto ? 'activa' : undefined}
                              onClick={() => setFoto(i)}
                              aria-label={`Foto ${i + 1}`}
                            >
                              <img src={u} alt="" />
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="cp-detalle-sinfoto">
                      <i className="fa-solid fa-image" aria-hidden="true" /> Sin fotos cargadas
                    </span>
                  )}
                </div>
                <dl className="datos-pares cp-detalle-datos">
                  {[
                    ['Marca', detalle.marca],
                    ['Línea', detalle.linea],
                    ['Gama', detalle.gama],
                    ['Tracción', detalle.traccion],
                    ['Potencia', detalle.potenciaKw != null ? `${detalle.potenciaKw} kW` : ''],
                    ['Cilindrada', detalle.cilindrada != null ? `${detalle.cilindrada} cm³` : ''],
                    ['Rodado', detalle.rodado],
                    ['Precio de lista', `${aMoneda(detalle.precio)} + IVA ${detalle.iva}%`],
                  ]
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                </dl>
              </div>
              <div className="ventanita-pie">
                {cantidadDe(detalle.id) > 0 && (
                  <span className="campo-ayuda">Ya tenés {cantidadDe(detalle.id)} en el pedido.</span>
                )}
                <button type="button" className="btn btn--texto btn--chico" onClick={() => setDetalle(null)}>
                  Cerrar
                </button>
                <button
                  type="button"
                  className="btn btn--primario btn--chico"
                  onClick={() => {
                    cambiarCantidad(detalle, 1)
                    setDetalle(null)
                  }}
                >
                  <i className="fa-solid fa-plus" aria-hidden="true" /> Agregar al pedido
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
