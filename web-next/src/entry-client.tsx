// @refresh reload
import * as Sentry from "@sentry/solidstart";
import { mount, StartClient } from "@solidjs/start/client";
import "solid-devtools";
import packageJson from "../package.json" with { type: "json" };

// SENTRY_DSN is injected at runtime by the SSR document (entry-server.tsx)
// as `window.__SENTRY_DSN__`. The inline script that sets it runs before
// this module (deferred via `type="module"`), so the value is ready by
// the time we read it. When unset, Sentry just stays disabled.
const sentryDsn = (window as { __SENTRY_DSN__?: string }).__SENTRY_DSN__ ?? "";
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    // Tag every event with the deployed version so Sentry can group
    // errors by release. The Dockerfile turns this into
    // `0.2.0+<git_commit>` per build (see the jq step), and the Sentry
    // Vite plugin uploads source maps under the matching release name
    // (vite.config.ts), so symbolication lines up.
    release: packageJson.version,
    // Send default PII (e.g. IP address) so we can correlate errors with
    // users where useful.
    sendDefaultPii: true,
  });
}

mount(() => <StartClient />, document.getElementById("app")!);
