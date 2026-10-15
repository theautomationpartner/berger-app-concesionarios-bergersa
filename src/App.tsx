import { useState } from 'react'
import { BarraMarca } from '@/components/ui/BarraMarca'
import { ConfirmarSalida } from '@/components/ui/ConfirmarSalida'
import { PantallaSinAcceso, PantallaVerificando } from '@/components/ui/PantallaSinAcceso'
import { clienteVistaPrevia } from '@/features/acceso/clienteVistaPrevia'
import { Ingreso, type SesionIngreso } from '@/features/acceso/Ingreso'
import { BarraNavegacion } from '@/features/inicio/BarraNavegacion'
import { PanelOpciones } from '@/features/inicio/PanelOpciones'
import { CrearPedido } from '@/features/pedidos/CrearPedido'
import { MisPedidos } from '@/features/ventas/MisPedidos'
import { useAccesoMonday } from '@/hooks/useAccesoMonday'
import { motivoParaNoSalir } from '@/hooks/useSalidaProtegida'
import {
  OPERACIONES_PRINCIPALES,
  PANTALLAS_PEDIDOS,
  RUTA_INICIO,
  type Ruta,
} from '@/lib/navegacion'
import { clienteIngreso } from '@/services/acceso/cliente'
import { MODULOS_APP } from '@/services/monday/operaciones'
import { mondayHabilitado } from '@/services/monday/sdk'

/**
 * En desarrollo, `?vista-previa` en la URL recorre las pantallas del ingreso con un servidor
 * simulado. Sin eso, en localhost se entra directo: ahí no corren las funciones de `api/`.
 * `import.meta.env.DEV` es `false` literal en el build de producción, así que esta rama —y el
 * cliente simulado— desaparecen del bundle publicado.
 */
const VISTA_PREVIA_INGRESO =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('vista-previa')

/**
 * En desarrollo, `?concesionario=BRUNO MAQUINARIAS S.R.L.` entra como un comercial de ese
 * concesionario (su equipo de monday tiene ese nombre). Sin el parámetro, como Administración. Es
 * sólo para mirar las pantallas en localhost: en producción los equipos los manda el servidor.
 */
const CONCESIONARIO_DEV = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('concesionario')
  : null

/**
 * Vista de tablero de CONCESIONARIOS BERGER S.A. — la app de los concesionarios, instalada en el
 * workspace Concesionarios BERGER SA.
 *
 * Tres barreras, en orden, y ninguna dibuja la app hasta que pasa:
 *
 *   1. monday   — ¿se abrió dentro del monday de BERGER?            (navegador, `useAccesoMonday`)
 *   2. ingreso  — ¿está en la Lista Blanca y pasó el autenticador? (servidor, `Ingreso`)
 *   3. datos    — cada pedido vuelve a comprobar las dos anteriores (servidor, `api/_seguridad`)
 *
 * Las dos primeras deciden QUÉ PANTALLA se ve. La que decide si se puede leer o escribir un dato
 * es la tercera, y está en el servidor: esconder la interfaz sin eso sería una cortina, no una
 * puerta.
 */
export function App() {
  const { acceso, usuarioId } = useAccesoMonday()

  if (acceso === 'verificando') return <PantallaVerificando />
  if (acceso === 'fuera-de-monday') return <PantallaSinAcceso motivo="fuera-de-monday" />
  if (acceso === 'sin-acceso') return <PantallaSinAcceso motivo="sin-acceso" />

  if (import.meta.env.DEV && !VISTA_PREVIA_INGRESO) {
    return (
      <AppAdentro
        sesion={{
          perfil: CONCESIONARIO_DEV
            ? {
                id: 'desarrollo',
                nombre: CONCESIONARIO_DEV,
                esAdministracion: false,
                equiposMonday: [{ id: '', nombre: CONCESIONARIO_DEV }],
              }
            : { id: 'desarrollo', nombre: 'Desarrollo local', esAdministracion: true, equiposMonday: [] },
          modulos: [...MODULOS_APP],
          salir: () => {},
          recuperacionRestantes: null,
        }}
      />
    )
  }

  return (
    <Ingreso
      cliente={import.meta.env.DEV ? clienteVistaPrevia : clienteIngreso}
      usuarioId={usuarioId}
    >
      {(sesion) => <AppAdentro sesion={sesion} />}
    </Ingreso>
  )
}

/**
 * La app propiamente dicha, una vez adentro: el inicio con las operaciones, la operación con sus
 * pantallas, y la pantalla. Volver a un nivel anterior desmonta la pantalla entera, y con ella
 * cualquier cosa a medio hacer —por eso salir pregunta antes cuando hay algo sin mandar.
 */
function AppAdentro({ sesion }: { sesion: SesionIngreso }) {
  const [ruta, setRuta] = useState<Ruta>(RUTA_INICIO)
  /** La salida que quedó esperando confirmación, con el porqué de la pantalla que se deja. */
  const [saliendo, setSaliendo] = useState<{ motivo: string; seguir: () => void } | null>(null)

  /* Toda salida de una pantalla pasa por acá: si la pantalla abierta pidió que no se la deje sin
     preguntar —está escribiendo en monday, o tiene algo armado sin mandar— primero se pregunta. */
  const salirSiSePuede = (seguir: () => void) => {
    const motivo = motivoParaNoSalir()
    if (motivo) setSaliendo({ motivo, seguir })
    else seguir()
  }
  const navegar = (r: Ruta) => salirSiSePuede(() => setRuta(r))

  /* El concesionario tiene sólo el módulo `pedidos`; si el servidor no se lo dio, no hay nada que
     mostrarle. */
  const puedePedidos = sesion.modulos.includes('pedidos')

  const barra = (
    <BarraMarca
      navegacion={<BarraNavegacion ruta={ruta} onIr={navegar} />}
      perfil={sesion.perfil.nombre}
      onSalir={
        import.meta.env.DEV && !VISTA_PREVIA_INGRESO
          ? undefined
          : () => salirSiSePuede(sesion.salir)
      }
    />
  )

  /* Único caso de desarrollo: la app corre en localhost sin token en `.env.local`. */
  if (!mondayHabilitado()) {
    return (
      <div className="app">
        {barra}
        <div className="scroll">
          <div className="view">
            <div className="aviso aviso--error">
              <i className="fa-solid fa-key" aria-hidden="true" />
              <span>
                Falta el token de Monday. Copiá <code>.env.example</code> a <code>.env.local</code>,
                completá <code>VITE_MONDAY_TOKEN</code> y reiniciá <code>npm run dev</code>.
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {barra}

      {/* Entró con un código de recuperación: probablemente perdió el celular. Se le avisa cuántos
          le quedan y qué hacer, en vez de dejarlo descubrirlo el día que se le terminan. */}
      {sesion.recuperacionRestantes != null && (
        <div className="aviso aviso--alerta aviso--banda">
          <i className="fa-solid fa-life-ring" aria-hidden="true" />
          <span>
            Entraste con un código de recuperación. Te{' '}
            {sesion.recuperacionRestantes === 1
              ? 'queda 1'
              : `quedan ${sesion.recuperacionRestantes}`}
            . Si perdiste el celular, pedile a BERGER que te reinicie la verificación.
          </span>
        </div>
      )}

      {ruta.principal === null && (
        <PanelOpciones
          titulo="¿Qué vas a hacer?"
          detalle="Elegí la operación."
          opciones={OPERACIONES_PRINCIPALES.filter((o) => o.id !== 'pedidos' || puedePedidos).map(
            (o) => ({ ...o, cuantas: o.id === 'pedidos' ? PANTALLAS_PEDIDOS.length : undefined }),
          )}
          onElegir={(id) => navegar({ ...RUTA_INICIO, principal: id })}
        />
      )}

      {ruta.principal === 'pedidos' && ruta.pedidos === null && (
        <PanelOpciones
          titulo="Pedidos"
          detalle="Tus pedidos de tractores a BERGER: cargarlos y seguirlos."
          opciones={PANTALLAS_PEDIDOS}
          onElegir={(id) => navegar({ principal: 'pedidos', pedidos: id })}
        />
      )}

      {ruta.principal === 'pedidos' && ruta.pedidos === 'crear' && puedePedidos && (
        <CrearPedido
          equipos={sesion.perfil.equiposMonday ?? []}
          esAdministracion={Boolean(sesion.perfil.esAdministracion)}
          comercialId={sesion.perfil.usuarioId}
          onIrAMisPedidos={() => setRuta({ principal: 'pedidos', pedidos: 'mios' })}
        />
      )}

      {ruta.principal === 'pedidos' && ruta.pedidos === 'mios' && puedePedidos && (
        <MisPedidos
          equipos={sesion.perfil.equiposMonday ?? []}
          esAdministracion={Boolean(sesion.perfil.esAdministracion)}
          usuarioId={sesion.perfil.usuarioId}
        />
      )}

      {saliendo && (
        <ConfirmarSalida
          motivo={saliendo.motivo}
          onQuedarse={() => setSaliendo(null)}
          onSalir={() => {
            setSaliendo(null)
            saliendo.seguir()
          }}
        />
      )}
    </div>
  )
}
