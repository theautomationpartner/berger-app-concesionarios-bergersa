/**
 * Catálogo de las operaciones que la app puede hacer contra monday.
 *
 * Antes el cliente le mandaba al proxy una consulta GraphQL y el proxy la reenviaba tal cual. Eso
 * convertía a `/api/monday` en una API completa de la cuenta: cualquier usuario de BERGER con
 * sesión —incluso uno de sólo lectura— podía abrir las herramientas del navegador y ejecutar la
 * consulta que quisiera con el token de la cuenta. El guard comprobaba QUIÉN preguntaba, pero
 * nunca QUÉ preguntaba.
 *
 * Ahora el cliente manda sólo el NOMBRE de una operación de este catálogo. El texto de la consulta
 * lo pone el servidor, así que no se puede falsificar: lo que no está acá, no se puede pedir.
 *
 * Las variables sí siguen viniendo del cliente, y por eso cada operación las valida. Sin esa parte
 * el candado no cerraría: `change_multiple_column_values` con variables libres escribe en
 * cualquier tablero de la cuenta aunque el texto de la mutation esté fijo.
 *
 * Este archivo lo importan las DOS puntas —el cliente para desarrollo, el proxy para producción—
 * a propósito. Con el texto duplicado en los dos lados, un cambio en uno solo compila igual y
 * falla nada más que en producción, que es donde peor se detecta.
 */

import { COL_CUENTA, COL_PEDIDO, COL_PEDIDO_SUB, COL_VENTA, TABLEROS } from './columns'

/**
 * Los módulos de la app: dos poblaciones distintas, con permisos distintos.
 *
 * `despacho` es el circuito de BERGER —elegir tractores, pagar, despachar—. `aduana` es lo que
 * hace el despachante externo: actualizar el estado de las OP que ya existen. `aduanaDashboard` es
 * la lectura de conjunto de ese mismo tablero, que es de BERGER y no del externo. `drafts` es lo
 * que pasa ANTES de que el tractor exista: planificar el período de producción de cada draft y
 * mandarle la planificación al proveedor. `fechas` es el ida y vuelta con el proveedor por la
 * fecha de producción de cada tractor.
 *
 * El dashboard es un módulo aparte y no una pantalla más de `aduana` justamente porque el
 * despachante NO lo ve: entra a actualizar sus OP, no a mirar el estado de toda la operación.
 * Como se alimenta de la misma consulta que usa el despachante, separarlo por módulo es lo único
 * que lo distingue del lado del servidor.
 *
 * Cada operación declara el suyo y el servidor comprueba, en cada pedido, que el perfil lo tenga
 * habilitado. Es lo que impide que un despachante pida los pagos del inventario aunque la pantalla
 * no se los muestre.
 */
export const MODULOS_APP = [
  /** Los pedidos del concesionario: cargarlos y seguirlos. Es lo único que tiene esta app. */
  'pedidos',
] as const

export type ModuloApp = (typeof MODULOS_APP)[number]

/** Nombre de cada operación. Es lo único que viaja del cliente al servidor. */
export type NombreOperacion =
  | 'crearPedido'
  | 'crearSubitemDePedido'
  | 'crearUnidadDeVenta'
  | 'pedidosCargados'
  | 'novedadesDePedidos'
  | 'unidadesDeVenta'
  | 'catalogoDeVenta'
  | 'configuracionDeVenta'
  | 'cuentasDelCrm'
  | 'etiquetasDelCrm'
  | 'crearCuentaCrm'

export type Variables = Record<string, unknown>

/** El pedido no corresponde a ninguna operación válida, o sus variables no pasan la validación. */
export class OperacionInvalida extends Error {}

interface Operacion {
  /** A qué módulo pertenece. Sin él, cualquier perfil podría pedir cualquier cosa del catálogo. */
  modulo: ModuloApp
  /**
   * Otros módulos que también la pueden pedir.
   *
   * Casi ninguna operación necesita esto: una operación es de un circuito y de uno solo. La
   * excepción son las del CRM que el concesionario necesita para armar un pedido —buscar la cuenta
   * del cliente final, y darla de alta si no está—, porque el concesionario no tiene el módulo de
   * ventas ni debería tenerlo: eso le abriría el CRM entero.
   *
   * Es una lista explícita y no un "si tenés cualquiera de estos": cada entrada es una decisión
   * sobre quién más puede hacer exactamente esa consulta.
   */
  tambienEn?: readonly ModuloApp[]
  /**
   * Versión de la API de monday con la que tiene que correr ESTA operación.
   *
   * Casi todas usan la de la app (`API_VERSION`). La excepción son las que necesitan algo que
   * todavía no existía entonces: subir la versión de toda la app por una sola consulta obligaría a
   * volver a probar las otras treinta, y cada versión de monday cambia el comportamiento de algo.
   */
  apiVersion?: string
  query: string
  /**
   * Comprueba y normaliza las variables. Puede devolver otras: cuando un valor lo decide el
   * servidor —los ids de tablero, por ejemplo— se reemplaza acá en vez de confiar en el que
   * llegó.
   */
  validar: (v: Variables) => Variables
}

/** Un id de monday es una cadena de dígitos. Sirve para items, subitems y tableros. */
function idMonday(valor: unknown, campo: string): string {
  const texto = String(valor ?? '')
  if (!/^\d{1,20}$/.test(texto)) throw new OperacionInvalida(`"${campo}" no es un id válido.`)
  return texto
}

/**
 * Entero dentro de un rango.
 *
 * El mínimo es explícito y NO vale 1 por defecto: los índices de las etiquetas de estado empiezan
 * en 0 —"Pend de Aprobar Transf" es justamente el 0—, así que exigir 1 dejaba la operación 2 sin
 * poder pedir nada. Los tamaños de página sí arrancan en 1.
 */
function entero(valor: unknown, campo: string, min: number, max: number): number {
  const n = Number(valor)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new OperacionInvalida(`"${campo}" fuera de rango.`)
  }
  return n
}

/**
 * Valida un `column_values` contra una lista cerrada de columnas.
 *
 * Es el mismo candado que `valoresDeColumnas`, pero con una lista que NO es la del tablero: la usan
 * los módulos que comparten tablero con otro y pueden tocar menos columnas que él. El Inventario es
 * el caso: el circuito de pago mueve el Estado Pago y el módulo de fechas mueve las fechas, y
 * ninguno de los dos puede escribir lo del otro aunque el tablero sea el mismo.
 */
function valoresAcotados(valor: unknown, permitidas: Set<string>, quien: string): string {
  let objeto: unknown
  try {
    objeto = JSON.parse(String(valor ?? ''))
  } catch {
    throw new OperacionInvalida('"column_values" no es JSON válido.')
  }
  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) {
    throw new OperacionInvalida('"column_values" tiene que ser un objeto.')
  }

  const claves = Object.keys(objeto as Record<string, unknown>)
  if (claves.length === 0) throw new OperacionInvalida('"column_values" está vacío.')
  for (const clave of claves) {
    if (!permitidas.has(clave)) {
      throw new OperacionInvalida(`La columna "${clave}" no la puede escribir ${quien}.`)
    }
  }
  return JSON.stringify(objeto)
}

/** Nombre del item o subitem. Se acota el largo para no reenviar cualquier cosa. */
function nombre(valor: unknown): string {
  const texto = String(valor ?? '').trim()
  if (!texto) throw new OperacionInvalida('Falta el nombre del item.')
  if (texto.length > 255) throw new OperacionInvalida('El nombre del item es demasiado largo.')
  return texto
}

function idsDeColumnas(valor: unknown): string[] {
  if (!Array.isArray(valor)) throw new OperacionInvalida('Faltan las columnas a leer.')
  return valor.map((c) => {
    const texto = String(c)
    if (!/^[A-Za-z0-9_]{1,64}$/.test(texto)) {
      throw new OperacionInvalida(`Id de columna inválido: "${texto}".`)
    }
    return texto
  })
}

/* ------------------------------------------------------------------ *
 * Fragmentos reutilizados por las consultas
 * ------------------------------------------------------------------ */

/**
 * `... on MirrorValue` y `... on BoardRelationValue` no son opcionales: sin ellos los importes
 * espejados vuelven vacíos y la conexión al Inventario vuelve en `null`.
 */
const CAMPOS_COLUMNA = `
  id
  type
  text
  ... on MirrorValue { display_value }
  # Las conexiones también devuelven text: null y traen los nombres en display_value. Sin pedirlo,
  # de una conexión se lee su lista de ids y nada más: un pedido sin concesionario, una unidad sin
  # modelo. (El comentario va con #: esto es GraphQL, no JavaScript.)
  ... on BoardRelationValue { linked_item_ids display_value }
  ... on LocationValue { lat lng }
`

/**
 * Lo mismo, más el JSON crudo de la columna.
 *
 * `value` es el único lugar donde viaja el **id** de la persona de una columna `people`: el `text`
 * trae su nombre, y con un nombre no se puede mencionar a nadie. Se pide sólo donde hace falta
 * porque es el campo más pesado de la respuesta y en la mayoría de las consultas no se mira.
 */
const CAMPOS_COLUMNA_CON_VALOR = `
  ${CAMPOS_COLUMNA}
  value
`

/** Los items de un tablero del CRM, con las columnas que pida quien llama. */
const CONSULTA_ITEMS_CRM = `
  query ($tablero: ID!, $columnas: [String!], $limite: Int!) {
    boards(ids: [$tablero]) {
      items_page(limit: $limite) {
        items { id name column_values(ids: $columnas) { ${CAMPOS_COLUMNA} } }
      }
    }
  }
`

/**
 * Lo único que la app escribe al dar de alta una cuenta.
 *
 * Es deliberadamente más corta que el tablero: desde acá no se puede dar de baja una cuenta ni
 * tocarle la fecha de baja. El alta da de alta; lo demás se hace en monday, donde queda
 * registrado quién lo hizo.
 */
const COLUMNAS_DE_CUENTA = new Set<string>([
  COL_CUENTA.tipoPersona,
  COL_CUENTA.estado,
  COL_CUENTA.clasificacion,
  COL_CUENTA.categoria,
  COL_CUENTA.cuit,
  COL_CUENTA.condicionFiscal,
  COL_CUENTA.direccion,
  COL_CUENTA.direccionTexto,
  COL_CUENTA.ciudad,
  COL_CUENTA.provincia,
  COL_CUENTA.pais,
  COL_CUENTA.descripcion,
  COL_CUENTA.contactos,
  COL_CUENTA.concesionario,
  COL_CUENTA.fechaAlta,
])

/**
 * Lo que el concesionario puede escribir en un pedido.
 *
 * No está el estado del pedido más allá del inicial, ni las fechas de aprobación o de entrega, ni
 * el motivo de rechazo: eso lo mueve BERGER. El concesionario carga su solicitud y a partir de ahí
 * sólo mira.
 */
const COLUMNAS_DE_PEDIDO = new Set<string>([
  COL_PEDIDO.cuenta,
  COL_PEDIDO.tercero,
  COL_PEDIDO.comercial,
  COL_PEDIDO.equipo,
  COL_PEDIDO.tipoPedido,
  COL_PEDIDO.pedidoPara,
  COL_PEDIDO.tipoFactura,
  COL_PEDIDO.politicaContado,
  COL_PEDIDO.totalComision,
  COL_PEDIDO.totalClienteFinal,
  COL_PEDIDO.estado,
  COL_PEDIDO.condicionVenta,
  COL_PEDIDO.banco,
  COL_PEDIDO.plazo,
  COL_PEDIDO.conceptoPago,
  COL_PEDIDO.totalListaSinIva,
  COL_PEDIDO.totalListaConIva,
  COL_PEDIDO.totalContadoSinIva,
  COL_PEDIDO.totalContadoConIva,
  COL_PEDIDO.totalFacturaSinIva,
  COL_PEDIDO.totalFacturaConIva,
  COL_PEDIDO.fechaSolicitud,
  COL_PEDIDO.aprobComercial,
  COL_PEDIDO.aprobFinanciera,
])

/** Lo que puede escribir en cada renglón. Los precios los calcula la app, no se tipean. */
const COLUMNAS_DE_PEDIDO_SUB = new Set<string>([
  COL_PEDIDO_SUB.catalogo,
  COL_PEDIDO_SUB.estado,
  COL_PEDIDO_SUB.cantidad,
  COL_PEDIDO_SUB.listaSinIva,
  COL_PEDIDO_SUB.listaConIva,
  COL_PEDIDO_SUB.dto1,
  COL_PEDIDO_SUB.dto2,
  COL_PEDIDO_SUB.dto3,
  COL_PEDIDO_SUB.dto4,
  COL_PEDIDO_SUB.contadoSinIva,
  COL_PEDIDO_SUB.contadoConIva,
  COL_PEDIDO_SUB.facturaSinIva,
  COL_PEDIDO_SUB.facturaConIva,
  COL_PEDIDO_SUB.precioClienteFinal,
  COL_PEDIDO_SUB.precioMaximoUnidad,
  COL_PEDIDO_SUB.comision,
])

/**
 * Lo que se escribe al crear una unidad.
 *
 * La conexión al Inventario NO está: asignar una unidad a un tractor concreto es de BERGER, y es
 * justamente lo que el concesionario no puede hacer por su cuenta.
 */
const COLUMNAS_DE_VENTA = new Set<string>([
  COL_VENTA.concesionario,
  COL_VENTA.tercero,
  COL_VENTA.concesionarioPersonas,
  COL_VENTA.comercial,
  COL_VENTA.catalogo,
  COL_VENTA.subitemPedido,
  COL_VENTA.pedido,
  COL_VENTA.estado,
  COL_VENTA.listaSinIva,
  COL_VENTA.listaConIva,
  COL_VENTA.dto1,
  COL_VENTA.dto2,
  COL_VENTA.dto3,
  COL_VENTA.dto4,
  COL_VENTA.contadoSinIva,
  COL_VENTA.contadoConIva,
  COL_VENTA.totalContadoSinIva,
  COL_VENTA.totalContadoConIva,
  COL_VENTA.facturaSinIva,
  COL_VENTA.facturaConIva,
  COL_VENTA.precioClienteFinal,
  COL_VENTA.precioMaximoUnidad,
])

const OPS_CRM = {

  /* ------------------------------------------------------------------ *
   * Módulo de pedidos: lo que carga el concesionario
   * ------------------------------------------------------------------ */

  /** El pedido. El concesionario lo crea; lo que pasa después ya no es suyo. */
  crearPedido: {
    modulo: 'pedidos' as const,
    query: `
      mutation ($tablero: ID!, $nombre: String!, $valores: JSON!) {
        create_item(board_id: $tablero, item_name: $nombre, column_values: $valores) { id }
      }
    `,
    validar: (v: Record<string, unknown>) => ({
      tablero: TABLEROS.pedidos,
      nombre: nombre(v.nombre),
      valores: valoresAcotados(v.valores, COLUMNAS_DE_PEDIDO, 'el alta de un pedido'),
    }),
  },

  /** Un renglón del pedido: un modelo con su cantidad y sus precios. */
  crearSubitemDePedido: {
    modulo: 'pedidos' as const,
    query: `
      mutation ($padre: ID!, $nombre: String!, $valores: JSON!) {
        create_subitem(parent_item_id: $padre, item_name: $nombre, column_values: $valores) { id }
      }
    `,
    validar: (v: Record<string, unknown>) => ({
      padre: idMonday(v.padre, 'padre'),
      nombre: nombre(v.nombre),
      valores: valoresAcotados(v.valores, COLUMNAS_DE_PEDIDO_SUB, 'un renglón del pedido'),
    }),
  },

  /** Una UNIDAD: es lo que después BERGER aprueba y asigna de a una. */
  crearUnidadDeVenta: {
    modulo: 'pedidos' as const,
    query: `
      mutation ($tablero: ID!, $nombre: String!, $valores: JSON!) {
        create_item(board_id: $tablero, item_name: $nombre, column_values: $valores) { id }
      }
    `,
    validar: (v: Record<string, unknown>) => ({
      tablero: TABLEROS.ventas,
      nombre: nombre(v.nombre),
      valores: valoresAcotados(v.valores, COLUMNAS_DE_VENTA, 'una unidad del pedido'),
    }),
  },

  /* ------------------------------------------------------------------ *
   * Pedidos: lo que se lee para seguirlos, aprobarlos y asignarlos
   * ------------------------------------------------------------------ */

  /**
   * Los pedidos con sus renglones.
   *
   * La misma consulta sirve para los dos lados del mostrador —el concesionario mira los suyos,
   * BERGER los de todos— porque lo que cambia no es la consulta sino el filtro, y el filtro lo
   * decide quién pregunta. Por eso `tambienEn`: el módulo que la pide dice para qué pantalla es.
   *
   * El filtro por concesionario se aplica del lado del cliente y no acá. monday no filtra por
   * columna de conexión sin `query_params` sobre el id interno de la relación, que cambia cuando
   * se reordena el tablero; preferible traer la página y filtrar por los ids que ya tenemos.
   */
  pedidosCargados: {
    modulo: 'pedidos' as const,
    query: `
      query ($tablero: ID!, $columnas: [String!], $subColumnas: [String!], $limite: Int!) {
        boards(ids: [$tablero]) {
          items_page(limit: $limite) {
            items {
              id
              name
              column_values(ids: $columnas) { ${CAMPOS_COLUMNA_CON_VALOR} }
              subitems { id name column_values(ids: $subColumnas) { ${CAMPOS_COLUMNA} } }
            }
          }
        }
      }
    `,
    validar: (v: Record<string, unknown>) => ({
      tablero: TABLEROS.pedidos,
      columnas: idsDeColumnas(v.columnas),
      subColumnas: idsDeColumnas(v.subColumnas),
      limite: entero(v.limite, 'limite', 1, 500),
    }),
  },

  /**
   * Los updates de los pedidos: de ahí salen las novedades que ve el concesionario.
   *
   * Es la misma información que monday le manda por notificación, pero puesta en la app: quien
   * trabaja acá adentro no tiene por qué ir al tablero a enterarse de que le aprobaron un pedido.
   */
  novedadesDePedidos: {
    modulo: 'pedidos' as const,
    query: `
      query ($tablero: ID!, $columnas: [String!], $limite: Int!) {
        boards(ids: [$tablero]) {
          items_page(limit: $limite) {
            items {
              id
              name
              column_values(ids: $columnas) { ${CAMPOS_COLUMNA_CON_VALOR} }
              updates(limit: 20) {
                id
                text_body
                created_at
                creator { id name }
              }
            }
          }
        }
      }
    `,
    validar: (v: Record<string, unknown>) => ({
      tablero: TABLEROS.pedidos,
      columnas: idsDeColumnas(v.columnas),
      limite: entero(v.limite, 'limite', 1, 300),
    }),
  },

  /** Las unidades de 🛍️Ventas. Una por tractor pedido: son las que se aprueban y se asignan. */
  unidadesDeVenta: {
    modulo: 'pedidos' as const,
    query: CONSULTA_ITEMS_CRM,
    validar: (v: Record<string, unknown>) => ({
      tablero: TABLEROS.ventas,
      columnas: idsDeColumnas(v.columnas),
      limite: entero(v.limite, 'limite', 1, 500),
    }),
  },

  /**
   * El catálogo con el que el concesionario arma su pedido.
   *
   * Es del módulo `pedidos` y no de `ventas`: el concesionario tiene que poder ver los productos
   * y sus precios, que es lo único del CRM a lo que llega.
   */
  catalogoDeVenta: {
    modulo: 'pedidos' as const,
    query: CONSULTA_ITEMS_CRM,
    validar: (v: Record<string, unknown>) => ({
      tablero: TABLEROS.catalogo,
      columnas: idsDeColumnas(v.columnas),
      limite: entero(v.limite, 'limite', 1, 500),
    }),
  },

  /** Los descuentos de contado y el IVA. Sólo se leen: los define BERGER en su tablero. */
  configuracionDeVenta: {
    modulo: 'pedidos' as const,
    query: CONSULTA_ITEMS_CRM,
    validar: (v: Record<string, unknown>) => ({
      tablero: TABLEROS.configuracion,
      columnas: idsDeColumnas(v.columnas),
      limite: entero(v.limite, 'limite', 1, 500),
    }),
  },

  /** Las cuentas, para buscarlas y para controlar que un CUIT no esté repetido. */
  cuentasDelCrm: {
    modulo: 'pedidos' as const,
    /* El concesionario la necesita para elegir el cliente final de su pedido. */
    query: CONSULTA_ITEMS_CRM,
    validar: (v: Record<string, unknown>) => ({
      tablero: TABLEROS.cuentas,
      columnas: idsDeColumnas(v.columnas),
      limite: entero(v.limite, 'limite', 1, 500),
    }),
  },

  /**
   * Las etiquetas de los desplegables de los dos tableros, en una sola consulta.
   *
   * Se leen de monday en vez de estar escritas acá porque una etiqueta inexistente hace fallar la
   * escritura ENTERA del item: si alguien agrega "Contratista" a Categoría, la app la ofrece sin
   * que haya que desplegar nada.
   */
  etiquetasDelCrm: {
    modulo: 'pedidos' as const,
    /* El concesionario la necesita para elegir el cliente final de su pedido. */
    query: `
      query ($tableros: [ID!], $columnasCuenta: [String!], $columnasContacto: [String!]) {
        boards(ids: $tableros) {
          id
          cuenta: columns(ids: $columnasCuenta) { id settings_str }
          contacto: columns(ids: $columnasContacto) { id settings_str }
        }
      }
    `,
    validar: (v: Record<string, unknown>) => ({
      tableros: [TABLEROS.cuentas, TABLEROS.contactos],
      columnasCuenta: idsDeColumnas(v.columnasCuenta),
      columnasContacto: idsDeColumnas(v.columnasContacto),
    }),
  },

  /** Alta de una cuenta. El tablero lo fija el servidor y las columnas son una lista cerrada. */
  crearCuentaCrm: {
    modulo: 'pedidos' as const,
    /* El concesionario la necesita para elegir el cliente final de su pedido. */
    query: `
      mutation ($tablero: ID!, $nombre: String!, $valores: JSON!) {
        create_item(board_id: $tablero, item_name: $nombre, column_values: $valores) { id name }
      }
    `,
    validar: (v: Record<string, unknown>) => ({
      tablero: TABLEROS.cuentas,
      nombre: nombre(v.nombre),
      valores: valoresAcotados(v.valores, COLUMNAS_DE_CUENTA, 'el alta de una cuenta'),
    }),
  },
}

/* ------------------------------------------------------------------ *
 * El catálogo
 * ------------------------------------------------------------------ */

export const OPERACIONES: Record<NombreOperacion, Operacion> = {
  ...OPS_CRM,
}

/**
 * Si un perfil con estos módulos puede pedir esta operación.
 *
 * Es el candado que separa a las dos poblaciones: la operación existe en el catálogo, pero tiene
 * que pertenecer a un módulo habilitado. Un despachante que pida los pagos del inventario se choca
 * con esto aunque su pantalla no ofrezca el botón.
 */
export const operacionPermitida = (operacion: Operacion, modulos: readonly ModuloApp[]): boolean =>
  modulos.includes(operacion.modulo) || (operacion.tambienEn ?? []).some((m) => modulos.includes(m))

/** Mutation de subida de archivos. El texto lo pone el servidor, igual que el resto. */
export const MUTATION_ARCHIVO =
  'mutation ($itemId: ID!, $columnId: String!, $file: File!) {' +
  ' add_file_to_column (item_id: $itemId, column_id: $columnId, file: $file) { id } }'

/**
 * Las columnas a las que esta app puede subir un archivo. Hoy, una: el contrato de un pedido en
 * concesión. Cualquier otra se rechaza aunque exista.
 */
const COLUMNAS_ARCHIVO: Record<string, ModuloApp> = {
  [COL_PEDIDO.contratoConcesion]: 'pedidos',
}

/** Valida el destino de un archivo y devuelve el módulo que hace falta para subirlo. */
export function validarDestinoArchivo(
  itemId: unknown,
  columnId: unknown,
): { itemId: string; columnId: string; modulo: ModuloApp } {
  const columna = String(columnId ?? '')
  const modulo = COLUMNAS_ARCHIVO[columna]
  if (!modulo) throw new OperacionInvalida('Esa columna no admite archivos desde la app.')
  return { itemId: idMonday(itemId, 'itemId'), columnId: columna, modulo }
}

/** Resuelve una operación por nombre. Lanza si no existe: no hay consultas fuera del catálogo. */
export function resolverOperacion(nombreOperacion: unknown): Operacion {
  const clave = String(nombreOperacion ?? '')
  const operacion = (OPERACIONES as Record<string, Operacion | undefined>)[clave]
  if (!operacion) throw new OperacionInvalida(`Operación desconocida: "${clave}".`)
  return operacion
}
