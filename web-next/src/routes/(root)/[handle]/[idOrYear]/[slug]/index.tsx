import type { Toc } from "@hackerspub/models/markup";
import { Meta } from "@solidjs/meta";
import {
  query,
  type RouteDefinition,
  useNavigate,
  useParams,
} from "@solidjs/router";
import { HttpHeader, HttpStatusCode } from "@solidjs/start";
import { graphql } from "relay-runtime";
import { createSignal, For, Show } from "solid-js";
import {
  createFragment,
  createPreloadedQuery,
  loadQuery,
  useRelayEnvironment,
} from "solid-relay";
import { ActorHoverCard } from "~/components/ActorHoverCard.tsx";
import { NoteCard } from "~/components/NoteCard.tsx";
import { NoteComposer } from "~/components/NoteComposer.tsx";
import { PostActionMenu } from "~/components/PostActionMenu.tsx";
import { PostControls } from "~/components/PostControls.tsx";
import { Title } from "~/components/Title.tsx";
import { TocList } from "~/components/TocList.tsx";
import { Trans } from "~/components/Trans.tsx";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/components/ui/avatar.tsx";
import { InternalLink } from "~/components/InternalLink.tsx";
import { Timestamp } from "~/components/Timestamp.tsx";
import { msg, plural, useLingui } from "~/lib/i18n/macro.d.ts";
import {
  MentionHoverCardLayer,
  useMentionHoverCards,
} from "~/lib/mentionHoverCards.tsx";
import type { SlugPageQuery } from "./__generated__/SlugPageQuery.graphql.ts";
import type { Slug_articleHeader$key } from "./__generated__/Slug_articleHeader.graphql.ts";
import type { Slug_body$key } from "./__generated__/Slug_body.graphql.ts";
import type { Slug_head$key } from "./__generated__/Slug_head.graphql.ts";
import type { Slug_languageSwitcher$key } from "./__generated__/Slug_languageSwitcher.graphql.ts";
import type { Slug_replies$key } from "./__generated__/Slug_replies.graphql.ts";
import type { Slug_viewer$key } from "./__generated__/Slug_viewer.graphql.ts";

export const route = {
  matchFilters: {
    handle: /^@/,
  },
  preload(args) {
    const handle = args.params.handle!;
    const idOrYear = args.params.idOrYear!;
    const slug = args.params.slug!;
    void loadPageQuery(handle, idOrYear, slug);
  },
} satisfies RouteDefinition;

const SlugPageQueryDef = graphql`
  query SlugPageQuery(
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
      ...Slug_head @arguments(language: $language)
      ...Slug_body @arguments(language: $language)
    }
    viewer {
      ...Slug_viewer
    }
  }
`;

const loadPageQuery = query(
  (handle: string, idOrYear: string, slug: string) =>
    loadQuery<SlugPageQuery>(
      useRelayEnvironment()(),
      SlugPageQueryDef,
      { handle, idOrYear, slug, language: null },
    ),
  "loadArticlePageQuery",
);

export default function ArticlePage() {
  const params = useParams();
  const handle = params.handle!;
  const idOrYear = params.idOrYear!;
  const slug = params.slug!;

  const data = createPreloadedQuery<SlugPageQuery>(
    SlugPageQueryDef,
    () => loadPageQuery(handle, idOrYear, slug),
  );

  return (
    <Show when={data()}>
      {(data) => (
        <Show
          when={data().articleByYearAndSlug}
          fallback={<HttpStatusCode code={404} />}
        >
          {(article) => (
            <>
              <ArticleMetaHead $article={article()} />
              <ArticleBody
                $article={article()}
                $viewer={data().viewer ?? undefined}
              />
            </>
          )}
        </Show>
      )}
    </Show>
  );
}

export { ArticleBody, ArticleMetaHead };

interface ArticleMetaHeadProps {
  $article: Slug_head$key;
}

function ArticleMetaHead(props: ArticleMetaHeadProps) {
  const { t } = useLingui();
  const article = createFragment(
    graphql`
      fragment Slug_head on Article
        @argumentDefinitions(language: { type: "Locale" })
      {
        actor {
          handle
          name
          rawName
          username
        }
        contents(language: $language) {
          title
          summary
          language
        }
        language
        iri
        url
        published
        updated
        hashtags {
          name
        }
      }
    `,
    () => props.$article,
  );

  return (
    <Show when={article()}>
      {(article) => {
        const content = () => article().contents?.[0];
        const title = () => content()?.title ?? "";
        const description = () => content()?.summary ?? "";
        return (
          <>
            <Title>
              {t`${article().actor.rawName}: ${title()}`}
            </Title>
            <Meta property="og:title" content={title()} />
            <Meta property="og:description" content={description()} />
            <Meta property="og:type" content="article" />
            <For each={articleOgImageUrls(article().url, article().contents)}>
              {(ogImageUrl) => (
                <>
                  <Meta property="og:image" content={ogImageUrl} />
                  <Meta property="og:image:width" content="1200" />
                  <Meta property="og:image:height" content="630" />
                </>
              )}
            </For>
            <Show when={article().url}>
              <Meta name="twitter:card" content="summary_large_image" />
            </Show>
            <Meta
              property="article:published_time"
              content={article().published}
            />
            <Meta
              property="article:modified_time"
              content={article().updated}
            />
            <Show when={article().actor.rawName}>
              {(name) => <Meta property="article:author" content={name()} />}
            </Show>
            <Meta
              property="article:author.username"
              content={article().actor.username}
            />
            <Meta
              name="fediverse:creator"
              content={article().actor.handle.replace(/^@/, "")}
            />
            <For each={article().hashtags}>
              {(hashtag) => (
                <Meta property="article:tag" content={hashtag.name} />
              )}
            </For>
            <Show when={content()?.language ?? article().language}>
              {(language) => <Meta property="og:locale" content={language()} />}
            </Show>
            <HttpHeader
              name="Link"
              value={`<${article().iri}>; rel="alternate"; type="application/activity+json"`}
            />
          </>
        );
      }}
    </Show>
  );
}

function articleOgImageUrls(
  articleUrl: string | null | undefined,
  contents: readonly { readonly language: string }[] | null | undefined,
) {
  if (articleUrl == null) return [];
  const ogImageUrl = new URL(articleUrl);
  ogImageUrl.pathname = `${ogImageUrl.pathname.replace(/\/$/, "")}/ogimage`;
  if (contents == null || contents.length < 1) return [ogImageUrl.toString()];
  return contents.map((content) => {
    const url = new URL(ogImageUrl);
    url.searchParams.set("l", content.language);
    return url.toString();
  });
}

interface ArticleBodyProps {
  $article: Slug_body$key;
  $viewer?: Slug_viewer$key;
}

function ArticleBody(props: ArticleBodyProps) {
  const [proseRef, setProseRef] = createSignal<HTMLElement>();
  const mentionState = useMentionHoverCards(proseRef);
  const article = createFragment(
    graphql`
      fragment Slug_body on Article
        @argumentDefinitions(language: { type: "Locale" })
      {
        contents(language: $language) {
          title
          content
          toc
          language
          originalLanguage
          beingTranslated
        }
        tags
        ...PostControls_post
        ...Slug_articleHeader
        ...Slug_languageSwitcher
        ...Slug_replies
      }
    `,
    () => props.$article,
  );

  return (
    <Show when={article()}>
      {(article) => {
        const content = () => article().contents?.[0];
        const toc = () => (content()?.toc ?? []) as Toc[];

        return (
          <>
            <div class="mt-8 mb-4 px-4 max-w-3xl mx-auto xl:max-w-4xl 2xl:max-w-screen-lg 2xl:flex 2xl:gap-8">
              <article class="2xl:flex-1 min-w-0">
                <ArticleTitle
                  title={content()?.title}
                  language={content()?.language ?? undefined}
                  beingTranslated={content()?.beingTranslated ?? false}
                />
                <ArticleHeader $article={article()} />
                <ArticleInlineToc
                  items={toc()}
                  hidden={content()?.beingTranslated ?? false}
                />
                <ArticleLanguageSwitcher
                  $article={article()}
                  currentLanguage={content()?.language ?? undefined}
                  currentOriginalLanguage={content()?.originalLanguage}
                />

                <Show when={!content()?.beingTranslated && content()?.content}>
                  {(html) => (
                    <div
                      ref={setProseRef}
                      lang={content()?.language ?? undefined}
                      class="prose dark:prose-invert mt-4 text-xl leading-8"
                      innerHTML={html()}
                    />
                  )}
                </Show>
                <MentionHoverCardLayer state={mentionState} />

                <ArticleTags tags={article().tags} class="2xl:hidden mt-4" />

                <PostControls
                  $post={article()}
                  class="mt-8"
                />
                <ArticleReplies
                  $article={article()}
                  $viewer={props.$viewer}
                />
              </article>

              <ArticleAside
                toc={toc()}
                tags={article().tags}
                hidden={content()?.beingTranslated ?? false}
              />
            </div>
          </>
        );
      }}
    </Show>
  );
}

interface ArticleTitleProps {
  title?: string | null;
  language?: string;
  beingTranslated: boolean;
}

function ArticleTitle(props: ArticleTitleProps) {
  const { t } = useLingui();

  return (
    <Show
      when={!props.beingTranslated}
      fallback={<h1 class="text-4xl font-bold">{t`Translating…`}</h1>}
    >
      <h1 class="text-4xl font-bold" lang={props.language}>
        {props.title}
      </h1>
    </Show>
  );
}

interface ArticleHeaderProps {
  $article: Slug_articleHeader$key;
}

function ArticleHeader(props: ArticleHeaderProps) {
  const { t } = useLingui();
  const article = createFragment(
    graphql`
      fragment Slug_articleHeader on Article {
        actor {
          name
          handle
          avatarUrl
          avatarInitials
          local
          username
          url
          iri
          isViewer
        }
        published
        publishedYear
        slug
        ...PostActionMenu_post
      }
    `,
    () => props.$article,
  );

  return (
    <Show when={article()}>
      {(article) => {
        const actorHref = () => article().actor.url ?? article().actor.iri;
        const actorInternalHref = () =>
          article().actor.local
            ? `/@${article().actor.username}`
            : `/${article().actor.handle}`;
        const postUrl = () =>
          `/@${article().actor.username}/${article().publishedYear}/${article().slug}`;

        return (
          <div class="flex gap-4 mt-4 items-center">
            <ActorHoverCard
              handle={article().actor.handle}
              class="shrink-0"
            >
              <Avatar class="size-12">
                <InternalLink
                  href={actorHref()}
                  internalHref={actorInternalHref()}
                >
                  <AvatarImage
                    src={article().actor.avatarUrl}
                    class="size-12"
                  />
                  <AvatarFallback class="size-12">
                    {article().actor.avatarInitials}
                  </AvatarFallback>
                </InternalLink>
              </Avatar>
            </ActorHoverCard>
            <div class="flex flex-col flex-1">
              <Show when={(article().actor.name ?? "").trim() !== ""}>
                {/* Actor names are sanitized HTML that may include custom emoji markup. */}
                <ActorHoverCard handle={article().actor.handle}>
                  <InternalLink
                    innerHTML={article().actor.name ?? ""}
                    href={actorHref()}
                    internalHref={actorInternalHref()}
                    class="font-semibold"
                  />
                </ActorHoverCard>
              </Show>
              <div class="flex flex-row items-center text-muted-foreground gap-1 flex-wrap">
                <span class="select-all">
                  {article().actor.handle}
                </span>
                <span>&middot;</span>
                <Timestamp
                  value={article().published}
                  capitalizeFirstLetter
                />
                <Show when={article().actor.isViewer}>
                  <span>&middot;</span>
                  <a
                    href={`${postUrl()}/edit`}
                    class="text-blue-500 hover:underline text-sm"
                  >
                    {t`Edit`}
                  </a>
                  <span>&middot;</span>
                  <PostActionMenu $post={article()} />
                </Show>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

interface ArticleInlineTocProps {
  items: Toc[];
  hidden: boolean;
}

function ArticleInlineToc(props: ArticleInlineTocProps) {
  const { t } = useLingui();

  return (
    <Show when={!props.hidden && props.items.length > 0}>
      <details class="xl:hidden mt-4 bg-stone-100 dark:bg-stone-800 rounded-lg">
        <summary class="p-4 cursor-pointer font-bold text-sm uppercase text-stone-500 dark:text-stone-400">
          {t`Table of contents`}
        </summary>
        <div class="px-4 pb-4">
          <TocList items={props.items} />
        </div>
      </details>
      <nav class="hidden xl:block 2xl:hidden mt-4 p-4 bg-stone-100 dark:bg-stone-800 rounded-lg w-fit">
        <p class="font-bold text-sm leading-7 uppercase text-stone-500 dark:text-stone-400">
          {t`Table of contents`}
        </p>
        <TocList items={props.items} />
      </nav>
    </Show>
  );
}

interface ArticleLanguageSwitcherProps {
  $article: Slug_languageSwitcher$key;
  currentLanguage?: string;
  currentOriginalLanguage?: string | null;
}

function ArticleLanguageSwitcher(props: ArticleLanguageSwitcherProps) {
  const { t, i18n } = useLingui();
  const article = createFragment(
    graphql`
      fragment Slug_languageSwitcher on Article {
        actor {
          username
        }
        publishedYear
        slug
        allContents: contents {
          language
          url
        }
      }
    `,
    () => props.$article,
  );

  return (
    <Show when={article()}>
      {(article) => {
        const postUrl = () =>
          `/@${article().actor.username}/${article().publishedYear}/${article().slug}`;

        return (
          <Show when={article().allContents.length > 1}>
            <aside class="mt-8 p-4 max-w-[80ch] border border-stone-200 dark:border-stone-700 flex flex-row gap-3 rounded-md">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="size-6 stroke-2 opacity-50 mt-0.5 flex-shrink-0"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802"
                />
              </svg>
              <div>
                <Show when={props.currentOriginalLanguage}>
                  {(originalLanguage) => {
                    const sourceUrl = () => {
                      const entry = article().allContents.find(
                        (c) => c.language === originalLanguage(),
                      );
                      return entry?.url ?? postUrl();
                    };
                    return (
                      <p class="mb-4">
                        <Trans
                          message={t`Translated from ${"LANGUAGE"}`}
                          values={{
                            LANGUAGE: () => (
                              <a href={sourceUrl()}>
                                {new Intl.DisplayNames(i18n.locale, {
                                  type: "language",
                                }).of(originalLanguage())}
                              </a>
                            ),
                          }}
                        />
                      </p>
                    );
                  }}
                </Show>
                <nav class="text-stone-600 dark:text-stone-400">
                  <strong>{t`Other languages`}</strong> &rarr;{" "}
                  <For
                    each={article().allContents.filter(
                      (c) => c.language !== props.currentLanguage,
                    )}
                  >
                    {(otherContent, i) => (
                      <>
                        {i() > 0 && <>{" "}&middot;{" "}</>}
                        <a
                          href={otherContent.url}
                          hreflang={otherContent.language}
                          lang={otherContent.language}
                          rel="alternate"
                          class="text-stone-900 dark:text-stone-100"
                        >
                          {new Intl.DisplayNames(otherContent.language, {
                            type: "language",
                          }).of(otherContent.language)}
                        </a>
                      </>
                    )}
                  </For>
                </nav>
              </div>
            </aside>
          </Show>
        );
      }}
    </Show>
  );
}

interface ArticleTagsProps {
  tags: readonly string[];
  class?: string;
}

function ArticleTags(props: ArticleTagsProps) {
  return (
    <Show when={props.tags.length > 0}>
      <div class={`flex flex-wrap gap-1.5 ${props.class ?? ""}`}>
        <For each={props.tags}>
          {(tag) => (
            <span class="bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-full text-sm text-stone-600 dark:text-stone-400">
              #{tag}
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

interface ArticleRepliesProps {
  $article: Slug_replies$key;
  $viewer?: Slug_viewer$key;
}

function ArticleReplies(props: ArticleRepliesProps) {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const article = createFragment(
    graphql`
      fragment Slug_replies on Article {
        id
        iri
        actor {
          username
        }
        publishedYear
        slug
        replies {
          edges {
            node {
              ...NoteCard_note
            }
          }
        }
      }
    `,
    () => props.$article,
  );
  const viewer = createFragment(
    graphql`
      fragment Slug_viewer on Account {
        id
      }
    `,
    () => props.$viewer,
  );

  return (
    <Show when={article()}>
      {(article) => {
        const postUrl = () =>
          `/@${article().actor.username}/${article().publishedYear}/${article().slug}`;

        return (
          <div id="replies" class="my-8">
            <h2 class="text-xl font-bold mb-4">
              {i18n._(
                msg`${
                  plural(article().replies?.edges.length ?? 0, {
                    one: "# comment",
                    other: "# comments",
                  })
                }`,
              )}
            </h2>

            <Show when={viewer() != null}>
              <div class="mb-4">
                <NoteComposer
                  replyTargetId={article().id}
                  placeholder={t`Write a reply…`}
                  onSuccess={() => navigate(postUrl(), { replace: true })}
                />
              </div>
            </Show>

            <Show when={viewer() == null}>
              <p class="p-4 text-sm text-muted-foreground">
                <Trans
                  message={t`If you have a fediverse account, you can reply to this article from your own instance. Search ${"ACTIVITYPUB_URI"} on your instance and reply to it.`}
                  values={{
                    ACTIVITYPUB_URI: () => (
                      <span class="select-all text-accent-foreground border-b border-b-muted-foreground border-dashed">
                        {article().iri}
                      </span>
                    ),
                  }}
                />
              </p>
            </Show>

            <Show when={article().replies?.edges.length}>
              <div class="border rounded-xl">
                <For each={article().replies?.edges}>
                  {(edge) => <NoteCard $note={edge.node} />}
                </For>
              </div>
            </Show>
          </div>
        );
      }}
    </Show>
  );
}

interface ArticleAsideProps {
  toc: Toc[];
  tags: readonly string[];
  hidden: boolean;
}

function ArticleAside(props: ArticleAsideProps) {
  const { t } = useLingui();

  return (
    <aside class="hidden 2xl:block 2xl:w-56 2xl:flex-shrink-0">
      <div class="2xl:sticky 2xl:top-4">
        <Show when={!props.hidden && props.toc.length > 0}>
          <div>
            <p class="font-bold text-sm leading-7 uppercase text-stone-500 dark:text-stone-400">
              {t`Table of contents`}
            </p>
            <TocList items={props.toc} />
          </div>
        </Show>

        <Show when={props.tags.length > 0}>
          <div class="mt-6">
            <p class="font-bold text-sm uppercase text-stone-500 dark:text-stone-400 mb-2">
              {t`Tags`}
            </p>
            <ArticleTags tags={props.tags} />
          </div>
        </Show>
      </div>
    </aside>
  );
}
