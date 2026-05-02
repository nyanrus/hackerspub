import assert from "node:assert/strict";
import test from "node:test";
import { execute, parse } from "graphql";
import { schema } from "./mod.ts";
import {
  createFedCtx,
  type FedCtxLookupObject,
  insertAccountWithActor,
  insertNotePost,
  makeGuestContext,
  toPlainJson,
  withRollback,
} from "../test/postgres.ts";

const searchObjectQuery = parse(`
  query SearchObject($query: String!) {
    searchObject(query: $query) {
      __typename
      ... on SearchedObject {
        url
      }
      ... on EmptySearchQueryError {
        message
      }
    }
  }
`);

test("searchObject returns an error union for empty queries", async () => {
  await withRollback(async (tx) => {
    const result = await execute({
      schema,
      document: searchObjectQuery,
      variableValues: { query: "   " },
      contextValue: makeGuestContext(tx),
      onError: "NO_PROPAGATE",
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlainJson(result.data), {
      searchObject: {
        __typename: "EmptySearchQueryError",
        message: "Query cannot be empty",
      },
    });
  });
});

test("searchObject resolves local handles without federation lookup", async () => {
  await withRollback(async (tx) => {
    await insertAccountWithActor(tx, {
      username: "searchhandle",
      name: "Search Handle",
      email: "searchhandle@example.com",
    });

    const result = await execute({
      schema,
      document: searchObjectQuery,
      variableValues: { query: "@searchhandle" },
      contextValue: makeGuestContext(tx),
      onError: "NO_PROPAGATE",
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlainJson(result.data), {
      searchObject: {
        __typename: "SearchedObject",
        url: "/@searchhandle",
      },
    });
  });
});

test("searchObject resolves local note URLs to canonical note routes", async () => {
  await withRollback(async (tx) => {
    const account = await insertAccountWithActor(tx, {
      username: "searchnote",
      name: "Search Note",
      email: "searchnote@example.com",
    });
    const { noteSourceId } = await insertNotePost(tx, {
      account: account.account,
      content: "Searchable note",
    });

    const result = await execute({
      schema,
      document: searchObjectQuery,
      variableValues: {
        query: `http://localhost/@${account.account.username}/${noteSourceId}`,
      },
      contextValue: makeGuestContext(tx),
      onError: "NO_PROPAGATE",
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlainJson(result.data), {
      searchObject: {
        __typename: "SearchedObject",
        url: `/@${account.account.username}/${noteSourceId}`,
      },
    });
  });
});

test("searchObject returns null for an unknown URL without federation lookup", async () => {
  await withRollback(async (tx) => {
    const lookupCalls: string[] = [];
    const recordingLookup: FedCtxLookupObject = (uri) => {
      lookupCalls.push(uri.toString());
      return Promise.resolve(null);
    };
    const fedCtx = createFedCtx(tx, { lookupObject: recordingLookup });

    const result = await execute({
      schema,
      document: searchObjectQuery,
      variableValues: { query: "https://unknown.example/posts/missing" },
      contextValue: makeGuestContext(tx, { fedCtx }),
      onError: "NO_PROPAGATE",
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlainJson(result.data), {
      searchObject: null,
    });
    assert.deepEqual(lookupCalls, []);
  });
});

test("searchObject returns null for an unknown remote handle without federation lookup", async () => {
  await withRollback(async (tx) => {
    const lookupCalls: string[] = [];
    const recordingLookup: FedCtxLookupObject = (uri) => {
      lookupCalls.push(uri.toString());
      return Promise.resolve(null);
    };
    const fedCtx = createFedCtx(tx, { lookupObject: recordingLookup });

    const result = await execute({
      schema,
      document: searchObjectQuery,
      variableValues: { query: "@nobody@unknown.example" },
      contextValue: makeGuestContext(tx, { fedCtx }),
      onError: "NO_PROPAGATE",
    });

    assert.equal(result.errors, undefined);
    assert.deepEqual(toPlainJson(result.data), {
      searchObject: null,
    });
    assert.deepEqual(lookupCalls, []);
  });
});
