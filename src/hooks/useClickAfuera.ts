import { useEffect, type RefObject } from 'react'

/**
 * Llama a `alCerrar` cuando se toca fuera de `ref` o se aprieta Escape, mientras `activo` sea
 * verdadero.
 *
 * Escucha `pointerdown` y no `click`: en el celular el `click` llega después de que el dedo se
 * levanta, y para entonces el toque ya pudo haber abierto otra cosa debajo del desplegable.
 */
export function useClickAfuera(
  ref: RefObject<HTMLElement | null>,
  activo: boolean,
  alCerrar: () => void,
): void {
  useEffect(() => {
    if (!activo) return

    const alTocar = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) alCerrar()
    }
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') alCerrar()
    }

    document.addEventListener('pointerdown', alTocar)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('pointerdown', alTocar)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [ref, activo, alCerrar])
}
