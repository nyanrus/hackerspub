import { getArticleSource } from "@hackerspub/models/article";
import { isPostPinnedBy, pinPost } from "@hackerspub/models/pin";
import { db } from "../../../../db.ts";
import { define } from "../../../../utils.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.params.idOrYear.match(/^\d+$/)) return ctx.next();
    const article = await getArticleSource(
      db,
      ctx.params.username,
      parseInt(ctx.params.idOrYear),
      ctx.params.slug,
      ctx.state.account,
    );
    if (article == null) return ctx.next();
    const pinned = await isPostPinnedBy(
      db,
      article.post,
      ctx.state.account?.actor,
    );
    return Response.json({ pinned });
  },

  async POST(ctx) {
    if (!ctx.params.idOrYear.match(/^\d+$/)) return ctx.next();
    if (ctx.state.account == null) {
      return new Response("Forbidden", { status: 403 });
    }
    const article = await getArticleSource(
      db,
      ctx.params.username,
      parseInt(ctx.params.idOrYear),
      ctx.params.slug,
      ctx.state.account,
    );
    if (article == null) return ctx.next();
    const pinned = await pinPost(
      ctx.state.fedCtx,
      ctx.state.account.actor,
      article.post,
    );
    if (pinned == null) return new Response("Bad Request", { status: 400 });
    return new Response(null, { status: 204 });
  },
});
