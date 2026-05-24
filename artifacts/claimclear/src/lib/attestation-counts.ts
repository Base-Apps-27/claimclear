// Task #893 / #895 — Re-export of the shared workspace helper. The
// canonical implementation lives in @workspace/attestation-counts so
// the api-server's parity test for /attestation/counts can import the
// exact same algorithm the client uses for the sidebar badge, the
// header pill, the Open tab badge, and the Queue section subhead.
export {
  countDistinctAttestationGroups,
  type AttestationCountsClaim,
  type AttestationCountsPayload,
} from "@workspace/attestation-counts";
