# Carga de los datos reales — deploy final

Lo que la planta tiene que cargar en producción después del deploy final, en
este orden, y en qué pantalla. Todo se carga desde la web, como cualquier día
de trabajo: nada por la base de datos.

Los datos de prueba (`pnpm demo:prueba`, ítem K de
[`plan-final.md`](./plan-final.md)) **no van a producción**: viven solo en la
base local de Docker y el script se niega a correr contra cualquier otra base.
En producción no hay nada «PRUEBA» que limpiar, salvo lo que ya estaba antes
del piloto (ver [`guion-piloto.md`](./guion-piloto.md), «¿Cuántos envases
tiene hoy la planta?»).

La tarjeta «Puesta en marcha» del Panel (solo la ve el administrador) lista
lo que todavía falta de esta hoja y desaparece cuando está todo.

| #   | Qué                     | Quién         | Pantalla                                                                | Cómo se carga                                                                                                                                          |
| --- | ----------------------- | ------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Precios de lista reales | Administrador | Administración › **Productos**                                          | Uno por producto (recarga con caño, recarga sin caño, bidón con caño, bidón sin caño). Cada cambio queda en el historial del producto.                 |
| 2   | Usuarios                | Administrador | Administración › **Usuarios**                                           | Un usuario por chofer (rol Chofer) y por persona de oficina (rol Vendedor). La contraseña inicial se le da a cada uno en persona; la cambian ellos.    |
| 3   | Días de reparto         | Administrador | Administración › **Zonas**                                              | Los días en que se reparte cada zona. Una zona sin días no se puede planificar con criterio.                                                           |
| 4   | Conteo de la planta     | Administrador | Envases y producción › **Inventario de envases**, «Conteo de la planta» | Los bidones vacíos y llenos que hay hoy en la planta, de cada tipo. Lo que falte entra como «Ingreso de envases nuevos» en **Movimientos de envases**. |
| 5   | Conteo de clientes      | Oficina       | Envases en poder de clientes                                            | Los bidones que tiene cada cliente, zona por zona. Una ubicación sin contar sigue con el saldo que traía el padrón.                                    |

## Antes de empezar

- El padrón de clientes ya está en producción (supuesto 14, cargado el
  2026-09-24); las zonas de los clientes las cargó Giancarlo el 2026-09-25.
- El usuario administrador ya existe. Rotar su contraseña es de Giancarlo
  (Pendientes, en [`PROGRESO.md`](./PROGRESO.md)).
- Las migraciones del deploy final van fuera de 08:00–20:00 (hora de Lima).
