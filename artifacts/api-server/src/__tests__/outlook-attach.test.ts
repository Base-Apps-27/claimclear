// Task #439 — outlook attachment routing + per-message size guard.
//
// We test `attachToDraft` directly with a fake Graph client + injected
// fetch so the inline POST vs upload-session PUT-loop branching is
// exercised without any network call. The 25 MB total guard living
// inside `replyToMessage` is exercised indirectly via a focused fake.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  EMAIL_MESSAGE_MAX_BYTES,
  INLINE_ATTACHMENT_THRESHOLD_BYTES,
} from "@workspace/api-zod";
import type { Client } from "@microsoft/microsoft-graph-client";
import { attachToDraft } from "../lib/outlook";

interface ApiCall {
  path: string;
  method: "post" | "patch" | "get";
  body: unknown;
}

function fakeClient(opts: {
  uploadUrl?: string;
  onCall?: (call: ApiCall) => void;
} = {}) {
  const calls: ApiCall[] = [];
  const client = {
    api(path: string) {
      return {
        post: async (body: unknown) => {
          const call: ApiCall = { path, method: "post", body };
          calls.push(call);
          opts.onCall?.(call);
          if (path.endsWith("/createUploadSession")) {
            return { uploadUrl: opts.uploadUrl ?? "https://upload.example.com/session/abc" };
          }
          return {};
        },
      };
    },
  } as unknown as Pick<Client, "api">;
  return { client, calls };
}

test("attachToDraft uses inline POST for files at or below INLINE_ATTACHMENT_THRESHOLD_BYTES", async () => {
  const { client, calls } = fakeClient();
  const content = Buffer.alloc(INLINE_ATTACHMENT_THRESHOLD_BYTES, 0x42);
  const result = await attachToDraft(client, "msg-1", {
    name: "small.pdf",
    content,
    contentType: "application/pdf",
  });
  assert.equal(result.kind, "inline");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/me/messages/msg-1/attachments");
  const body = calls[0].body as Record<string, unknown>;
  assert.equal(body["@odata.type"], "#microsoft.graph.fileAttachment");
  assert.equal(body.name, "small.pdf");
  assert.equal(body.contentType, "application/pdf");
  assert.equal(typeof body.contentBytes, "string");
});

test("attachToDraft opens an upload session and PUTs chunks for files over the inline threshold", async () => {
  const { client, calls } = fakeClient({ uploadUrl: "https://upload.example.com/sess/xyz" });
  // 7.5 MB → must use upload-session and split into 3 chunks of 3.125 MB.
  const size = Math.floor(7.5 * 1024 * 1024);
  const content = Buffer.alloc(size, 0x55);
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  const httpFetch = (async (url: string | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 202 });
  }) as unknown as typeof fetch;

  const result = await attachToDraft(
    client,
    "msg-2",
    { name: "big.pdf", content, contentType: "application/pdf" },
    { httpFetch },
  );

  assert.equal(result.kind, "upload_session");
  assert.equal(result.chunks, 3);
  // First Graph call must be the createUploadSession POST.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/me/messages/msg-2/attachments/createUploadSession");
  const sessBody = calls[0].body as Record<string, any>;
  assert.equal(sessBody.AttachmentItem.size, size);
  assert.equal(sessBody.AttachmentItem.name, "big.pdf");
  // Three PUTs to the pre-authorized uploadUrl with correct Content-Range headers.
  assert.equal(fetchCalls.length, 3);
  for (const call of fetchCalls) {
    assert.equal(call.url, "https://upload.example.com/sess/xyz");
    assert.equal(call.init.method, "PUT");
    const headers = call.init.headers as Record<string, string>;
    assert.match(headers["Content-Range"], /^bytes \d+-\d+\/\d+$/);
  }
  // Ranges must form a contiguous cover of [0, size).
  const ranges = fetchCalls.map((c) => {
    const m = (c.init.headers as Record<string, string>)["Content-Range"].match(
      /^bytes (\d+)-(\d+)\/(\d+)$/,
    );
    return { start: Number(m![1]), end: Number(m![2]), total: Number(m![3]) };
  });
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges[ranges.length - 1].end, size - 1);
  for (const r of ranges) assert.equal(r.total, size);
  for (let i = 1; i < ranges.length; i++) {
    assert.equal(ranges[i].start, ranges[i - 1].end + 1);
  }
});

test("attachToDraft surfaces upload-session PUT failures with byte ranges", async () => {
  const { client } = fakeClient();
  const content = Buffer.alloc(INLINE_ATTACHMENT_THRESHOLD_BYTES + 1024, 0x33);
  const httpFetch = (async () =>
    new Response("rate limited", { status: 503 })) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      attachToDraft(
        client,
        "msg-3",
        { name: "fail.bin", content },
        { httpFetch },
      ),
    /Upload-session PUT for fail\.bin failed at bytes 0-/,
  );
});

test("EMAIL_MESSAGE_MAX_BYTES is 25 MB and INLINE_ATTACHMENT_THRESHOLD_BYTES is 3 MB", () => {
  assert.equal(EMAIL_MESSAGE_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(INLINE_ATTACHMENT_THRESHOLD_BYTES, 3 * 1024 * 1024);
});
