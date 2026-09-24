# Plan de cierre para el piloto

Cola de trabajo del agente para cerrar Yacco antes del piloto. Es el goal que
Giancarlo le pasó el 2026-09-24, guardado tal cual para que sobreviva a un
reinicio de sesión: si la sesión se reinicia, se relee este archivo y se sigue
desde el primer ítem sin marcar. Nunca se depende de «lo que te pasé antes».

Giancarlo solo revisa el producto final. Claude (la capa arquitectónica) actúa
como cliente por delegación: sus decisiones van escritas acá.

Cada PR marca su ítem. Marcas: `[ ]` pendiente, `[x]` hecho (con el PR),
`[bloqueado]` con el motivo.

## Paso 0 — antes que nada

- [bloqueado] Token nuevo de Vercel: `secrets:gcp --upload=VERCEL_TOKEN` (ids
  por el entorno), `check-vercel-token`, relanzar el deploy de 415dd7b en
  verde, destruir la versión vieja del secreto, fecha en PROGRESO y D-015.
  **Motivo (2026-09-24):** el agente no tiene permiso para escribir en Secret
  Manager; el clasificador de permisos denegó la subida. Lo corre Giancarlo
  (comando en PROGRESO.md, fila del token). Hasta entonces el preflight de
  cada deploy rechaza el token viejo y **ningún deploy corre**: se detiene
  antes de tocar ninguna base, así que los merges se acumulan sin riesgo y
  salen todos en el primer deploy verde.
- [x] #174 (Dependabot, minor-and-patch).
- [x] #180 (backlog: validar `secrets:gcp` antes de rotar Neon; respaldo de
      `main` antes del piloto).
- [x] Este archivo, en un PR propio.

## Reglas fijas (todas vigentes)

- Leer antes de editar: AGENTS.md, docs/yacco-documentacion.md (spec, fuente
  de verdad), docs/supuestos-por-validar.md, docs/backlog-tecnico.md,
  docs/ARQUITECTURA.md (D-021, D-022, D-023), docs/estado-por-modulo.md, y el
  código real de cada módulo que se toque. Skills: yacco-conventions,
  domain-invariants, nest-module, prisma-migration, sprint-close, demo-seed.
- Un PR por ítem: rama, cinco checks verdes, squash sin `--admin`, borrar
  rama, esperar el deploy verde antes del siguiente. Sonar: 80% de cobertura
  en código nuevo y 3% de duplicación, sin bajar umbrales ni agregar
  exclusiones.
- Tests: un test que arma a mano el estado que la feature debería producir no
  prueba la feature. Se revierte el cambio, se lo ve en rojo, se lo reaplica y
  la salida en rojo va al PR. Si la rama tiene un fallback, los datos se eligen
  para que no dispare.
- Schema: una columna o tabla nueva solo si el ítem lo exige, con
  expand/contract. Una migración destructiva (contract) lleva [OK].
- Invariantes de AGENTS.md sin excepción: libro inmutable, dinero NUMERIC y en
  string, fechas de negocio como texto, «avisa, no bloquea».
- Decisiones de producto: las tomadas acá se registran en
  supuestos-por-validar como «Decidido por Claude por delegación de Giancarlo
  (fecha)», con las cuatro líneas (Asumimos / Construido encima / Preguntar /
  Si dice que no). Una ambigüedad NUEVA que no esté cubierta acá: se elige la
  opción más conservadora para los datos, se registra igual y se sigue.
- [OK] solo en: cargar datos reales en main, migraciones destructivas y borrar
  recursos. Todo lo demás, sin preguntar.
- never-print-secrets siempre.
- Si un ítem se traba por algo externo (credenciales, un servicio caído), se
  anota acá como bloqueado, con el motivo, y se sigue con el siguiente.

## Cola (en este orden)

1. [x] **Docs al día con el código:** regenerar estado-por-modulo.md
       recorriendo apps/web-nuxt (hoy nombra archivos .tsx del React), y
       actualizar en supuestos-por-validar.md las rutas del React a las del Nuxt.
2. [x] **Decisiones de Claude sobre los 10 supuestos pendientes:** se mantiene
       el comportamiento actual en todos. Cada uno pasa a «Decidido por Claude por
       delegación», conservando su «Preguntar» para el piloto. Sin cambios de
       código.
3. [ ] **Defectos del recorrido de paridad** (backlog, 2026-09-23):
   - [ ] a) el primer clic después de cerrar un desplegable, o de cargar una
         página, a veces no toma. Reproducirlo con Playwright; si es real,
         arreglarlo con un test de navegador que falle sin el arreglo;
   - [ ] b) «Hydration completed but contains mismatches»: encontrar el nodo y
         arreglarlo;
   - [x] c) el ejemplo «25.00» de «Monto cobrado» pasa a mostrar el total de
         la venta;
   - [ ] d) «Arriba del camión»: separar lo cargado de lo que queda (cargado
         menos entregado menos vendido);
   - [x] e) la columna «Diferencia» del conteo lleva la palabra (faltan N /
         sobran N), y cierra la entrada de backlog que ya existe.
4. [ ] **Llenos que vuelven al galpón** (backlog «Devolver llenos al galpón no
       repone el lote»; fullReturned quedó afuera de la decisión del 29/08).
       Decisión de Claude: la liquidación emite el movimiento de retorno de llenos
       DESDE LO CONTADO, igual que los vacíos, y el lleno que vuelve repone el
       lote más antiguo del que salió (el mismo FIFO de la carga, al revés). Si
       reponer el lote exacto exige guardar el origen de cada carga y hoy no está,
       se guarda (expand). Test de liquidación con 6 cargados, 5 entregados y 1
       contado de vuelta: el inventario y el lote cierran. Registrarlo como
       decisión delegada.
5. [ ] **Reportes post-MVP de la spec:**
   - HU-19, deuda por cliente con total y fecha del cargo más antiguo;
   - HU-20, el total prestado cuadra con «en poder del cliente» del parque
     (que el test lo compare);
   - HU-21, producción por período, por tipo y por lote.

   Pantallas nuevas en el menú, sin librería de gráficos nueva. Tablas y
   totales alcanzan.

6. [ ] **Vista «Mi ruta» para el chofer** (HU-11 y HU-12 a HU-14 en el
       celular, en línea). Decisión de Claude: no hay app nativa ni offline para
       el piloto. Un usuario con rol DRIVER entra al mismo web y ve solo sus rutas
       del día, en un diseño para pantalla de celular (360 px), y registra cada
       parada con el mismo PATCH que hoy usa la oficina (el API ya lo permite a
       DRIVER).
   - Si el usuario tiene SOLO el rol DRIVER, no ve el resto del menú.
   - Offline, sincronización y fotos (HU-11 E1, HU-15, HU-16) quedan
     registrados como diferidos al post-piloto.
   - Tests e2e con Playwright en viewport de celular: login de chofer, su ruta
     visible, una ruta ajena NO visible (con dos choferes y dos rutas en los
     datos), y registro de una entrega.
7. [ ] **Seguridad antes de datos reales:**
   - [ ] a) refresh token en cookie httpOnly; Secure; SameSite=Lax por el
         mismo origen del proxy (la fase propia de D-022), y fuera de
         localStorage;
   - [ ] b) cambiar la contraseña o desactivar a un usuario invalida sus
         refresh tokens ya emitidos (backlog «No hay forma de invalidar un token
         ya emitido» y «Cambiar la contraseña no invalida los refresh tokens»). Al
         supuesto 4 se le agrega que ahora sí se corta la sesión;
   - [ ] c) CSP completa en el web, verificada en la respuesta servida, sin
         romper Nuxt UI ni los íconos.

   Una decisión nueva en D-024 si cambia cómo emite la sesión la API.

8. [ ] **Padrón de clientes** (#59, rama feat/firestore-export, 112 commits
       atrás):
   - rebase, revisión y merge de la herramienta de export del Yacco viejo en
     Firestore (proyecto yacco-2026, SOLO lectura: no se escribe nada ahí);
   - el export alimenta roster-loader. Primero una corrida completa contra
     DEMO, con un reporte de cuántos clientes entran, cuántos se descartan y
     por qué (duplicados por teléfono, sin nombre, etc.);
   - si no hay acceso a Firestore, se para este ítem, se reporta y se sigue
     con el 9.
9. [ ] **Entorno de revisión para Giancarlo:** que `pnpm demo:data` corra
       contra la demo de Cloud Run (hoy no corre, está en el backlog), sembrar
       demo con datos de varios días, y publicar un preview de yacco-web (apunta a
       demo por D-011) con un chofer de demo con contraseña en Secret Manager.
       Verificarlo de punta a punta con Playwright: el ciclo pedido → ruta → Mi
       ruta del chofer → liquidación → reportes.
10. [ ] **Carga real [OK]:**
    - antes, una rama de respaldo de main (D-006);
    - después, la carga del padrón en main con el reporte de la corrida en
      demo a la vista;
    - desde acá vuelven las restricciones: la ventana de migraciones de 08:00
      a 20:00 de Lima (AGENTS.md) y el deny de ramas de Neon sin excepciones.
11. [ ] **Cierre:** sprint-close, PROGRESO.md con el estado final, y un
        reporte final corto para Giancarlo:
    - la URL del preview y cómo entrar como admin y como chofer (dónde está
      cada contraseña en Secret Manager, nunca el valor);
    - qué revisar, en 10 pasos;
    - la lista de decisiones delegadas para llevarle al dueño.
