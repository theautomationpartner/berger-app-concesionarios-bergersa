/**
 * Tipos compartidos de la app de concesionarios.
 *
 * Lo de los pedidos (pedido, renglón, unidad) vive junto a sus servicios en `services/monday`; acá
 * queda sólo lo que usan los paneles de navegación.
 */

/** Una sección de un panel: agrupa tarjetas bajo un título y un color. */
export interface SeccionPanel {
  id: string
  titulo: string
  detalle: string
  /** Se usa como clase CSS: `panel-grupo--${tono}`. */
  tono: 'azul' | 'naranja'
  icono: string
}

export interface OpcionPanel<T extends string> {
  id: T
  /** A qué sección del panel pertenece, si el panel tiene secciones. */
  seccion?: string
  titulo: string
  /** Rótulo corto, para pantallas angostas. */
  corto: string
  detalle: string
  icono: string
  /**
   * Cuántas pantallas hay adentro.
   *
   * Es la diferencia entre entrar a algo que abre otra lista y entrar a algo que ya es la pantalla
   * final. Sin esto hay que entrar para averiguarlo.
   */
  cuantas?: number
}
