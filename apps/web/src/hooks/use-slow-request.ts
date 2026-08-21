import { useEffect, useState } from "react";
import { SLOW_REQUEST_NOTICE_MS } from "../api/timing";

/**
 * Devuelve true cuando una petición en curso supera SLOW_REQUEST_NOTICE_MS.
 * Existe para el arranque en frío de Render: sin aviso, los ~52s de espera
 * se leen como una aplicación colgada.
 */
export function useSlowRequest(isPending: boolean): boolean {
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    if (!isPending) {
      setIsSlow(false);
      return;
    }

    const timeoutId = setTimeout(() => setIsSlow(true), SLOW_REQUEST_NOTICE_MS);
    return () => clearTimeout(timeoutId);
  }, [isPending]);

  return isSlow;
}
