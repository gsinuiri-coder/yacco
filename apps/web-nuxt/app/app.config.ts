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
    // Los títulos llevan la familia de títulos del tema (`--font-display` en
    // main.css): el de cada pantalla, el de cada tarjeta y el de cada diálogo.
    dashboardNavbar: {
      slots: {
        title: "font-display",
      },
    },
    card: {
      slots: {
        title: "font-display",
      },
    },
    modal: {
      slots: {
        title: "font-display",
      },
    },
    pageCard: {
      slots: {
        // Una columna que no crece con su contenido: sin esto, en pantallas
        // anchas una tabla larga dentro de la tarjeta la ensancha en vez de
        // desplazarse. La horizontal sigue con sus dos columnas (su variante
        // pisa esta clase).
        container: "lg:grid-cols-1",
        title: "font-display",
      },
    },
    form: {
      base: "space-y-6",
    },
    pageList: {
      base: "gap-6",
    },
    pageBody: {
      base: "mt-0 space-y-6 pb-0",
    },
    pageSection: {
      slots: {
        container: "max-w-none gap-6 px-0 py-0 sm:gap-6 sm:px-0 sm:py-0 lg:px-0 lg:py-0",
        body: "mt-0",
      },
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
