/**
 * Las pantallas de la app de concesionarios.
 *
 * Es la operación PEDIDOS de la app de BERGER S.A., sacada a su propia app para el workspace
 * Concesionarios BERGER SA: lo que un concesionario hace es cargar sus pedidos y seguirlos, y esta
 * app no tiene nada más. Por eso son dos niveles y no tres —no hay COMPRA ni VENTA que elegir— y
 * no hay buscador ni panel lateral: con una sola operación, no hay nada que buscar.
 *
 * Cuando se sumen operaciones (por ejemplo, garantías), cada una entra como otra tarjeta del inicio
 * y su lista de pantallas, igual que PEDIDOS.
 */
import type { OpcionPanel } from '@/types'

export type OperacionPrincipal = 'pedidos'
export type PantallaPedidos = 'gestionar'

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
    id: 'gestionar',
    titulo: 'GESTIONAR PEDIDOS',
    corto: 'Gestionar pedidos',
    detalle: 'Cargar un pedido nuevo y seguir el estado de cada tractor de los que ya mandaste.',
    icono: 'fa-solid fa-cart-plus',
  },
]
