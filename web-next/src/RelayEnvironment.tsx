import type { FetchFunction, IEnvironment } from "relay-runtime";
import { Environment, Network, RecordSource, Store } from "relay-runtime";
import { getRequestEvent } from "solid-js/web";
import { getApiUrl } from "~/lib/env.ts";

function readSessionCookie(request: Request | undefined): string | null {
  const cookieHeader = request?.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== "session") continue;
    const raw = part.slice(eq + 1).trim();
    return raw ? decodeURIComponent(raw) : null;
  }
  return null;
}

const fetchFn: FetchFunction = async (
  params,
  variables,
) => {
  "use server";

  if (!params.text) throw new Error("Operation document must be provided");

  const event = getRequestEvent();
  const cookieHeader = event?.request?.headers.get("cookie") ?? null;
  const sessionId = readSessionCookie(event?.request);
  const apiUrl = getApiUrl();

  // [DEBUG] Remove once login flow is verified.
  console.log("[fetchFn]", {
    operation: params.name,
    apiUrl,
    hasEvent: event != null,
    hasNativeEvent: event?.nativeEvent != null,
    hasRequest: event?.request != null,
    cookieHeader,
    sessionId: sessionId == null ? null : sessionId.slice(0, 8) + "...",
  });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...sessionId == null ? {} : {
        "Authorization": "Bearer " + sessionId,
      },
    },
    credentials: "include",
    body: JSON.stringify({ query: params.text, variables }),
  });

  // [DEBUG] Remove once login flow is verified.
  const text = await response.text();
  console.log("[fetchFn response]", {
    operation: params.name,
    status: response.status,
    body: text.slice(0, 500),
  });
  return JSON.parse(text);
};

export function createEnvironment(): IEnvironment {
  const network = Network.create((params, variables, cacheConfig) => {
    return fetchFn(params, variables, cacheConfig);
  });
  const store = new Store(new RecordSource());
  return new Environment({ store, network });
}
