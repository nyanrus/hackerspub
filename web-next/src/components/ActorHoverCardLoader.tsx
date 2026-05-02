import { graphql } from "relay-runtime";
import { ErrorBoundary, type JSX, Show } from "solid-js";
import {
  createPreloadedQuery,
  loadQuery,
  useRelayEnvironment,
} from "solid-relay";
import { useLingui } from "~/lib/i18n/macro.d.ts";
import type { ActorHoverCardLoaderByHandleQuery } from "./__generated__/ActorHoverCardLoaderByHandleQuery.graphql.ts";
import type { ActorHoverCardLoaderByUrlQuery } from "./__generated__/ActorHoverCardLoaderByUrlQuery.graphql.ts";
import { ActorPreviewCard } from "./ActorPreviewCard.tsx";
import { ActorPreviewSkeleton } from "./ActorPreviewSkeleton.tsx";

const actorHoverCardLoaderByHandleQuery = graphql`
  query ActorHoverCardLoaderByHandleQuery($handle: String!) {
    actorByHandle(handle: $handle, allowLocalHandle: true) {
      ...ActorPreviewCard_actor
    }
  }
`;

const actorHoverCardLoaderByUrlQuery = graphql`
  query ActorHoverCardLoaderByUrlQuery($url: URL!) {
    actorByUrl(url: $url) {
      ...ActorPreviewCard_actor
    }
  }
`;

function Unavailable() {
  const { t } = useLingui();
  return (
    <div class="p-4 text-sm text-muted-foreground">
      {t`Could not load profile.`}
    </div>
  );
}

function withFallbacks(loaded: () => JSX.Element) {
  return (
    <ErrorBoundary fallback={() => <Unavailable />}>
      {loaded()}
    </ErrorBoundary>
  );
}

export interface ActorHoverCardLoaderProps {
  handle: string;
}

export function ActorHoverCardLoader(props: ActorHoverCardLoaderProps) {
  const env = useRelayEnvironment();
  const data = createPreloadedQuery<ActorHoverCardLoaderByHandleQuery>(
    actorHoverCardLoaderByHandleQuery,
    () =>
      loadQuery(env(), actorHoverCardLoaderByHandleQuery, {
        handle: props.handle,
      }),
  );

  return withFallbacks(() => (
    <Show when={data()} fallback={<ActorPreviewSkeleton />}>
      {(loaded) => (
        <Show when={loaded().actorByHandle} fallback={<Unavailable />}>
          {(actor) => <ActorPreviewCard $actor={actor()} />}
        </Show>
      )}
    </Show>
  ));
}

export interface ActorHoverCardLoaderByUrlProps {
  url: string;
}

export function ActorHoverCardLoaderByUrl(
  props: ActorHoverCardLoaderByUrlProps,
) {
  const env = useRelayEnvironment();
  const data = createPreloadedQuery<ActorHoverCardLoaderByUrlQuery>(
    actorHoverCardLoaderByUrlQuery,
    () => loadQuery(env(), actorHoverCardLoaderByUrlQuery, { url: props.url }),
  );

  return withFallbacks(() => (
    <Show when={data()} fallback={<ActorPreviewSkeleton />}>
      {(loaded) => (
        <Show when={loaded().actorByUrl} fallback={<Unavailable />}>
          {(actor) => <ActorPreviewCard $actor={actor()} />}
        </Show>
      )}
    </Show>
  ));
}
