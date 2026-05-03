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
    sendDefaultPii: true,
  });
}
