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
  },
});
