declare module "bun" {
  interface Env {
    // Add your environment variables here
    X_FE_SIGNALS: string;
    X_FE_VERSION: string;
    X_USER_AGENT: string;
    X_VQD_STACK: string;
    X_MODELS_JSON: string;
    X_EMIT_REASONING: string;
    PORT: number;
    NODE_ENV: "development" | "production";
  }
  1;
}

// This allows the types to apply to process.env as well
declare global {
  namespace NodeJS {
    interface ProcessEnv extends Bun.Env {}
  }
}
