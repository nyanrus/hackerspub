import { graphql } from "relay-runtime";
import { ErrorBoundary, Show } from "solid-js";
import {
  createPreloadedQuery,
  loadQuery,
  useRelayEnvironment,
} from "solid-relay";
import { useLingui } from "~/lib/i18n/macro.d.ts";
import type { ActorHoverCardLoaderQuery } from "./__generated__/ActorHoverCardLoaderQuery.graphql.ts";
import { ActorPreviewCard } from "./ActorPreviewCard.tsx";
import { ActorPreviewSkeleton } from "./ActorPreviewSkeleton.tsx";

const actorHoverCardLoaderQuery = graphql`
  query ActorHoverCardLoaderQuery($handle: String!) {
    actorByHandle(handle: $handle, allowLocalHandle: true) {
      ...ActorPreviewCard_actor
    }
  }
`;

export interface ActorHoverCardLoaderProps {
  handle: string;
}

export function ActorHoverCardLoader(props: ActorHoverCardLoaderProps) {
  const { t } = useLingui();
  const env = useRelayEnvironment();

  const data = createPreloadedQuery<ActorHoverCardLoaderQuery>(
    actorHoverCardLoaderQuery,
    () => loadQuery(env(), actorHoverCardLoaderQuery, { handle: props.handle }),
  );

  const unavailable = () => (
    <div class="p-4 text-sm text-muted-foreground">
      {t`Could not load profile.`}
    </div>
  );

  return (
    <ErrorBoundary fallback={unavailable}>
      <Show when={data()} fallback={<ActorPreviewSkeleton />}>
        {(loaded) => (
          <Show when={loaded().actorByHandle} fallback={unavailable()}>
            {(actor) => <ActorPreviewCard $actor={actor()} />}
          </Show>
        )}
      </Show>
    </ErrorBoundary>
  );
}
