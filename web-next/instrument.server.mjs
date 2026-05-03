// Server-side Sentry initialization. Loaded via `node --import` before the
// Nitro entry runs (see `prod:web-next` in mise.toml). Skips init when
// SENTRY_DSN is unset so local development and builds without a DSN
// configured stay quiet.
import * as Sentry from "@sentry/solidstart";
import nodeProcess from "node:process";

if (nodeProcess.env.SENTRY_DSN) {
  Sentry.init({
    dsn: nodeProcess.env.SENTRY_DSN,
    sendDefaultPii: true,
  });
}
