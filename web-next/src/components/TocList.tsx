import type { Toc } from "@hackerspub/models/markup";
import { For, Show } from "solid-js";

export interface TocListProps {
  readonly items: Toc[];
  readonly class?: string;
  readonly classList?: Record<string, boolean | undefined>;
}

export function TocList(props: TocListProps) {
  return (
    <ul class={props.class} classList={props.classList}>
      <For each={props.items}>
        {(item) => (
          <li class="mt-1">
            <a
              href={`#${item.id}`}
              class="block rounded-sm px-1 py-0.5 hover:bg-muted hover:text-foreground"
            >
              {item.title}
            </a>
            <Show when={item.children.length > 0}>
              <TocList items={item.children} class="pl-4" />
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}
