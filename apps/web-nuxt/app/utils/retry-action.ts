import type { ButtonProps } from "@nuxt/ui";

/** El botón «Reintentar» de un estado de error, el mismo en listas, fichas y búsquedas. */
export function retryAction(onClick: () => void): ButtonProps {
  return {
    color: "neutral",
    variant: "outline",
    icon: "i-lucide-rotate-cw",
    label: "Reintentar",
    onClick,
  };
}
