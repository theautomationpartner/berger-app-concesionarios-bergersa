import { useEffect, useRef, useState } from 'react'

interface Props {
  onCompleto: (codigo: string) => void
  deshabilitado: boolean
  /** Si cambia, el campo se vacía: después de un código rechazado hay que escribir uno nuevo. */
  reinicio: unknown
}

/**
 * Campo del código de 6 dígitos.
 *
 * Es UN solo `<input>` y no seis cajitas: seis campos rompen el pegado desde el portapapeles, el
 * autocompletado del sistema (`autocomplete="one-time-code"`) y la navegación con teclado, que son
 * justo las tres formas más rápidas de cargar el código. El aspecto de seis casillas lo da el CSS.
 *
 * Al completar el sexto dígito se envía solo: no hay nada que decidir entre escribir el código y
 * apretar "Ingresar", y el código cambia cada 30 segundos, así que cada clic de más es tiempo que
 * se le come.
 */
export function CampoCodigo({ onCompleto, deshabilitado, reinicio }: Props) {
  const [valor, setValor] = useState('')
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValor('')
    campo.current?.focus()
  }, [reinicio])

  return (
    <input
      ref={campo}
      className="codigo"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      aria-label="Código de 6 dígitos"
      placeholder="······"
      autoFocus
      disabled={deshabilitado}
      value={valor}
      onChange={(e) => {
        const limpio = e.target.value.replace(/\D/g, '').slice(0, 6)
        setValor(limpio)
        if (limpio.length === 6) onCompleto(limpio)
      }}
    />
  )
}
