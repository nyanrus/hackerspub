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
import { For, Show } from "solid-js";
import {
  createFragment,
  createPreloadedQuery,
  loadQuery,
  useRelayEnvironment,
} from "solid-relay";
import { NarrowContainer } from "~/components/NarrowContainer.tsx";
import { PostCard } from "~/components/PostCard.tsx";
import { Title } from "~/components/Title.tsx";
import { Trans } from "~/components/Trans.tsx";
import { useLingui } from "~/lib/i18n/macro.d.ts";
import type { NoteIdPageQuery } from "./__generated__/NoteIdPageQuery.graphql.ts";
import type { NoteId_body$key } from "./__generated__/NoteId_body.graphql.ts";
import type { NoteId_head$key } from "./__generated__/NoteId_head.graphql.ts";
import type { NoteId_viewer$key } from "./__generated__/NoteId_viewer.graphql.ts";

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

    void loadPageQuery(username.replace(/^@/, ""), noteId);
  },
} satisfies RouteDefinition;

const NoteIdPageQuery = graphql`
  query NoteIdPageQuery($handle: String!, $noteId: UUID!) {
    actorByHandle(handle: $handle, allowLocalHandle: true) {
      postByUuid(uuid: $noteId) {
        ...NoteId_head
        ...NoteId_body
      }
    }
    viewer {
      ...NoteId_viewer
    }
  }
`;

const loadPageQuery = query(
  (username: string, noteId: Uuid) =>
    loadQuery<NoteIdPageQuery>(
      useRelayEnvironment()(),
      NoteIdPageQuery,
      { handle: username, noteId },
    ),
  "loadPostPageQuery",
);

export default function NotePage() {
  const params = useParams();
  const noteId = params.noteId!;
  const username = decodeURIComponent(params.handle!).replace(/^@/, "");

  if (!validateUuid(noteId)) {
    return <HttpStatusCode code={404} />;
  }

  const data = createPreloadedQuery<NoteIdPageQuery>(
    NoteIdPageQuery,
    () => loadPageQuery(username, noteId),
  );

  return (
    <Show when={data()}>
      {(data) => (
        <>
          <Show
            when={data().actorByHandle}
            fallback={<HttpStatusCode code={404} />}
          >
            {(actor) => (
              <Show
                when={actor().postByUuid}
                fallback={<HttpStatusCode code={404} />}
              >
                {(post) => (
                  <>
                    <PostMetaHead $post={post()} />
                    <PostInternal
                      $post={post()}
                      $viewer={data().viewer ?? undefined}
                    />
                  </>
                )}
              </Show>
            )}
          </Show>
        </>
      )}
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

interface PostInternalProps {
  $post: NoteId_body$key;
  $viewer?: NoteId_viewer$key;
}

function PostInternal(props: PostInternalProps) {
  const { t } = useLingui();
  const navigate = useNavigate();

  const post = createFragment(
    graphql`
      fragment NoteId_body on Post {
        iri
        url
        ...PostCard_post
      }
    `,
    () => props.$post,
  );
  const viewer = createFragment(
    graphql`
      fragment NoteId_viewer on Account {
        id
      }
    `,
    () => props.$viewer,
  );

  return (
    <Show when={post()}>
      {(post) => (
        <NarrowContainer>
          <div class="my-4">
            <div class="border rounded-xl *:first:rounded-t-xl *:last:rounded-b-xl text-xl">
              <PostCard $post={post()} onDeleted={() => navigate(-1)} />
              <Show when={viewer() == null}>
                <p class="p-4 text-sm text-muted-foreground">
                  <Trans
                    message={t`If you have a fediverse account, you can reply to this post from your own instance. Search ${"ACTIVITYPUB_URI"} on your instance and reply to it.`}
                    values={{
                      ACTIVITYPUB_URI: () => (
                        <span class="select-all text-accent-foreground border-b border-b-muted-foreground border-dashed">
                          {post().iri}
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
