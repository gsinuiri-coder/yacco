/**
 * Tests de lo compartido por los pasos manuales que entran como admin, sin
 * red: el prompt sin eco y el login.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, test } from "node:test";

import { loginAdmin, promptHidden } from "./admin-api.mjs";

/** Una terminal de mentira: lo que `promptHidden` necesita de process.stdin. */
function fakeTty(isTTY = true) {
  const input = new EventEmitter();
  input.isTTY = isTTY;
  input.rawModes = [];
  input.setRawMode = (mode) => input.rawModes.push(mode);
  input.setEncoding = () => {};
  input.resume = () => {};
  input.pause = () => {};
  const written = [];
  return { input, output: { write: (text) => written.push(text) }, written };
}

describe("promptHidden", () => {
  test("devuelve lo tecleado, respeta el borrado y no lo escribe en la salida", async () => {
    const tty = fakeTty();
    const answer = promptHidden("Contraseña: ", tty);
    tty.input.emit("data", "clavx");
    tty.input.emit("data", "\u007fe\r");
    assert.equal(await answer, "clave");
    assert.deepEqual(tty.written, ["Contraseña: ", "\n"]);
    assert.deepEqual(tty.input.rawModes, [true, false]);
  });

  test("Ctrl+C cancela y devuelve la terminal a su modo normal", async () => {
    const tty = fakeTty();
    const answer = promptHidden("Contraseña: ", tty);
    tty.input.emit("data", "\u0003");
    await assert.rejects(answer, /Cancelado/);
    assert.deepEqual(tty.input.rawModes, [true, false]);
  });

  test("sin terminal interactiva no corre: nadie le pasa la del admin por un pipe", async () => {
    const tty = fakeTty(false);
    await assert.rejects(promptHidden("Contraseña: ", tty), /terminal interactiva/);
    assert.deepEqual(tty.written, []);
  });
});

describe("loginAdmin", () => {
  test("devuelve el token de un 200", async () => {
    const api = async () => ({ status: 200, body: { accessToken: "t" } });
    assert.equal(await loginAdmin(api, "x"), "t");
  });

  test("un 401 lanza con el status y sin la contraseña", async () => {
    const api = async () => ({ status: 401, body: {} });
    await assert.rejects(loginAdmin(api, "la-clave"), (error) => {
      assert.match(error.message, /401/);
      assert.ok(!error.message.includes("la-clave"));
      return true;
    });
  });
});
