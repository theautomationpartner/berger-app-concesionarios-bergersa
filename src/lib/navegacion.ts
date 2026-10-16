/**
 * Las pantallas de la app de concesionarios.
 *
 * Nació como la operación PEDIDOS de la app de BERGER S.A., sacada a su propia app para el
 * workspace Concesionarios BERGER SA. Después se le sumaron las dos operaciones del CRM propio del
 * concesionario —Cuentas y contactos, y Actividades—, que son las mismas de la app de BERGER sobre
 * los tableros de este workspace. Siguen siendo dos niveles y no tres: no hay COMPRA ni VENTA que
 * elegir, y con tres operaciones no hace falta buscador.
 *
 * Crear y seguir son dos pantallas y no dos solapas de una: cada una aprovecha la pantalla entera,
 * y los pasos del pedido quedan arriba, sin una fila de opciones encima.
 */
import type { OpcionPanel } from '@/types'

export type OperacionPrincipal = 'pedidos' | 'clientes' | 'actividades'
export type PantallaPedidos = 'crear' | 'mios'

/** Dónde está parado el usuario. `null` es el nivel de arriba, todavía sin elegir. */
export interface Ruta {
  principal: OperacionPrincipal | null
  pedidos: PantallaPedidos | null
}

export const RUTA_INICIO: Ruta = { principal: null, pedidos: null }

export const OPERACIONES_PRINCIPALES: OpcionPanel<OperacionPrincipal>[] = [
  {
    id: 'pedidos',
    titulo: 'PEDIDOS',
    corto: 'Pedidos',
    detalle: 'Cargar los pedidos de tractores a BERGER y seguir en qué anda cada uno.',
    icono: 'fa-solid fa-cart-shopping',
  },
  {
    id: 'clientes',
    titulo: 'CUENTAS Y CONTACTOS',
    corto: 'Cuentas y contactos',
    detalle: 'Dar de alta tus cuentas y sus contactos, y corregir los que ya están.',
    icono: 'fa-solid fa-address-book',
  },
  {
    id: 'actividades',
    titulo: 'ACTIVIDADES',
    corto: 'Actividades',
    detalle: 'Lo que hablaste con un cliente y lo que te queda: llamadas, WhatsApp, visitas.',
    icono: 'fa-solid fa-calendar-check',
  },
]

export const PANTALLAS_PEDIDOS: OpcionPanel<PantallaPedidos>[] = [
  {
    id: 'crear',
    titulo: 'CREAR PEDIDO',
    corto: 'Crear pedido',
    detalle: 'Elegir los tractores, cómo se pagan, y mandar la solicitud a BERGER.',
    icono: 'fa-solid fa-cart-plus',
  },
  {
    id: 'mios',
    titulo: 'MIS PEDIDOS',
    corto: 'Mis pedidos',
    detalle: 'En qué anda cada pedido y cada tractor, las métricas y las novedades de BERGER.',
    icono: 'fa-solid fa-list-check',
  },
]
