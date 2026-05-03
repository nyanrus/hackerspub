// Sentry initialization for the GraphQL server. Imported as the very first
// statement in main.ts so it runs before any of the other module-init code
// that could throw — that way uncaught exceptions during startup also
// reach Sentry. Stays a no-op when SENTRY_DSN is unset (local dev,
// PR builds, forks without an account), matching the pattern used by
// web-next's instrument.server.mjs.
import * as Sentry from "@sentry/deno";
import metadata from "./deno.json" with { type: "json" };

const dsn = Deno.env.get("SENTRY_DSN");
if (dsn) {
  Sentry.init({
    dsn,
    // Tag every event with the build's release identifier — same scheme
    // web-next uses (`<base>+<git_commit>` after the Dockerfile's jq
    // step) so Sentry can match symbols and group across deploys.
    release: metadata.version,
    // Turn on Sentry's structured Logs API at the SDK level so the
    // @logtape/sentry sink (graphql/logging.ts) can actually deliver
    // records through it; without this they'd be dropped on the
    // client side before reaching Sentry.
    enableLogs: true,
    sendDefaultPii: true,
    // Enable performance tracing. Required for vercelAIIntegration's
    // AI-call spans to actually be captured. 1.0 = every request
    // traced; tune downward (e.g. 0.1) once we know the volume.
    tracesSampleRate: 1.0,
    integrations: [
      // Wraps the Vercel AI SDK so each `generateText` / `streamText` /
      // similar call shows up as a span with model, prompt tokens,
      // latency, etc. Inputs/outputs default to recorded because
      // sendDefaultPii is on.
      Sentry.vercelAIIntegration(),
      // Periodically reports Deno process memory and uptime metrics
      // (rss / heap_used / heap_total / uptime, every 30s by default).
      Sentry.denoRuntimeMetricsIntegration(),
      // `Sentry.denoContextIntegration` is included automatically by
      // the SDK's default integrations, so we don't list it here —
      // it tags every event with Deno runtime / OS / V8 / TS context.
    ],
  });
}
