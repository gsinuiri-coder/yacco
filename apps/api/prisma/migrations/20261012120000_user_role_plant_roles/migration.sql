-- AlterEnum
-- Agrega los valores PLANT_SUPERVISOR y PLANT_OPERATOR a user_role en su propia migración.
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'PLANT_SUPERVISOR';
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'PLANT_OPERATOR';
