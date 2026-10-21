# Front de gestión — el panel del staff

Requiere login. Cada módulo de `panel/` verifica el rol con `requerirAcceso`.

- `login/` — ingreso y recuperación de contraseña
- `panel/_components/` — kit visual compartido (usar siempre estos componentes)
- `panel/<modulo>/` — un módulo por carpeta, con el mismo molde:
  `page.tsx` (listado) · `nuevo/` (alta) · `[id]/` (ficha) · `[id]/editar/` ·
  `actions.ts` (lo que guarda, corre en el servidor)
