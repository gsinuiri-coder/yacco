-- La fila de `roles` para VIEWER. Va en su propia migración porque Postgres no
-- deja usar un valor de enum en la misma transacción que lo agregó (la
-- anterior, 20260925010000_user_role_viewer). Las otras tres filas las puso el
-- seed; esta se inserta acá para que exista en toda base migrada, sin
-- depender de volver a sembrar producción. Idempotente.
INSERT INTO "roles" ("name") VALUES ('VIEWER') ON CONFLICT ("name") DO NOTHING;
