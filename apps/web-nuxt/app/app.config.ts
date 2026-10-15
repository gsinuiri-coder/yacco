/**
 * Qué paleta de `app/assets/css/main.css` cumple cada papel en Nuxt UI. Los
 * valores de color y las familias tipográficas viven allá; acá se asignan sus
 * papeles y los ajustes compartidos de componentes.
 */
export default defineAppConfig({
  ui: {
    colors: {
      primary: "lagoon",
      secondary: "ochre",
      success: "emerald",
      info: "lagoon",
      warning: "amber",
      error: "red",
      neutral: "basalt",
    },
    dashboardSidebar: {
      slots: {
        footer: "border-t border-default justify-between",
      },
    },
    form: {
      base: "space-y-6",
    },
    user: {
      slots: {
        root: "min-w-0 flex-1",
        wrapper: "min-w-0",
        name: "truncate",
      },
    },
  },
});
