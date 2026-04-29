import { Navigate, useLocation } from "@solidjs/router";
import { Match, type ParentComponent, Show, Switch } from "solid-js";

export interface SettingsOwnerGuardProps {
  accountId?: string | null;
  viewerId?: string | null;
}

export const SettingsOwnerGuard: ParentComponent<SettingsOwnerGuardProps> = (
  props,
) => {
  const location = useLocation();

  return (
    <Switch>
      <Match when={props.viewerId == null}>
        <Navigate
          href={`/sign?next=${encodeURIComponent(location.pathname)}`}
        />
      </Match>
      <Match
        when={props.accountId != null && props.viewerId !== props.accountId}
      >
        <Navigate href="/" />
      </Match>
      <Match when={props.accountId != null}>
        <Show when={props.children}>
          {(children) => children()}
        </Show>
      </Match>
    </Switch>
  );
};
