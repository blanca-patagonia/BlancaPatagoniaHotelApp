#!/usr/bin/env node
/**
 * Verifica y limpia datos de prueba con prefijos QA/ZZZ/TEST.
 *
 * La tarea #22 limpió huéspedes, reservas, agencias y proveedores,
 * pero el otro Claude encontró un tipo "QA Verif Tipo" que quedó.
 * Este script busca exhaustivamente en todas las tablas con datos
 * de prueba potenciales.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

// Leer .env.local manualmente
const envContent = readFileSync('.env.local', 'utf-8')
const envVars = {}
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) {
    envVars[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
  }
}

const SUPABASE_URL = envVars.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

console.log('🔍 Buscando datos de prueba con prefijos QA/ZZZ/TEST...\n')

// Buscar en cada tabla
const busquedas = [
  {
    tabla: 'tipos_unidad',
    campos: 'id, nombre, codigo',
    filtro: 'or(nombre.ilike.%QA%,nombre.ilike.%ZZZ%,nombre.ilike.%TEST%,codigo.ilike.%QA%,codigo.ilike.%ZZZ%,codigo.ilike.%TEST%)',
  },
  {
    tabla: 'unidades',
    campos: 'id, nombre',
    filtro: 'or(nombre.ilike.%QA%,nombre.ilike.%ZZZ%,nombre.ilike.%TEST%)',
  },
  {
    tabla: 'huespedes',
    campos: 'id, apellido, nombre',
    filtro: 'or(apellido.ilike.%QA%,apellido.ilike.%ZZZ%,apellido.ilike.%TEST%,nombre.ilike.%QA%,nombre.ilike.%ZZZ%,nombre.ilike.%TEST%)',
  },
  {
    tabla: 'reservas',
    campos: 'id, codigo',
    filtro: 'or(codigo.ilike.%QA%,codigo.ilike.%ZZZ%,codigo.ilike.%TEST%)',
  },
  {
    tabla: 'agencias',
    campos: 'id, nombre',
    filtro: 'or(nombre.ilike.%QA%,nombre.ilike.%ZZZ%,nombre.ilike.%TEST%)',
  },
  {
    tabla: 'proveedores',
    campos: 'id, nombre',
    filtro: 'or(nombre.ilike.%QA%,nombre.ilike.%ZZZ%,nombre.ilike.%TEST%)',
  },
  {
    tabla: 'productos_servicios',
    campos: 'id, nombre',
    filtro: 'or(nombre.ilike.%QA%,nombre.ilike.%ZZZ%,nombre.ilike.%TEST%)',
  },
  {
    tabla: 'promociones',
    campos: 'id, nombre',
    filtro: 'or(nombre.ilike.%QA%,nombre.ilike.%ZZZ%,nombre.ilike.%TEST%)',
  },
]

const encontrados = []

for (const { tabla, campos, filtro } of busquedas) {
  const { data, error } = await supabase.from(tabla).select(campos).or(filtro)

  if (error) {
    console.error(`❌ Error en ${tabla}:`, error.message)
    continue
  }

  if (data && data.length > 0) {
    console.log(`📋 ${tabla}: ${data.length} encontrados`)
    for (const fila of data) {
      console.log(`   - ${JSON.stringify(fila)}`)
      encontrados.push({ tabla, id: fila.id })
    }
  }
}

if (encontrados.length === 0) {
  console.log('\n✅ No hay datos de prueba con prefijos QA/ZZZ/TEST')
  process.exit(0)
}

// Buscar reservas de los huéspedes encontrados
const idsHuespedes = encontrados.filter(e => e.tabla === 'huespedes').map(e => e.id)
if (idsHuespedes.length > 0) {
  console.log(`\n🔗 Buscando reservas de ${idsHuespedes.length} huéspedes de prueba...`)
  const { data: reservasAsociadas, error } = await supabase
    .from('reservas')
    .select('id, codigo')
    .in('huesped_id', idsHuespedes)

  if (!error && reservasAsociadas && reservasAsociadas.length > 0) {
    console.log(`📋 reservas: ${reservasAsociadas.length} asociadas a huéspedes de prueba`)
    for (const r of reservasAsociadas) {
      console.log(`   - ${JSON.stringify(r)}`)
      encontrados.push({ tabla: 'reservas', id: r.id })
    }
  }
}

console.log(`\n🧹 Limpiando ${encontrados.length} filas...\n`)

// Borrar en orden inverso de dependencias: primero las hojas
const orden = [
  'reservas',           // depende de huespedes, unidades, agencias
  'huespedes',          // no tiene FK salientes críticas para esta limpieza
  'unidades',           // depende de tipos_unidad
  'productos_servicios',
  'promociones',
  'agencias',
  'proveedores',
  'tipos_unidad',       // al final porque unidades depende de esto
]

let borradas = 0
for (const tabla of orden) {
  const ids = encontrados.filter(e => e.tabla === tabla).map(e => e.id)
  if (ids.length === 0) continue

  const { error } = await supabase.from(tabla).delete().in('id', ids)

  if (error) {
    console.error(`❌ Error borrando de ${tabla}:`, error.message)
  } else {
    console.log(`✓ ${tabla}: ${ids.length} borradas`)
    borradas += ids.length
  }
}

console.log(`\n✅ Limpieza completa: ${borradas} filas eliminadas`)
