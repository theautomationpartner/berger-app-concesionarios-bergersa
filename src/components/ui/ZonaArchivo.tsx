import { useRef, useState } from 'react'
import { pesoArchivo } from '@/lib/format'

interface Props {
  archivo: File | null
  onElegir: (archivo: File | null) => void
  /** Extensiones aceptadas, para el `accept` del input y para el mensaje de rechazo. */
  acepta?: string
  /** Qué se está pidiendo. Cada operación adjunta un documento distinto. */
  titulo?: string
}

/**
 * Recuadro para adjuntar la transferencia: se puede soltar el archivo encima o abrir el
 * explorador.
 *
 * El `<input type="file">` está oculto pero SÍ existe en el DOM: es lo que le da a la zona el
 * comportamiento nativo de teclado y el diálogo del sistema. Reemplazarlo por un `div` con un
 * `onClick` deja la carga fuera del alcance de quien navega sin mouse.
 */
export function ZonaArchivo({
  archivo,
  onElegir,
  acepta = '.pdf',
  titulo = 'Arrastrá el archivo acá o hacé clic para buscarlo',
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [sobre, setSobre] = useState(false)
  const [rechazo, setRechazo] = useState<string | null>(null)

  const extensiones = acepta.split(',').map((e) => e.trim().toLowerCase())

  const aceptar = (f: File | undefined) => {
    if (!f) return
    const ok = extensiones.some((ext) => f.name.toLowerCase().endsWith(ext))
    if (!ok) {
      setRechazo(`El archivo tiene que ser ${extensiones.join(' o ')}.`)
      return
    }
    setRechazo(null)
    onElegir(f)
  }

  if (archivo) {
    return (
      <div className="archivo">
        <span className="archivo-ic">
          <i className="fa-solid fa-file-pdf" aria-hidden="true" />
        </span>
        <span className="archivo-txt">
          <span className="archivo-nom">{archivo.name}</span>
          <span className="archivo-peso">{pesoArchivo(archivo.size)} · listo para adjuntar</span>
        </span>
        <button
          type="button"
          className="btn btn--borde btn--chico archivo-quitar"
          onClick={() => {
            onElegir(null)
            // Sin esto, volver a elegir EL MISMO archivo no dispara `change` y no pasa nada.
            if (input.current) input.current.value = ''
          }}
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" /> Quitar
        </button>
      </div>
    )
  }

  return (
    <>
      <label
        className={`zona${sobre ? ' zona--sobre' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setSobre(true)
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => {
          e.preventDefault()
          setSobre(false)
          aceptar(e.dataTransfer.files?.[0])
        }}
      >
        <span className="zona-ic">
          <i className="fa-solid fa-cloud-arrow-up" aria-hidden="true" />
        </span>
        <span className="zona-tit">{titulo}</span>
        <span className="zona-det">Un archivo {extensiones.join(' o ')} de tu computadora</span>
        <input
          ref={input}
          type="file"
          accept={acepta}
          hidden
          onChange={(e) => aceptar(e.target.files?.[0])}
        />
      </label>
      {rechazo && (
        <div className="aviso aviso--error" style={{ marginTop: 12, marginBottom: 0 }}>
          <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
          <span>{rechazo}</span>
        </div>
      )}
    </>
  )
}
