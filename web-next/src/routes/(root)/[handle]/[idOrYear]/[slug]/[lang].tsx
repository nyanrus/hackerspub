import { normalizeLocale } from "@hackerspub/models/i18n";
import {
  Navigate,
  query,
  type RouteDefinition,
  useParams,
} from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import { fetchQuery, graphql } from "relay-runtime";
import type { Subscription } from "relay-runtime";
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import type { Disposable } from "relay-runtime";
import {
  createMutation,
  createPreloadedQuery,
  loadQuery,
  useRelayEnvironment,
} from "solid-relay";
import { showToast } from "~/components/ui/toast.tsx";
import { useLingui } from "~/lib/i18n/macro.d.ts";
import type { LangPage_requestArticleTranslation_Mutation } from "./__generated__/LangPage_requestArticleTranslation_Mutation.graphql.ts";
import type { LangPageQuery } from "./__generated__/LangPageQuery.graphql.ts";
import {
  ArticleBody,
  ArticleMetaHead,
  ArticleTranslationPlaceholder,
} from "./index.tsx";

// Matches the staleness window inside `startArticleContentTranslation`
// (`models/article.ts`).  After 30 minutes of no `updated` change on a
// `beingTranslated: true` row, the model's retry path is willing to
// re-queue the translation, so the route should re-fire its mutation
// instead of polling forever.
const TRANSLATION_STALE_MS = 30 * 60 * 1000;

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
      id
      language
      allowLlmTranslation
      publishedYear
      slug
      actor {
        username
      }
      contents(language: $language, includeBeingTranslated: true) {
        language
        originalLanguage
        beingTranslated
        updated
      }
      ...Slug_head
        @arguments(language: $language, includeBeingTranslated: true)
      ...Slug_body
        @arguments(language: $language, includeBeingTranslated: true)
    }
    viewer {
      id
      locales
      ...Slug_viewer
    }
  }
`;

const requestArticleTranslationMutation = graphql`
  mutation LangPage_requestArticleTranslation_Mutation(
    $input: RequestArticleTranslationInput!
    $language: Locale!
  ) {
    requestArticleTranslation(input: $input) {
      __typename
      ... on RequestArticleTranslationPayload {
        article {
          id
          ...Slug_head
            @arguments(language: $language, includeBeingTranslated: true)
          ...Slug_body
            @arguments(language: $language, includeBeingTranslated: true)
        }
      }
      ... on NotAuthenticatedError {
        notAuthenticated
      }
      ... on InvalidInputError {
        inputPath
      }
      ... on LlmTranslationNotAllowedError {
        reason
      }
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
  const env = useRelayEnvironment();
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
  const viewer = createMemo(() => data()?.viewer ?? null);
  const canRequestTranslation = createMemo(() => {
    const a = article();
    return viewer() != null && a != null && a.allowLlmTranslation &&
      a.language !== props.language;
  });
  // Mirrors the `30 * 60 * 1000` staleness window inside
  // `startArticleContentTranslation`: if the placeholder row hasn't
  // updated in 30 minutes the background translation worker has
  // probably died, and the model layer's retry path will accept a
  // fresh `requestArticleTranslation` call to re-queue it.
  const isStaleInProgress = createMemo(() => {
    const c = content();
    if (c == null || !c.beingTranslated) return false;
    return Date.parse(c.updated) < Date.now() - TRANSLATION_STALE_MS;
  });
  const shouldAutoRequest = createMemo(() =>
    canRequestTranslation() && (content() == null || isStaleInProgress())
  );
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

  // While a translation is in flight, poll for completion every 30
  // seconds.  When `beingTranslated` flips back to false (translation
  // finished) or the component unmounts, the interval is cleared via
  // `onCleanup` registered inside this effect's tracking scope.
  // `fetchQuery` is used (instead of revalidating the Solid Router
  // cache key) because it forces a network round trip and writes the
  // fresh response into the Relay store, which `createPreloadedQuery`
  // observes — revalidating the router cache alone would leave the
  // already-populated Relay store unchanged.
  createEffect(() => {
    if (!content()?.beingTranslated) return;
    let pending: Subscription | null = null;
    const interval = setInterval(() => {
      pending?.unsubscribe();
      pending = fetchQuery<LangPageQuery>(env(), LangPageQueryDef, {
        handle: props.handle,
        idOrYear: props.idOrYear,
        slug: props.slug,
        language: props.language,
      }).subscribe({
        error(error: unknown) {
          // Background polling can hit transient network failures
          // without any UI affordance; surface them in the console
          // so they're discoverable, but don't toast or otherwise
          // interrupt the placeholder.  The next tick will retry on
          // its own.
          console.error("Translation polling failed:", error);
        },
      });
    }, 30_000);
    onCleanup(() => {
      clearInterval(interval);
      pending?.unsubscribe();
    });
  });

  return (
    <Show when={data() != null}>
      <Switch fallback={<HttpStatusCode code={404} />}>
        <Match when={article() == null}>
          <HttpStatusCode code={404} />
        </Match>
        <Match when={shouldAutoRequest()}>
          <AutoRequestTranslation
            articleId={article()!.id}
            language={props.language}
          />
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
            viewerLocales={data()?.viewer?.locales}
          />
        </Match>
      </Switch>
    </Show>
  );
}

interface AutoRequestTranslationProps {
  articleId: string;
  language: string;
}

function AutoRequestTranslation(props: AutoRequestTranslationProps) {
  const { t } = useLingui();
  const [requestTranslation] = createMutation<
    LangPage_requestArticleTranslation_Mutation
  >(requestArticleTranslationMutation);
  const [failed, setFailed] = createSignal(false);
  // Tracks the last `${articleId}/${language}` we fired the mutation
  // for; SolidStart can reuse this component across client-side param
  // changes (e.g. switching from a missing /ja to a missing /zh-CN
  // without unmounting the route), and we want each distinct request
  // to fire exactly once.
  let firedKey: string | null = null;
  let disposable: Disposable | null = null;

  onCleanup(() => disposable?.dispose());

  createEffect(() => {
    const key = `${props.articleId}/${props.language}`;
    if (firedKey === key) return;
    firedKey = key;
    setFailed(false);
    disposable?.dispose();
    disposable = requestTranslation({
      variables: {
        input: {
          articleId: props.articleId,
          targetLanguage: props.language,
        },
        language: props.language,
      },
      onCompleted(response) {
        const payload = response.requestArticleTranslation;
        if (payload.__typename !== "RequestArticleTranslationPayload") {
          showToast({
            title: t`Translation request failed`,
            variant: "destructive",
          });
          setFailed(true);
        }
      },
      onError(_error) {
        showToast({
          title: t`Translation request failed`,
          variant: "destructive",
        });
        setFailed(true);
      },
    });
  });

  return (
    <Show when={!failed()} fallback={<HttpStatusCode code={404} />}>
      <div class="mt-8 mb-4 px-4 max-w-3xl mx-auto xl:max-w-4xl 2xl:max-w-screen-lg">
        <article class="min-w-0">
          <ArticleTranslationPlaceholder targetLanguage={props.language} />
        </article>
      </div>
    </Show>
  );
}
