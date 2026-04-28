import { getNoteSource } from "@hackerspub/models/note";
import { isPostPinnedBy, pinPost } from "@hackerspub/models/pin";
import { validateUuid } from "@hackerspub/models/uuid";
import { db } from "../../../db.ts";
import { define } from "../../../utils.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!validateUuid(ctx.params.idOrYear)) return ctx.next();
    if (ctx.params.username.includes("@")) return ctx.next();
    const note = await getNoteSource(
      db,
      ctx.params.username,
      ctx.params.idOrYear,
      ctx.state.account,
    );
    if (note == null) return ctx.next();
    const pinned = await isPostPinnedBy(
      db,
      note.post,
      ctx.state.account?.actor,
    );
    return Response.json({ pinned });
  },

  async POST(ctx) {
    if (!validateUuid(ctx.params.idOrYear)) return ctx.next();
    if (ctx.params.username.includes("@")) return ctx.next();
    if (ctx.state.account == null) {
      return new Response("Forbidden", { status: 403 });
    }
    const note = await getNoteSource(
      db,
      ctx.params.username,
      ctx.params.idOrYear,
      ctx.state.account,
    );
    if (note == null) return ctx.next();
    const pinned = await pinPost(db, ctx.state.account.actor, note.post);
    if (pinned == null) return new Response("Bad Request", { status: 400 });
    return new Response(null, { status: 204 });
  },
});
