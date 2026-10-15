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
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Desplegable } from '@/components/ui/Desplegable'
import { useSalidaProtegida } from '@/hooks/useSalidaProtegida'
import { concesionariosElegibles, type EquipoMonday } from '@/lib/concesionario'
import { importe as aMoneda } from '@/lib/format'
import { descuentoTotalEnPorcentaje, totalesDePedido, type DescuentoConfigurado } from '@/lib/precios'
import {
  catalogoDeVenta,
  descuentosDeContado,
  type ProductoDeCatalogo,
} from '@/services/monday/catalogoVenta'
import { esContado, TIPO_PEDIDO, TIPO_VENTA } from '@/services/monday/columns'
import { cuentasDelCrm, etiquetasDelCrm, type CuentaCrm } from '@/services/monday/crm'
import {
  calcularRenglones,
  crearPedido,
  faltaParaElPedido,
  pagoDelPedido,
  type AltaPedido,
  type ResultadoPedido,
} from '@/services/monday/pedidos'
import { SinAcceso } from '@/services/monday/sdk'
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

const VACIO: AltaPedido = {
  cuentaId: '',
  cuentaNombre: '',
  equipoId: '',
  tipoPedido: '',
  tipoVenta: '',
  clientes: [],
  condicionVenta: '',
  banco: '',
  plazo: '',
  conceptoPago: '',
  renglones: [],
}

const PASOS = ['El pedido', 'Los tractores', 'El pago', 'Revisar y mandar']

interface Props {
  /** Sus equipos de monday: de ahí sale de qué concesionario es. */
  equipos: EquipoMonday[]
  /** Administración carga a nombre de cualquier concesionario. */
  esAdministracion: boolean
  /** El usuario de monday que carga. Queda como comercial del pedido y recibe los avisos. */
  comercialId?: string
  /** Después de mandar, para ir directo a seguirlo. */
  onIrAMisPedidos: () => void
}

export function CrearPedido({ equipos, esAdministracion, comercialId = '', onIrAMisPedidos }: Props) {
  const [paso, setPaso] = useState(1)
  const [cuentas, setCuentas] = useState<CuentaCrm[]>([])
  const [catalogo, setCatalogo] = useState<ProductoDeCatalogo[]>([])
  const [descuentos, setDescuentos] = useState<DescuentoConfigurado[]>([])
  const [condicionesFiscales, setCondicionesFiscales] = useState<string[]>([])

  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [listo, setListo] = useState<ResultadoPedido | null>(null)

  const [datos, setDatos] = useState<AltaPedido>(VACIO)
  const [detalle, setDetalle] = useState<ProductoDeCatalogo | null>(null)
  const [foto, setFoto] = useState(0)

  const recargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [c, cat, ds, et] = await Promise.all([
        cuentasDelCrm(),
        catalogoDeVenta(),
        descuentosDeContado(),
        etiquetasDelCrm(),
      ])
      setCuentas(c)
      setCondicionesFiscales(et.condicionFiscal)
      setCatalogo(cat.filter((p) => p.vigente))
      setDescuentos(ds)
    } catch (e) {
      setError(
        e instanceof SinAcceso
          ? 'la app tiene que abrirse desde monday para leer el catálogo.'
          : mensaje(e),
      )
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void recargar()
  }, [recargar])

  /* Los concesionarios que puede usar: el suyo (por su equipo de monday) o todos si es de
     Administración. Con uno solo, queda elegido. */
  const elegibles = useMemo(
    () => concesionariosElegibles(cuentas, equipos, esAdministracion),
    [cuentas, equipos, esAdministracion],
  )

  useEffect(() => {
    if (!datos.cuentaId && elegibles.length === 1) {
      const e = elegibles[0]
      setDatos((d) => ({ ...d, cuentaId: e.cuenta.id, cuentaNombre: e.cuenta.nombre, equipoId: e.equipoId }))
    }
  }, [elegibles, datos.cuentaId])

  const miConcesionario = cuentas.find((c) => c.id === datos.cuentaId) ?? null
  const esTerceros = datos.tipoPedido === TIPO_PEDIDO.TERCEROS
  const esDirecta = esTerceros && datos.tipoVenta === TIPO_VENTA.DIRECTA
  const pago = pagoDelPedido(datos)
  const contado = esContado(pago)
  /* "BANCO" aparece suelto y dentro de combinaciones: alcanza con que la condición lo mencione. */
  const pideBanco = esTerceros && datos.condicionVenta.toUpperCase().includes('BANCO')

  const renglones = useMemo(
    () => calcularRenglones(datos, descuentos, contado),
    [datos, descuentos, contado],
  )
  const totales = useMemo(() => totalesDePedido(renglones), [renglones])
  const faltan = faltaParaElPedido(datos)
  const terceros = cuentas.filter((c) => datos.clientes.some((x) => x.id === c.id))

  /* Salir a mitad de camino pregunta antes: mientras se escribe en monday —el pedido son tres
     tableros— y con un pedido armado sin mandar, porque lo elegido vive sólo en esta pantalla. */
  const armado = Boolean(datos.tipoPedido) || datos.renglones.length > 0
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

  const empezarOtro = () => {
    setListo(null)
    setErrorEnvio(null)
    setPaso(1)
    /* El concesionario queda: el próximo pedido casi siempre es del mismo. */
    setDatos({ ...VACIO, cuentaId: datos.cuentaId, cuentaNombre: datos.cuentaNombre, equipoId: datos.equipoId })
  }

  const mandar = async () => {
    setEnviando(true)
    setErrorEnvio(null)
    try {
      setListo(await crearPedido({ ...datos, comercialId }, descuentos))
    } catch (e) {
      setErrorEnvio(mensaje(e))
    } finally {
      setEnviando(false)
    }
  }

  /* El crédito: cuánto hay y cuánto quedaría con este pedido. Se mira en todos los pasos. */
  const asignado = miConcesionario?.creditoAsignado ?? 0
  const disponible = asignado - (miConcesionario?.creditoUtilizado ?? 0)
  const quedaria = disponible - totales.facturaConIva
  const usadoSiSeAprueba =
    asignado > 0 ? Math.min(100, Math.round(((asignado - quedaria) / asignado) * 100)) : 0

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
            <span>Desc. contado ({descuentoTotalEnPorcentaje(descuentos)}%)</span>
            <b>− {aMoneda(totales.listaSinIva - totales.contadoSinIva)}</b>
          </div>
        )}
        <div className="pedido-linea">
          <span>IVA</span>
          <b>{aMoneda(totales.facturaConIva - totales.facturaSinIva)}</b>
        </div>
        <div className="pedido-linea pedido-linea--total">
          <span>A facturar s/IVA</span>
          <span>{aMoneda(totales.facturaSinIva)}</span>
        </div>
        <div className="pedido-linea pedido-linea--suave">
          <span>Con IVA</span>
          <b>{aMoneda(totales.facturaConIva)}</b>
        </div>
      </div>

      {/* El crédito, resumido: lo que importa mientras se arma es si entra o no. */}
      {miConcesionario && (
        <div className={`linea-credito linea-credito--${tonoDeCredito(usadoSiSeAprueba)}`}>
          {asignado > 0 ? (
            <>
              <span>
                Línea disponible <b>{aMoneda(disponible)}</b>
              </span>
              <span>
                Con este pedido queda <b className={quedaria < 0 ? 'rojo' : undefined}>{aMoneda(quedaria)}</b>
              </span>
            </>
          ) : (
            <span>Sin línea de crédito asignada</span>
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
              {listo.unidades === 1 ? '' : 'es'}. Ahora espera la aprobación de BERGER —comercial y
              financiera—, y te avisamos en Novedades cuando cambie.
            </p>
            <div className="cp-exito-cifras">
              <span>
                <small>A facturar s/IVA</small>
                <b>{aMoneda(listo.totales.facturaSinIva)}</b>
              </span>
              <span>
                <small>Con IVA</small>
                <b>{aMoneda(listo.totales.facturaConIva)}</b>
              </span>
              <span>
                <small>Forma de pago</small>
                <b>{pago || '—'}</b>
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

  const puedeSeguir =
    !cargando &&
    ((paso === 1 &&
      Boolean(datos.cuentaId) &&
      Boolean(datos.tipoPedido) &&
      (!esTerceros || Boolean(datos.tipoVenta)) &&
      (!esDirecta || terceros.length > 0)) ||
      (paso === 2 && datos.renglones.length > 0) ||
      (paso === 3 && Boolean(pago)))

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
                <span className="paso-txt">{p}</span>
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

                  <div className="campo">
                    <span className="campo-lbl">
                      Tipo de pedido <span className="campo-req">· obligatorio</span>
                    </span>
                    <Desplegable
                      valor={datos.tipoPedido}
                      opciones={[TIPO_PEDIDO.STOCK, TIPO_PEDIDO.TERCEROS]}
                      vacio="Elegir…"
                      onCambiar={(v) =>
                        setDatos({
                          ...datos,
                          tipoPedido: v,
                          tipoVenta: '',
                          clientes: [],
                          condicionVenta: '',
                          banco: '',
                          conceptoPago: '',
                        })
                      }
                    />
                    <span className="campo-ayuda">
                      Stock es para ustedes; terceros, para venderle a un cliente final.
                    </span>
                  </div>

                  {esTerceros && (
                    <div className="campo">
                      <span className="campo-lbl">
                        Tipo de venta <span className="campo-req">· obligatorio</span>
                      </span>
                      <Desplegable
                        valor={datos.tipoVenta}
                        opciones={[TIPO_VENTA.DIRECTA, TIPO_VENTA.INDIRECTA]}
                        vacio="Elegir…"
                        /* Pasar a indirecta borra el cliente final: deja de preguntarse. */
                        onCambiar={(v) =>
                          setDatos({ ...datos, tipoVenta: v, clientes: v === TIPO_VENTA.DIRECTA ? datos.clientes : [] })
                        }
                      />
                      <span className="campo-ayuda">
                        {datos.tipoVenta === TIPO_VENTA.DIRECTA
                          ? 'BERGER le factura directo al cliente final.'
                          : datos.tipoVenta === TIPO_VENTA.INDIRECTA
                            ? 'BERGER les factura a ustedes, y ustedes al cliente.'
                            : 'Directa: BERGER factura al cliente. Indirecta: les factura a ustedes.'}
                      </span>
                    </div>
                  )}

                  {/* A quién se le vende, sólo en venta DIRECTA: ahí BERGER le factura al cliente. */}
                  {esDirecta && miConcesionario && (
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
                  <i className="fa-solid fa-money-bill-wave" aria-hidden="true" /> Cómo se paga
                </div>
                <div className="cp-campos">
                  {esTerceros ? (
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
                          setDatos({ ...datos, condicionVenta: v, banco: v.toUpperCase().includes('BANCO') ? datos.banco : '' })
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
                        onCambiar={(v) => setDatos({ ...datos, conceptoPago: v })}
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

                {contado && descuentos.length > 0 && (
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
                      <span className="descuento descuento--total">
                        <b>{descuentoTotalEnPorcentaje(descuentos)}%</b>
                        <small>en total</small>
                      </span>
                    </div>
                    <span className="campo-ayuda">
                      Se aplican uno sobre otro, en ese orden: por eso el total no es la suma.
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
                    <dt>Tipo</dt>
                    <dd>
                      {datos.tipoPedido}
                      {datos.tipoVenta ? ` · ${datos.tipoVenta}` : ''}
                    </dd>
                  </div>
                  {terceros.length > 0 && (
                    <div>
                      <dt>Cliente final</dt>
                      <dd>{terceros.map((c) => c.nombre).join(', ')}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Forma de pago</dt>
                    <dd>{pago || '—'}</dd>
                  </div>
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
                </dl>
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
              onClick={() => setPaso(paso + 1)}
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
