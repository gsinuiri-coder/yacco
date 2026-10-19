import { readFileSync } from "node:fs";
import { expect } from "vitest";

/** La plantilla de un .vue, desde `<template>`: el script no cuenta. */
export function templateOf(fileUrl: URL): string {
  const source = readFileSync(fileUrl, "utf8");
  return source.slice(source.indexOf("<template>"));
}

/**
 * Una plantilla no maqueta con elementos HTML que Nuxt UI sustituye (tabla,
 * formulario, lista de definiciones), no pisa estilos con `:ui=` ni con
 * clases calculadas, y cada clase fija está en `allowedClasses` con su razón.
 */
export function expectNativeNuxtUi(fileUrl: URL, allowedClasses: Record<string, string>): void {
  const template = templateOf(fileUrl);

  expect(template).not.toMatch(/<table\b/);
  expect(template).not.toMatch(/<form\b/);
  expect(template).not.toMatch(/<dl\b/);
  expect(template).not.toMatch(/:ui=/);
  expect(template).not.toMatch(/(:|v-bind:)class=/);

  const classes = [...template.matchAll(/\sclass="([^"]*)"/g)].map((match) => match[1]);
  for (const value of classes) {
    expect(allowedClasses, `clase sin razón en ${fileUrl.pathname}`).toHaveProperty([value!]);
  }
}
