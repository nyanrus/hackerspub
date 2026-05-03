import { define } from "../../utils.ts";

// /feed only exists on web-next. Anyone routed here through the legacy
// stack (e.g. without the web-next gating cookie) gets bounced back home.
export const handler = define.handlers({
  GET(ctx) {
    return Response.redirect(new URL("/", ctx.url), 302);
  },
});
