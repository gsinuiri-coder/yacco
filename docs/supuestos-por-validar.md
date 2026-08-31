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

**Una decisión puede aterrizar en Validados sin haber pasado nunca por
Pendientes.** Pasa cada vez que el dueño resuelve algo que nadie llegó a anotar
como supuesto —porque la pregunta apareció y se le hizo en el mismo día, o
porque el tema se descubrió ya con él delante—. Esas entradas se escriben
directamente abajo; no se inventa un pendiente retroactivo para que el
documento parezca más prolijo de lo que fue.

Cada entrada validada lleva, además de la fecha, una línea **Cómo se resolvió**
con uno de dos valores, y la diferencia importa:

- **Respondió la pregunta** — se le preguntó en el vocabulario de la planta, sin
  insinuar la respuesta que nos convenía, y eligió.
- **Aprobó la recomendación** — le llevamos una propuesta razonada, con lo que
  implicaba, y dijo que sí.

Las dos son decisiones suyas y ninguna vale menos, pero no son lo mismo: el día
que diga otra cosa, el documento tiene que poder mostrar cuál de las dos fue —si
eligió entre opciones o si aceptó la nuestra.

Las entradas validadas tienen tres líneas:

- **Qué se decidió** — la decisión, en una frase, con lo que quedó explícitamente
  afuera.
- **Cómo se resolvió** — uno de los dos valores de arriba.
- **Construido encima** — qué código la implementa, o que todavía no hay ninguno.

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

### 7. El cliente devuelve los vacíos en la visita siguiente, no en el momento

- **Asumimos** que el ciclo normal es: el chofer deja llenos hoy y se lleva los
  vacíos de la visita anterior, así que un cliente habitual queda con más o
  menos una visita de envases en la mano. También asumimos que un saldo
  negativo es raro y viene del cuaderno de papel —envases entregados que nadie
  anotó— y no de la operación de todos los días.
- **Construido encima:** el plan de `seed-demo-plan.ts`. De nueve visitas con
  devolución, ocho devuelven lo de la visita anterior y una devuelve de más,
  que es el descuadre que la pantalla de cuadre necesita mostrar. Esa
  proporción es la que enseña, a quien mire la demo, qué es normal y qué es
  excepción.
- **Preguntar:** cuando su chofer llega a un cliente, ¿se trae los envases
  vacíos de la vez pasada, o el cliente se los va guardando y se los entrega
  cada tanto? ¿Cuántos envases suele tener un cliente habitual en la mano?
- **Si dice que no:** barato, y solo toca la demo. Si los clientes acumulan
  varias visitas antes de devolver, cambian las cantidades del plan y los
  saldos quedan más altos; el descuadre se sigue produciendo igual. Nada de
  esto toca el código de producción.

### 8. El administrador que corrige una parada queda como quien autorizó el precio

- **Asumimos** que, en una corrección, no hace falta preguntarle a nadie más:
  quien corrige es el administrador, la operación ya lleva su motivo escrito, y
  que él mismo figure como el que autorizó el precio de esa venta es fiel a lo
  que pasó. Asumimos también que al dueño no le molesta ver su propio nombre
  como autorizador en una corrección que no tocó ningún precio.
- **Construido encima:** `RoutesService.correctStop` manda
  `priceOverrideAuthorizedById: actor.id` SIEMPRE al volver a registrar la
  parada, no solo cuando el precio difiere, y el endpoint rechaza con 400 un
  `priceOverrideAuthorizedById` que venga en el cuerpo. Tiene un efecto de
  costado que conviene tener presente: `hasOverride` se calcula contra el
  precio VIGENTE HOY, así que una corrección que no toca el precio igual queda
  marcada como venta con precio autorizado si el `CustomerPrice` de ese cliente
  cambió desde la venta original.
- **Preguntar:** cuando usted corrige lo que se anotó de una visita, ¿alcanza
  con que quede su nombre y el motivo, o quiere que el sistema le pregunte
  aparte quién autorizó cobrar distinto de lo pactado?
- **Si dice que no:** barato. `correctionReason` ya viaja obligatorio; lo que
  cambia es dejar de forzar el autorizador y volver a exigirlo solo cuando el
  precio difiere de verdad, con un campo más en el formulario de corrección.
  Nada de esto toca la anulación ni el libro de movimientos.

### 9. La parada muestra solo la última corrección, no todas

- **Asumimos** que corregir una parada dos veces es raro, y que cuando pasa lo
  que la oficina necesita ver es cómo quedó y por qué se cambió la última vez.
  El historial completo de correcciones lo asumimos material de auditoría, no
  de la pantalla del día a día.
- **Construido encima:** las tres columnas `corrected_at` / `corrected_by` /
  `correction_reason` de `route_stops`, que una segunda corrección PISA. No se
  pierde nada: cada corrección deja su propia venta anulada —con su
  `voided_at`, `voided_by` y `void_reason`— y sus movimientos `*_VOID` en el
  libro, que es inmutable. La alternativa era una tabla
  `route_stop_corrections` con su modelo, su endpoint y su pantalla, para
  contar lo que esas dos fuentes ya cuentan.
- **Preguntar:** si una visita se corrige dos veces, ¿le sirve ver solo la
  última corrección con su motivo, o quiere la lista de todas las veces que se
  cambió, con quién y cuándo?
- **Si dice que no:** medio caro y toca esquema. Serían una tabla nueva de
  correcciones, una migración que además tendría que reconstruir el historial
  de lo ya corregido desde las ventas anuladas, y una pantalla que hoy no
  existe. No es una columna más: es un modelo.

## Validados

### Terminar una ruta exige sus paradas resueltas — 29/08/2026

- **Qué se decidió:** una ruta no puede terminarse mientras le quede una parada
  sin resolver; hay que marcar cada una como entregada o no entregada, o
  quitarla de la ruta. Se descartaron las dos alternativas: **no** se
  autocompletan las paradas al terminar (sería inventar un hecho de campo que
  nadie observó) y **no** se liberan los pedidos de las paradas pendientes
  (sería devolverlos a la bandeja como si nunca hubieran salido en un camión).
  Una ruta que nunca tuvo paradas sí se puede terminar.
- **Cómo se resolvió:** aprobó la recomendación. Se le llevó el caso —un pedido
  que queda «en ruta» para siempre porque su parada quedó a medias— con la
  propuesta de no dejar cerrar la ruta hasta resolverlas, y dijo que sí.
- **Construido encima:** el PR «terminar una ruta exige que sus paradas estén
  resueltas»: la guarda dentro del `WHERE` de `RoutesService.finish`, el 409 con
  el número de paradas que faltan, y el diálogo de «Terminar ruta» de la
  pantalla de detalle, que dejó de ofrecer confirmar cuando quedan paradas. El
  detalle de por qué este bloqueo no contradice el «avisa, no bloquea» del
  sistema está en «Terminar una ruta no exigía sus paradas resueltas», en
  [`backlog-tecnico.md`](./backlog-tecnico.md).

### La liquidación emite los `EMPTY_UNLOAD` que devuelven los vacíos al galpón — 29/08/2026

- **Qué se decidió:** al liquidar una ruta, los vacíos contados en la puerta
  vuelven al galpón con su movimiento `EMPTY_UNLOAD`, en vez de quedarse en
  `EMPTY_ON_ROUTE` para siempre. Cuatro cosas quedaron fijadas con la decisión:
  `emptiesCollected` deja de ser un entero y pasa a ser un **desglose por tipo
  de envase**, porque un movimiento de envases nombra siempre su tipo; el
  movimiento se emite **desde lo contado** en la puerta, no desde lo que dice el
  libro, que es justo el número contra el que se cuenta; es **automático dentro
  de `settle`** y no un paso aparte, porque descargar el camión no es una
  decisión que alguien tome cada tarde; y **no lleva migración** —
  `empties_collected` sigue guardando el total y el desglose se reconstruye del
  ledger, que es la fuente de verdad. `fullReturned` queda explícitamente
  **afuera**: los llenos que vuelven son otra conversación, y meterla acá
  duplicaría el alcance.
- **Cómo se resolvió:** aprobó la recomendación. Se le mostró el inventario de
  la demo abriendo con 34 «Con caño» en camión —envases que en la planta real
  vuelven al galpón el mismo día— con la propuesta de emitirlos desde la
  liquidación, y dijo que sí.
- **Construido encima:** el PR «la liquidación devuelve los vacíos al galpón»,
  que cerró «Descargar los vacíos al volver de ruta no tiene camino en la app»
  en [`backlog-tecnico.md`](./backlog-tecnico.md): `settle` emite un
  `EMPTY_UNLOAD` por cada tipo contado, `emptiesCollected` viaja desglosado por
  tipo, la pantalla de liquidación cuenta línea por línea y el seed de demo
  liquida todas sus rutas menos la última. `fullReturned` quedó afuera, con su
  propia entrada abierta en el backlog.
