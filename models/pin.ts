import { and, count, eq } from "drizzle-orm";
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
  db: Database,
  actor: Actor,
  post: Post,
): Promise<Pin | null> {
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
  return pin ?? await db.query.pinTable.findFirst({
    where: {
      actorId: actor.id,
      postId: post.id,
    },
  }) ?? null;
}

export async function unpinPost(
  db: Database,
  actor: Actor,
  post: Post,
): Promise<Pin | null> {
  const [pin] = await db
    .delete(pinTable)
    .where(
      and(
        eq(pinTable.actorId, actor.id),
        eq(pinTable.postId, post.id),
      ),
    )
    .returning();
  return pin ?? null;
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
