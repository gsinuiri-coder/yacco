/**
 * La URL de la API se fija al armar el APK (docs/ENTORNOS.md): Expo inlinea
 * `EXPO_PUBLIC_API_URL` en el bundle. Sin default a propósito: uno escrito
 * acá sería una URL sin cifrar hacia la máquina de desarrollo, y un APK armado
 * sin la variable tiene que decirlo, no fallar en silencio en la calle.
 * Devuelve null si no se configuró.
 */
export function resolveApiUrl(configured: string | undefined): string | null {
  let url = configured?.trim() ?? "";
  while (url.endsWith("/")) url = url.slice(0, -1);
  return url === "" ? null : url;
}
