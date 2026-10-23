import type { LoginRequest, SessionUser } from "@yacco/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { SessionExpiredError } from "./api-client";
import type { ApiClient, SessionEndReason } from "./api-client";

export type SessionState =
  | { status: "restoring" }
  // `ended`: por qué terminó la sesión guardada; null si nunca hubo una o el
  // chofer la cerró él mismo.
  | { status: "signedOut"; ended: SessionEndReason | null }
  // `user` es null cuando no se pudo preguntar quién es (sin señal, o el
  // servidor no responde): la sesión sigue, dura 30 días en el celular.
  // `driverId` sale del refresh guardado y se sabe siempre, con o sin señal:
  // a su nombre queda la cola.
  | { status: "signedIn"; user: SessionUser | null; driverId: string };

interface SessionValue {
  state: SessionState;
  login(credentials: LoginRequest): Promise<void>;
  logout(): Promise<void>;
  /**
   * El servidor rechazó el refresh en medio del uso (venció, lo cortó el
   * administrador o le sacaron el rol): vuelve al ingreso diciendo por qué.
   * El cliente ya lo borró del almacenamiento seguro.
   */
  expire(reason: SessionEndReason): void;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Quién es el chofer, o null si ahora no se puede saber. Solo un refresh
 * rechazado (SessionExpiredError) termina la sesión; cualquier otra falla
 * —sin señal, un 5xx— no es motivo para sacarlo de la app.
 */
async function whoIs(client: ApiClient): Promise<SessionUser | null> {
  try {
    return await client.me();
  } catch (error) {
    if (error instanceof SessionExpiredError) throw error;
    return null;
  }
}

/** La sesión abierta, o la de ingreso si el refresh guardado no dice de quién es. */
async function signedIn(client: ApiClient): Promise<SessionState> {
  const user = await whoIs(client);
  const driverId = await client.sessionUserId();
  return driverId === null
    ? { status: "signedOut", ended: null }
    : { status: "signedIn", user, driverId };
}

export function SessionProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "restoring" });

  useEffect(() => {
    let active = true;
    async function restore(): Promise<SessionState> {
      try {
        if (!(await client.hasStoredSession())) return { status: "signedOut", ended: null };
        return await signedIn(client);
      } catch (error) {
        // whoIs solo deja pasar el refresh rechazado; otra falla acá es del
        // almacenamiento seguro, y sin poder leerlo solo queda volver a ingresar.
        return {
          status: "signedOut",
          ended: error instanceof SessionExpiredError ? error.reason : null,
        };
      }
    }
    void restore().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [client]);

  const login = useCallback(
    async (credentials: LoginRequest) => {
      await client.login(credentials);
      setState(await signedIn(client));
    },
    [client],
  );

  const logout = useCallback(async () => {
    await client.logout();
    setState({ status: "signedOut", ended: null });
  }, [client]);

  const expire = useCallback((reason: SessionEndReason) => {
    setState({ status: "signedOut", ended: reason });
  }, []);

  const value = useMemo(() => ({ state, login, logout, expire }), [state, login, logout, expire]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession necesita un SessionProvider");
  return value;
}
