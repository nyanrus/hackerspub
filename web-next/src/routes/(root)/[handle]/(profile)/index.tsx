import { Link, Meta } from "@solidjs/meta";
import { query, type RouteDefinition, useParams } from "@solidjs/router";
import { graphql } from "relay-runtime";
import { For, Show } from "solid-js";
import {
  createPreloadedQuery,
  loadQuery,
  useRelayEnvironment,
} from "solid-relay";
import { ActorPostList } from "~/components/ActorPostList.tsx";
import { NarrowContainer } from "~/components/NarrowContainer.tsx";
import { NavigateIfHandleIsNotCanonical } from "~/components/NavigateIfHandleIsNotCanonical.tsx";
import { PostCard } from "~/components/PostCard.tsx";
import { ProfileCard } from "~/components/ProfileCard.tsx";
import { ProfileTabs } from "~/components/ProfileTabs.tsx";
import { Title } from "~/components/Title.tsx";
import { useLingui } from "~/lib/i18n/macro.d.ts";
import IconPin from "~icons/lucide/pin";
import type { ProfilePagePinsQuery } from "./__generated__/ProfilePagePinsQuery.graphql.ts";
import type { ProfilePagePostsQuery } from "./__generated__/ProfilePagePostsQuery.graphql.ts";
import type { ProfilePageQuery } from "./__generated__/ProfilePageQuery.graphql.ts";

export const route = {
  matchFilters: {
    handle: /^@/,
  },
  preload(args) {
    const { i18n } = useLingui();
    const handle = args.params.handle!;
    void loadPageQuery(handle);
    void loadPagePinsQuery(handle, i18n.locale);
    void loadPagePostsQuery(handle, i18n.locale);
  },
} satisfies RouteDefinition;

const ProfilePageQuery = graphql`
  query ProfilePageQuery($handle: String!) {
    actorByHandle(handle: $handle, allowLocalHandle: true) {
      isViewer
      rawName
      username
      url
      iri
      viewerBlocks
      ...NavigateIfHandleIsNotCanonical_actor
      ...ProfileCard_actor
      ...ProfileTabs_actor
    }
  }
`;

const ProfilePagePinsQuery = graphql`
  query ProfilePagePinsQuery($handle: String!, $locale: Locale) {
    actorByHandle(handle: $handle, allowLocalHandle: true) {
      pins(first: 20) @connection(key: "ProfilePage_pins") {
        __id
        edges {
          node {
            ...PostCard_post @arguments(locale: $locale)
          }
        }
      }
    }
  }
`;

const ProfilePagePostsQuery = graphql`
  query ProfilePagePostsQuery($handle: String!, $locale: Locale) {
    actorByHandle(handle: $handle, allowLocalHandle: true) {
      posts(first: 20) @connection(key: "ActorPostList_posts") {
        __id
        edges {
          __id
        }
      }
      ...ActorPostList_posts @arguments(locale: $locale)
    }
  }
`;

const loadPageQuery = query(
  (handle: string) =>
    loadQuery<ProfilePageQuery>(
      useRelayEnvironment()(),
      ProfilePageQuery,
      { handle },
    ),
  "loadProfilePageQuery",
);

const loadPagePinsQuery = query(
  (handle: string, locale: string) =>
    loadQuery<ProfilePagePinsQuery>(
      useRelayEnvironment()(),
      ProfilePagePinsQuery,
      { handle, locale },
    ),
  "loadProfilePagePinsQuery",
);

const loadPagePostsQuery = query(
  (handle: string, locale: string) =>
    loadQuery<ProfilePagePostsQuery>(
      useRelayEnvironment()(),
      ProfilePagePostsQuery,
      { handle, locale },
    ),
  "loadProfilePagePostsQuery",
);

export default function ProfilePage() {
  const { i18n, t } = useLingui();
  const params = useParams();
  const data = createPreloadedQuery<ProfilePageQuery>(
    ProfilePageQuery,
    () => loadPageQuery(params.handle!),
  );
  const pinnedPostsData = createPreloadedQuery<ProfilePagePinsQuery>(
    ProfilePagePinsQuery,
    () => loadPagePinsQuery(params.handle!, i18n.locale),
  );
  const postsData = createPreloadedQuery<ProfilePagePostsQuery>(
    ProfilePagePostsQuery,
    () => loadPagePostsQuery(params.handle!, i18n.locale),
  );
  const pinConnectionId = () => pinnedPostsData()?.actorByHandle?.pins.__id;
  const pinConnections = () => {
    const connectionId = pinConnectionId();
    return connectionId == null ? [] : [connectionId];
  };
  const viewerPinConnections = () =>
    data()?.actorByHandle?.isViewer ? pinConnections() : [];
  const postConnectionId = () => postsData()?.actorByHandle?.posts.__id;
  const postConnections = () => {
    const connectionId = postConnectionId();
    return connectionId == null ? [] : [connectionId];
  };
  const viewerPostConnections = () =>
    data()?.actorByHandle?.isViewer ? postConnections() : [];
  const postsActor = () => {
    const actor = postsData()?.actorByHandle;
    return actor ?? undefined;
  };

  return (
    <Show when={data()}>
      {(data) => (
        <>
          <Show
            when={data().actorByHandle}
          >
            {(actor) => (
              <NarrowContainer>
                <Link rel="canonical" href={actor().url ?? actor().iri} />
                <Link
                  rel="alternate"
                  type="application/activity+json"
                  href={actor().iri}
                />
                <Title>{actor().rawName ?? actor().username}</Title>
                <Meta property="og:type" content="profile" />
                <Meta property="og:url" content={actor().url ?? actor().iri} />
                <Meta
                  property="og:title"
                  content={actor().rawName ?? actor().username}
                />
                <Meta property="profile:username" content={actor().username} />
                <NavigateIfHandleIsNotCanonical $actor={actor()} />
                <div>
                  <ProfileCard $actor={actor()} />
                </div>
                <Show when={!actor().viewerBlocks}>
                  <div class="p-4">
                    <ProfileTabs selected="posts" $actor={actor()} />
                    <Show when={pinnedPostsData()?.actorByHandle?.pins}>
                      {(pins) => (
                        <Show when={pins().edges.length > 0}>
                          <section class="my-4">
                            <h2 class="mb-2 flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
                              <IconPin class="size-4" />
                              {t`Pinned posts`}
                            </h2>
                            <div class="overflow-hidden rounded-lg border bg-card shadow-sm">
                              <For each={pins().edges}>
                                {(edge) => (
                                  <PostCard
                                    $post={edge.node}
                                    connections={viewerPostConnections()}
                                    pinConnections={viewerPinConnections()}
                                  />
                                )}
                              </For>
                            </div>
                          </section>
                        </Show>
                      )}
                    </Show>
                    <Show when={postsActor()}>
                      {(postsActor) => (
                        <ActorPostList
                          $posts={postsActor()}
                          pinConnections={viewerPinConnections()}
                        />
                      )}
                    </Show>
                  </div>
                </Show>
              </NarrowContainer>
            )}
          </Show>
        </>
      )}
    </Show>
  );
}
