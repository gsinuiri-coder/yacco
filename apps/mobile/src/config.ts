/**
 * La URL de la API se fija al armar el APK (docs/ENTORNOS.md): Expo inlinea
 * `EXPO_PUBLIC_API_URL` en el bundle. Sin ella, la del emulador de Android
 * hacia la API local (10.0.2.2 es el localhost de la máquina que lo corre).
 */
export const LOCAL_API_URL = "http://10.0.2.2:3200";

export function resolveApiUrl(configured: string | undefined): string {
  const url = configured?.trim() ? configured.trim() : LOCAL_API_URL;
  return url.replace(/\/+$/, "");
}
