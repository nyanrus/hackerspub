import { resolve } from "node:path";
import process from "node:process";
import { lingui } from "@lingui/vite-plugin";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { solidStart } from "@solidjs/start/config";
import { nitroV2Plugin } from "@solidjs/vite-plugin-nitro-2";
import tailwindcss from "@tailwindcss/vite";
import devtools from "solid-devtools/vite";
import Icons from "unplugin-icons/vite";
import { cjsInterop } from "vite-plugin-cjs-interop";
import { defineConfig } from "vite";
import relay from "vite-plugin-relay-lite";

try {
  process.loadEnvFile(resolve(process.cwd(), "../.env"));
} catch (e) {
  console.warn("No .env file found.");
}

// Sentry source-map upload runs only when an auth token is provided at
// build time — typically inside CI, fed in via a Docker BuildKit secret
// (see Dockerfile). For local builds and any image build without the
// secret, the plugin is omitted entirely so nothing tries to talk to
// Sentry. SENTRY_ORG / SENTRY_PROJECT default to the values used by
// this repo's Sentry project; override via env if you fork.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryPlugins = sentryAuthToken
  ? [
    sentryVitePlugin({
      org: process.env.SENTRY_ORG ?? "hackerspub",
      project: process.env.SENTRY_PROJECT ?? "web-next",
      authToken: sentryAuthToken,
      sourcemaps: {
        // Strip .map files from the production output after they have
        // been uploaded to Sentry, so they don't ship in the public
        // Docker image and aren't reachable from the open web. Sentry
        // can still symbolicate stack traces because it has its own
        // copy of the maps.
        filesToDeleteAfterUpload: [
          "./.output/public/_build/assets/*.map",
          "./.output/server/**/*.map",
        ],
      },
    }),
  ]
  : [];

export default defineConfig(() => ({
  // Source maps must be generated for the Sentry plugin to upload them.
  // Vite produces hidden source maps in production by default; this just
  // makes the intent explicit so a future config tweak doesn't silently
  // disable Sentry symbolication.
  build: { sourcemap: true },
  plugins: [
    solidStart({
      solid: {
        babel: {
          plugins: ["@lingui/babel-plugin-lingui-macro"],
        },
      },
    }),
    nitroV2Plugin({
      esbuild: {
        options: {
          target: "esnext",
        },
      },
    }),
    devtools({
      autoname: true,
      locator: {
        targetIDE: "vscode",
        jsxLocation: true,
        componentLocation: true,
      },
    }),
    tailwindcss(),
    lingui(),
    relay({ codegen: process.env.NO_WATCHMAN == "1" ? false : true }),
    cjsInterop({ dependencies: ["relay-runtime"] }),
    Icons({ compiler: "solid" }),
    // Has to come after the bundling plugins so it sees the final
    // emitted assets (and their .map files).
    ...sentryPlugins,
  ],
}));
