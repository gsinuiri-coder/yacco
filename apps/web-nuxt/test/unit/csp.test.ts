import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, stampNonce } from "../../config/csp";

describe("contentSecurityPolicy", () => {
  it("todo desde el propio origen, scripts solo con el nonce y nadie enmarca la app", () => {
    const policy = contentSecurityPolicy("abc123");

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'nonce-abc123'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    // Ni eval ni scripts en línea sin nonce.
    expect(policy).not.toMatch(/script-src[^;]*unsafe/);
  });
});

describe("stampNonce", () => {
  it("le pone el nonce a cada script de cada fragmento, sin duplicar uno que ya lo tenga", () => {
    const html = {
      head: ['<script type="module" src="/_nuxt/entry.js"></script>'],
      bodyPrepend: ["<script>window.x=1</script>"],
      body: ['<div id="__nuxt"></div><script type="application/json">{}</script>'],
      bodyAppend: ['<script nonce="ya">window.y=2</script><scriptish></scriptish>'],
    };

    stampNonce(html, "n1");

    expect(html.head[0]).toBe('<script nonce="n1" type="module" src="/_nuxt/entry.js"></script>');
    expect(html.bodyPrepend[0]).toBe('<script nonce="n1">window.x=1</script>');
    expect(html.body[0]).toContain('<script nonce="n1" type="application/json">');
    expect(html.bodyAppend[0]).toBe(
      '<script nonce="ya">window.y=2</script><scriptish></scriptish>',
    );
  });
});
