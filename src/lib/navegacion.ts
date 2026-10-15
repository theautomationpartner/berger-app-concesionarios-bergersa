/**
 * Las pantallas de la app de concesionarios.
 *
 * Es la operación PEDIDOS de la app de BERGER S.A., sacada a su propia app para el workspace
 * Concesionarios BERGER SA: lo que un concesionario hace es cargar sus pedidos y seguirlos, y esta
 * app no tiene nada más. Por eso son dos niveles y no tres —no hay COMPRA ni VENTA que elegir— y
 * no hay buscador ni panel lateral: con una sola operación, no hay nada que buscar.
 *
 * Crear y seguir son dos pantallas y no dos solapas de una: cada una aprovecha la pantalla entera,
 * y los pasos del pedido quedan arriba, sin una fila de opciones encima.
 */
import type { OpcionPanel } from '@/types'

export type OperacionPrincipal = 'pedidos'
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
