import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/equals";
import { accountTable } from "@hackerspub/models/schema";
import { eq } from "drizzle-orm";
import { execute, parse } from "graphql";
import { schema } from "./mod.ts";
import {
  insertAccountWithActor,
  insertNotePost,
  makeGuestContext,
  makeUserContext,
  withRollback,
} from "../test/postgres.ts";

const adminAccountsQuery = parse(`
  query AdminAccounts($first: Int, $after: String) {
    adminAccounts(first: $first, after: $after) {
      __typename
      ... on AdminAccountConnection {
        totalCount
        edges {
          cursor
          node {
            uuid
            username
            postCount
            lastPostPublished
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      ... on NotAuthenticatedError { notAuthenticated }
      ... on NotAuthorizedError { notAuthorized }
    }
  }
`);

async function makeModerator(
  tx: Parameters<Parameters<typeof withRollback>[0]>[0],
  username: string,
) {
  const result = await insertAccountWithActor(tx, {
    username,
    name: `Moderator ${username}`,
    email: `${username}@example.com`,
  });
  await tx.update(accountTable).set({ moderator: true }).where(
    eq(accountTable.id, result.account.id),
  );
  return {
    ...result,
    account: { ...result.account, moderator: true },
  };
}

Deno.test({
  name: "adminAccounts returns NotAuthenticatedError for guest",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const result = await execute({
        schema,
        document: adminAccountsQuery,
        variableValues: { first: 10 },
        contextValue: makeGuestContext(tx),
        onError: "NO_PROPAGATE",
      });
      assertEquals(result.errors, undefined);
      const data = result.data as {
        adminAccounts: { __typename: string };
      };
      assertEquals(data.adminAccounts.__typename, "NotAuthenticatedError");
    });
  },
});

Deno.test({
  name: "adminAccounts returns NotAuthorizedError for non-moderator",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const normal = await insertAccountWithActor(tx, {
        username: "adminnonmod",
        name: "Non Mod",
        email: "adminnonmod@example.com",
      });
      const result = await execute({
        schema,
        document: adminAccountsQuery,
        variableValues: { first: 10 },
        contextValue: makeUserContext(tx, normal.account),
        onError: "NO_PROPAGATE",
      });
      assertEquals(result.errors, undefined);
      const data = result.data as {
        adminAccounts: { __typename: string };
      };
      assertEquals(data.adminAccounts.__typename, "NotAuthorizedError");
    });
  },
});

Deno.test({
  name: "adminAccounts returns paginated AdminAccountConnection for moderator",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const mod = await makeModerator(tx, "adminmod1");
      // Create three other accounts.
      for (let i = 0; i < 3; i++) {
        await insertAccountWithActor(tx, {
          username: `adminuser${i}`,
          name: `Admin User ${i}`,
          email: `adminuser${i}@example.com`,
        });
      }
      const result = await execute({
        schema,
        document: adminAccountsQuery,
        variableValues: { first: 10 },
        contextValue: makeUserContext(tx, mod.account),
        onError: "NO_PROPAGATE",
      });
      assertEquals(result.errors, undefined);
      const data = result.data as {
        adminAccounts: {
          __typename: string;
          totalCount: number;
          edges: { node: { username: string } }[];
        };
      };
      assertEquals(data.adminAccounts.__typename, "AdminAccountConnection");
      assertEquals(data.adminAccounts.totalCount, 4);
      assertEquals(data.adminAccounts.edges.length, 4);
      const usernames = data.adminAccounts.edges.map((e) => e.node.username)
        .sort();
      assertEquals(
        usernames,
        ["adminmod1", "adminuser0", "adminuser1", "adminuser2"],
      );
    });
  },
});

Deno.test({
  name:
    "adminAccounts orders by latest post published falling back to account.updated",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const mod = await makeModerator(tx, "ordermod");

      // a posted most recently, b posted earlier, c never posted.
      const a = await insertAccountWithActor(tx, {
        username: "orderalice",
        name: "Order Alice",
        email: "orderalice@example.com",
      });
      const b = await insertAccountWithActor(tx, {
        username: "orderbob",
        name: "Order Bob",
        email: "orderbob@example.com",
      });
      const c = await insertAccountWithActor(tx, {
        username: "ordercarol",
        name: "Order Carol",
        email: "ordercarol@example.com",
      });

      // Set distinct `updated` timestamps on the no-post accounts so
      // ordering is deterministic.
      await tx.update(accountTable).set({
        updated: new Date("2026-04-01T00:00:00.000Z"),
      }).where(eq(accountTable.id, c.account.id));
      await tx.update(accountTable).set({
        updated: new Date("2026-03-01T00:00:00.000Z"),
      }).where(eq(accountTable.id, mod.account.id));

      await insertNotePost(tx, {
        account: a.account,
        published: new Date("2026-04-15T00:00:00.000Z"),
      });
      await insertNotePost(tx, {
        account: b.account,
        published: new Date("2026-04-10T00:00:00.000Z"),
      });

      const result = await execute({
        schema,
        document: adminAccountsQuery,
        variableValues: { first: 10 },
        contextValue: makeUserContext(tx, mod.account),
        onError: "NO_PROPAGATE",
      });
      assertEquals(result.errors, undefined);
      const data = result.data as {
        adminAccounts: {
          edges: { node: { username: string } }[];
        };
      };
      // a (2026-04-15) > b (2026-04-10) > c.updated (2026-04-01)
      // > mod.updated (2026-03-01)
      assertEquals(
        data.adminAccounts.edges.map((e) => e.node.username),
        ["orderalice", "orderbob", "ordercarol", "ordermod"],
      );
    });
  },
});

Deno.test({
  name: "adminAccounts pagination cursor round-trips correctly",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const mod = await makeModerator(tx, "paginmod");
      const others = [];
      // Distinct updated timestamps so ordering is stable.
      for (let i = 0; i < 5; i++) {
        const acc = await insertAccountWithActor(tx, {
          username: `paginuser${i}`,
          name: `Pagin User ${i}`,
          email: `paginuser${i}@example.com`,
        });
        await tx.update(accountTable).set({
          updated: new Date(`2026-04-${10 + i}T00:00:00.000Z`),
        }).where(eq(accountTable.id, acc.account.id));
        others.push(acc);
      }

      // First page.
      const first = await execute({
        schema,
        document: adminAccountsQuery,
        variableValues: { first: 2 },
        contextValue: makeUserContext(tx, mod.account),
        onError: "NO_PROPAGATE",
      });
      assertEquals(first.errors, undefined);
      const firstData = first.data as {
        adminAccounts: {
          edges: { cursor: string; node: { username: string } }[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };
      assertEquals(firstData.adminAccounts.edges.length, 2);
      assert(firstData.adminAccounts.pageInfo.hasNextPage);

      // Second page.
      const second = await execute({
        schema,
        document: adminAccountsQuery,
        variableValues: {
          first: 2,
          after: firstData.adminAccounts.pageInfo.endCursor,
        },
        contextValue: makeUserContext(tx, mod.account),
        onError: "NO_PROPAGATE",
      });
      assertEquals(second.errors, undefined);
      const secondData = second.data as {
        adminAccounts: {
          edges: { cursor: string; node: { username: string } }[];
          pageInfo: { hasNextPage: boolean };
        };
      };
      assertEquals(secondData.adminAccounts.edges.length, 2);

      // No overlap with the first page.
      const firstUsernames = firstData.adminAccounts.edges.map((e) =>
        e.node.username
      );
      const secondUsernames = secondData.adminAccounts.edges.map((e) =>
        e.node.username
      );
      for (const u of secondUsernames) {
        assert(
          !firstUsernames.includes(u),
          `cursor leak: ${u} appears in both pages`,
        );
      }
    });
  },
});

Deno.test({
  name: "adminAccounts.totalCount equals overall account count",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const mod = await makeModerator(tx, "totalmod");
      for (let i = 0; i < 7; i++) {
        await insertAccountWithActor(tx, {
          username: `totaluser${i}`,
          name: `Total User ${i}`,
          email: `totaluser${i}@example.com`,
        });
      }
      const result = await execute({
        schema,
        document: adminAccountsQuery,
        variableValues: { first: 2 },
        contextValue: makeUserContext(tx, mod.account),
        onError: "NO_PROPAGATE",
      });
      assertEquals(result.errors, undefined);
      const data = result.data as {
        adminAccounts: { totalCount: number; edges: unknown[] };
      };
      assertEquals(data.adminAccounts.totalCount, 8);
      assertEquals(data.adminAccounts.edges.length, 2);
    });
  },
});

Deno.test({
  name: "adminAccounts exposes Account.postCount for moderator",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const mod = await makeModerator(tx, "countmod");
      const target = await insertAccountWithActor(tx, {
        username: "counttarget",
        name: "Count Target",
        email: "counttarget@example.com",
      });
      for (let i = 0; i < 4; i++) {
        await insertNotePost(tx, {
          account: target.account,
          published: new Date(`2026-04-${10 + i}T00:00:00.000Z`),
        });
      }
      const result = await execute({
        schema,
        document: adminAccountsQuery,
        variableValues: { first: 10 },
        contextValue: makeUserContext(tx, mod.account),
        onError: "NO_PROPAGATE",
      });
      assertEquals(result.errors, undefined);
      const data = result.data as {
        adminAccounts: {
          edges: {
            node: {
              username: string;
              postCount: number;
              lastPostPublished: Date | string | null;
            };
          }[];
        };
      };
      const targetEdge = data.adminAccounts.edges.find(
        (e) => e.node.username === "counttarget",
      );
      assert(targetEdge != null);
      assertEquals(targetEdge.node.postCount, 4);
      const ts = targetEdge.node.lastPostPublished;
      assert(ts != null);
      const tsIso = ts instanceof Date ? ts.toISOString() : ts;
      assertEquals(tsIso, "2026-04-13T00:00:00.000Z");
    });
  },
});

Deno.test({
  name: "adminAccounts.lastPostPublished is null for accounts with no posts",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const mod = await makeModerator(tx, "emptymod");
      await insertAccountWithActor(tx, {
        username: "emptytarget",
        name: "Empty Target",
        email: "emptytarget@example.com",
      });
      const result = await execute({
        schema,
        document: adminAccountsQuery,
        variableValues: { first: 10 },
        contextValue: makeUserContext(tx, mod.account),
        onError: "NO_PROPAGATE",
      });
      assertEquals(result.errors, undefined);
      const data = result.data as {
        adminAccounts: {
          edges: {
            node: {
              username: string;
              postCount: number;
              lastPostPublished: string | null;
            };
          }[];
        };
      };
      const target = data.adminAccounts.edges.find(
        (e) => e.node.username === "emptytarget",
      );
      assert(target != null);
      assertEquals(target.node.postCount, 0);
      assertEquals(target.node.lastPostPublished, null);
    });
  },
});
