/**
 * Comprueba que las funciones de `api/` no arrastren el alias `@/`.
 *
 * Por qué existe: las funciones edge de Vercel se empaquetan con **su propio** resolutor, que no
 * conoce el alias `@/` de Vite. Un import de más en `api/` —o en cualquier archivo que `api/`
 * alcance— hace que el deploy falle con "is referencing unsupported modules", y el build local
 * pasa igual porque Vite sí resuelve el alias. Eso dejó la app sin desplegar dos días sin que
 * `npm run build` dijera nada.
 *
 * El chequeo camina el árbol de imports desde `api/` y falla si encuentra un `@/` en el camino.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const RAIZ = resolve(import.meta.dirname, '..')

/** Todos los .ts de una carpeta, recursivo. */
function archivosDe(carpeta) {
  const salida = []
  for (const nombre of readdirSync(carpeta)) {
    const ruta = join(carpeta, nombre)
    if (statSync(ruta).isDirectory()) salida.push(...archivosDe(ruta))
    else if (ruta.endsWith('.ts') || ruta.endsWith('.tsx')) salida.push(ruta)
  }
  return salida
}

/** Los imports de un archivo, en crudo: sirve tanto el `from '...'` como el `import('...')`. */
function importsDe(texto) {
  const rutas = []
  for (const m of texto.matchAll(/from\s+'([^']+)'/g)) rutas.push(m[1])
  for (const m of texto.matchAll(/import\(\s*'([^']+)'\s*\)/g)) rutas.push(m[1])
  return rutas
}

/** Resuelve una ruta relativa a un archivo real, probando las extensiones de siempre. */
function resolver(desde, ruta) {
  const base = resolve(dirname(desde), ruta)
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidato).isFile()) return candidato
    } catch {
      // Sigue con el próximo candidato.
    }
  }
  return null
}

const problemas = []
const vistos = new Set()
const pendientes = archivosDe(join(RAIZ, 'api'))

while (pendientes.length > 0) {
  const archivo = pendientes.pop()
  if (vistos.has(archivo)) continue
  vistos.add(archivo)

  const texto = readFileSync(archivo, 'utf8')
  for (const ruta of importsDe(texto)) {
    if (ruta.startsWith('@/')) {
      problemas.push(`${archivo.replace(RAIZ, '.')} → ${ruta}`)
      continue
    }
    if (!ruta.startsWith('.')) continue // paquete de node_modules: lo resuelve Vercel
    const destino = resolver(archivo, ruta)
    if (destino) pendientes.push(destino)
  }
}

if (problemas.length > 0) {
  console.error('\nLas funciones de api/ alcanzan módulos con el alias "@/":\n')
  for (const p of problemas) console.error(`  ${p}`)
  console.error(
    '\nVercel no resuelve ese alias al empaquetar las funciones edge y el deploy va a fallar.\n' +
      'Usá un import relativo, o mové lo que haga falta a un módulo sin alias (por ejemplo\n' +
      'src/services/monday/columns.ts, que no importa nada).\n',
  )
  process.exit(1)
}

console.log(`api/: ${vistos.size} archivos revisados, ninguno usa el alias "@/".`)
