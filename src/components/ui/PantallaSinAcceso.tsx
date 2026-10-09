interface Props {
  /**
   * - `fuera-de-monday`: se abrió la URL suelta, sin monday alrededor.
   * - `sin-acceso`: hay usuario de monday, pero no puede entrar (otra cuenta, no está en la Lista
   *   Blanca, inactivo, sin la app). Todos esos motivos se muestran IGUAL.
   */
  motivo: 'fuera-de-monday' | 'sin-acceso'
}

/**
 * Pantalla de acceso denegado.
 *
 * Es lo ÚNICO que se dibuja cuando alguien no puede entrar: sin barra de marca, sin operaciones y
 * sin ninguna consulta al tablero.
 *
 * Con un usuario de monday del otro lado, el mensaje es siempre el mismo, sea cual sea el motivo.
 * "Tu usuario está inactivo" o "no tenés esta app habilitada" le confirmarían a quien está
 * tanteando que su usuario existe en la lista y qué hay adentro. El motivo real queda en el
 * Registro de Accesos, que es donde lo tiene que ver un administrador.
 */
export function PantallaSinAcceso({ motivo }: Props) {
  return (
    <div className="sin-acceso">
      <span className="sin-acceso-ic">
        <i className="fa-solid fa-lock" aria-hidden="true" />
      </span>
      {motivo === 'fuera-de-monday' ? (
        <>
          <h1 className="sin-acceso-tit">No tenés acceso a este contenido</h1>
          <p className="sin-acceso-det">
            Esta aplicación funciona únicamente dentro de <b>monday.com</b>.
          </p>
        </>
      ) : (
        <>
          <h1 className="sin-acceso-tit">No tenés acceso a esta aplicación</h1>
          <p className="sin-acceso-det">Contactá al administrador.</p>
        </>
      )}
    </div>
  )
}

/** Espera mientras monday responde quién es el usuario. Dura un instante dentro del iframe. */
export function PantallaVerificando() {
  return (
    <div className="ingreso">
      <span className="spin" aria-hidden="true" />
      <p className="ingreso-pie">Verificando el acceso…</p>
    </div>
  )
}
