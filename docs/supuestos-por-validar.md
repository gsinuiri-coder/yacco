# Supuestos por validar con el dueño de la planta

Decisiones de producto que se tomaron **entre Giancarlo y la capa
arquitectónica**, sin preguntárselas al dueño de la planta, y sobre las que ya
hay código construido.

No son deuda técnica —para eso está [`backlog-tecnico.md`](./backlog-tecnico.md)—
ni requisitos: son **preguntas pendientes**. Este archivo existe para que el día
de la demo haya una lista que leer, y no haya que reconstruirla de memoria.

## Cómo se usa

Cada supuesto tiene siempre las mismas cuatro líneas. En la demo alcanza con
leer las **Preguntar**; las otras tres son para saber qué está en juego antes de
escuchar la respuesta.

- **Asumimos** — la afirmación sobre lo que el dueño necesita, prefiere o hace.
- **Construido encima** — qué código depende de que sea cierta.
- **Preguntar** — la pregunta, en el vocabulario de la planta, sin insinuar la
  respuesta que nos conviene.
- **Si dice que no** — qué cambia. Sirve para saber si la pregunta es barata o
  cara antes de hacerla.

Cuando uno se valida, se mueve a **Validados** al final, con la fecha y lo que
dijo. Cuando se cae, se borra de acá y se abre lo que corresponda en
`backlog-tecnico.md`. Un supuesto no se queda en esta lista después de tener
respuesta.

**Regla para escribir código nuevo:** si una decisión de producto se toma sin
preguntarle, se anota acá y el comentario del código dice que es un supuesto.
Lo que no se puede es escribirla como si él la hubiera pedido — el día que
diga otra cosa, el documento tiene que mostrar que nunca se lo preguntamos, no
que dijo que sí.

## Pendientes

### 1. El buscador del Panel muestra clientes desactivados

- **Asumimos:** que un cliente desactivado que todavía debe plata es
  exactamente a quien viene a buscar en el Panel.
- **Construido encima:** `apps/web/src/components/customer-quick-search.tsx`
  omite el filtro `active` que `CustomerSelect` sí aplica. Buscar por nombre o
  teléfono devuelve clientes en uso y desactivados por igual.
- **Preguntar:** cuando busca a un cliente en la pantalla de inicio, ¿espera
  encontrar también a los que dio de baja, o esos deberían desaparecer de la
  búsqueda?
- **Si dice que no:** barato. Pasarle `active: true` a `listCustomers` en ese
  componente, igual que hace `CustomerSelect`. No cambia el diseño de la
  búsqueda.

### 2. Al cambiar una contraseña, el administrador la elige y la dicta

- **Asumimos:** que el administrador elige la contraseña nueva y se la dicta a
  la persona, en vez de que el sistema genere una temporal que la persona
  cambie al entrar.
- **Construido encima:** el bloque «Cambiar contraseña» de
  `apps/web/src/pages/users-page.tsx`. Hoy no existe pantalla de «cambiar mi
  contraseña» en `apps/web/src/pages`, así que una temporal no tendría a dónde
  ir.
- **Preguntar:** cuando a alguien se le olvida su contraseña, ¿prefiere
  ponerle una usted y decírsela, o que el sistema le dé una provisional y que
  la persona se ponga la suya la primera vez que entre?
- **Si dice que no:** caro. Lo primero que falta es la pantalla de «cambiar mi
  contraseña» —que cualquier rol tiene que poder abrir—, y recién después el
  campo que marca la contraseña como provisional. No es un campo más en la
  pantalla de usuarios.

### 3. El administrador puede cambiarse la contraseña a sí mismo

- **Asumimos:** que está bien que el administrador se cambie la suya desde la
  misma pantalla, y que esa es la forma prevista de rotar `admin123`.
- **Construido encima:** `users-page.tsx` ofrece «Cambiar contraseña» también
  en la propia fila. La guarda de `isSelf` que sí tiene «Desactivar» —para no
  cerrarse la puerta desde adentro— deliberadamente no se aplica acá.
- **Preguntar:** ¿quiere poder cambiarse su propia contraseña desde esta
  pantalla, o prefiere que su contraseña se toque solo desde afuera del
  sistema?
- **Si dice que no:** barato en la pantalla, caro en la operación. Aplicar la
  misma guarda de `isSelf`, pero entonces rotar `admin123` vuelve a exigir un
  `UPDATE` a mano contra la base (ver «Password del admin de producción» en
  `backlog-tecnico.md`).

### 4. Decirle que la sesión abierta no se cierra alcanza

- **Asumimos:** que alcanza con **avisar** que cambiar la contraseña no cierra
  la sesión que esa persona tenga abierta, y que para cortarle el acceso hay
  que desactivarla.
- **Construido encima:** el aviso del bloque «Cambiar contraseña». Que la
  sesión no se cierre **no** es un supuesto: es un hecho del código, fijado por
  el test «resetting a user's password does NOT invalidate a refresh token
  already issued» en `apps/api/test/integration/auth.int.test.ts`. El supuesto
  es que decírselo sea suficiente.
- **Preguntar:** si le cambia la contraseña a alguien porque no quiere que siga
  entrando, ¿le sirve que esa persona siga adentro hasta que cierre sesión, o
  necesita que se caiga en ese momento?
- **Si dice que no:** caro, y no es un cambio de redacción. Hace falta
  invalidar tokens ya emitidos — ver «No hay forma de invalidar un token ya
  emitido» en `backlog-tecnico.md`, que además arrastra el caso de desactivar
  y reactivar.

### 5. Quitarle el rol de chofer a alguien avisa, pero no bloquea

- **Asumimos:** que si el administrador le quita «Chofer» a alguien que todavía
  tiene rutas sin cerrar, corresponde **avisarle cuántas** y dejarlo decidir, en
  vez de impedírselo hasta que las cierre.
- **Construido encima:** el bloque «Roles» de `apps/web/src/pages/users-page.tsx`
  consulta las rutas `PLANNED` e `IN_PROGRESS` de esa persona y pide
  confirmación diciendo el número. Si la consulta falla, se confirma igual
  diciendo que no se pudo verificar. Es coherente con la filosofía del resto del
  sistema —el límite de crédito advierte y no bloquea, una liquidación con
  descuadre cierra igual—, pero eso es una inferencia nuestra, no algo que él
  haya dicho de este caso.
- **Preguntar:** si le saca el permiso de repartir a alguien que todavía tiene
  reparto pendiente, ¿quiere que el sistema se lo deje hacer avisándole, o
  prefiere que no lo deje hasta que esas rutas estén cerradas?
- **Si dice que no:** barato en la pantalla —el botón de confirmar se
  deshabilita en vez de guardar— pero hay que decidir antes qué pasa si la
  consulta de rutas falla: bloquear por no poder verificar deja al
  administrador sin poder corregir un rol por un problema de red.

### 6. Las rutas conservan al chofer que las hizo

- **Asumimos:** que al quitarle el rol de chofer a alguien, sus rutas ya
  planificadas o en curso **siguen a su nombre**, sin reasignarse ni cancelarse.
- **Construido encima:** el cambio de roles no toca `routes` en absoluto.
  Descansa en que `route.driverId` es un hecho histórico y en que ADMIN y SELLER
  pueden terminar cualquier ruta desde la oficina
  (`assertCanAccessRoute`), así que ninguna queda trabada.
- **Preguntar:** cuando alguien deja de repartir, ¿la ruta que ya salió a su
  nombre tiene que seguir figurando como suya, o prefiere pasársela a otro
  chofer?
- **Si dice que no:** caro, y toca dominio. Reasignar una ruta cerrada o en
  curso significa decidir qué pasa con lo ya entregado y cobrado en esa ruta, y
  con la liquidación pendiente. No es un campo editable: es una operación con su
  propia forma, y probablemente su propia entrada de backlog.

## Validados

_Ninguno todavía._
