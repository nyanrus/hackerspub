import { graphql } from "relay-runtime";
import { Show } from "solid-js";
import { createFragment } from "solid-relay";
import type { NotificationActor_notification$key } from "./__generated__/NotificationActor_notification.graphql.ts";

interface NotificationActorProps {
  $notification: NotificationActor_notification$key;
}

export function NotificationActor(props: NotificationActorProps) {
  const notification = createFragment(
    graphql`
      fragment NotificationActor_notification on Notification {
        actors {
          edges {
            node {
              handle
              name
            }
          }
        }
      }
    `,
    () => props.$notification,
  );

  type Notification = Exclude<
    ReturnType<typeof notification>,
    undefined
  >;

  const firstActor = (
    notification: Notification,
  ) => {
    return notification.actors.edges[0]?.node;
  };

  return (
    <Show when={notification()}>
      {(notification) => (
        <Show when={firstActor(notification())}>
          {(firstActor) => (
            <a href={`/${firstActor().handle}`} class="min-w-0">
              <Show
                when={firstActor().name}
                fallback={
                  <span class="font-semibold text-muted-foreground">
                    {firstActor().handle}
                  </span>
                }
              >
                {(name) => (
                  <span class="inline min-w-0">
                    <span innerHTML={name()} class="font-semibold" />{" "}
                    <span
                      class="break-all text-muted-foreground"
                      title={firstActor().handle}
                    >
                      ({firstActor().handle})
                    </span>
                  </span>
                )}
              </Show>
            </a>
          )}
        </Show>
      )}
    </Show>
  );
}
