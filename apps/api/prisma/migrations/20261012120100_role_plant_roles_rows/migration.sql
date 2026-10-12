-- Las filas de `roles` para PLANT_SUPERVISOR y PLANT_OPERATOR. Va en su propia
-- migración porque Postgres no deja usar un valor de enum en la misma transacción
-- que lo agregó (20261012120000_user_role_plant_roles). Idempotente.
INSERT INTO "roles" ("name") VALUES ('PLANT_SUPERVISOR'), ('PLANT_OPERATOR') ON CONFLICT ("name") DO NOTHING;
