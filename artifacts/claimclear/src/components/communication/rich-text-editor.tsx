import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { useUnsavedDraftLeaveGuard } from "@/hooks/use-unsaved-draft-leave-guard";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Link as LinkIcon,
  Undo,
  Redo,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface RichTextEditorProps {
  content: string;
  onUpdate: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
}

/**
 * Pure helper: does this editor HTML represent a non-empty draft worth
 * warning about on navigation? Tiptap renders an empty document as
 * `<p></p>` (and similar empty wrappers); we strip tags + collapse
 * whitespace and check whether any user-visible text remains.
 *
 * Mirrors the `raw.trim().length > 0` predicate used by
 * `per-leg-context-editor.tsx` for its leave guard.
 */
export function richTextHasUnsavedDraft(html: string): boolean {
  if (!html) return false;
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
  return text.length > 0;
}

export function RichTextEditor({
  content,
  onUpdate,
  placeholder = "Write your reply…",
  editable = true,
  className = "",
}: RichTextEditorProps) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  // Track the latest editor HTML so the leave guard can decide whether
  // to fire on navigation. Initialized from the controlled `content`
  // prop so a pre-filled draft is also protected from the moment it
  // mounts.
  const [latestHtml, setLatestHtml] = useState<string>(content);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline" },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content,
    editable,
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      setLatestHtml(html);
      onUpdate(html);
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[6rem] px-3 py-2 text-sm",
      },
    },
  });

  // Mirror of the unsaved-draft guard from
  // `per-leg-context-editor.tsx` (Task #411 audit, Tier 2). Protects
  // typed-but-unsent reply text from being silently lost to a tab
  // close, refresh, or in-app SPA navigation. Only active while the
  // editor is editable AND has non-empty content.
  const hasUnsavedDraft =
    editable && richTextHasUnsavedDraft(latestHtml);

  const { leaveConfirmOpen, confirmLeave, cancelLeave } =
    useUnsavedDraftLeaveGuard(hasUnsavedDraft);

  if (!editor) return null;

  return (
    <div className={`border rounded-md bg-background ${className}`}>
      {editable && (
        <div className="flex items-center gap-0.5 border-b px-2 py-1">
          <ToolbarButton
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <div className="w-px h-4 bg-border mx-1" />
          <ToolbarButton
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet list"
          >
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Numbered list"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Quote"
          >
            <Quote className="h-3.5 w-3.5" />
          </ToolbarButton>
          <div className="w-px h-4 bg-border mx-1" />
          <ToolbarButton
            active={editor.isActive("link")}
            onClick={() => {
              if (editor.isActive("link")) {
                editor.chain().focus().unsetLink().run();
                return;
              }
              setLinkUrl("");
              setLinkDialogOpen(true);
            }}
            title="Link"
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <div className="flex-1" />
          <ToolbarButton
            active={false}
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo"
          >
            <Undo className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={false}
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo"
          >
            <Redo className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>
      )}
      <EditorContent editor={editor} />
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent data-testid="rich-text-editor-link-dialog">
          <DialogHeader>
            <DialogTitle>Insert link</DialogTitle>
            <DialogDescription>
              Paste or type the URL the selected text should link to.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const url = linkUrl.trim();
              if (url) {
                editor
                  .chain()
                  .focus()
                  .setLink({ href: url, target: "_blank" })
                  .run();
              }
              setLinkDialogOpen(false);
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="rich-text-editor-link-url">URL</Label>
              <Input
                id="rich-text-editor-link-url"
                data-testid="rich-text-editor-link-url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                autoFocus
                type="url"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLinkDialogOpen(false)}
                data-testid="rich-text-editor-link-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={linkUrl.trim().length === 0}
                data-testid="rich-text-editor-link-confirm"
              >
                Add link
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={leaveConfirmOpen}
        onOpenChange={(o) => { if (!o) cancelLeave(); }}
      >
        <AlertDialogContent data-testid="rich-text-editor-leave-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved reply?</AlertDialogTitle>
            <AlertDialogDescription>
              You have a reply that hasn&apos;t been sent yet. Leaving now
              drops it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={cancelLeave}
              data-testid="rich-text-editor-leave-cancel"
            >
              Stay on this page
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmLeave}
              data-testid="rich-text-editor-leave-confirm-btn"
            >
              Discard and leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`h-7 w-7 p-0 ${active ? "bg-accent text-accent-foreground" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </Button>
  );
}
