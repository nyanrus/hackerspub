import { createSignal, type JSX, Show } from "solid-js";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "~/components/ui/hover-card.tsx";
import { cn } from "~/lib/utils.ts";
import { ActorHoverCardLoader } from "./ActorHoverCardLoader.tsx";

export interface ActorHoverCardProps {
  /** Canonical fediverse handle (e.g., `@user@host`). */
  handle: string;
  /**
   * Extra classes for the trigger wrapper. Append `shrink-0` when wrapping a
   * fixed-size avatar in a flex container so the wrapper itself does not
   * collapse.
   */
  class?: string;
  children: JSX.Element;
}

export function ActorHoverCard(props: ActorHoverCardProps) {
  const [open, setOpen] = createSignal(false);
  return (
    <HoverCard open={open()} onOpenChange={setOpen}>
      <HoverCardTrigger
        as="span"
        class={cn("inline-flex self-start", props.class)}
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
