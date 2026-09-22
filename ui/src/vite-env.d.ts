/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_API_KEY?: string
  readonly VITE_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
