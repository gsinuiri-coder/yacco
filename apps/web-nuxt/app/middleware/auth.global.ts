/**
 * Quién puede entrar a cada ruta. Corre SÓLO en el cliente: en el servidor no
 * hay sesión que mirar (D-022), así que el SSR entrega el shell y es el
 * navegador, ya con la sesión restaurada, quien decide si deja pasar.
 *
 * Una página es pública con `definePageMeta({ public: true })`; todo lo demás
 * pide sesión.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;

  const session = useSession();
  await session.restore();

  if (to.meta.public) {
    // Con sesión, el login no tiene nada que ofrecer: de vuelta a donde iba.
    if (to.path === "/login" && session.user.value !== null) {
      return navigateTo(safeReturnPath(to.query.from), { replace: true });
    }
    return;
  }

  if (session.user.value === null) {
    return navigateTo({ path: "/login", query: { from: to.fullPath } }, { replace: true });
  }

  // Quien solo reparte trabaja en «Mi ruta»: cualquier otra pantalla es de la
  // oficina, y la API igual le negaría sus datos.
  if (isDriverOnly(session.user.value.roles) && to.path !== MY_ROUTE_PATH) {
    return navigateTo(MY_ROUTE_PATH, { replace: true });
  }

  // Quien trabaja sólo en planta entra directo a «Producción», y cualquier otra
  // pantalla fuera de su alcance lo redirige allí.
  if (isPlantOnly(session.user.value.roles)) {
    const allowed = session.hasRole("PLANT_SUPERVISOR")
      ? ["/production", "/inventory", "/container-movements"]
      : ["/production", "/inventory"];
    if (!allowed.includes(to.path)) {
      return navigateTo("/production", { replace: true });
    }
  }
});
