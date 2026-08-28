import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Closes a popover-style element (a combobox's results list) when a
 * mousedown lands outside `ref`'s subtree. Shared by CustomerSelect and
 * CustomerQuickSearch, which otherwise duplicated this effect verbatim.
 */
export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  onOutsideClick: () => void,
): void {
  const callbackRef = useRef(onOutsideClick);
  callbackRef.current = onOutsideClick;

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callbackRef.current();
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [ref]);
}
