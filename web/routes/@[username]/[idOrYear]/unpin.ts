import { getNoteSource } from "@hackerspub/models/note";
import { unpinPost } from "@hackerspub/models/pin";
import { validateUuid } from "@hackerspub/models/uuid";
import { db } from "../../../db.ts";
import { define } from "../../../utils.ts";

export const handler = define.handlers({
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
    await unpinPost(ctx.state.fedCtx, ctx.state.account.actor, note.post);
    return new Response(null, { status: 204 });
  },
});
