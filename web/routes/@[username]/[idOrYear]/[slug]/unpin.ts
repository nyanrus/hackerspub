import { getArticleSource } from "@hackerspub/models/article";
import { unpinPost } from "@hackerspub/models/pin";
import { db } from "../../../../db.ts";
import { define } from "../../../../utils.ts";

export const handler = define.handlers({
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
    await unpinPost(ctx.state.fedCtx, ctx.state.account.actor, article.post);
    return new Response(null, { status: 204 });
  },
});
