import { normalizeLocale } from "@hackerspub/models/i18n";
import {
  Navigate,
  query,
  type RouteDefinition,
  useParams,
} from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import { graphql } from "relay-runtime";
import { createMemo, Match, Show, Switch } from "solid-js";
import {
  createPreloadedQuery,
  loadQuery,
  useRelayEnvironment,
} from "solid-relay";
import type { LangPageQuery } from "./__generated__/LangPageQuery.graphql.ts";
import { ArticleBody, ArticleMetaHead } from "./index.tsx";

export const route = {
  matchFilters: {
    handle: /^@/,
    lang: /^[A-Za-z]{2,3}(?:[_-][A-Za-z0-9]+)*$/,
  },
  preload(args) {
    const handle = args.params.handle!;
    const idOrYear = args.params.idOrYear!;
    const slug = args.params.slug!;
    const language = normalizeLocale(args.params.lang!);
    if (language == null) return;
    void loadLangPageQuery(handle, idOrYear, slug, language);
  },
} satisfies RouteDefinition;

const LangPageQueryDef = graphql`
  query LangPageQuery(
    $handle: String!
    $idOrYear: String!
    $slug: String!
    $language: Locale!
  ) {
    articleByYearAndSlug(
      handle: $handle
      idOrYear: $idOrYear
      slug: $slug
    ) {
      publishedYear
      slug
      actor {
        username
      }
      contents(language: $language, includeBeingTranslated: false) {
        language
        originalLanguage
      }
      ...Slug_head @arguments(language: $language)
      ...Slug_body @arguments(language: $language)
    }
    viewer {
      ...Slug_viewer
    }
  }
`;

const loadLangPageQuery = query(
  (handle: string, idOrYear: string, slug: string, language: string) =>
    loadQuery<LangPageQuery>(
      useRelayEnvironment()(),
      LangPageQueryDef,
      { handle, idOrYear, slug, language },
    ),
  "loadArticleLangPageQuery",
);

export default function ArticleLangPage() {
  const params = useParams();

  return (
    <Show
      when={normalizeLocale(params.lang!)}
      fallback={<HttpStatusCode code={404} />}
    >
      {(language) => (
        <ArticleLangPageContent
          handle={params.handle!}
          idOrYear={params.idOrYear!}
          slug={params.slug!}
          language={language()}
        />
      )}
    </Show>
  );
}

interface ArticleLangPageContentProps {
  handle: string;
  idOrYear: string;
  slug: string;
  language: string;
}

function ArticleLangPageContent(props: ArticleLangPageContentProps) {
  const data = createPreloadedQuery<LangPageQuery>(
    LangPageQueryDef,
    () =>
      loadLangPageQuery(
        props.handle,
        props.idOrYear,
        props.slug,
        props.language,
      ),
  );

  const article = createMemo(() => data()?.articleByYearAndSlug ?? null);
  const content = createMemo(() => article()?.contents[0] ?? null);
  const canonicalBase = createMemo(() => {
    const a = article();
    return a == null
      ? null
      : `/@${a.actor.username}/${a.publishedYear}/${a.slug}`;
  });
  const redirectHref = createMemo(() => {
    const c = content();
    const base = canonicalBase();
    if (c == null || base == null) return null;
    if (c.originalLanguage == null) return base;
    if (c.language !== props.language) return `${base}/${c.language}`;
    return null;
  });

  return (
    <Show when={data() != null}>
      <Switch fallback={<HttpStatusCode code={404} />}>
        <Match when={article() == null}>
          <HttpStatusCode code={404} />
        </Match>
        <Match when={content() == null}>
          <HttpStatusCode code={404} />
        </Match>
        <Match when={redirectHref() != null}>
          <Navigate href={redirectHref()!} />
        </Match>
        <Match when={article() != null && content() != null}>
          <ArticleMetaHead
            $article={article()!}
            canonicalLanguage={content()!.language}
          />
          <ArticleBody
            $article={article()!}
            $viewer={data()?.viewer ?? undefined}
          />
        </Match>
      </Switch>
    </Show>
  );
}
