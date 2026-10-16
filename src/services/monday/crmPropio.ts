/**
 * El CRM PROPIO del concesionario: alta y edición de sus cuentas y contactos.
 *
 * Es el mismo código que la operación Cuentas y contactos de la app de BERGER S.A., apuntado a los
 * tableros del workspace Concesionarios BERGER SA (`TABLEROS_CRM`). No confundir con `crm.ts`,
 * que lee las cuentas de BERGER para elegir el cliente final de un pedido.
 *
 * Lo que este CRM no tiene y por eso acá no está: categorías (de cuenta y de contacto), línea de
 * crédito, fecha de alta de la cuenta, y los datos del concesionario (equipo y concesiones).
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
import {
  CATEGORIA_CONCESIONARIO,
  CRM_PROPIO as CRM,
  COL_CRM_CONTACTO as COL_CONTACTO,
  COL_CRM_CUENTA as COL_CUENTA,
} from './columns'
import { normalizarWhatsapp } from '@/lib/telefono'
import { esCuentaAutomatica } from './cuentaAutomatica'
import { porId, texto, type ColumnaCruda } from './parse'
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
  /** El nombre del equipo de monday del concesionario. Sólo lo tienen las de categoría Concesionario. */
  equipoNombre: string
  /** Cuántos pedidos en concesión puede tener a la vez. `null` = sin cargar. */
  concesionLimite: number | null
  /** Ids de los contactos conectados. */
  contactoIds: string[]
}

export interface ContactoCrm {
  id: string
  nombre: string
  nombres: string
  apellidos: string
  /** Lo que no es una persona: "Ventas", "Administración", un mail general. */
  otro: string
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
  COL_CUENTA.tipoPersona,
  COL_CUENTA.condicionFiscal,
  COL_CUENTA.direccionTexto,
  COL_CUENTA.ciudad,
  COL_CUENTA.provincia,
  COL_CUENTA.pais,
  COL_CUENTA.descripcion,
  COL_CUENTA.estado,
  COL_CUENTA.contactos,
]

const COLUMNAS_CONTACTO = [
  COL_CONTACTO.nombres,
  COL_CONTACTO.apellidos,
  COL_CONTACTO.otro,
  COL_CONTACTO.pais,
  COL_CONTACTO.comentarios,
  COL_CONTACTO.email,
  COL_CONTACTO.whatsapp,
  COL_CONTACTO.estado,
  COL_CONTACTO.cuenta,
]

/** Ids conectados de una columna de conexión. */
const conectados = (c: ColumnaConRelacion | undefined): string[] =>
  (c?.linked_item_ids ?? []).map(String)

/** Todas las cuentas, para el buscador y para controlar que el CUIT no esté repetido. */
export async function cuentasDelCrm(): Promise<CuentaCrm[]> {
  const r = await mondayApi<{ boards: { items_page: { items: ItemCrudo[] } }[] }>('cuentasCrmPropio', {
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
        categoria: '',
        tipoPersona: texto(c[COL_CUENTA.tipoPersona]),
        condicionFiscal: texto(c[COL_CUENTA.condicionFiscal]),
        direccion: texto(c[COL_CUENTA.direccionTexto]),
        ciudad: texto(c[COL_CUENTA.ciudad]),
        provincia: texto(c[COL_CUENTA.provincia]),
        pais: texto(c[COL_CUENTA.pais]),
        descripcion: texto(c[COL_CUENTA.descripcion]),
        estado: texto(c[COL_CUENTA.estado]),
        creditoAsignado: null,
        creditoUtilizado: null,
        equipoNombre: '',
        concesionLimite: null,
        contactoIds: conectados(c[COL_CUENTA.contactos]),
      }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** Todos los contactos. Se leen enteros porque la comprobación de duplicados los recorre. */
export async function contactosDelCrm(): Promise<ContactoCrm[]> {
  const r = await mondayApi<{ boards: { items_page: { items: ItemCrudo[] } }[] }>(
    'contactosCrmPropio',
    { columnas: COLUMNAS_CONTACTO, limite: 500 },
  )
  return (r.boards?.[0]?.items_page.items ?? [])
    .map((i) => {
      const c = porId(i.column_values)
      return {
        id: i.id,
        nombre: i.name.trim(),
        nombres: texto(c[COL_CONTACTO.nombres]),
        apellidos: texto(c[COL_CONTACTO.apellidos]),
        otro: texto(c[COL_CONTACTO.otro]),
        email: texto(c[COL_CONTACTO.email]),
        whatsapp: texto(c[COL_CONTACTO.whatsapp]),
        categoria: '',
        pais: texto(c[COL_CONTACTO.pais]),
        comentarios: texto(c[COL_CONTACTO.comentarios]),
        estado: texto(c[COL_CONTACTO.estado]),
        cuentaIds: conectados(c[COL_CONTACTO.cuenta]),
      }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
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
  }>('etiquetasCrmPropio', {
    columnasCuenta: [COL_CUENTA.tipoPersona, COL_CUENTA.clasificacion, COL_CUENTA.condicionFiscal],
    columnasContacto: [COL_CONTACTO.estado],
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
    /* Este CRM no tiene categorías: sin opciones, el formulario no las pregunta. */
    categoriaCuenta: [],
    condicionFiscal: etiquetas(COL_CUENTA.condicionFiscal),
    categoriaContacto: [],
  }
}

/* ------------------------------------------------------------------ *
 * Duplicados
 * ------------------------------------------------------------------ */

const mismoEmail = (a: string, b: string): boolean =>
  Boolean(a.trim()) && a.trim().toLowerCase() === b.trim().toLowerCase()

const mismoWhatsapp = (a: string, b: string): boolean => {
  const x = normalizarWhatsapp(a)
  const y = normalizarWhatsapp(b)
  return Boolean(x) && x === y
}

/**
 * ¿Ya hay en ESTA cuenta un contacto con este mail o este WhatsApp?
 *
 * Devuelve el contacto que choca y por qué dato, para poder decirlo con nombre y apellido: "Ya
 * está Ricardo Gutiérrez con ese mail" se entiende; "contacto duplicado" obliga a ir a buscarlo.
 */
export function contactoRepetido(
  contactos: ContactoCrm[],
  cuentaId: string,
  email: string,
  whatsapp: string,
): { contacto: ContactoCrm; por: 'el e-mail' | 'el WhatsApp' } | null {
  if (!cuentaId) return null
  for (const c of contactos) {
    if (!c.cuentaIds.includes(cuentaId)) continue
    if (mismoEmail(c.email, email)) return { contacto: c, por: 'el e-mail' }
    if (mismoWhatsapp(c.whatsapp, whatsapp)) return { contacto: c, por: 'el WhatsApp' }
  }
  return null
}

/** ¿Ya existe una cuenta con este CUIT? El CUIT es la llave: no puede haber dos. */
export function cuentaConElMismoCuit(cuentas: CuentaCrm[], cuit: string): CuentaCrm | null {
  const d = cuit.replace(/\D/g, '')
  if (!d) return null
  return cuentas.find((c) => c.cuit.replace(/\D/g, '') === d) ?? null
}

/* ------------------------------------------------------------------ *
 * Alta
 * ------------------------------------------------------------------ */

export interface AltaContacto {
  nombres: string
  apellidos: string
  /**
   * Lo que no es una persona: un sector, un mail general, el teléfono de la oficina. Con esto
   * cargado, el nombre y el apellido dejan de ser obligatorios.
   */
  otro: string
  categorias: string[]
  email: string
  /** Ya armado: `+5492494520152`. Vacío si no cargaron teléfono. */
  whatsapp: string
  /** Código ISO del país del teléfono, para la columna `country`. */
  paisCodigo: string
  paisNombre: string
  comentarios: string
  /** Cuenta a la que se conecta al crearlo. Vacío = contacto suelto. */
  cuentaId: string
  /**
   * Todas las cuentas a las que pertenece. Lo usa la edición.
   *
   * Una misma persona puede comprar para dos empresas: es un solo contacto con dos cuentas, no dos
   * contactos iguales. Al crearlo se elige una —es lo normal— y al corregirlo se pueden sumar las
   * demás.
   */
  cuentaIds?: string[]
  /**
   * El mail que tenía antes de editarlo. Lo usa la app de concesionarios: allá cambiar el mail
   * dispara una automatización de monday que hay que deshacer, y si no cambió no hace falta esperarla.
   */
  emailAnterior?: string
}

/** El nombre del item: "Nombre Apellido Otro". Monday no acepta items sin nombre. */
export const nombreDeContacto = (nombres: string, apellidos: string, otro = ''): string =>
  [nombres.trim(), apellidos.trim(), otro.trim()].filter(Boolean).join(' ')

export async function crearContacto(d: AltaContacto): Promise<{ id: string; nombre: string }> {
  const valores: Record<string, unknown> = {
    [COL_CONTACTO.nombres]: d.nombres.trim(),
    [COL_CONTACTO.apellidos]: d.apellidos.trim(),
    [COL_CONTACTO.estado]: { label: CRM.CONTACTO_ACTIVO },
    [COL_CONTACTO.fechaAlta]: { date: hoy() },
  }
  if (d.email.trim()) valores[COL_CONTACTO.email] = { email: d.email.trim(), text: d.email.trim() }
  if (d.whatsapp) {
    /* La columna `phone` de monday guarda el número y el país por separado. El número va sin el
       "+": monday lo agrega al mostrarlo. */
    valores[COL_CONTACTO.whatsapp] = {
      phone: d.whatsapp.replace(/^\+/, ''),
      countryShortName: d.paisCodigo,
    }
  }
  if (d.paisCodigo) {
    valores[COL_CONTACTO.pais] = { countryCode: d.paisCodigo, countryName: d.paisNombre }
  }
  if (d.otro.trim()) valores[COL_CONTACTO.otro] = d.otro.trim()
  if (d.comentarios.trim()) valores[COL_CONTACTO.comentarios] = d.comentarios.trim()
  if (d.cuentaId) valores[COL_CONTACTO.cuenta] = { item_ids: [d.cuentaId] }

  const nombreItem = nombreDeContacto(d.nombres, d.apellidos, d.otro)
  const r = await mondayApi<{ create_item: { id: string; name: string } }>('crearContactoCrmPropio', {
    nombre: nombreItem,
    valores: JSON.stringify(valores),
  })
  /* La automatización de monday le crea y engancha una cuenta por el dominio del mail. */
  if (d.email.trim()) await soltarCuentasDelDominio(r.create_item.id, d.cuentaId ? [d.cuentaId] : [])
  return { id: r.create_item.id, nombre: r.create_item.name || nombreItem }
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
  /**
   * Cuántos pedidos en concesión puede tener a la vez. Sólo se escribe si la cuenta es de categoría
   * Concesionario; para las demás no significa nada.
   */
  concesionLimite: number | null
  /** Contactos que ya existen y se conectan a la cuenta nueva. */
  contactoIds: string[]
}

/** ¿La cuenta es un concesionario? Es lo que la habilita a tener equipo y pedidos en concesión. */
export const esConcesionario = (categorias: string[]): boolean =>
  categorias.includes(CATEGORIA_CONCESIONARIO)

/**
 * Lo que una cuenta de concesionario lleva además del resto.
 *
 * El nombre del equipo es la razón social, siempre: el equipo de monday que se le crea al
 * concesionario se llama igual que su cuenta, y es por ese nombre que la app de concesionarios
 * sabe de quién es cada usuario. Escribirlo a mano invitaba a que no coincidieran por un punto.
 */
function columnasDeConcesionario(d: AltaCuenta): Record<string, unknown> {
  /* Este CRM no tiene categorías ni las columnas del concesionario: nunca hay nada que agregar. */
  void d
  return {}
}

export async function crearCuenta(d: AltaCuenta): Promise<{ id: string; nombre: string }> {
  const valores: Record<string, unknown> = {
    [COL_CUENTA.cuit]: d.cuit.trim(),
    [COL_CUENTA.estado]: { label: CRM.CUENTA_ACTIVA },
  }
  if (d.tipoPersona) valores[COL_CUENTA.tipoPersona] = { label: d.tipoPersona }
  if (d.clasificacion) valores[COL_CUENTA.clasificacion] = { label: d.clasificacion }
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
  if (d.contactoIds.length > 0) valores[COL_CUENTA.contactos] = { item_ids: d.contactoIds }
  Object.assign(valores, columnasDeConcesionario(d))

  const nombreItem = d.razonSocial.trim()
  const r = await mondayApi<{ create_item: { id: string; name: string } }>('crearCuentaCrmPropio', {
    nombre: nombreItem,
    valores: JSON.stringify(valores),
  })
  return { id: r.create_item.id, nombre: r.create_item.name || nombreItem }
}

/* ------------------------------------------------------------------ *
 * Validaciones del formulario
 * ------------------------------------------------------------------ */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Qué falta para dar de alta un contacto. Vacío = se puede. */
export function faltaParaElContacto(d: AltaContacto): string[] {
  const faltan: string[] = []
  /* Un sector o un mail general no tiene nombre ni apellido: con "Otro" cargado alcanza. */
  if (!d.otro.trim()) {
    if (!d.nombres.trim()) faltan.push('el nombre')
    if (!d.apellidos.trim()) faltan.push('el apellido')
  }
  if (d.email.trim() && !EMAIL.test(d.email.trim())) faltan.push('un e-mail válido')
  /* Sin mail y sin WhatsApp el contacto no sirve para nada: es una fila con un nombre. Y son
     justamente los dos datos con los que se detectan los duplicados. */
  if (!d.email.trim() && !d.whatsapp) faltan.push('el e-mail o el WhatsApp')
  return faltan
}

/** Qué falta para dar de alta una cuenta. Vacío = se puede. */
export function faltaParaLaCuenta(d: AltaCuenta): string[] {
  const faltan: string[] = []
  if (!d.razonSocial.trim()) faltan.push('la razón social')
  if (!d.cuit.trim()) faltan.push('el CUIT')
  if (!d.condicionFiscal) faltan.push('la condición fiscal')
  if (
    esConcesionario(d.categorias) &&
    (d.concesionLimite === null || !Number.isInteger(d.concesionLimite) || d.concesionLimite < 0)
  ) {
    faltan.push('los pedidos x concesión permitidos (0 o más)')
  }
  return faltan
}

/* ------------------------------------------------------------------ *
 * Edición
 * ------------------------------------------------------------------ */

/**
 * Cambia los datos de una cuenta que ya existe.
 *
 * Escribe las MISMAS columnas que el alta y ninguna más: desde acá no se da de baja una cuenta ni
 * se le toca la fecha de alta. Lo que no se manda queda como estaba, así que vaciar un campo
 * manda el vacío a propósito y no por omisión.
 *
 * El nombre del item también se actualiza: si cambia la razón social y el nombre queda con la
 * vieja, en el tablero la cuenta sigue llamándose como antes.
 */
export async function actualizarCuenta(id: string, d: AltaCuenta): Promise<void> {
  const valores: Record<string, unknown> = {
    [COL_CUENTA.cuit]: d.cuit.trim(),
    [COL_CUENTA.direccionTexto]: d.direccion.trim(),
    [COL_CUENTA.ciudad]: d.ciudad.trim(),
    [COL_CUENTA.provincia]: d.provincia.trim(),
    [COL_CUENTA.descripcion]: d.descripcion.trim(),
  }
  /* Un estado o un dropdown con la etiqueta vacía se limpia con `{}`: mandar `{label: ''}` hace
     fallar la escritura entera del item. */
  valores[COL_CUENTA.tipoPersona] = d.tipoPersona ? { label: d.tipoPersona } : {}
  valores[COL_CUENTA.clasificacion] = d.clasificacion ? { label: d.clasificacion } : {}
  valores[COL_CUENTA.condicionFiscal] = d.condicionFiscal ? { label: d.condicionFiscal } : {}
  valores[COL_CUENTA.pais] = d.paisCodigo
    ? { countryCode: d.paisCodigo, countryName: d.paisNombre }
    : {}
  valores[COL_CUENTA.contactos] = { item_ids: d.contactoIds }
  Object.assign(valores, columnasDeConcesionario(d))

  await mondayApi('actualizarCuentaCrmPropio', {
    item: id,
    nombre: d.razonSocial.trim(),
    valores: JSON.stringify(valores),
  })
}

/** Lo mismo para un contacto. */
export async function actualizarContacto(id: string, d: AltaContacto): Promise<void> {
  const valores: Record<string, unknown> = {
    [COL_CONTACTO.nombres]: d.nombres.trim(),
    [COL_CONTACTO.apellidos]: d.apellidos.trim(),
    [COL_CONTACTO.otro]: d.otro.trim(),
    [COL_CONTACTO.comentarios]: d.comentarios.trim(),
  }
  valores[COL_CONTACTO.email] = d.email.trim()
    ? { email: d.email.trim(), text: d.email.trim() }
    : {}
  valores[COL_CONTACTO.whatsapp] = d.whatsapp
    ? { phone: d.whatsapp.replace(/^\+/, ''), countryShortName: d.paisCodigo }
    : {}
  valores[COL_CONTACTO.pais] = d.paisCodigo
    ? { countryCode: d.paisCodigo, countryName: d.paisNombre }
    : {}
  valores[COL_CONTACTO.cuenta] = {
    item_ids: d.cuentaIds ?? (d.cuentaId ? [d.cuentaId] : []),
  }

  await mondayApi('actualizarContactoCrmPropio', {
    item: id,
    nombre: nombreDeContacto(d.nombres, d.apellidos, d.otro),
    valores: JSON.stringify(valores),
  })
  /* Sólo si cambió el mail: es lo que dispara la automatización de cuentas por dominio. */
  const mail = d.email.trim().toLowerCase()
  if (mail && mail !== (d.emailAnterior ?? '').trim().toLowerCase()) {
    await soltarCuentasDelDominio(id, d.cuentaIds ?? (d.cuentaId ? [d.cuentaId] : []))
  }
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Deshace lo que hace sola la automatización de cuentas por dominio (ver `cuentaAutomatica.ts`).
 *
 * monday tarda unos segundos en actuar, así que se mira el contacto varias veces. Cuando aparece
 * una cuenta que no es de las suyas, se le devuelven sus cuentas y, si esa cuenta la creó la
 * automatización recién, se borra. Si la cuenta ya existía —otra de ese dominio—, sólo se la
 * desengancha: no es de la app borrarla.
 *
 * Devuelve las cuentas que se soltaron. Nunca tira: el contacto ya quedó bien guardado.
 */
export async function soltarCuentasDelDominio(
  contactoId: string,
  propias: string[],
  intentos = 8,
  cadaMs = 1500,
): Promise<string[]> {
  try {
    for (let i = 0; i < intentos; i++) {
      await espera(cadaMs)
      const r = await mondayApi<{
        items: { column_values: { linked_item_ids?: string[] | null }[] }[]
      }>('vinculosDeContactoPropio', { item: contactoId })
      const enganchadas = (r.items?.[0]?.column_values?.[0]?.linked_item_ids ?? []).map(String)
      const extras = enganchadas.filter((x) => !propias.includes(x))
      if (extras.length === 0) continue

      await mondayApi('reconectarContactoCrmPropio', {
        item: contactoId,
        valores: JSON.stringify({ [COL_CONTACTO.cuenta]: { item_ids: propias } }),
      })
      for (const id of extras) {
        try {
          const c = await mondayApi<{
            items: {
              created_at: string
              board: { id: string }
              column_values: { id: string; text: string | null }[]
            }[]
          }>('cuentaParaDescartar', { item: id })
          const it = c.items?.[0]
          if (!it) continue
          const col = (k: string) => it.column_values.find((x) => x.id === k)?.text ?? ''
          const automatica = esCuentaAutomatica({
            tablero: String(it.board?.id ?? ''),
            creada: it.created_at,
            cuit: col(COL_CUENTA.cuit),
            dominio: col(COL_CUENTA.dominio),
          })
          if (automatica) await mondayApi('descartarCuentaAutomatica', { item: id })
        } catch {
          /* si no se pudo borrar, al menos quedó desenganchada */
        }
      }
      return extras
    }
  } catch {
    /* sin lectura no hay nada que corregir */
  }
  return []
}

/* ------------------------------------------------------------------ *
 * Buscar para editar
 * ------------------------------------------------------------------ */

const sinTildes = (t: string): string =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

/**
 * Una cuenta se busca por razón social o por CUIT.
 *
 * El CUIT se compara sin guiones de los dos lados: nadie se acuerda de cómo lo escribió el que la
 * cargó, y buscar "30712345678" no tiene por qué fallar porque en el tablero diga "30-71234567-8".
 */
export const textoDeBusquedaDeCuenta = (c: CuentaCrm): string =>
  sinTildes(`${c.nombre} ${c.cuit} ${c.cuit.replace(/\D/g, '')}`)

/** Un contacto, por nombre, apellido, mail o WhatsApp. */
export const textoDeBusquedaDeContacto = (c: ContactoCrm): string =>
  sinTildes(
    `${c.nombre} ${c.nombres} ${c.apellidos} ${c.otro} ${c.email} ${c.whatsapp} ${c.whatsapp.replace(/\D/g, '')}`,
  )
