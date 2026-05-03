// @refresh reload
// Polyfill Temporal for the Node.js runtime. Deno (used by web/graphql)
// exposes Temporal natively as an unstable API, but Node has not shipped
// it yet. Several modules in @hackerspub/models reference Temporal at
// module init (e.g. session.ts's `EXPIRATION = Temporal.Duration.from(...)`),
// so this must run before any of those chunks load.
//
// The package's documented form is `import "temporal-polyfill/global"`,
// but Nitro's bundler drops the side-effect-only import despite the
// package's `sideEffects` declaration. Importing a binding and assigning
// it manually keeps the polyfill in the bundle.
import { Temporal as TemporalPolyfill } from "temporal-polyfill";
(globalThis as { Temporal?: typeof TemporalPolyfill }).Temporal ??=
  TemporalPolyfill;

import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html>
        <head>
          <meta charset="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <link
            rel="alternate icon"
            type="image/x-icon"
            href="/favicon.ico"
            sizes="16x16 32x32 48x48 256x256"
          />
          <link rel="apple-touch-icon" href="/apple-icon-180.png" />
          <link rel="manifest" href="/manifest.json" />
          <meta name="theme-color" content="#000000" />
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
