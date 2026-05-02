import { graphql } from "relay-runtime";
import { Show } from "solid-js";
import { createFragment } from "solid-relay";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/components/ui/avatar.tsx";
import { msg, plural, useLingui } from "~/lib/i18n/macro.d.ts";
import type { ActorPreviewCard_actor$key } from "./__generated__/ActorPreviewCard_actor.graphql.ts";
import { FollowButton } from "./FollowButton.tsx";

export interface ActorPreviewCardProps {
  $actor: ActorPreviewCard_actor$key;
}

export function ActorPreviewCard(props: ActorPreviewCardProps) {
  const { t, i18n } = useLingui();
  const actor = createFragment(
    graphql`
      fragment ActorPreviewCard_actor on Actor {
        id
        name
        username
        handle
        avatarUrl
        avatarInitials
        bio
        local
        url
        iri
        followsViewer
        followeesCount: followees {
          totalCount
        }
        followersCount: followers {
          totalCount
        }
        ...FollowButton_actor
      }
    `,
    () => props.$actor,
  );

  return (
    <Show when={actor()}>
      {(a) => {
        const profileHref = () =>
          a().local ? `/@${a().username}` : a().url ?? a().iri;
        const profileTarget = () => (a().local ? undefined : "_blank");
        return (
          <div class="flex flex-col">
            <div class="flex items-start gap-3 p-4">
              <Avatar class="size-12 shrink-0">
                <a href={profileHref()} target={profileTarget()}>
                  <AvatarImage src={a().avatarUrl} class="size-12" />
                  <AvatarFallback class="size-12">
                    {a().avatarInitials}
                  </AvatarFallback>
                </a>
              </Avatar>
              <div class="flex min-w-0 flex-1 flex-col">
                <a
                  href={profileHref()}
                  target={profileTarget()}
                  innerHTML={a().name || a().username}
                  class="truncate font-semibold"
                />
                <span
                  class="truncate text-sm text-muted-foreground select-all"
                  title={a().handle}
                >
                  {a().handle}
                </span>
              </div>
              <div class="shrink-0">
                <FollowButton $actor={a()} />
              </div>
            </div>
            <Show when={(a().bio?.trim() ?? "") !== ""}>
              <div class="px-4 pb-3">
                <div
                  innerHTML={a().bio ?? ""}
                  class="prose prose-sm dark:prose-invert max-w-none break-words line-clamp-4"
                />
              </div>
            </Show>
            <div class="px-4 pb-4 text-sm text-muted-foreground">
              <Show
                when={a().local}
                fallback={
                  <>
                    <span>
                      {i18n._(
                        msg`${
                          plural(a().followeesCount.totalCount, {
                            one: "# following",
                            other: "# following",
                          })
                        }`,
                      )}
                    </span>
                    {" · "}
                    <span>
                      {i18n._(
                        msg`${
                          plural(a().followersCount.totalCount, {
                            one: "# follower",
                            other: "# followers",
                          })
                        }`,
                      )}
                    </span>
                  </>
                }
              >
                <a href={`/@${a().username}/following`}>
                  {i18n._(
                    msg`${
                      plural(a().followeesCount.totalCount, {
                        one: "# following",
                        other: "# following",
                      })
                    }`,
                  )}
                </a>
                {" · "}
                <a href={`/@${a().username}/followers`}>
                  {i18n._(
                    msg`${
                      plural(a().followersCount.totalCount, {
                        one: "# follower",
                        other: "# followers",
                      })
                    }`,
                  )}
                </a>
              </Show>
              <Show when={a().followsViewer}>
                {" · "}
                {t`Following you`}
              </Show>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
