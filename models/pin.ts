import type { Context } from "@fedify/fedify";
import * as vocab from "@fedify/vocab";
import { and, count, eq } from "drizzle-orm";
import type { ContextData } from "./context.ts";
import type { Database } from "./db.ts";
import { type Actor, type Pin, pinTable, type Post } from "./schema.ts";

export const MAX_PINNED_POSTS = 20;

export function canPinPost(
  actor: Actor,
  post: Post,
): boolean {
  return post.actorId === actor.id &&
    post.sharedPostId == null &&
    (post.visibility === "public" || post.visibility === "unlisted");
}

export async function pinPost(
  fedCtx: Context<ContextData>,
  actor: Actor,
  post: Post,
): Promise<Pin | null> {
  const { db } = fedCtx.data;
  if (!canPinPost(actor, post)) return null;

  const existing = await db.query.pinTable.findFirst({
    where: {
      actorId: actor.id,
      postId: post.id,
    },
  });
  if (existing != null) return existing;

  const [{ pinnedPosts }] = await db
    .select({ pinnedPosts: count() })
    .from(pinTable)
    .where(eq(pinTable.actorId, actor.id));
  if (pinnedPosts >= MAX_PINNED_POSTS) return null;

  const [pin] = await db
    .insert(pinTable)
    .values({ actorId: actor.id, postId: post.id })
    .onConflictDoNothing()
    .returning();
  if (pin != null) {
    await sendPinActivity(fedCtx, actor, post);
    return pin;
  }

  return await db.query.pinTable.findFirst({
    where: {
      actorId: actor.id,
      postId: post.id,
    },
  }) ?? null;
}

export async function unpinPost(
  fedCtx: Context<ContextData>,
  actor: Actor,
  post: Post,
): Promise<Pin | null> {
  const { db } = fedCtx.data;
  const [pin] = await db
    .delete(pinTable)
    .where(
      and(
        eq(pinTable.actorId, actor.id),
        eq(pinTable.postId, post.id),
      ),
    )
    .returning();
  if (pin != null) await sendUnpinActivity(fedCtx, actor, post);
  return pin ?? null;
}

async function sendPinActivity(
  fedCtx: Context<ContextData>,
  actor: Actor,
  post: Post,
): Promise<void> {
  if (actor.accountId == null) return;
  const activity = new vocab.Add({
    id: new URL(
      `#add/${crypto.randomUUID()}`,
      fedCtx.getActorUri(actor.accountId),
    ),
    actor: fedCtx.getActorUri(actor.accountId),
    object: new URL(post.iri),
    target: fedCtx.getFeaturedUri(actor.accountId),
    to: fedCtx.getFollowersUri(actor.accountId),
  });
  await fedCtx.sendActivity(
    { identifier: actor.accountId },
    "followers",
    activity,
    {
      orderingKey: post.iri,
      preferSharedInbox: true,
      excludeBaseUris: [new URL(fedCtx.canonicalOrigin)],
    },
  );
}

async function sendUnpinActivity(
  fedCtx: Context<ContextData>,
  actor: Actor,
  post: Post,
): Promise<void> {
  if (actor.accountId == null) return;
  const activity = new vocab.Remove({
    id: new URL(
      `#remove/${crypto.randomUUID()}`,
      fedCtx.getActorUri(actor.accountId),
    ),
    actor: fedCtx.getActorUri(actor.accountId),
    object: new URL(post.iri),
    target: fedCtx.getFeaturedUri(actor.accountId),
    to: fedCtx.getFollowersUri(actor.accountId),
  });
  await fedCtx.sendActivity(
    { identifier: actor.accountId },
    "followers",
    activity,
    {
      orderingKey: post.iri,
      preferSharedInbox: true,
      excludeBaseUris: [new URL(fedCtx.canonicalOrigin)],
    },
  );
}

export async function isPostPinnedBy(
  db: Database,
  post: Post,
  actor?: Actor | null,
): Promise<boolean> {
  if (actor == null) return false;
  const rows = await db
    .select({ postId: pinTable.postId })
    .from(pinTable)
    .where(
      and(
        eq(pinTable.actorId, actor.id),
        eq(pinTable.postId, post.id),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
