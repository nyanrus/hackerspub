import { define } from "../../utils.ts";

// /feed/* only exists on web-next. See ./index.tsx for the rationale.
export const handler = define.handlers({
  GET(ctx) {
    return Response.redirect(new URL("/", ctx.url), 302);
  },
});
