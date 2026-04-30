import type { RouteDefinition } from "@solidjs/router";
import type { APIEvent } from "@solidjs/start/server";
import { fetchQuery, graphql } from "relay-runtime";
import { createEnvironment } from "../../../../../RelayEnvironment.tsx";
import type { ogimageQuery } from "./__generated__/ogimageQuery.graphql.ts";

export const route = {
  matchFilters: {
    handle: /^@[^@]+$/,
  },
} satisfies RouteDefinition;

export async function GET({ params, request }: APIEvent) {
  const { handle, idOrYear, slug } = params;
  if (!handle || !idOrYear || !slug) {
    return new Response("Not Found", { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const language = requestUrl.searchParams.get("l");
  const response = await fetchQuery<ogimageQuery>(
    createEnvironment(),
    graphql`
      query ogimageQuery(
        $handle: String!
        $idOrYear: String!
        $slug: String!
        $language: Locale
      ) {
        articleByYearAndSlug(
          handle: $handle
          idOrYear: $idOrYear
          slug: $slug
        ) {
          contents(language: $language) {
            ogImageUrl
          }
        }
      }
    `,
    { handle, idOrYear, slug, language },
  ).toPromise();

  const ogImageUrl = response?.articleByYearAndSlug?.contents[0]?.ogImageUrl;
  if (ogImageUrl == null) {
    return new Response("Not Found", { status: 404 });
  }

  return Response.redirect(ogImageUrl, 302);
}
