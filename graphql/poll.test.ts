import assert from "node:assert/strict";
import test from "node:test";
import { encodeGlobalID } from "@pothos/plugin-relay";
import { execute, parse } from "graphql";
import {
  type NewPost,
  pollOptionTable,
  pollTable,
  pollVoteTable,
  postTable,
} from "@hackerspub/models/schema";
import { generateUuidV7 } from "@hackerspub/models/uuid";
import { schema } from "./mod.ts";
import {
  insertAccountWithActor,
  makeGuestContext,
  makeUserContext,
  toPlainJson,
  withRollback,
} from "../test/postgres.ts";

const pollEndsInFuture = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const pollEndedInPast = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

const questionPollQuery = parse(`
  query QuestionPoll($id: ID!) {
    node(id: $id) {
      ... on Question {
        poll {
          multiple
          closed
          viewerHasVoted
          options {
            index
            title
            viewerHasVoted
            votes(first: 10) {
              totalCount
              edges {
                node {
                  actor { id }
                }
              }
            }
          }
          votes(first: 10) {
            totalCount
            edges {
              node {
                actor { id }
                option { title }
              }
            }
          }
          voters(first: 10) {
            totalCount
            edges {
              node { id }
            }
          }
        }
      }
    }
  }
`);

const actorPostByUuidQuery = parse(`
  query ActorPostByUuid($handle: String!, $uuid: UUID!) {
    actorByHandle(handle: $handle, allowLocalHandle: true) {
      postByUuid(uuid: $uuid) {
        __typename
        id
      }
    }
  }
`);

const voteOnPollMutation = parse(`
  mutation VoteOnPoll($questionId: ID!, $optionIndices: [Int!]!) {
    voteOnPoll(input: {
      questionId: $questionId,
      optionIndices: $optionIndices,
    }) {
      __typename
      ... on VoteOnPollPayload {
        question {
          id
          poll {
            viewerHasVoted
            voters(first: 10) {
              totalCount
            }
            options {
              index
              title
              viewerHasVoted
              votes(first: 10) {
                totalCount
              }
            }
          }
        }
        poll {
          viewerHasVoted
        }
        votes {
          option {
            index
            title
          }
        }
      }
      ... on InvalidInputError {
        inputPath
      }
      ... on NotAuthenticatedError {
        notAuthenticated
      }
    }
  }
`);

test("Question.poll exposes ordered options and vote connections", async () => {
  await withRollback(async (tx) => {
    const author = await insertAccountWithActor(tx, {
      username: "pollgraphqlauthor",
      name: "Poll GraphQL Author",
      email: "pollgraphqlauthor@example.com",
    });
    const firstVoter = await insertAccountWithActor(tx, {
      username: "pollgraphqlfirst",
      name: "Poll GraphQL First",
      email: "pollgraphqlfirst@example.com",
    });
    const secondVoter = await insertAccountWithActor(tx, {
      username: "pollgraphqlsecond",
      name: "Poll GraphQL Second",
      email: "pollgraphqlsecond@example.com",
    });
    const questionId = generateUuidV7();
    const published = new Date("2026-04-15T00:00:00.000Z");

    await tx.insert(postTable).values(
      {
        id: questionId,
        iri: `http://localhost/objects/${questionId}`,
        type: "Question",
        visibility: "public",
        actorId: author.actor.id,
        name: "Favorite language?",
        contentHtml: "<p>Favorite language?</p>",
        language: "en",
        tags: {},
        emojis: {},
        url: `http://localhost/@${author.account.username}/polls/${questionId}`,
        published,
        updated: published,
      } satisfies NewPost,
    );
    await tx.insert(pollTable).values({
      postId: questionId,
      multiple: true,
      votersCount: 2,
      ends: pollEndedInPast(),
    });
    await tx.insert(pollOptionTable).values([
      { postId: questionId, index: 1, title: "Rust", votesCount: 1 },
      { postId: questionId, index: 0, title: "TypeScript", votesCount: 1 },
    ]);
    await tx.insert(pollVoteTable).values([
      {
        postId: questionId,
        optionIndex: 0,
        actorId: firstVoter.actor.id,
        created: new Date("2026-04-15T00:00:01.000Z"),
      },
      {
        postId: questionId,
        optionIndex: 1,
        actorId: secondVoter.actor.id,
        created: new Date("2026-04-15T00:00:02.000Z"),
      },
    ]);

    const result = await execute({
      schema,
      document: questionPollQuery,
      variableValues: { id: encodeGlobalID("Question", questionId) },
      contextValue: makeGuestContext(tx),
      onError: "NO_PROPAGATE",
    });

    assert.equal(result.errors, undefined);

    const poll = (toPlainJson(result.data) as {
      node: {
        poll: {
          multiple: boolean;
          closed: boolean;
          viewerHasVoted: boolean;
          options: Array<{
            index: number;
            title: string;
            viewerHasVoted: boolean;
            votes: {
              totalCount: number;
              edges: Array<{ node: { actor: { id: string } } }>;
            };
          }>;
          votes: {
            totalCount: number;
            edges: Array<{
              node: { actor: { id: string }; option: { title: string } };
            }>;
          };
          voters: {
            totalCount: number;
            edges: Array<{ node: { id: string } }>;
          };
        };
      } | null;
    }).node?.poll;

    assert.ok(poll != null);
    assert.equal(poll.multiple, true);
    assert.equal(poll.closed, true);
    assert.equal(poll.viewerHasVoted, false);
    assert.deepEqual(
      poll.options.map((option) => ({
        index: option.index,
        title: option.title,
        viewerHasVoted: option.viewerHasVoted,
      })),
      [
        { index: 0, title: "TypeScript", viewerHasVoted: false },
        { index: 1, title: "Rust", viewerHasVoted: false },
      ],
    );
    assert.deepEqual(
      poll.options.map((option) => option.votes.totalCount),
      [1, 1],
    );
    assert.equal(poll.votes.totalCount, 2);
    assert.deepEqual(
      poll.votes.edges.map((edge) => edge.node.option.title).sort(),
      ["Rust", "TypeScript"],
    );
    assert.equal(poll.voters.totalCount, 2);
    assert.deepEqual(
      poll.voters.edges.map((edge) => edge.node.id).sort(),
      [
        encodeGlobalID("Actor", firstVoter.actor.id),
        encodeGlobalID("Actor", secondVoter.actor.id),
      ].sort(),
    );
  });
});

test("Actor.postByUuid resolves visible Question posts", async () => {
  await withRollback(async (tx) => {
    const author = await insertAccountWithActor(tx, {
      username: "polluuidlookup",
      name: "Poll UUID Lookup",
      email: "polluuidlookup@example.com",
    });
    const questionId = generateUuidV7();
    const published = new Date("2026-04-15T00:00:00.000Z");

    await tx.insert(postTable).values(
      {
        id: questionId,
        iri: `http://localhost/objects/${questionId}`,
        type: "Question",
        visibility: "public",
        actorId: author.actor.id,
        name: "Lookup poll?",
        contentHtml: "<p>Lookup poll?</p>",
        language: "en",
        tags: {},
        emojis: {},
        url: `http://localhost/@${author.account.username}/polls/${questionId}`,
        published,
        updated: published,
      } satisfies NewPost,
    );
    await tx.insert(pollTable).values({
      postId: questionId,
      multiple: false,
      votersCount: 0,
      ends: pollEndsInFuture(),
    });
    await tx.insert(pollOptionTable).values([
      { postId: questionId, index: 0, title: "Yes", votesCount: 0 },
      { postId: questionId, index: 1, title: "No", votesCount: 0 },
    ]);

    const result = await execute({
      schema,
      document: actorPostByUuidQuery,
      variableValues: {
        handle: author.account.username,
        uuid: questionId,
      },
      contextValue: makeGuestContext(tx),
      onError: "NO_PROPAGATE",
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlainJson(result.data), {
      actorByHandle: {
        postByUuid: {
          __typename: "Question",
          id: encodeGlobalID("Question", questionId),
        },
      },
    });
  });
});

test("voteOnPoll stores a single-choice vote and updates viewer fields", async () => {
  await withRollback(async (tx) => {
    const author = await insertAccountWithActor(tx, {
      username: "pollgraphqlvoteauthor",
      name: "Poll GraphQL Vote Author",
      email: "pollgraphqlvoteauthor@example.com",
    });
    const voter = await insertAccountWithActor(tx, {
      username: "pollgraphqlvoter",
      name: "Poll GraphQL Voter",
      email: "pollgraphqlvoter@example.com",
    });
    const questionId = generateUuidV7();
    const published = new Date("2026-04-15T00:00:00.000Z");
    const questionGlobalId = encodeGlobalID("Question", questionId);

    await tx.insert(postTable).values(
      {
        id: questionId,
        iri: `http://localhost/objects/${questionId}`,
        type: "Question",
        visibility: "public",
        actorId: author.actor.id,
        name: "Vote poll?",
        contentHtml: "<p>Vote poll?</p>",
        language: "en",
        tags: {},
        emojis: {},
        url: `http://localhost/@${author.account.username}/polls/${questionId}`,
        published,
        updated: published,
      } satisfies NewPost,
    );
    await tx.insert(pollTable).values({
      postId: questionId,
      multiple: false,
      votersCount: 0,
      ends: pollEndsInFuture(),
    });
    await tx.insert(pollOptionTable).values([
      { postId: questionId, index: 0, title: "TypeScript", votesCount: 0 },
      { postId: questionId, index: 1, title: "Rust", votesCount: 0 },
    ]);

    const result = await execute({
      schema,
      document: voteOnPollMutation,
      variableValues: {
        questionId: questionGlobalId,
        optionIndices: [1],
      },
      contextValue: makeUserContext(tx, voter.account),
      onError: "NO_PROPAGATE",
    });

    assert.equal(result.errors, undefined);
    const payload = (toPlainJson(result.data) as {
      voteOnPoll: {
        __typename: string;
        question?: {
          id: string;
          poll: {
            viewerHasVoted: boolean;
            voters: { totalCount: number };
            options: Array<{
              index: number;
              title: string;
              viewerHasVoted: boolean;
              votes: { totalCount: number };
            }>;
          };
        };
        poll?: { viewerHasVoted: boolean };
        votes?: Array<{ option: { index: number; title: string } }>;
      };
    }).voteOnPoll;

    assert.equal(payload.__typename, "VoteOnPollPayload");
    assert.equal(payload.question?.id, questionGlobalId);
    assert.equal(payload.question?.poll.viewerHasVoted, true);
    assert.equal(payload.poll?.viewerHasVoted, true);
    assert.equal(payload.question?.poll.voters.totalCount, 1);
    assert.deepEqual(payload.question?.poll.options, [
      {
        index: 0,
        title: "TypeScript",
        viewerHasVoted: false,
        votes: { totalCount: 0 },
      },
      {
        index: 1,
        title: "Rust",
        viewerHasVoted: true,
        votes: { totalCount: 1 },
      },
    ]);
    assert.deepEqual(payload.votes, [
      { option: { index: 1, title: "Rust" } },
    ]);

    const repeat = await execute({
      schema,
      document: voteOnPollMutation,
      variableValues: {
        questionId: questionGlobalId,
        optionIndices: [0],
      },
      contextValue: makeUserContext(tx, voter.account),
      onError: "NO_PROPAGATE",
    });

    assert.equal(repeat.errors, undefined);
    const repeatPayload = (toPlainJson(repeat.data) as {
      voteOnPoll: {
        __typename: string;
        votes?: Array<{ option: { index: number; title: string } }>;
      };
    }).voteOnPoll;
    assert.equal(repeatPayload.__typename, "VoteOnPollPayload");
    assert.deepEqual(repeatPayload.votes, [
      { option: { index: 1, title: "Rust" } },
    ]);
  });
});

test("voteOnPoll stores multiple choices for multi-choice polls", async () => {
  await withRollback(async (tx) => {
    const author = await insertAccountWithActor(tx, {
      username: "pollgraphqlmultiauthor",
      name: "Poll GraphQL Multi Author",
      email: "pollgraphqlmultiauthor@example.com",
    });
    const voter = await insertAccountWithActor(tx, {
      username: "pollgraphqlmultivoter",
      name: "Poll GraphQL Multi Voter",
      email: "pollgraphqlmultivoter@example.com",
    });
    const questionId = generateUuidV7();
    const published = new Date("2026-04-15T00:00:00.000Z");

    await tx.insert(postTable).values(
      {
        id: questionId,
        iri: `http://localhost/objects/${questionId}`,
        type: "Question",
        visibility: "public",
        actorId: author.actor.id,
        name: "Multi vote poll?",
        contentHtml: "<p>Multi vote poll?</p>",
        language: "en",
        tags: {},
        emojis: {},
        url: `http://localhost/@${author.account.username}/polls/${questionId}`,
        published,
        updated: published,
      } satisfies NewPost,
    );
    await tx.insert(pollTable).values({
      postId: questionId,
      multiple: true,
      votersCount: 0,
      ends: pollEndsInFuture(),
    });
    await tx.insert(pollOptionTable).values([
      { postId: questionId, index: 0, title: "Red", votesCount: 0 },
      { postId: questionId, index: 1, title: "Blue", votesCount: 0 },
      { postId: questionId, index: 2, title: "Green", votesCount: 0 },
    ]);

    const result = await execute({
      schema,
      document: voteOnPollMutation,
      variableValues: {
        questionId: encodeGlobalID("Question", questionId),
        optionIndices: [0, 2],
      },
      contextValue: makeUserContext(tx, voter.account),
      onError: "NO_PROPAGATE",
    });

    assert.equal(result.errors, undefined);
    const payload = (toPlainJson(result.data) as {
      voteOnPoll: {
        __typename: string;
        question?: {
          poll: {
            voters: { totalCount: number };
            options: Array<{
              index: number;
              viewerHasVoted: boolean;
              votes: { totalCount: number };
            }>;
          };
        };
        votes?: Array<{ option: { index: number; title: string } }>;
      };
    }).voteOnPoll;

    assert.equal(payload.__typename, "VoteOnPollPayload");
    assert.equal(payload.question?.poll.voters.totalCount, 1);
    assert.deepEqual(
      payload.question?.poll.options.map((option) => ({
        index: option.index,
        viewerHasVoted: option.viewerHasVoted,
        totalCount: option.votes.totalCount,
      })),
      [
        { index: 0, viewerHasVoted: true, totalCount: 1 },
        { index: 1, viewerHasVoted: false, totalCount: 0 },
        { index: 2, viewerHasVoted: true, totalCount: 1 },
      ],
    );
    assert.deepEqual(
      payload.votes?.map((vote) => vote.option).sort((a, b) =>
        a.index - b.index
      ),
      [
        { index: 0, title: "Red" },
        { index: 2, title: "Green" },
      ],
    );
  });
});

test("voteOnPoll rejects guest, invalid, and expired votes", async () => {
  await withRollback(async (tx) => {
    const author = await insertAccountWithActor(tx, {
      username: "pollgraphqlrejectauthor",
      name: "Poll GraphQL Reject Author",
      email: "pollgraphqlrejectauthor@example.com",
    });
    const voter = await insertAccountWithActor(tx, {
      username: "pollgraphqlrejectvoter",
      name: "Poll GraphQL Reject Voter",
      email: "pollgraphqlrejectvoter@example.com",
    });
    const questionId = generateUuidV7();
    const expiredQuestionId = generateUuidV7();
    const published = new Date("2026-04-15T00:00:00.000Z");

    for (
      const [id, ends] of [
        [questionId, pollEndsInFuture()],
        [expiredQuestionId, pollEndedInPast()],
      ] as const
    ) {
      await tx.insert(postTable).values(
        {
          id,
          iri: `http://localhost/objects/${id}`,
          type: "Question",
          visibility: "public",
          actorId: author.actor.id,
          name: "Reject poll?",
          contentHtml: "<p>Reject poll?</p>",
          language: "en",
          tags: {},
          emojis: {},
          url: `http://localhost/@${author.account.username}/polls/${id}`,
          published,
          updated: published,
        } satisfies NewPost,
      );
      await tx.insert(pollTable).values({
        postId: id,
        multiple: false,
        votersCount: 0,
        ends,
      });
      await tx.insert(pollOptionTable).values([
        { postId: id, index: 0, title: "Yes", votesCount: 0 },
        { postId: id, index: 1, title: "No", votesCount: 0 },
      ]);
    }

    const guestResult = await execute({
      schema,
      document: voteOnPollMutation,
      variableValues: {
        questionId: encodeGlobalID("Question", questionId),
        optionIndices: [0],
      },
      contextValue: makeGuestContext(tx),
      onError: "NO_PROPAGATE",
    });

    assert.equal(guestResult.errors, undefined);
    assert.equal(
      (toPlainJson(guestResult.data) as {
        voteOnPoll: { __typename: string };
      }).voteOnPoll.__typename,
      "NotAuthenticatedError",
    );

    for (
      const [optionIndices, expectedPath] of [
        [[], "optionIndices"],
        [[0, 1], "optionIndices"],
        [[999], "optionIndices"],
      ] as const
    ) {
      const result = await execute({
        schema,
        document: voteOnPollMutation,
        variableValues: {
          questionId: encodeGlobalID("Question", questionId),
          optionIndices,
        },
        contextValue: makeUserContext(tx, voter.account),
        onError: "NO_PROPAGATE",
      });

      assert.equal(result.errors, undefined);
      assert.deepEqual(toPlainJson(result.data), {
        voteOnPoll: {
          __typename: "InvalidInputError",
          inputPath: expectedPath,
        },
      });
    }

    const expiredResult = await execute({
      schema,
      document: voteOnPollMutation,
      variableValues: {
        questionId: encodeGlobalID("Question", expiredQuestionId),
        optionIndices: [0],
      },
      contextValue: makeUserContext(tx, voter.account),
      onError: "NO_PROPAGATE",
    });

    assert.equal(expiredResult.errors, undefined);
    assert.deepEqual(toPlainJson(expiredResult.data), {
      voteOnPoll: {
        __typename: "InvalidInputError",
        inputPath: "questionId",
      },
    });
  });
});
