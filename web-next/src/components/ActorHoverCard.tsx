import { createSignal, type JSX, Show } from "solid-js";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "~/components/ui/hover-card.tsx";
import { ActorHoverCardLoader } from "./ActorHoverCardLoader.tsx";

export interface ActorHoverCardProps {
  /** Canonical fediverse handle (e.g., `@user@host`). */
  handle: string;
  children: JSX.Element;
}

export function ActorHoverCard(props: ActorHoverCardProps) {
  const [open, setOpen] = createSignal(false);
  return (
    <HoverCard open={open()} onOpenChange={setOpen}>
      <HoverCardTrigger
        as="span"
        class="inline-flex"
        role="presentation"
        tabIndex={-1}
      >
        {props.children}
      </HoverCardTrigger>
      <HoverCardContent>
        <Show when={open()}>
          <ActorHoverCardLoader handle={props.handle} />
        </Show>
      </HoverCardContent>
    </HoverCard>
  );
}
