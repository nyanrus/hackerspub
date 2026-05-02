import { Skeleton } from "~/components/ui/skeleton.tsx";

export function ActorPreviewSkeleton() {
  return (
    <div class="flex flex-col gap-3 p-4">
      <div class="flex items-start gap-3">
        <Skeleton class="size-12 shrink-0 rounded-full" />
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton class="h-4 w-32 rounded" />
          <Skeleton class="h-3 w-40 rounded" />
        </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <Skeleton class="h-3 w-full rounded" />
        <Skeleton class="h-3 w-11/12 rounded" />
        <Skeleton class="h-3 w-2/3 rounded" />
      </div>
      <Skeleton class="h-3 w-1/2 rounded" />
    </div>
  );
}
