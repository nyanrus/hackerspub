import { Navigate, query } from "@solidjs/router";
import { graphql } from "relay-runtime";
import { createSignal, Show } from "solid-js";
import {
  createMutation,
  createPreloadedQuery,
  loadQuery,
  useRelayEnvironment,
} from "solid-relay";
import { NarrowContainer } from "~/components/NarrowContainer.tsx";
import { Timestamp } from "~/components/Timestamp.tsx";
import { Title } from "~/components/Title.tsx";
import { Button } from "~/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card.tsx";
import { showToast } from "~/components/ui/toast.tsx";
import { useLingui } from "~/lib/i18n/macro.d.ts";
import type { invitationsPageQuery } from "./__generated__/invitationsPageQuery.graphql.ts";
import type { invitationsRegenerateMutation } from "./__generated__/invitationsRegenerateMutation.graphql.ts";

const invitationsPageQuery = graphql`
  query invitationsPageQuery {
    viewer {
      moderator
    }
    invitationRegenerationStatus {
      lastRegeneratedAt
      cutoffDate
      eligibleAccountsCount
      topThirdCount
    }
  }
`;

const loadAdminInvitationsPageQuery = query(
  () =>
    loadQuery<invitationsPageQuery>(
      useRelayEnvironment()(),
      invitationsPageQuery,
      {},
      { fetchPolicy: "network-only" },
    ),
  "loadAdminInvitationsPageQuery",
);

export const route = {
  preload() {
    void loadAdminInvitationsPageQuery();
  },
};

const invitationsRegenerateMutation = graphql`
  mutation invitationsRegenerateMutation {
    regenerateInvitations {
      __typename
      ... on RegenerateInvitationsPayload {
        accountsAffected
        regeneratedAt
        status {
          lastRegeneratedAt
          cutoffDate
          eligibleAccountsCount
          topThirdCount
        }
      }
      ... on NotAuthenticatedError {
        notAuthenticated
      }
      ... on NotAuthorizedError {
        notAuthorized
      }
    }
  }
`;

export default function AdminInvitationsPage() {
  const { i18n, t } = useLingui();
  const data = createPreloadedQuery<invitationsPageQuery>(
    invitationsPageQuery,
    () => loadAdminInvitationsPageQuery(),
  );
  const [regenerate] = createMutation<invitationsRegenerateMutation>(
    invitationsRegenerateMutation,
  );
  const [submitting, setSubmitting] = createSignal(false);

  function onRegenerate() {
    setSubmitting(true);
    regenerate({
      variables: {},
      onCompleted(response) {
        setSubmitting(false);
        const result = response.regenerateInvitations;
        if (result.__typename === "RegenerateInvitationsPayload") {
          showToast({
            title: t`Regenerated invitations for ${
              result.accountsAffected!.toLocaleString(i18n.locale)
            } accounts.`,
          });
        } else {
          showToast({
            title: t`Not authorized to regenerate invitations.`,
            variant: "error",
          });
        }
      },
      onError(error) {
        setSubmitting(false);
        console.error(error);
        showToast({
          title: t`Failed to regenerate invitations.`,
          description: import.meta.env.DEV ? error.message : undefined,
          variant: "error",
        });
      },
    });
  }

  return (
    <NarrowContainer class="p-4">
      <Title>{t`Hackers' Pub: Admin · Invitations`}</Title>
      <Show when={data()}>
        {(data) => (
          <Show
            when={data().viewer?.moderator}
            fallback={<Navigate href="/sign?next=%2Fadmin%2Finvitations" />}
          >
            {(_) => {
              const status = () => data().invitationRegenerationStatus;
              return (
                <>
                  <h1 class="mb-4 text-2xl font-semibold tracking-tight">
                    {t`Invitations`}
                  </h1>
                  <Card>
                    <CardHeader>
                      <CardTitle>{t`Regenerate invitations`}</CardTitle>
                      <CardDescription>
                        {t`Grants one extra invitation to the most active accounts (the top third by post count) since the last regeneration cutoff.`}
                      </CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-2 text-sm">
                      <p>
                        <span class="text-muted-foreground">
                          {t`Last regenerated:`}
                        </span>{" "}
                        <Show
                          when={status()?.lastRegeneratedAt}
                          fallback={
                            <span class="text-muted-foreground/70">
                              {t`Never`}
                            </span>
                          }
                        >
                          {(ts) => <Timestamp value={ts()} />}
                        </Show>
                      </p>
                      <p>
                        <span class="text-muted-foreground">
                          {t`Cutoff:`}
                        </span>{" "}
                        <Show when={status()?.cutoffDate}>
                          {(ts) => <Timestamp value={ts()} />}
                        </Show>
                      </p>
                      <p>
                        {t`${
                          (status()?.eligibleAccountsCount ?? 0).toLocaleString(
                            i18n.locale,
                          )
                        } eligible account(s); ${
                          (status()?.topThirdCount ?? 0).toLocaleString(
                            i18n.locale,
                          )
                        } would receive an invitation if regenerated now.`}
                      </p>
                    </CardContent>
                    <CardFooter>
                      <Button
                        on:click={onRegenerate}
                        disabled={submitting()}
                      >
                        {submitting() ? t`Regenerating…` : t`Regenerate`}
                      </Button>
                    </CardFooter>
                  </Card>
                </>
              );
            }}
          </Show>
        )}
      </Show>
    </NarrowContainer>
  );
}
