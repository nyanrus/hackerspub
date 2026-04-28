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
import type { ProfilePageQuery } from "./__generated__/ProfilePageQuery.graphql.ts";

export const route = {
  matchFilters: {
    handle: /^@/,
  },
  preload(args) {
    const { i18n } = useLingui();
    void loadPageQuery(args.params.handle!, i18n.locale);
  },
} satisfies RouteDefinition;

const ProfilePageQuery = graphql`
  query ProfilePageQuery($handle: String!, $locale: Locale) {
    actorByHandle(handle: $handle, allowLocalHandle: true) {
      rawName
      username
      url
      iri
      ...NavigateIfHandleIsNotCanonical_actor
      ...ActorPostList_posts @arguments(locale: $locale)
      ...ProfileCard_actor
      ...ProfileTabs_actor
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

const loadPageQuery = query(
  (handle: string, locale: string) =>
    loadQuery<ProfilePageQuery>(
      useRelayEnvironment()(),
      ProfilePageQuery,
      { handle, locale },
    ),
  "loadProfilePageQuery",
);

export default function ProfilePage() {
  const { i18n, t } = useLingui();
  const params = useParams();
  const data = createPreloadedQuery<ProfilePageQuery>(
    ProfilePageQuery,
    () => loadPageQuery(params.handle!, i18n.locale),
  );
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
                <div class="p-4">
                  <ProfileTabs selected="posts" $actor={actor()} />
                  <Show when={actor().pins.edges.length > 0}>
                    <section class="my-4">
                      <h2 class="mb-2 flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
                        <IconPin class="size-4" />
                        {t`Pinned posts`}
                      </h2>
                      <div class="border rounded-xl *:first:rounded-t-xl *:last:rounded-b-xl">
                        <For each={actor().pins.edges}>
                          {(edge) => (
                            <PostCard
                              $post={edge.node}
                              pinConnections={[actor().pins.__id]}
                            />
                          )}
                        </For>
                      </div>
                    </section>
                  </Show>
                  <ActorPostList
                    $posts={actor()}
                    pinConnections={[actor().pins.__id]}
                  />
                </div>
              </NarrowContainer>
            )}
          </Show>
        </>
      )}
    </Show>
  );
}
