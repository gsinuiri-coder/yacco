import { readFileSync } from "node:fs";
import { expect } from "vitest";

/** La plantilla de un .vue, desde `<template>`: el script no cuenta. */
export function templateOf(fileUrl: URL): string {
  const source = readFileSync(fileUrl, "utf8");
  const start = source.indexOf("<template>");
  expect(start, `sin <template> en ${fileUrl.pathname}`).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

/**
 * UPageList pone siempre role="list": sin `as="ul"`/`as="ol"` es un
 * contenedor que el lector anuncia como lista vacía. Para apilar, UPageBody.
 */
export function expectPageListsAreLists(fileUrl: URL): void {
  const template = templateOf(fileUrl);
  const pageLists = [...template.matchAll(/<UPageList\b[^>]*>/g)].map((match) => match[0]);
  for (const tag of pageLists) {
    expect(tag, `UPageList que no es lista en ${fileUrl.pathname}`).toMatch(/\sas="(ul|ol)"/);
  }
}

/**
 * Una plantilla no maqueta con elementos HTML que Nuxt UI sustituye (tabla,
 * formulario, lista de definiciones) ni pisa estilos con `:ui=` o con clases
 * calculadas.
 */
export function expectNoSubstitutedMarkup(fileUrl: URL): void {
  const template = templateOf(fileUrl);

  expect(template, fileUrl.pathname).not.toMatch(/<table\b/);
  expect(template, fileUrl.pathname).not.toMatch(/<form\b/);
  expect(template, fileUrl.pathname).not.toMatch(/<dl\b/);
  expect(template, fileUrl.pathname).not.toMatch(/(:|v-bind:)ui=/);
  expect(template, fileUrl.pathname).not.toMatch(/(:|v-bind:)class=/);

  expectPageListsAreLists(fileUrl);
}

/**
 * Lo de `expectNoSubstitutedMarkup`, y además cada clase fija está en
 * `allowedClasses` con su razón.
 */
export function expectNativeNuxtUi(fileUrl: URL, allowedClasses: Record<string, string>): void {
  const template = templateOf(fileUrl);

  expectNoSubstitutedMarkup(fileUrl);

  const classes = [...template.matchAll(/\sclass="([^"]*)"/g)].map((match) => match[1]);
  for (const value of classes) {
    expect(allowedClasses, `clase sin razón en ${fileUrl.pathname}`).toHaveProperty([value!]);
  }
}
