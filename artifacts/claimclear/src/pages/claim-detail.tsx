import { useParams } from "wouter";
import { ClaimDetailV2 } from "@/components/claim-detail-v2";

// Per-invoice transition is fully cut over: ClaimDetailV2 is the only
// per-leg investigation surface. The legacy claim detail page (and its
// flag gate) was removed in Task #199.
export default function ClaimDetail() {
  const params = useParams<{ id: string }>();
  const claimId = parseInt(params.id || "0", 10);
  return <ClaimDetailV2 claimId={claimId} />;
}
