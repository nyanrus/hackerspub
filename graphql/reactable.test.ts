import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/equals";
import { eq } from "drizzle-orm";
import type { Transaction } from "@hackerspub/models/db";
import {
  actorTable,
  customEmojiTable,
  reactionTable,
} from "@hackerspub/models/schema";
import { generateUuidV7 } from "@hackerspub/models/uuid";
import { encodeGlobalID } from "@pothos/plugin-relay";
import { execute, parse } from "graphql";
import { schema } from "./mod.ts";
import {
  insertAccountWithActor,
  insertNotePost,
  makeUserContext,
  seedLocalInstance,
  withRollback,
} from "../test/postgres.ts";

interface ReactedNoteSeedResult {
  noteId: string;
  viewerAccount: Awaited<ReturnType<typeof insertAccountWithActor>>["account"];
  reactors: { id: string; handle: string; avatarUrl: string }[];
}

const reactorsQuery = parse(`
  query ReactorsQuery($id: ID!) {
    node(id: $id) {
      ... on Post {
        reactionGroups {
          ... on EmojiReactionGroup {
            emoji
            reactors(first: 10) {
              totalCount
              viewerHasReacted
              edges {
                node {
                  id
                  handle
                  avatarUrl
                }
              }
            }
          }
          ... on CustomEmojiReactionGroup {
            reactors(first: 10) {
              edges {
                node {
                  handle
                  avatarUrl
                }
              }
            }
          }
        }
      }
    }
  }
`);

Deno.test({
  name: "ReactionGroup.reactors returns edges for first-page queries",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { noteId, viewerAccount, reactors } = await seedReactedNote(tx);

      const result = await execute({
        schema,
        document: reactorsQuery,
        variableValues: {
          id: encodeGlobalID("Note", noteId),
        },
        contextValue: makeUserContext(tx, viewerAccount),
        onError: "NO_PROPAGATE",
      });

      assertEquals(result.errors, undefined);

      const data = result.data as {
        node: {
          reactionGroups: {
            emoji?: string;
            reactors?: {
              totalCount?: number;
              viewerHasReacted?: boolean;
              edges: {
                node: { id?: string; handle: string; avatarUrl: string };
              }[];
            };
          }[];
        } | null;
      };

      const reactionGroup = data.node?.reactionGroups.find((group) =>
        group.emoji === "❤️"
      );
      assert(reactionGroup != null);
      const reactorsConnection = reactionGroup.reactors;
      assert(reactorsConnection != null);
      assertEquals(reactorsConnection.totalCount, 2);
      assertEquals(reactorsConnection.viewerHasReacted, true);
      assertEquals(reactorsConnection.edges.length, 2);
      assertEquals(
        reactorsConnection.edges.map((edge) => edge.node.id).sort(),
        reactors.map((reactor) => encodeGlobalID("Actor", reactor.id)).sort(),
      );
      for (const reactor of reactors) {
        const node = reactorsConnection.edges.find((edge) =>
          edge.node.handle === reactor.handle
        )?.node;
        assert(node != null);
        assertEquals(node.avatarUrl, reactor.avatarUrl);
      }

      const customReactionGroup = data.node?.reactionGroups.find((group) =>
        group.emoji == null && group.reactors != null
      );
      assert(customReactionGroup != null);
      assert(customReactionGroup.reactors != null);
      assertEquals(customReactionGroup.reactors.edges.length, 1);
      assertEquals(
        customReactionGroup.reactors.edges[0].node.handle,
        reactors[0].handle,
      );
      assertEquals(
        customReactionGroup.reactors.edges[0].node.avatarUrl,
        reactors[0].avatarUrl,
      );
    });
  },
});

async function seedReactedNote(
  tx: Transaction,
): Promise<ReactedNoteSeedResult> {
  const timestamp = new Date("2026-04-15T00:00:00.000Z");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);

  await seedLocalInstance(tx);

  const author = await insertAccountWithActor(tx, {
    username: `author${suffix}`,
    name: "Author",
    email: `author-${suffix}@example.com`,
  });
  const viewer = await insertAccountWithActor(tx, {
    username: `viewer${suffix}`,
    name: "Viewer",
    email: `viewer-${suffix}@example.com`,
  });
  const other = await insertAccountWithActor(tx, {
    username: `other${suffix}`,
    name: "Other",
    email: `other-${suffix}@example.com`,
  });

  const viewerAvatarUrl = `https://cdn.example/avatars/viewer-${suffix}.png`;
  const otherAvatarUrl = `https://cdn.example/avatars/other-${suffix}.png`;
  const customEmojiId = generateUuidV7();
  await tx.update(actorTable)
    .set({ avatarUrl: viewerAvatarUrl })
    .where(eq(actorTable.id, viewer.actor.id));
  await tx.update(actorTable)
    .set({ avatarUrl: otherAvatarUrl })
    .where(eq(actorTable.id, other.actor.id));
  await tx.insert(customEmojiTable).values({
    id: customEmojiId,
    iri: `http://localhost/emojis/${customEmojiId}`,
    name: ":party:",
    imageUrl: `https://cdn.example/emoji/${customEmojiId}.png`,
  });

  const { post } = await insertNotePost(tx, {
    account: author.account,
    content: "Hello world",
    contentHtml: "<p>Hello world</p>",
    published: timestamp,
    updated: timestamp,
    reactionsCounts: { "❤️": 2, [customEmojiId]: 1 },
  });

  await tx.insert(reactionTable).values([
    {
      iri: `http://localhost/reactions/${generateUuidV7()}`,
      postId: post.id,
      actorId: viewer.actor.id,
      customEmojiId,
      created: new Date("2026-04-15T00:00:00.500Z"),
    },
    {
      iri: `http://localhost/reactions/${generateUuidV7()}`,
      postId: post.id,
      actorId: viewer.actor.id,
      emoji: "❤️",
      created: new Date("2026-04-15T00:00:01.000Z"),
    },
    {
      iri: `http://localhost/reactions/${generateUuidV7()}`,
      postId: post.id,
      actorId: other.actor.id,
      emoji: "❤️",
      created: new Date("2026-04-15T00:00:02.000Z"),
    },
  ]);

  return {
    noteId: post.id,
    viewerAccount: viewer.account,
    reactors: [
      {
        id: viewer.actor.id,
        handle: viewer.actor.handle,
        avatarUrl: viewerAvatarUrl,
      },
      {
        id: other.actor.id,
        handle: other.actor.handle,
        avatarUrl: otherAvatarUrl,
      },
    ],
  };
}
