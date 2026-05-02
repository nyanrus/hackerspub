import * as PopoverPrimitive from "@kobalte/core/popover";
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { ActorHoverCardLoader } from "~/components/ActorHoverCardLoader.tsx";
import { ACTOR_HOVER_SURFACE_CLASS } from "~/components/ui/hover-card.tsx";
import { cn } from "~/lib/utils.ts";

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

  /**
   * Resolve a hovered mention element to a fediverse handle.
   *
   * Two source markups are supported:
   *
   * 1. The local Markdown renderer (see `models/markup.ts`) emits
   *    `<a class="u-url mention" data-username data-host …>`, so handle
   *    parts come straight from those data attributes.
   * 2. Federated content (e.g., notes received over ActivityPub) typically
   *    uses Mastodon-style h-card markup
   *    `<span class="h-card"><a class="u-url mention" href="…">@user</a></span>`
   *    without data attributes. In that case we derive the host from the
   *    href URL and the username from the link text.
   */
  const resolveMention = (
    target: EventTarget | null,
  ): { el: HTMLElement; handle: string } | undefined => {
    const t = target as Element | null;
    if (!t?.closest) return undefined;
    const a = t.closest(
      "a.mention:not(.hashtag)",
    ) as HTMLElement | null;
    if (!a) return undefined;

    const dsUsername = a.getAttribute("data-username");
    const dsHost = a.getAttribute("data-host");
    if (dsUsername && dsHost) {
      return { el: a, handle: `@${dsUsername}@${dsHost}` };
    }

    const href = a.getAttribute("href");
    if (!href) return undefined;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return undefined;
    }
    const host = url.host;
    // Strip the leading `@` and anything after a second `@` (some servers
    // render full `@user@host` text inside the link).
    const username = (a.textContent ?? "")
      .trim()
      .replace(/^@/, "")
      .split("@")[0]
      ?.trim();
    if (!host || !username) return undefined;
    return { el: a, handle: `@${username}@${host}` };
  };

  const onPointerOver = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const m = resolveMention(e.target);
    if (!m) return;
    // Pointer movement between child nodes of the same mention reports the
    // same `closest("a.mention")`; skip those so we don't restart the open
    // delay every time the cursor crosses an inner img/span boundary.
    const from = e.relatedTarget as Node | null;
    if (from && m.el.contains(from)) return;
    cancelClose();
    if (anchor() === m.el && open()) return;
    cancelOpen();
    openTimer = window.setTimeout(() => {
      // Update the anchor first so Popper recomputes against the new rect
      // when open flips to true.
      setAnchor(m.el);
      setHandle(m.handle);
      setOpen(true);
      openTimer = undefined;
    }, OPEN_DELAY_MS);
  };

  const onPointerOut = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const m = resolveMention(e.target);
    if (!m) return;
    const into = e.relatedTarget as Node | null;
    if (into && m.el.contains(into)) return;
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
          class={cn(
            ACTOR_HOVER_SURFACE_CLASS,
            "origin-[var(--kb-popover-content-transform-origin)]",
          )}
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
