import { useCallback, useEffect, useState } from 'react'
import type { ModuloApp } from '@/services/monday/operaciones'
import type {
  ClienteIngreso,
  PedidoIngreso,
  PerfilIngreso,
  RespuestaIngreso,
} from '@/services/acceso/cliente'
import {
  borrarSesionDelDia,
  cargarSesionDelDia,
  EVENTO_REINGRESAR,
  EVENTO_SIN_ACCESO,
  guardarSesionDelDia,
} from '@/services/acceso/sesionDelDia'

/** Pantalla del ingreso que corresponde mostrar. */
export type PasoIngreso =
  | { tipo: 'cargando' }
  | { tipo: 'sin_acceso' }
  | { tipo: 'error' }
  | {
      tipo: 'configurar'
      perfil: PerfilIngreso
      otpauth: string
      secreto: string
      puedeImportar: boolean
    }
  | { tipo: 'codigos'; perfil: PerfilIngreso; codigos: string[]; modulos: ModuloApp[] }
  | { tipo: 'verificar'; perfil: PerfilIngreso }
  | { tipo: 'listo'; perfil: PerfilIngreso; modulos: ModuloApp[] }

const MENSAJE_BLOQUEADO = 'Demasiados intentos. Esperá 15 minutos y volvé a probar.'
const MENSAJE_ERROR = 'No se pudo verificar el código. Probá de nuevo en unos minutos.'
const MENSAJE_CLAVE =
  'Esa clave no parece válida. Copiala completa desde el gestor de contraseñas, sin espacios de más.'

function mensajeIncorrecto(restantes?: number): string {
  const base = 'El código no es correcto. Usá el que muestra ahora la app del celular.'
  return restantes != null && restantes <= 2
    ? `${base} Te ${restantes === 1 ? 'queda 1 intento' : `quedan ${restantes} intentos`}.`
    : base
}

/**
 * Recorrido del ingreso: Lista Blanca → perfil → autenticador → app.
 *
 * El navegador no decide ningún paso: le pregunta al servidor qué falta y muestra la pantalla que
 * corresponde. Lo único que hace por su cuenta es encadenar lo obvio —si el servidor dice
 * "configurar", pedir el QR sin esperar un clic— y guardar la sesión del día cuando llega.
 *
 * También escucha los rechazos de los pedidos de datos: si la sesión vence con la app abierta
 * (pasó la medianoche) vuelve a pedir el código, y si al perfil lo dieron de baja muestra el cartel
 * de acceso denegado. Las pantallas de la app no se enteran de nada de esto.
 */
export function useIngreso(cliente: ClienteIngreso, usuarioId: string | null) {
  const [paso, setPaso] = useState<PasoIngreso>({ tipo: 'cargando' })
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  /** Después de usar un código de recuperación: cuántos le quedan, para avisarle. */
  const [recuperacionRestantes, setRecuperacionRestantes] = useState<number | null>(null)
  const pedir = useCallback((pedido: PedidoIngreso) => cliente.pedir(pedido), [cliente])

  const aplicar = useCallback(
    async (r: RespuestaIngreso): Promise<void> => {
      switch (r.estado) {
        case 'sin_acceso':
          borrarSesionDelDia()
          setPaso({ tipo: 'sin_acceso' })
          return
        case 'error':
          setPaso((actual) => (actual.tipo === 'cargando' ? { tipo: 'error' } : actual))
          setMensaje(MENSAJE_ERROR)
          return
        case 'configurar':
          if (r.otpauth && r.secreto) {
            setPaso({
              tipo: 'configurar',
              perfil: r.perfil,
              otpauth: r.otpauth,
              secreto: r.secreto,
              puedeImportar: Boolean(r.puedeImportar),
            })
          } else {
            // Primera vez: se pide el QR directamente, sin un clic intermedio que no decide nada.
            await aplicar(await pedir({ accion: 'iniciar' }))
          }
          return
        case 'verificar':
          setPaso({ tipo: 'verificar', perfil: r.perfil })
          return
        case 'listo':
          guardarSesionDelDia(r.sesion)
          setMensaje(null)
          if (r.recuperacionRestantes != null) setRecuperacionRestantes(r.recuperacionRestantes)
          // Recién configurado: antes de entrar, los códigos de recuperación. Se muestran UNA vez.
          setPaso(
            r.codigosRecuperacion?.length
              ? {
                  tipo: 'codigos',
                  perfil: r.perfil,
                  codigos: r.codigosRecuperacion,
                  modulos: r.modulos ?? [],
                }
              : { tipo: 'listo', perfil: r.perfil, modulos: r.modulos ?? [] },
          )
          return
        case 'codigo_incorrecto':
          setMensaje(mensajeIncorrecto(r.intentosRestantes))
          return
        case 'bloqueado':
          setMensaje(MENSAJE_BLOQUEADO)
          return
        case 'clave_invalida':
          setMensaje(MENSAJE_CLAVE)
          return
      }
    },
    [pedir],
  )

  const consultarEstado = useCallback(async () => {
    setMensaje(null)
    await aplicar(await pedir({ accion: 'estado' }))
  }, [aplicar, pedir])

  /* Arranque: cuando se conoce el usuario de monday, se carga su sesión guardada y se pregunta. */
  useEffect(() => {
    if (!usuarioId) return
    cargarSesionDelDia(usuarioId)
    void consultarEstado()
  }, [usuarioId, consultarEstado])

  /* Rechazos de los pedidos de datos, avisados por el cliente de la API. */
  useEffect(() => {
    const reingresar = () => {
      borrarSesionDelDia()
      setPaso({ tipo: 'cargando' })
      void consultarEstado()
    }
    const sinAcceso = () => {
      borrarSesionDelDia()
      setPaso({ tipo: 'sin_acceso' })
    }
    window.addEventListener(EVENTO_REINGRESAR, reingresar)
    window.addEventListener(EVENTO_SIN_ACCESO, sinAcceso)
    return () => {
      window.removeEventListener(EVENTO_REINGRESAR, reingresar)
      window.removeEventListener(EVENTO_SIN_ACCESO, sinAcceso)
    }
  }, [consultarEstado])

  /** Envía un pedido mostrando que está en curso. Nunca se pueden mandar dos a la vez. */
  const enviar = useCallback(
    async (pedido: PedidoIngreso) => {
      setEnviando(true)
      setMensaje(null)
      try {
        await aplicar(await pedir(pedido))
      } finally {
        setEnviando(false)
      }
    },
    [aplicar, pedir],
  )

  return {
    paso,
    mensaje,
    enviando,
    recuperacionRestantes,

    confirmar: (codigo: string, clave?: string) =>
      enviar({ accion: 'confirmar', codigo, ...(clave ? { clave } : {}) }),

    verificar: (codigo: string, recuperacion = false) =>
      enviar({ accion: 'verificar', codigo, recuperacion }),

    /** Después de guardar los códigos de recuperación. */
    entrar: () =>
      setPaso((actual) =>
        actual.tipo === 'codigos'
          ? { tipo: 'listo', perfil: actual.perfil, modulos: actual.modulos }
          : actual,
      ),

    /**
     * Cierra la sesión del día en este navegador y vuelve al principio. Con perfiles compartidos
     * es la forma de que entre otra persona desde la misma computadora.
     */
    salir: () => {
      borrarSesionDelDia()
      setRecuperacionRestantes(null)
      setPaso({ tipo: 'cargando' })
      void consultarEstado()
    },

    reintentar: () => {
      setPaso({ tipo: 'cargando' })
      void consultarEstado()
    },
  }
}
