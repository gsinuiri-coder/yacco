/**
 * Lo que se le pasa a cada `USelect` en `:content`.
 *
 * Por defecto el desplegable de Reka UI es modal: mientras está abierto deja
 * el `body` en `pointer-events: none` (dos veces: el bloqueo de scroll y la
 * capa que descarta clics de afuera). El clic que el usuario hace sobre OTRO
 * control para cerrarlo solo cierra el desplegable y se pierde; hay que
 * repetirlo. Medido con Playwright: 10 de 10 clics perdidos, 0 de 10 con esto.
 * El desplegable se sigue cerrando con ese mismo clic y con Escape.
 */
export const NON_BLOCKING_SELECT = {
  bodyLock: false,
  disableOutsidePointerEvents: false,
} as const;
