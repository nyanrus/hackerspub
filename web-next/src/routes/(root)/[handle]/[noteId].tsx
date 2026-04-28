import { type Uuid, validateUuid } from "@hackerspub/models/uuid";
import { Meta } from "@solidjs/meta";
import {
  query,
  type RouteDefinition,
  useNavigate,
  useParams,
} from "@solidjs/router";
import { HttpHeader, HttpStatusCode } from "@solidjs/start";
import { graphql } from "relay-runtime";
import { For, Match, Show, Switch } from "solid-js";
import {
  createFragment,
  createPreloadedQuery,
  loadQuery,
  useRelayEnvironment,
} from "solid-relay";
import { NarrowContainer } from "~/components/NarrowContainer.tsx";
import { NoteCard } from "~/components/NoteCard.tsx";
import { QuestionCard } from "~/components/QuestionCard.tsx";
import { Title } from "~/components/Title.tsx";
import { Trans } from "~/components/Trans.tsx";
import { useLingui } from "~/lib/i18n/macro.d.ts";
import type { NoteIdPageQuery } from "./__generated__/NoteIdPageQuery.graphql.ts";
import type { NoteId_head$key } from "./__generated__/NoteId_head.graphql.ts";
import type { NoteId_noteBody$key } from "./__generated__/NoteId_noteBody.graphql.ts";
import type { NoteId_questionBody$key } from "./__generated__/NoteId_questionBody.graphql.ts";
import type {
  NoteIdQuestionPageQuery,
  NoteIdQuestionPageQuery$data,
} from "./__generated__/NoteIdQuestionPageQuery.graphql.ts";

type NoteIdPageQuestion = Extract<
  NonNullable<
    NonNullable<NoteIdQuestionPageQuery$data["actorByHandle"]>["postByUuid"]
  >,
  { readonly __typename: "Question" }
>;

export const route = {
  matchFilters: {
    handle: /^@/,
  },
  preload(args) {
    const username = decodeURIComponent(args.params.handle!);
    const noteId = args.params.noteId!;
    if (!validateUuid(noteId)) {
      throw new Error("Invalid Request"); // FIXME
    }

    void loadNotePageQuery(username.replace(/^@/, ""), noteId);
    void loadQuestionPageQuery(username.replace(/^@/, ""), noteId);
  },
} satisfies RouteDefinition;

const NoteIdPageQuery = graphql`
  query NoteIdPageQuery($handle: String!, $noteId: UUID!) {
    actorByHandle(handle: $handle, allowLocalHandle: true) {
      noteByUuid(uuid: $noteId) {
        ...NoteId_head
        ...NoteId_noteBody
      }
    }
    viewer {
      id
    }
  }
`;

const NoteIdQuestionPageQuery = graphql`
  query NoteIdQuestionPageQuery($handle: String!, $noteId: UUID!) {
    actorByHandle(handle: $handle, allowLocalHandle: true) {
      postByUuid(uuid: $noteId) {
        __typename
        ... on Question {
          ...NoteId_head
          ...NoteId_questionBody
        }
      }
    }
    viewer {
      id
    }
  }
`;

const loadNotePageQuery = query(
  (username: string, noteId: Uuid) =>
    loadQuery<NoteIdPageQuery>(
      useRelayEnvironment()(),
      NoteIdPageQuery,
      { handle: username, noteId },
    ),
  "loadNotePageQuery",
);

const loadQuestionPageQuery = query(
  (username: string, noteId: Uuid) =>
    loadQuery<NoteIdQuestionPageQuery>(
      useRelayEnvironment()(),
      NoteIdQuestionPageQuery,
      { handle: username, noteId },
    ),
  "loadQuestionPageQuery",
);

export default function NotePage() {
  const params = useParams();
  const noteId = params.noteId!;
  const username = decodeURIComponent(params.handle!).replace(/^@/, "");

  if (!validateUuid(noteId)) {
    return <HttpStatusCode code={404} />;
  }

  const noteData = createPreloadedQuery<NoteIdPageQuery>(
    NoteIdPageQuery,
    () => loadNotePageQuery(username, noteId),
  );
  const questionData = createPreloadedQuery<NoteIdQuestionPageQuery>(
    NoteIdQuestionPageQuery,
    () => loadQuestionPageQuery(username, noteId),
  );

  const note = () => noteData()?.actorByHandle?.noteByUuid;
  const question = (): NoteIdPageQuestion | null => {
    const post = questionData()?.actorByHandle?.postByUuid;
    return post?.__typename === "Question" ? post as NoteIdPageQuestion : null;
  };
  const viewer = () =>
    noteData()?.viewer ?? questionData()?.viewer ?? undefined;

  return (
    <Show when={noteData() != null && questionData() != null}>
      <Switch fallback={<HttpStatusCode code={404} />}>
        <Match when={note()}>
          {(note) => (
            <>
              <PostMetaHead $post={note()} />
              <NoteInternal $note={note()} $viewer={viewer()} />
            </>
          )}
        </Match>
        <Match when={question()}>
          {(question) => (
            <>
              <PostMetaHead $post={question()} />
              <QuestionInternal $question={question()} $viewer={viewer()} />
            </>
          )}
        </Match>
      </Switch>
    </Show>
  );
}

interface PostMetaHeadProps {
  $post: NoteId_head$key;
}

function PostMetaHead(props: PostMetaHeadProps) {
  const { t } = useLingui();
  const post = createFragment(
    graphql`
      fragment NoteId_head on Post {
        content
        excerpt
        published
        updated
        actor {
          handle
          name
          username
        }
        language
        iri
        hashtags {
          name
        }
      }
    `,
    () => props.$post,
  );

  return (
    <Show when={post()}>
      {(post) => (
        <>
          <Title>{t`${post().actor.name}: ${post().excerpt}`}</Title>
          <Meta property="og:title" content={post().excerpt} />
          <Meta property="og:description" content={post().excerpt} />
          <Meta property="og:type" content="article" />
          <Meta
            property="article:published_time"
            content={post().published}
          />
          <Meta
            property="article:modified_time"
            content={post().updated}
          />
          <Show when={post().actor.name}>
            {(name) => (
              <Meta
                property="article:author"
                content={name()}
              />
            )}
          </Show>
          <Meta
            property="article:author.username"
            content={post().actor.username}
          />
          <Meta
            name="fediverse:creator"
            content={post().actor.handle.replace(/^@/, "")}
          />
          <For each={post().hashtags}>
            {(hashtag) => (
              <Meta
                property="article:tag"
                content={hashtag.name}
              />
            )}
          </For>
          <Show when={post().language}>
            {(language) => (
              <Meta
                property="og:locale"
                content={language()}
              />
            )}
          </Show>

          <HttpHeader
            name="Link"
            value={`<${post().iri}>; rel="alternate"; type="application/activity+json"`}
          />
        </>
      )}
    </Show>
  );
}

interface NoteInternalProps {
  $note: NoteId_noteBody$key;
  $viewer?: { readonly id: string } | null;
}

function NoteInternal(props: NoteInternalProps) {
  const { t } = useLingui();
  const navigate = useNavigate();

  const note = createFragment(
    graphql`
      fragment NoteId_noteBody on Note {
        iri
        url
        ...NoteCard_note
        replyTarget {
          ... on Note {
            ...NoteCard_note
          }
        }
        replies {
          edges {
            node {
              ... on Note {
                ...NoteCard_note
              }
            }
          }
        }
      }
    `,
    () => props.$note,
  );
  return (
    <Show when={note()}>
      {(note) => (
        <NarrowContainer>
          <div class="my-4">
            <Show when={note().replyTarget}>
              {(parent) => (
                <div class="border-x border-t rounded-t-xl">
                  <NoteCard $note={parent()} />
                </div>
              )}
            </Show>
            <div class="border rounded-xl *:first:rounded-t-xl *:last:rounded-b-xl text-xl">
              <NoteCard $note={note()} onDeleted={() => navigate(-1)} />
              <Show when={props.$viewer == null}>
                <p class="p-4 text-sm text-muted-foreground">
                  <Trans
                    message={t`If you have a fediverse account, you can reply to this note from your own instance. Search ${"ACTIVITYPUB_URI"} on your instance and reply to it.`}
                    values={{
                      ACTIVITYPUB_URI: () => (
                        <span class="select-all text-accent-foreground border-b border-b-muted-foreground border-dashed">
                          {note().iri}
                        </span>
                      ),
                    }}
                  />
                </p>
              </Show>
            </div>
            <Show when={note().replies?.edges.length}>
              <div class="border-x border-b rounded-b-xl">
                <For each={note().replies?.edges}>
                  {(edge) => (
                    <Show when={edge.node}>
                      {(reply) => <NoteCard $note={reply()} />}
                    </Show>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </NarrowContainer>
      )}
    </Show>
  );
}

interface QuestionInternalProps {
  $question: NoteId_questionBody$key;
  $viewer?: { readonly id: string } | null;
}

function QuestionInternal(props: QuestionInternalProps) {
  const { t } = useLingui();
  const navigate = useNavigate();

  const question = createFragment(
    graphql`
      fragment NoteId_questionBody on Question {
        iri
        url
        ...QuestionCard_question
      }
    `,
    () => props.$question,
  );
  return (
    <Show when={question()}>
      {(question) => (
        <NarrowContainer>
          <div class="my-4">
            <div class="border rounded-xl *:first:rounded-t-xl *:last:rounded-b-xl text-xl">
              <QuestionCard
                $question={question()}
                onDeleted={() => navigate(-1)}
              />
              <Show when={props.$viewer == null}>
                <p class="p-4 text-sm text-muted-foreground">
                  <Trans
                    message={t`If you have a fediverse account, you can reply to this post from your own instance. Search ${"ACTIVITYPUB_URI"} on your instance and reply to it.`}
                    values={{
                      ACTIVITYPUB_URI: () => (
                        <span class="select-all text-accent-foreground border-b border-b-muted-foreground border-dashed">
                          {question().iri}
                        </span>
                      ),
                    }}
                  />
                </p>
              </Show>
            </div>
          </div>
        </NarrowContainer>
      )}
    </Show>
  );
}
