declare module "#app" {
  interface PageMeta {
    /** Se puede ver sin sesión (ver middleware/auth.global.ts). */
    public?: boolean;
  }
}

export {};
