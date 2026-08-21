# Backlog técnico

Deuda aceptada a conciencia. Cada entrada dice qué se hizo, por qué se aceptó
y cuál es el disparador que obliga a resolverla.

## Refresh token en localStorage

**Estado:** abierto. **Disparador:** antes del piloto de campo.

El refresh token se guarda en `localStorage` (`apps/web/src/auth/token-storage.ts`)
y el access token vive solo en memoria, en el estado de React.

Cualquier XSS que consiga ejecutar script en el origen puede leer el refresh
token y quedarse con una sesión renovable. El access token en memoria no se
persiste, así que sobrevive menos, pero el refresh es el que importa.

Se aceptó para el esqueleto porque la alternativa correcta —cookie `httpOnly`

- `SameSite` emitida por la API— exige cambiar el contrato de
  `POST /api/v1/auth/refresh`: hoy el refresh token viaja en el header
  `Authorization` (`JwtRefreshStrategy` lo extrae con
  `ExtractJwt.fromAuthHeaderAsBearerToken()`), y pasarlo a cookie implica tocar
  la estrategia, el guard, CORS con credenciales y el flujo de logout.

**Para cerrarla:** emitir el refresh token como cookie `httpOnly`, `Secure`,
`SameSite=Lax` desde la API; que `/auth/refresh` la lea de la cookie en vez del
header; agregar un `POST /auth/logout` que la invalide; y borrar
`token-storage.ts` del cliente.

## No hay endpoint de usuario actual

**Estado:** abierto. **Disparador:** cuando la UI necesite datos del usuario
que no estén en el token (nombre completo, estado `active`, permisos finos).

La API no expone `/auth/me`, y `GET /api/v1/users` es solo `ADMIN`, así que un
`SELLER` o un `DRIVER` no puede consultarse a sí mismo. El cliente resuelve la
identidad decodificando el payload del access token
(`apps/web/src/api/decode-token.ts`): trae `sub`, `username` y `roles`, que es
todo lo que la UI necesita hoy.

Esto es seguro —la firma la verifica el servidor en cada petición, y un token
manipulado en el navegador solo consigue un 401— pero el payload es una foto
del momento del login: si a un usuario le cambian los roles o lo desactivan, la
UI sigue mostrando lo viejo hasta el próximo refresh.

**Para cerrarla:** agregar `GET /api/v1/auth/me` protegido con `JwtAccessGuard`
que devuelva el usuario desde la base, y usarlo como fuente de verdad en la UI.
