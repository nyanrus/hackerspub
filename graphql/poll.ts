import { vote } from "@hackerspub/models/poll";
import {
  isPostObject,
  isPostVisibleTo,
  persistPost,
} from "@hackerspub/models/post";
import { pollVoteTable } from "@hackerspub/models/schema";
import { drizzleConnectionHelpers } from "@pothos/plugin-drizzle";
import { eq } from "drizzle-orm";
import { builder } from "./builder.ts";
import { Actor } from "./actor.ts";
import { InvalidInputError } from "./error.ts";
import { Post, Question } from "./post.ts";
import { NotAuthenticatedError } from "./session.ts";

const Poll = builder.drizzleNode("pollTable", {
  name: "Poll",
  id: {
    column: (poll) => poll.postId,
  },
  fields: (t) => ({
    multiple: t.exposeBoolean("multiple"),
    ends: t.expose("ends", { type: "DateTime" }),
    closed: t.boolean({
      select: {
        columns: {
          ends: true,
        },
      },
      resolve(poll) {
        return poll.ends <= new Date();
      },
    }),
    viewerHasVoted: t.boolean({
      select: {
        columns: {
          postId: true,
        },
      },
      async resolve(poll, _, ctx) {
        if (ctx.account == null) return false;
        return await ctx.db.query.pollVoteTable.findFirst({
          where: {
            postId: poll.postId,
            actorId: ctx.account.actor.id,
          },
          columns: {
            postId: true,
          },
        }) != null;
      },
    }),
    post: t.relation("post", { type: Post }),
    options: t.field({
      type: [PollOption],
      select: (_, __, nestedSelect) => ({
        with: {
          options: nestedSelect(),
        },
      }),
      resolve(poll) {
        return poll.options.toSorted((a, b) => a.index - b.index);
      },
    }),
    votes: t.connection({
      type: PollVote,
      select: (args, ctx, nestedSelect) => ({
        with: {
          votes: pollVoteConnectionHelpers.getQuery(args, ctx, nestedSelect),
        },
        extras: {
          votesCount: (table) =>
            ctx.db.$count(
              pollVoteTable,
              eq(pollVoteTable.postId, table.postId),
            ),
        },
      }),
      resolve(poll, args, ctx) {
        const connection = pollVoteConnectionHelpers.resolve(
          poll.votes,
          args,
          ctx,
          poll,
        );
        return { totalCount: poll.votesCount, ...connection };
      },
    }, {
      fields: (t) => ({
        totalCount: t.exposeInt("totalCount"),
      }),
    }),
    voters: t.connection({
      type: Actor,
      select: (args, ctx, nestedSelect) => ({
        with: {
          voters: actorConnectionHelpers.getQuery(args, ctx, nestedSelect),
        },
      }),
      resolve(poll, args, ctx) {
        const connection = actorConnectionHelpers.resolve(
          poll.voters,
          args,
          ctx,
          poll,
        );
        return { totalCount: poll.votersCount, ...connection };
      },
    }, {
      fields: (t) => ({
        totalCount: t.exposeInt("totalCount"),
      }),
    }),
  }),
});

const PollOption = builder.drizzleObject("pollOptionTable", {
  name: "PollOption",
  fields: (t) => ({
    index: t.exposeInt("index"),
    title: t.exposeString("title"),
    poll: t.relation("poll"),
    viewerHasVoted: t.boolean({
      select: {
        columns: {
          postId: true,
          index: true,
        },
      },
      async resolve(option, _, ctx) {
        if (ctx.account == null) return false;
        return await ctx.db.query.pollVoteTable.findFirst({
          where: {
            postId: option.postId,
            optionIndex: option.index,
            actorId: ctx.account.actor.id,
          },
          columns: {
            postId: true,
          },
        }) != null;
      },
    }),
    votes: t.connection({
      type: PollVote,
      select: (args, ctx, nestedSelect) => ({
        with: {
          votes: pollVoteConnectionHelpers.getQuery(args, ctx, nestedSelect),
        },
      }),
      resolve(option, args, ctx) {
        const connection = pollVoteConnectionHelpers.resolve(
          option.votes,
          args,
          ctx,
          option,
        );
        return { totalCount: option.votesCount, ...connection };
      },
    }, {
      fields: (t) => ({
        totalCount: t.exposeInt("totalCount"),
      }),
    }),
  }),
});

const PollVote = builder.drizzleObject("pollVoteTable", {
  name: "PollVote",
  fields: (t) => ({
    created: t.expose("created", { type: "DateTime" }),
    poll: t.relation("poll"),
    option: t.relation("option"),
    actor: t.relation("actor"),
  }),
});

const pollVoteConnectionHelpers = drizzleConnectionHelpers(
  builder,
  "pollVoteTable",
  {},
);

const actorConnectionHelpers = drizzleConnectionHelpers(
  builder,
  "actorTable",
  {},
);

builder.drizzleObjectField(Question, "poll", (t) =>
  t.field({
    type: Poll,
    nullable: true,
    select: (_, __, nestedSelect) => ({
      columns: {
        id: true,
        iri: true,
        sharedPostId: true,
      },
      with: {
        poll: nestedSelect(),
      },
    }),
    async resolve(question, _, ctx) {
      if (question.poll != null) return question.poll;
      if (question.sharedPostId != null) return null;

      const documentLoader = ctx.account == null
        ? undefined
        : await ctx.fedCtx.getDocumentLoader({
          identifier: ctx.account.id,
        });
      const postObject = await ctx.fedCtx.lookupObject(question.iri, {
        documentLoader,
      });
      if (!isPostObject(postObject)) return null;

      await persistPost(ctx.fedCtx, postObject, { documentLoader });
      const reloaded = await ctx.db.query.postTable.findFirst({
        where: {
          id: question.id,
          type: "Question",
        },
        with: {
          poll: {
            extras: {
              votesCount: (table) =>
                ctx.db.$count(
                  pollVoteTable,
                  eq(pollVoteTable.postId, table.postId),
                ),
            },
            with: {
              options: {
                with: {
                  votes: true,
                },
              },
              votes: true,
              voters: true,
            },
          },
        },
      });
      return reloaded?.poll ?? null;
    },
  }));

builder.relayMutationField(
  "voteOnPoll",
  {
    inputFields: (t) => ({
      questionId: t.globalID({
        for: [Question],
        required: true,
      }),
      optionIndices: t.intList({ required: true }),
    }),
  },
  {
    errors: {
      types: [
        NotAuthenticatedError,
        InvalidInputError,
      ],
    },
    async resolve(_root, args, ctx) {
      if (ctx.account == null) {
        throw new NotAuthenticatedError();
      }

      const optionIndices = new Set(args.input.optionIndices);
      if (optionIndices.size < 1) {
        throw new InvalidInputError("optionIndices");
      }

      const question = await ctx.db.query.postTable.findFirst({
        with: {
          actor: {
            with: {
              followers: true,
              blockees: true,
              blockers: true,
            },
          },
          mentions: true,
          poll: {
            extras: {
              votesCount: (table) =>
                ctx.db.$count(
                  pollVoteTable,
                  eq(pollVoteTable.postId, table.postId),
                ),
            },
            with: {
              options: {
                with: {
                  votes: true,
                },
              },
              votes: true,
              voters: true,
            },
          },
        },
        where: {
          id: args.input.questionId.id,
          type: "Question",
        },
      });

      if (
        question == null || question.poll == null ||
        !isPostVisibleTo(question, ctx.account.actor)
      ) {
        throw new InvalidInputError("questionId");
      }

      if (question.poll.ends <= new Date()) {
        throw new InvalidInputError("questionId");
      }

      if (!question.poll.multiple && optionIndices.size !== 1) {
        throw new InvalidInputError("optionIndices");
      }

      const validOptionIndices = new Set(
        question.poll.options.map((option) => option.index),
      );
      if (
        [...optionIndices].some((index) => !validOptionIndices.has(index))
      ) {
        throw new InvalidInputError("optionIndices");
      }

      await vote(ctx.fedCtx, ctx.account, question.poll, optionIndices);

      const updatedQuestion = await ctx.db.query.postTable.findFirst({
        with: {
          actor: {
            with: {
              followers: true,
              blockees: true,
              blockers: true,
            },
          },
          mentions: true,
          poll: {
            extras: {
              votesCount: (table) =>
                ctx.db.$count(
                  pollVoteTable,
                  eq(pollVoteTable.postId, table.postId),
                ),
            },
            with: {
              options: {
                with: {
                  votes: true,
                },
              },
              votes: true,
              voters: true,
            },
          },
        },
        where: {
          id: question.id,
          type: "Question",
        },
      });
      if (updatedQuestion == null || updatedQuestion.poll == null) {
        throw new InvalidInputError("questionId");
      }

      const votes = await ctx.db.query.pollVoteTable.findMany({
        with: {
          option: true,
        },
        where: {
          postId: question.id,
          actorId: ctx.account.actor.id,
        },
        orderBy: { optionIndex: "asc" },
      });

      return { question: updatedQuestion, poll: updatedQuestion.poll, votes };
    },
  },
  {
    outputFields: (t) => ({
      question: t.field({
        type: Question,
        resolve(result) {
          return result.question;
        },
      }),
      poll: t.field({
        type: Poll,
        resolve(result) {
          return result.poll;
        },
      }),
      votes: t.field({
        type: [PollVote],
        resolve(result) {
          return result.votes;
        },
      }),
    }),
  },
);
