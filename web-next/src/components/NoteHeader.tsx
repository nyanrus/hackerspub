import { graphql } from "relay-runtime";
import { Show } from "solid-js";
import { createFragment } from "solid-relay";
import { NoteHeader_note$key } from "./__generated__/NoteHeader_note.graphql.ts";
import { InternalLink } from "./InternalLink.tsx";
import { PostActionMenu } from "./PostActionMenu.tsx";
import { Timestamp } from "./Timestamp.tsx";
import { VisibilityTag } from "./VisibilityTag.tsx";

export interface NoteHeaderProps {
  $note: NoteHeader_note$key;
  connections?: string[];
  pinConnections?: string[];
  onDeleted?: () => void;
}

export function NoteHeader(props: NoteHeaderProps) {
  const note = createFragment(
    graphql`
      fragment NoteHeader_note on Note {
        uuid
        visibility
        published
        url
        iri
        actor {
          name
          handle
          username
          local
          url
          iri
        }
        ...PostActionMenu_post
      }
    `,
    () => props.$note,
  );

  return (
    <Show when={note()}>
      {(n) => (
        <div class="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
          <Show when={(n().actor.name ?? "").trim() !== ""}>
            <InternalLink
              href={n().actor.url ?? n().actor.iri}
              internalHref={n().actor.local
                ? `/@${n().actor.username}`
                : `/${n().actor.handle}`}
              innerHTML={n().actor.name ?? ""}
              class="font-semibold"
            />
            {" "}
          </Show>
          <span class="min-w-0 grow break-all select-all text-muted-foreground">
            {n().actor.handle}
          </span>
          <span class="flex items-center gap-1.5 text-sm text-muted-foreground/70">
            <InternalLink
              href={n().url ?? n().iri}
              internalHref={`/${
                n().actor.local ? "@" + n().actor.username : n().actor.handle
              }/${n().uuid}`}
            >
              <Timestamp value={n().published} capitalizeFirstLetter />
            </InternalLink>
            &middot;
            <VisibilityTag visibility={n().visibility} />
            <PostActionMenu
              $post={n()}
              connections={props.connections}
              pinConnections={props.pinConnections}
              onDeleted={props.onDeleted}
            />
          </span>
        </div>
      )}
    </Show>
  );
}
