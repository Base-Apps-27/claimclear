// Task #372 / #377: the SOP-walk transcript helper now lives in
// `@workspace/leg-state` so the server (dispute write-up prompt) and
// the React client (read-only transcript card on the leg page) consume
// one source of truth. This module is a thin re-export so existing
// `import { ... } from "@/lib/sop-transcript"` call sites keep working.

export {
  buildSopTranscript,
  normalizeAnswers,
  type SopAnswerRow,
  type TranscriptLine,
  type SopTranscriptTree,
  type SopTranscriptTreeNode,
} from "@workspace/leg-state";
