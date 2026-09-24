-- Expand (D-024): la versión de la sesión de cada usuario. Cada refresh token
-- lleva la vigente al emitirse; cambiar la contraseña o desactivar la sube, y
-- los tokens viejos dejan de refrescar. Aditiva y con default: las filas
-- existentes quedan en 0, que es justo lo que valida un token emitido antes
-- de este cambio (sin la versión en el payload, se lee como 0).
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
