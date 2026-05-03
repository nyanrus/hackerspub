// @refresh reload
import * as Sentry from "@sentry/solidstart";
import { mount, StartClient } from "@solidjs/start/client";
import "solid-devtools";

// SENTRY_DSN is injected at runtime by the SSR document (entry-server.tsx)
// as `window.__SENTRY_DSN__`. The inline script that sets it runs before
// this module (deferred via `type="module"`), so the value is ready by
// the time we read it. When unset, Sentry just stays disabled.
const sentryDsn = (window as { __SENTRY_DSN__?: string }).__SENTRY_DSN__ ?? "";
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    // Send default PII (e.g. IP address) so we can correlate errors with
    // users where useful.
    sendDefaultPii: true,
  });
}

mount(() => <StartClient />, document.getElementById("app")!);
