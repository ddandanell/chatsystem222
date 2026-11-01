/**
 * While /login/reset validates the token server-side, show the shape of the card rather than a
 * blank page. Same shell, so nothing jumps when the real content streams in.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function ResetLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-4" aria-busy="true">
      <span className="sr-only">Checking the reset link</span>
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="border-b border-border/60">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-64" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-4">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
