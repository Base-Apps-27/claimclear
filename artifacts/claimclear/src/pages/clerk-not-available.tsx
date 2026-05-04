import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldX } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

// Rendered by the route guards in `App.tsx` when a clerk lands on a
// page they aren't allowed to see (Setup pages, Admin pages, Import).
// The server already 403s on the underlying endpoints, so this page
// only handles the cosmetic "you opened a URL we hide from you" case
// — typed URL, stale bookmark, link from a deeplink in someone else's
// note. Mirrors the visual language of the pending/denied access cards
// in `layout.tsx` so the lockout feels intentional, not broken.
export default function ClerkNotAvailable() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center">
              <ShieldX className="h-7 w-7 text-muted-foreground" />
            </div>
          </div>
          <CardTitle className="text-xl">Not available for your role</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <p className="text-sm text-muted-foreground text-center">
            This page is restricted to administrators and standard users.
            Per-claim work continues from the Queue and the All Claims list.
          </p>
          <Button asChild variant="default" className="w-full">
            <Link href="/queue">Go to the Queue</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
