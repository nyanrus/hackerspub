import {
  getInvitationRegenerationStatus,
  regenerateInvitations,
} from "@hackerspub/models/admin";
import { accountTable, actorTable, postTable } from "@hackerspub/models/schema";
import { type Uuid, validateUuid } from "@hackerspub/models/uuid";
import {
  resolveCursorConnection,
  type ResolveCursorConnectionArgs,
} from "@pothos/plugin-relay";
import { and, asc, desc, eq, isNotNull, type SQL, sql } from "drizzle-orm";
import { Account } from "./account.ts";
import { builder } from "./builder.ts";
import { NotAuthorizedError } from "./error.ts";
import { NotAuthenticatedError } from "./session.ts";

interface AdminAccountRow {
  account: typeof accountTable.$inferSelect;
  lastActivity: Date;
}

function encodeAdminCursor(row: AdminAccountRow): string {
  return `${row.lastActivity.toISOString()}|${row.account.id}`;
}

function decodeAdminCursor(
  cursor: string,
): { lastActivity: Date; accountId: Uuid } | null {
  const sep = cursor.indexOf("|");
  if (sep < 0) return null;
  const ts = cursor.slice(0, sep);
  const rawId = cursor.slice(sep + 1);
  const lastActivity = new Date(ts);
  if (Number.isNaN(lastActivity.getTime())) return null;
  if (!validateUuid(rawId)) return null;
  return { lastActivity, accountId: rawId };
}

const AdminAccountEdge = builder.simpleObject("AdminAccountEdge", {
  fields: (t) => ({
    cursor: t.string(),
    node: t.field({ type: Account }),
  }),
});

const AdminAccountPageInfo = builder.simpleObject("AdminAccountPageInfo", {
  fields: (t) => ({
    hasNextPage: t.boolean(),
    hasPreviousPage: t.boolean(),
    startCursor: t.string({ nullable: true }),
    endCursor: t.string({ nullable: true }),
  }),
});

interface AdminAccountConnectionShape {
  totalCount: number;
  edges: { cursor: string; node: typeof accountTable.$inferSelect }[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
}

const AdminAccountConnection = builder.simpleObject("AdminAccountConnection", {
  fields: (t) => ({
    totalCount: t.int(),
    edges: t.field({ type: [AdminAccountEdge] }),
    pageInfo: t.field({ type: AdminAccountPageInfo }),
  }),
});

builder.queryField("adminAccounts", (t) =>
  t.field({
    type: AdminAccountConnection,
    nullable: true,
    description:
      "Moderator-only connection of every account, ordered by latest " +
      "post `published` falling back to `account.updated`.  Returns " +
      "null when the viewer is not a moderator; routes should guard " +
      "with `viewer.moderator` and redirect non-moderators.",
    args: {
      first: t.arg.int(),
      after: t.arg.string(),
      last: t.arg.int(),
      before: t.arg.string(),
    },
    async resolve(
      _root,
      args,
      ctx,
    ): Promise<AdminAccountConnectionShape | null> {
      if (ctx.session == null) return null;
      if (!ctx.account?.moderator) return null;

      // Aggregate the latest published timestamp per account so the
      // outer query can sort by COALESCE(MAX(published), updated).
      const lastPublishedSubquery = ctx.db
        .select({
          accountId: actorTable.accountId,
          maxPublished: sql<Date | null>`MAX(${postTable.published})`.as(
            "max_published",
          ),
        })
        .from(postTable)
        .innerJoin(actorTable, eq(actorTable.id, postTable.actorId))
        .where(isNotNull(actorTable.accountId))
        .groupBy(actorTable.accountId)
        .as("last_published");

      const lastActivityExpr = sql<
        Date
      >`COALESCE(${lastPublishedSubquery.maxPublished}, ${accountTable.updated})`;

      const totalCount = await ctx.db.$count(accountTable);

      // For the natural ordering `lastActivity DESC, accountId DESC`,
      // the cursor filters depend only on the cursor side, never on
      // `inverted`: rows BEFORE the cursor in natural order have a
      // strictly larger (lastActivity, id) tuple, and rows AFTER have a
      // strictly smaller one.  The `inverted` flag only flips the
      // ORDER BY direction so the framework can take the LAST N nodes
      // closest to the cursor and reverse them back into natural order.
      // The cursor timestamp and id are bound as text and cast inside
      // the SQL so postgres-js can serialise them (it has no parameter
      // type for the COALESCE expression).
      function tupleLessThan(ts: Date, id: string): SQL {
        const tsLit = sql`${ts.toISOString()}::timestamptz`;
        const idLit = sql`${id}::uuid`;
        return sql`(${lastActivityExpr} < ${tsLit}) OR (${lastActivityExpr} = ${tsLit} AND ${accountTable.id} < ${idLit})`;
      }

      function tupleGreaterThan(ts: Date, id: string): SQL {
        const tsLit = sql`${ts.toISOString()}::timestamptz`;
        const idLit = sql`${id}::uuid`;
        return sql`(${lastActivityExpr} > ${tsLit}) OR (${lastActivityExpr} = ${tsLit} AND ${accountTable.id} > ${idLit})`;
      }

      const connection = await resolveCursorConnection(
        {
          args,
          toCursor: (row: AdminAccountRow) => encodeAdminCursor(row),
        },
        async (
          { before, after, limit, inverted }: ResolveCursorConnectionArgs,
        ): Promise<AdminAccountRow[]> => {
          const beforeCursor = before == null
            ? null
            : decodeAdminCursor(before);
          const afterCursor = after == null ? null : decodeAdminCursor(after);

          const beforeFilter = beforeCursor == null
            ? undefined
            : tupleGreaterThan(
              beforeCursor.lastActivity,
              beforeCursor.accountId,
            );
          const afterFilter = afterCursor == null ? undefined : tupleLessThan(
            afterCursor.lastActivity,
            afterCursor.accountId,
          );

          const rows = await ctx.db
            .select({
              account: accountTable,
              lastActivity: lastActivityExpr.as("last_activity"),
            })
            .from(accountTable)
            .leftJoin(
              lastPublishedSubquery,
              eq(lastPublishedSubquery.accountId, accountTable.id),
            )
            .where(and(beforeFilter, afterFilter))
            .orderBy(
              inverted ? asc(lastActivityExpr) : desc(lastActivityExpr),
              inverted ? asc(accountTable.id) : desc(accountTable.id),
            )
            .limit(limit);

          return rows.map((r) => ({
            account: r.account,
            // `MAX(timestamp)` is returned as a string by postgres-js;
            // coerce to a Date so the cursor encoder can serialise it.
            lastActivity: r.lastActivity instanceof Date
              ? r.lastActivity
              : new Date(r.lastActivity as unknown as string),
          }));
        },
      );

      return {
        totalCount,
        edges: connection.edges.map((edge) => ({
          cursor: edge.cursor,
          node: edge.node.account,
        })),
        pageInfo: {
          hasNextPage: connection.pageInfo.hasNextPage,
          hasPreviousPage: connection.pageInfo.hasPreviousPage,
          startCursor: connection.pageInfo.startCursor ?? null,
          endCursor: connection.pageInfo.endCursor ?? null,
        },
      };
    },
  }));

const InvitationRegenerationStatus = builder.simpleObject(
  "InvitationRegenerationStatus",
  {
    description:
      "A snapshot of the invitation-regeneration state used by the admin UI " +
      "to preview a regeneration before triggering it.",
    fields: (t) => ({
      lastRegeneratedAt: t.field({
        type: "DateTime",
        nullable: true,
        description:
          "When the regeneration was last triggered, or null if it has " +
          "never been run.",
      }),
      cutoffDate: t.field({
        type: "DateTime",
        description:
          "The earliest `published` timestamp a post must have to count " +
          "an account as eligible.  Equals `lastRegeneratedAt` once a " +
          "regeneration has been recorded; otherwise defaults to one " +
          "week before now.",
      }),
      eligibleAccountsCount: t.int({
        description: "Number of accounts with at least one post past cutoff.",
      }),
      topThirdCount: t.int({
        description:
          "Number of accounts that would receive an invitation if a " +
          "regeneration were triggered now (ceil(eligible / 3)).",
      }),
    }),
  },
);

builder.queryField("invitationRegenerationStatus", (t) =>
  t.field({
    type: InvitationRegenerationStatus,
    nullable: true,
    description:
      "Moderator-only invitation-regeneration preview.  Returns null " +
      "when the viewer is not a moderator; the route guards with " +
      "`viewer.moderator` to redirect non-moderators.",
    async resolve(_root, _args, ctx) {
      if (ctx.session == null) return null;
      if (!ctx.account?.moderator) return null;
      return await getInvitationRegenerationStatus(ctx.db, ctx.kv);
    },
  }));

const RegenerateInvitationsPayload = builder.simpleObject(
  "RegenerateInvitationsPayload",
  {
    description: "The result of a successful invitations regeneration.",
    fields: (t) => ({
      regeneratedAt: t.field({
        type: "DateTime",
        description: "When the regeneration ran.",
      }),
      accountsAffected: t.int({
        description:
          "Number of accounts whose `leftInvitations` was incremented.",
      }),
      status: t.field({
        type: InvitationRegenerationStatus,
        description:
          "The updated regeneration status reflecting the just-recorded run.",
      }),
    }),
  },
);

builder.mutationField("regenerateInvitations", (t) =>
  t.field({
    type: RegenerateInvitationsPayload,
    description:
      "Grant +1 invitation to the top third of accounts with at least " +
      "one post since the last regeneration cutoff, and persist the new " +
      "last-regen timestamp.",
    errors: {
      types: [NotAuthenticatedError, NotAuthorizedError],
    },
    async resolve(_root, _args, ctx) {
      if (ctx.session == null) throw new NotAuthenticatedError();
      if (!ctx.account?.moderator) throw new NotAuthorizedError();
      const result = await regenerateInvitations(ctx.db, ctx.kv);
      const status = await getInvitationRegenerationStatus(ctx.db, ctx.kv);
      return {
        regeneratedAt: result.regeneratedAt,
        accountsAffected: result.accountsAffected,
        status,
      };
    },
  }));
