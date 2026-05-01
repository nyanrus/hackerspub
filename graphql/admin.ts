import { accountTable, actorTable, postTable } from "@hackerspub/models/schema";
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
): { lastActivity: Date; accountId: string } | null {
  const sep = cursor.indexOf("|");
  if (sep < 0) return null;
  const ts = cursor.slice(0, sep);
  const accountId = cursor.slice(sep + 1);
  const lastActivity = new Date(ts);
  if (Number.isNaN(lastActivity.getTime())) return null;
  return { lastActivity, accountId };
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
    args: {
      first: t.arg.int(),
      after: t.arg.string(),
      last: t.arg.int(),
      before: t.arg.string(),
    },
    errors: {
      types: [NotAuthenticatedError, NotAuthorizedError],
    },
    async resolve(_root, args, ctx): Promise<AdminAccountConnectionShape> {
      if (ctx.session == null) throw new NotAuthenticatedError();
      if (!ctx.account?.moderator) throw new NotAuthorizedError();

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

      // For natural ordering `lastActivity DESC, accountId DESC`, an
      // `after` cursor selects rows with smaller (lastActivity, id) and
      // a `before` cursor selects rows with larger (lastActivity, id).
      // The `inverted` flag swaps these for backwards traversal.
      // The cursor timestamp is bound as text and cast inside the SQL so
      // postgres-js can serialise it (it does not know the parameter
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
            : inverted
            ? tupleLessThan(beforeCursor.lastActivity, beforeCursor.accountId)
            : tupleGreaterThan(
              beforeCursor.lastActivity,
              beforeCursor.accountId,
            );
          const afterFilter = afterCursor == null
            ? undefined
            : inverted
            ? tupleGreaterThan(afterCursor.lastActivity, afterCursor.accountId)
            : tupleLessThan(afterCursor.lastActivity, afterCursor.accountId);

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
