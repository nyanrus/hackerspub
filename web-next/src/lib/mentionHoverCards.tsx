import * as PopoverPrimitive from "@kobalte/core/popover";
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { ActorHoverCardLoader } from "~/components/ActorHoverCardLoader.tsx";

const OPEN_DELAY_MS = 400;
const CLOSE_DELAY_MS = 200;

export interface MentionHoverCardState {
  anchor: Accessor<HTMLElement | undefined>;
  handle: Accessor<string | undefined>;
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
  onContentEnter: () => void;
  onContentLeave: () => void;
}

/**
 * Attach hover-card behavior to all `<a class="mention">` elements rendered
 * inside the given container. The container's `innerHTML` may be set from a
 * server-rendered Markdown string.
 *
 * The container ref is read reactively, so callers may pass a signal accessor
 * whose value is `undefined` until the container mounts (e.g., when wrapped
 * in a `<Show>`).
 */
export function useMentionHoverCards(
  getEl: Accessor<HTMLElement | undefined>,
): MentionHoverCardState {
  const [anchor, setAnchor] = createSignal<HTMLElement | undefined>();
  const [handle, setHandle] = createSignal<string | undefined>();
  const [open, setOpen] = createSignal(false);

  let openTimer: number | undefined;
  let closeTimer: number | undefined;

  const cancelOpen = () => {
    if (openTimer !== undefined) {
      clearTimeout(openTimer);
      openTimer = undefined;
    }
  };
  const cancelClose = () => {
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  };

  const findMention = (target: EventTarget | null): HTMLElement | undefined => {
    const t = target as Element | null;
    if (!t?.closest) return undefined;
    const a = t.closest(
      "a.mention:not(.hashtag)",
    ) as HTMLElement | null;
    if (!a) return undefined;
    if (
      !a.hasAttribute("data-username") || !a.hasAttribute("data-host")
    ) {
      return undefined;
    }
    return a;
  };

  const onPointerOver = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const a = findMention(e.target);
    if (!a) return;
    // Pointer movement between child nodes of the same mention reports the
    // same `closest("a.mention")`; skip those so we don't restart the open
    // delay every time the cursor crosses an inner img/span boundary.
    const from = e.relatedTarget as Node | null;
    if (from && a.contains(from)) return;
    cancelClose();
    if (anchor() === a && open()) return;
    cancelOpen();
    openTimer = window.setTimeout(() => {
      const username = a.getAttribute("data-username");
      const host = a.getAttribute("data-host");
      if (!username || !host) return;
      // Update the anchor first so Popper recomputes against the new rect
      // when open flips to true.
      setAnchor(a);
      setHandle(`@${username}@${host}`);
      setOpen(true);
      openTimer = undefined;
    }, OPEN_DELAY_MS);
  };

  const onPointerOut = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const a = findMention(e.target);
    if (!a) return;
    const into = e.relatedTarget as Node | null;
    if (into && a.contains(into)) return;
    cancelOpen();
    cancelClose();
    closeTimer = window.setTimeout(() => {
      setOpen(false);
      closeTimer = undefined;
    }, CLOSE_DELAY_MS);
  };

  // Reactively (re-)attach listeners as the container element appears,
  // changes, or unmounts. createEffect's onCleanup runs before the effect
  // re-evaluates, so the previous element is detached cleanly.
  createEffect(() => {
    const el = getEl();
    if (!el) return;
    el.addEventListener("pointerover", onPointerOver, { passive: true });
    el.addEventListener("pointerout", onPointerOut, { passive: true });
    onCleanup(() => {
      el.removeEventListener("pointerover", onPointerOver);
      el.removeEventListener("pointerout", onPointerOut);
      // If a previous element is being detached while a hover-card cycle
      // is mid-flight, drop any pending timers so they can't reopen
      // against an anchor that is no longer in the live tree.
      cancelOpen();
      cancelClose();
      const a = anchor();
      if (a && el.contains(a)) {
        setOpen(false);
        setAnchor(undefined);
        setHandle(undefined);
      }
    });
  });

  // Component-level cleanup for any pending timers.
  onCleanup(() => {
    cancelOpen();
    cancelClose();
  });

  return {
    anchor,
    handle,
    open,
    setOpen,
    onContentEnter: () => {
      cancelClose();
    },
    onContentLeave: () => {
      cancelOpen();
      cancelClose();
      closeTimer = window.setTimeout(() => {
        setOpen(false);
        closeTimer = undefined;
      }, CLOSE_DELAY_MS);
    },
  };
}

export interface MentionHoverCardLayerProps {
  state: MentionHoverCardState;
}

export function MentionHoverCardLayer(props: MentionHoverCardLayerProps) {
  return (
    <PopoverPrimitive.Root
      open={props.state.open()}
      onOpenChange={props.state.setOpen}
      anchorRef={props.state.anchor}
      modal={false}
      gutter={4}
    >
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          class="z-50 w-80 max-w-[calc(100vw-2rem)] origin-[var(--kb-popover-content-transform-origin)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
          onPointerEnter={props.state.onContentEnter}
          onPointerLeave={props.state.onContentLeave}
        >
          <Show when={props.state.handle()}>
            {(handle) => <ActorHoverCardLoader handle={handle()} />}
          </Show>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
