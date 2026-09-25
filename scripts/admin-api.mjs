/**
 * Lo que comparten los pasos MANUALES que entran a producción como admin
 * (`pnpm viewer:bootstrap`, `pnpm roster:zones`): la contraseña se teclea en
 * la terminal sin eco, y la API se llama con fetch, sin dependencias.
 *
 * Ninguno lee un secreto de admin: la contraseña la escribe la persona que
 * corre el paso, nunca llega por argv, por el entorno ni por un archivo.
 */

/**
 * Pide una contraseña en la terminal sin mostrarla. Sin TTY rechaza: estos
 * pasos los corre una persona, y un stdin redirigido querría decir que alguien
 * los está automatizando con la contraseña del admin en un archivo o un pipe.
 */
export function promptHidden(question, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      reject(new Error("Este paso pide la contraseña del admin en una terminal interactiva."));
      return;
    }
    let value = "";
    const finish = (settle) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      settle();
    };
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === "\r" || char === "\n") return finish(() => resolve(value));
        if (char === "\u0003") return finish(() => reject(new Error("Cancelado.")));
        value = char === "\u007f" || char === "\b" ? value.slice(0, -1) : value + char;
      }
    };
    output.write(question);
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.resume();
  });
}

/** `api(path, { token, method, body })` → `{ status, body }` contra `${baseUrl}/api/v1`. */
export function apiClient(baseUrl, fetchImpl) {
  return async (path, { token, method = "GET", body } = {}) => {
    const response = await fetchImpl(`${baseUrl}/api/v1${path}`, {
      method,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // El status alcanza para decidir.
    }
    return { status: response.status, body: json };
  };
}

/** Login del admin; devuelve el access token o lanza con el status (nunca con la contraseña). */
export async function loginAdmin(api, password, username = "admin") {
  const response = await api("/auth/login", { method: "POST", body: { username, password } });
  if (response.status !== 200) throw new Error(`El login de admin devolvió ${response.status}.`);
  return response.body.accessToken;
}
