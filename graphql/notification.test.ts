import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/equals";
import {
  type Actor as ActorRow,
  actorTable,
  notificationTable,
} from "@hackerspub/models/schema";
import { generateUuidV7, type Uuid } from "@hackerspub/models/uuid";
import { encodeGlobalID } from "@pothos/plugin-relay";
import DataLoader from "dataloader";
import { inArray } from "drizzle-orm";
import { execute, parse } from "graphql";
import { schema } from "./mod.ts";
import {
  insertAccountWithActor,
  makeUserContext,
  withRollback,
} from "../test/postgres.ts";

const notificationActorsQuery = parse(`
  query NotificationActorsOrderQuery {
    viewer {
      notifications(first: 10) {
        edges {
          node {
            ... on FollowNotification {
              actors(first: 10) {
                edges {
                  node {
                    id
                  }
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
  name: "Notification.actors returns actors newest-first",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const recipient = await insertAccountWithActor(tx, {
        username: "notifyme",
        name: "Notify Me",
        email: "notifyme@example.com",
      });
      const olderActor = await insertAccountWithActor(tx, {
        username: "olderactor",
        name: "Older Actor",
        email: "olderactor@example.com",
      });
      const newerActor = await insertAccountWithActor(tx, {
        username: "neweractor",
        name: "Newer Actor",
        email: "neweractor@example.com",
      });

      await tx.insert(notificationTable).values({
        id: crypto.randomUUID(),
        accountId: recipient.account.id,
        type: "follow",
        actorIds: [olderActor.actor.id, newerActor.actor.id],
        created: new Date("2026-04-15T00:00:00.000Z"),
      });

      const result = await execute({
        schema,
        document: notificationActorsQuery,
        contextValue: makeUserContext(tx, recipient.account),
        onError: "NO_PROPAGATE",
      });

      assertEquals(result.errors, undefined);

      const data = result.data as {
        viewer: {
          notifications: {
            edges: {
              node: {
                actors: {
                  edges: { node: { id: string } }[];
                };
              };
            }[];
          };
        } | null;
      };

      const edges = data.viewer?.notifications.edges;
      assert(edges != null && edges.length > 0);
      assertEquals(
        edges[0].node.actors.edges.map((edge) => edge.node.id),
        [
          encodeGlobalID("Actor", newerActor.actor.id),
          encodeGlobalID("Actor", olderActor.actor.id),
        ],
      );
    });
  },
});

Deno.test({
  name: "Notification.actors batches across multiple notifications",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const recipient = await insertAccountWithActor(tx, {
        username: "notifybatchme",
        name: "Notify Batch Me",
        email: "notifybatchme@example.com",
      });
      const actorA = await insertAccountWithActor(tx, {
        username: "notifybatchactora",
        name: "Notify Batch Actor A",
        email: "notifybatchactora@example.com",
      });
      const actorB = await insertAccountWithActor(tx, {
        username: "notifybatchactorb",
        name: "Notify Batch Actor B",
        email: "notifybatchactorb@example.com",
      });
      const actorC = await insertAccountWithActor(tx, {
        username: "notifybatchactorc",
        name: "Notify Batch Actor C",
        email: "notifybatchactorc@example.com",
      });

      // Two notifications for the same recipient.  actorB appears in
      // both — exercising the per-request DataLoader cache path that
      // dedupes overlapping ids across notifications.
      await tx.insert(notificationTable).values([
        {
          id: generateUuidV7(),
          accountId: recipient.account.id,
          type: "follow",
          actorIds: [actorA.actor.id, actorB.actor.id],
          // Newer notification — surfaces first via desc(created).
          created: new Date("2026-04-15T00:00:01.000Z"),
        },
        {
          id: generateUuidV7(),
          accountId: recipient.account.id,
          type: "follow",
          actorIds: [actorB.actor.id, actorC.actor.id],
          created: new Date("2026-04-15T00:00:00.000Z"),
        },
      ]);

      const result = await execute({
        schema,
        document: notificationActorsQuery,
        contextValue: makeUserContext(tx, recipient.account),
        onError: "NO_PROPAGATE",
      });

      assertEquals(result.errors, undefined);

      const data = result.data as {
        viewer: {
          notifications: {
            edges: {
              node: {
                actors: {
                  edges: { node: { id: string } }[];
                };
              };
            }[];
          };
        } | null;
      };

      const edges = data.viewer?.notifications.edges;
      assert(edges != null);
      assertEquals(edges.length, 2);

      // Each notification still resolves to its own ordered actor list,
      // newest-position-first (the resolver's existing semantics).
      assertEquals(
        edges[0].node.actors.edges.map((edge) => edge.node.id),
        [
          encodeGlobalID("Actor", actorB.actor.id),
          encodeGlobalID("Actor", actorA.actor.id),
        ],
      );
      assertEquals(
        edges[1].node.actors.edges.map((edge) => edge.node.id),
        [
          encodeGlobalID("Actor", actorC.actor.id),
          encodeGlobalID("Actor", actorB.actor.id),
        ],
      );
    });
  },
});

Deno.test({
  name:
    "Notification.actors filters out missing actor ids without breaking the batch",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const recipient = await insertAccountWithActor(tx, {
        username: "notifymissingme",
        name: "Notify Missing Me",
        email: "notifymissingme@example.com",
      });
      const realActor = await insertAccountWithActor(tx, {
        username: "notifymissingreal",
        name: "Notify Missing Real",
        email: "notifymissingreal@example.com",
      });
      const phantomId = generateUuidV7();

      await tx.insert(notificationTable).values({
        id: generateUuidV7(),
        accountId: recipient.account.id,
        type: "follow",
        actorIds: [phantomId, realActor.actor.id],
        created: new Date("2026-04-15T00:00:00.000Z"),
      });

      const result = await execute({
        schema,
        document: notificationActorsQuery,
        contextValue: makeUserContext(tx, recipient.account),
        onError: "NO_PROPAGATE",
      });

      assertEquals(result.errors, undefined);
      const data = result.data as {
        viewer: {
          notifications: {
            edges: {
              node: { actors: { edges: { node: { id: string } }[] } };
            }[];
          };
        } | null;
      };

      const edges = data.viewer?.notifications.edges;
      assert(edges != null && edges.length === 1);
      assertEquals(
        edges[0].node.actors.edges.map((edge) => edge.node.id),
        [encodeGlobalID("Actor", realActor.actor.id)],
      );
    });
  },
});

Deno.test({
  name:
    "Notification.actors fires one DataLoader batch for the deduped actor id union",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const recipient = await insertAccountWithActor(tx, {
        username: "notifyspyme",
        name: "Notify Spy Me",
        email: "notifyspyme@example.com",
      });
      const actorA = await insertAccountWithActor(tx, {
        username: "notifyspyactora",
        name: "Notify Spy Actor A",
        email: "notifyspyactora@example.com",
      });
      const actorB = await insertAccountWithActor(tx, {
        username: "notifyspyactorb",
        name: "Notify Spy Actor B",
        email: "notifyspyactorb@example.com",
      });
      const actorC = await insertAccountWithActor(tx, {
        username: "notifyspyactorc",
        name: "Notify Spy Actor C",
        email: "notifyspyactorc@example.com",
      });

      // Two notifications with overlapping actor ids — actorB appears
      // in both.  After dedupe, the loader should batch exactly the
      // three distinct ids in a single call.
      await tx.insert(notificationTable).values([
        {
          id: generateUuidV7(),
          accountId: recipient.account.id,
          type: "follow",
          actorIds: [actorA.actor.id, actorB.actor.id],
          created: new Date("2026-04-15T00:00:01.000Z"),
        },
        {
          id: generateUuidV7(),
          accountId: recipient.account.id,
          type: "follow",
          actorIds: [actorB.actor.id, actorC.actor.id],
          created: new Date("2026-04-15T00:00:00.000Z"),
        },
      ]);

      const batches: Uuid[][] = [];
      const actorByIdLoader = new DataLoader<Uuid, ActorRow | null>(
        async (ids) => {
          const idList = ids as Uuid[];
          batches.push([...idList]);
          const rows = await tx
            .select()
            .from(actorTable)
            .where(inArray(actorTable.id, idList));
          const byId = new Map(rows.map((row) => [row.id, row]));
          return idList.map((id) => byId.get(id) ?? null);
        },
      );

      const result = await execute({
        schema,
        document: notificationActorsQuery,
        contextValue: makeUserContext(tx, recipient.account, {
          actorByIdLoader,
        }),
        onError: "NO_PROPAGATE",
      });

      assertEquals(result.errors, undefined);

      // Exactly one batch — the loader collapsed both notifications'
      // actor lookups into one SQL query.
      assertEquals(batches.length, 1);

      // The batch contains exactly the deduped union (3 ids) of every
      // actor id requested across both notifications, in some order.
      // The length check rules out an undeduped payload that happens
      // to contain the right Set.
      assertEquals(batches[0].length, 3);
      assertEquals(
        new Set(batches[0]),
        new Set([
          actorA.actor.id,
          actorB.actor.id,
          actorC.actor.id,
        ]),
      );
    });
  },
});
