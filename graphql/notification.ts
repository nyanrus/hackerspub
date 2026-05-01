import {
  accountTable,
  type Actor as ActorRow,
  actorTable,
} from "@hackerspub/models/schema";
import type { Uuid } from "@hackerspub/models/uuid";
import {
  resolveCursorConnection,
  type ResolveCursorConnectionArgs,
} from "@pothos/plugin-relay";
import DataLoader from "dataloader";
import { eq, inArray, sql } from "drizzle-orm";
import { Actor } from "./actor.ts";
import { builder, Node, type UserContext } from "./builder.ts";
import { Post } from "./post.ts";
import { NotAuthenticatedError } from "./session.ts";

// Per-request loader keyed by actor id.  Notifications carry an
// `actorIds: Uuid[]` column, so the unbatched resolver fired one
// `findMany` per notification.  The loader collapses every actor
// id requested across the active execution into a single
// `SELECT … WHERE id = ANY($1)` and dedupes overlapping ids
// (e.g., the same person mentioned in two notifications).
function getActorById(
  ctx: UserContext,
  actorId: Uuid,
): Promise<ActorRow | null> {
  ctx.actorByIdLoader ??= new DataLoader<Uuid, ActorRow | null>(
    async (ids) => {
      const idList = ids as Uuid[];
      const rows = await ctx.db
        .select()
        .from(actorTable)
        .where(inArray(actorTable.id, idList));
      const byId = new Map(rows.map((row) => [row.id, row]));
      return idList.map((id) => byId.get(id) ?? null);
    },
  );
  return ctx.actorByIdLoader.load(actorId);
}

export const NotificationType = builder.enumType("NotificationType", {
  values: [
    "FOLLOW",
    "MENTION",
    "REPLY",
    "SHARE",
    "QUOTE",
    "REACT",
  ] as const,
});

export const Notification = builder.drizzleInterface("notificationTable", {
  variant: "Notification",
  interfaces: [Node],
  resolveType(notification): string {
    switch (notification.type) {
      case "follow":
        return FollowNotification.name;
      case "mention":
        return MentionNotification.name;
      case "reply":
        return ReplyNotification.name;
      case "share":
        return ShareNotification.name;
      case "quote":
        return QuoteNotification.name;
      case "react":
        return ReactNotification.name;
    }
  },
  fields: (t) => ({
    uuid: t.expose("id", { type: "UUID" }),
    created: t.expose("created", { type: "DateTime" }),
    account: t.relation("account"),
    actors: t.connection({
      type: Actor,
      resolve(notification, args, ctx) {
        return resolveCursorConnection(
          {
            args,
            toCursor: (actor) => actor.id,
          },
          async (_args: ResolveCursorConnectionArgs) => {
            const loaded = await Promise.all(
              notification.actorIds.map((id) => getActorById(ctx, id)),
            );
            const actors = loaded.filter(
              (actor): actor is ActorRow => actor != null,
            );
            const positionMap = new Map(
              notification.actorIds.map((id, index) => [id, index]),
            );
            actors.sort((a, b) =>
              (positionMap.get(b.id) ?? -1) -
              (positionMap.get(a.id) ?? -1)
            );
            return actors;
          },
        );
      },
    }),
  }),
});

export const FollowNotification = builder.drizzleNode("notificationTable", {
  variant: "FollowNotification",
  interfaces: [Notification],
  id: {
    column: (notification) => notification.id,
  },
});

export const MentionNotification = builder.drizzleNode(
  "notificationTable",
  {
    variant: "MentionNotification",
    interfaces: [Notification],
    id: {
      column: (notification) => notification.id,
    },
    fields: (t) => ({
      post: t.relation("post", { type: Post, nullable: true }),
    }),
  },
);

export const ReplyNotification = builder.drizzleNode("notificationTable", {
  variant: "ReplyNotification",
  interfaces: [Notification],
  id: {
    column: (notification) => notification.id,
  },
  fields: (t) => ({
    post: t.relation("post", { type: Post, nullable: true }),
  }),
});

export const ShareNotification = builder.drizzleNode("notificationTable", {
  variant: "ShareNotification",
  interfaces: [Notification],
  id: {
    column: (notification) => notification.id,
  },
  fields: (t) => ({
    post: t.relation("post", { type: Post, nullable: true }),
  }),
});

export const QuoteNotification = builder.drizzleNode("notificationTable", {
  variant: "QuoteNotification",
  interfaces: [Notification],
  id: {
    column: (notification) => notification.id,
  },
  fields: (t) => ({
    post: t.relation("post", { type: Post, nullable: true }),
  }),
});

export const ReactNotification = builder.drizzleNode("notificationTable", {
  variant: "ReactNotification",
  interfaces: [Notification],
  id: {
    column: (notification) => notification.id,
  },
  fields: (t) => ({
    post: t.relation("post", { type: Post, nullable: true }),
    emoji: t.exposeString("emoji", { nullable: true }),
    customEmoji: t.relation("customEmoji", { nullable: true }),
  }),
});

builder.mutationField("markNotificationsAsRead", (t) =>
  t.field({
    type: "DateTime",
    description:
      "Marks all notifications as read up to the current time. Returns the timestamp.",
    async resolve(_root, _args, ctx) {
      if (ctx.account == null) throw new NotAuthenticatedError();
      const [row] = await ctx.db.update(accountTable)
        .set({
          notificationRead:
            sql`GREATEST(${accountTable.notificationRead}, CURRENT_TIMESTAMP)`,
        })
        .where(eq(accountTable.id, ctx.account.id))
        .returning({ notificationRead: accountTable.notificationRead });
      return row.notificationRead!;
    },
  }));
