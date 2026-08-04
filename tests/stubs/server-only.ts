/**
 * Reemplazo de `server-only` para los tests.
 *
 * El paquete real lo provee Next y su única función es **romper el build** si
 * un módulo de servidor se importa desde el navegador. Fuera de Next no existe,
 * así que sin este stub los tests de Server Actions no pueden ni cargar los
 * módulos que quieren probar.
 *
 * Es seguro: la protección que aporta `server-only` es de tiempo de compilación
 * de la aplicación, y ahí sigue intacta.
 */
export {}
