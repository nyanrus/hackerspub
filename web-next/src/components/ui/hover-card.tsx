import type { ValidComponent } from "solid-js";
import { type Component, splitProps } from "solid-js";

import * as HoverCardPrimitive from "@kobalte/core/hover-card";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";

import { cn } from "~/lib/utils.ts";

const HoverCardTrigger = HoverCardPrimitive.Trigger;

const HoverCard: Component<HoverCardPrimitive.HoverCardRootProps> = (props) => {
  return (
    <HoverCardPrimitive.Root
      gutter={4}
      openDelay={400}
      closeDelay={200}
      {...props}
    />
  );
};

type HoverCardContentProps<T extends ValidComponent = "div"> =
  & HoverCardPrimitive.HoverCardContentProps<T>
  & { class?: string | undefined };

const HoverCardContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, HoverCardContentProps<T>>,
) => {
  const [local, others] = splitProps(props as HoverCardContentProps, ["class"]);
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        class={cn(
          "z-50 w-80 max-w-[calc(100vw-2rem)] origin-[var(--kb-hovercard-content-transform-origin)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95",
          local.class,
        )}
        {...others}
      />
    </HoverCardPrimitive.Portal>
  );
};

export { HoverCard, HoverCardContent, HoverCardTrigger };
