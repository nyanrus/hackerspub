// `sentryBeforeResponseMiddleware` lives at the package root for
// @sentry/solidstart 10.x — the docs page that shows
// `@sentry/solidstart/middleware` as a subpath import is for a
// different version and that subpath is not exported here.
import { sentryBeforeResponseMiddleware } from "@sentry/solidstart";
import { createMiddleware } from "@solidjs/start/middleware";

// Wired in via `solidStart({ middleware: "./src/middleware.ts" })` in
// vite.config.ts. `sentryBeforeResponseMiddleware()` propagates the
// Sentry trace context onto outgoing responses so a server transaction
// can be linked to the client navigation that triggered it (distributed
// tracing). Add additional handlers to the same `onBeforeResponse`
// array if we ever need other response-time hooks.
export default createMiddleware({
  onBeforeResponse: [
    sentryBeforeResponseMiddleware(),
  ],
});
