import { useState, useContext } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import {
  Bold,
  Italic,
  Strikethrough,
  Link2,
  List,
  ListOrdered,
  Heading2,
  Quote,
  Code2,
  Table,
  Check,
} from "lucide-react";
import { PublicBoardContext } from "../context";
import { translator, type Translate } from "../i18n";
import { safeLink } from "../ui";
import "./editor.css";

export default function RichEditor({
  initial = "",
  onChange,
  label,
  autoFocus = false,
  toolbarBelow = false,
  translate,
}: {
  initial?: string;
  onChange: (value: string) => void;
  label: string;
  autoFocus?: boolean;
  toolbarBelow?: boolean;
  translate?: Translate;
}) {
  const board = useContext(PublicBoardContext);
  const t = translate ?? board?.t ?? translator("en");
  const [link, setLink] = useState<string | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          protocols: ["https", "http"],
          defaultProtocol: "https",
        },
      }),
      TableKit.configure({ table: { resizable: false } }),
      Markdown.configure({ markedOptions: { gfm: true } }),
    ],
    content: initial,
    contentType: "markdown",
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        class: "pb-editor-content",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
  });
  const active = useEditorState({
    editor,
    selector: (ctx) =>
      ctx.editor
        ? [
            "bold",
            "italic",
            "strike",
            "link",
            "bulletList",
            "orderedList",
            "heading",
            "blockquote",
            "codeBlock",
            "table",
          ].map((n) => ctx.editor!.isActive(n))
        : [],
  });
  if (!editor) return null;
  const chain = () => editor.chain().focus();
  const actions: [Parameters<Translate>[0], typeof Bold, () => void][] = [
    ["bold", Bold, () => chain().toggleBold().run()],
    ["italic", Italic, () => chain().toggleItalic().run()],
    ["strike", Strikethrough, () => chain().toggleStrike().run()],
    [
      "link",
      Link2,
      () => setLink(String(editor.getAttributes("link").href || "")),
    ],
    ["bullet", List, () => chain().toggleBulletList().run()],
    ["numbered", ListOrdered, () => chain().toggleOrderedList().run()],
    ["heading", Heading2, () => chain().toggleHeading({ level: 2 }).run()],
    ["quote", Quote, () => chain().toggleBlockquote().run()],
    ["code", Code2, () => chain().toggleCodeBlock().run()],
    [
      "table",
      Table,
      () =>
        chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run(),
    ],
  ];
  const applyLink = () => {
    if (link === null) return;
    if (!link.trim()) chain().extendMarkRange("link").unsetLink().run();
    else if (safeLink(link))
      chain().extendMarkRange("link").setLink({ href: link }).run();
    else return;
    setLink(null);
  };
  return (
    <div className="pb-editor">
      {toolbarBelow && <EditorContent editor={editor} />}
      <div className="pb-tools" role="group" aria-label={label}>
        {actions.map(([key, Icon, action], i) => (
          <button
            key={key}
            type="button"
            title={t(key)}
            aria-label={t(key)}
            aria-pressed={active?.[i] ?? false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={action}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>
      {link !== null && (
        <div className="pb-link-input">
          <input
            aria-label={t("url")}
            type="url"
            value={link}
            placeholder="https://"
            autoFocus
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
          />
          <button aria-label={t("setLink")} type="button" onClick={applyLink}>
            <Check size={16} />
          </button>
        </div>
      )}
      {!toolbarBelow && <EditorContent editor={editor} />}
    </div>
  );
}
