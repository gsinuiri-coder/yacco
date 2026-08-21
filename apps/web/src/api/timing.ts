/**
 * El free tier de Render duerme el servicio tras 15 minutos sin tráfico; el
 * arranque en frío medido es de ~52s. Un timeout corto mataría precisamente
 * la primera petición del día, que es la del login de la demo.
 */
export const REQUEST_TIMEOUT_MS = 75_000;

/** A partir de aquí la UI avisa que el servidor está despertando. */
export const SLOW_REQUEST_NOTICE_MS = 5_000;

export const SLOW_REQUEST_MESSAGE = "Conectando con el servidor, puede tardar un momento…";
