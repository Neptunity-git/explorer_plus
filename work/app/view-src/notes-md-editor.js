// ノートビューの付箋の中身：Markdown を「書いている行だけ記号を出す」形で見せるエディタ（ADR 0019）。
// CodeMirror 6 を使い、カーソルの無い行では # や ** などの記号を隠して、見出しは大きく・太字は太く見せる。
// npm run build:views で、views/builtin.notes/md-editor.js に1つのファイルとしてまとめる（ビューは外のサイトから読み込めないため）。
import { EditorState, Compartment, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";

/** 隠す記号 */
const HIDDEN_MARKS = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark", "LinkMark", "QuoteMark", "URL"]);
/** 文字の飾り（範囲に付ける class） */
const INLINE_CLASS = {
  StrongEmphasis: "md-strong",
  Emphasis: "md-em",
  InlineCode: "md-code",
  Strikethrough: "md-strike",
  Link: "md-link",
};
/** 行の飾り（行に付ける class） */
const LINE_CLASS = {
  ATXHeading1: "md-h1",
  ATXHeading2: "md-h2",
  ATXHeading3: "md-h3",
  ATXHeading4: "md-h4",
  ATXHeading5: "md-h5",
  ATXHeading6: "md-h6",
  Blockquote: "md-quote",
  FencedCode: "md-pre",
};

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    return Object.assign(document.createElement("span"), { className: "md-bullet", textContent: "•" });
  }
}

/** チェックボックス（- [ ] / - [x]）。押すと中身の [ ] と [x] を入れ替える */
class TaskWidget extends WidgetType {
  constructor(checked, from) {
    super();
    this.checked = checked;
    this.from = from;
  }
  eq(other) {
    return other.checked === this.checked && other.from === this.from;
  }
  toDOM(view) {
    const box = Object.assign(document.createElement("input"), { type: "checkbox", className: "md-task", checked: this.checked });
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (!view.state.facet(EditorView.editable)) return;
      view.dispatch({ changes: { from: this.from, to: this.from + 3, insert: this.checked ? "[ ]" : "[x]" } });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const hide = Decoration.replace({});

/** カーソル（選択）のある行の番号。エディタにフォーカスが無ければ、どの行も整えて見せる */
function activeLines(view) {
  const lines = new Set();
  if (!view.hasFocus) return lines;
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number;
    const b = view.state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  return lines;
}

function build(view) {
  const doc = view.state.doc;
  const active = activeLines(view);
  const isActive = (pos) => active.has(doc.lineAt(pos).number);
  const marks = [];
  const lineClasses = new Map();
  syntaxTree(view.state).iterate({
    enter(node) {
      const name = node.name;
      if (LINE_CLASS[name]) {
        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(node.to).number;
        for (let n = first; n <= last; n++) lineClasses.set(n, LINE_CLASS[name]);
      }
      if (INLINE_CLASS[name]) marks.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: INLINE_CLASS[name] }) });
      if (isActive(node.from)) return;
      if (HIDDEN_MARKS.has(name)) {
        let to = node.to;
        // 見出しの # のあとの空白も隠す
        if (name === "HeaderMark" && doc.sliceString(to, to + 1) === " ") to += 1;
        if (name === "QuoteMark" && doc.sliceString(to, to + 1) === " ") to += 1;
        // リンクの (URL) は、カッコごと隠す
        if (name === "URL" && doc.sliceString(node.from - 1, node.from) === "(") return;
        if (to > node.from) marks.push({ from: node.from, to, deco: hide });
      } else if (name === "ListMark") {
        const text = doc.sliceString(node.from, node.to);
        const after = doc.sliceString(node.to, node.to + 4);
        if ((text === "-" || text === "*" || text === "+") && !/^ \[[ xX]\]/.test(after)) marks.push({ from: node.from, to: node.to, deco: bullet });
        if (/^ \[[ xX]\]/.test(after)) marks.push({ from: node.from, to: node.to + 1, deco: hide });
      } else if (name === "TaskMarker") {
        const checked = /x/i.test(doc.sliceString(node.from, node.to));
        marks.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new TaskWidget(checked, node.from) }) });
      } else if (name === "Link") {
        // [文字](URL) の "](URL)" を隠す
        const text = doc.sliceString(node.from, node.to);
        const close = text.lastIndexOf("](");
        if (close > 0 && text.endsWith(")")) marks.push({ from: node.from + close, to: node.to, deco: hide });
      }
    },
  });
  const b = new RangeSetBuilder();
  const items = [];
  for (const [n, cls] of lineClasses) {
    const line = doc.line(n);
    items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: cls }), line: true });
  }
  items.push(...marks);
  // 同じ場所から始まるものは、行の飾り → 広い範囲 → 狭い範囲の順に並べる（RangeSetBuilder の決まり）
  items.sort((x, y) => x.from - y.from || (y.line ? 1 : 0) - (x.line ? 1 : 0) || x.deco.startSide - y.deco.startSide || y.to - x.to);
  // 重なる「隠す」範囲は入れられないので、前のものと重なるなら飛ばす
  let lastReplaceEnd = -1;
  for (const it of items) {
    const isReplace = !it.line && it.deco.spec && (it.deco.spec.widget || it.deco === hide);
    if (isReplace) {
      if (it.from < lastReplaceEnd) continue;
      lastReplaceEnd = it.to;
    }
    b.add(it.from, it.to, it.deco);
  }
  return b.finish();
}

const livePreview = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = build(view);
    }
    update(u) {
      if (u.docChanged || u.selectionSet || u.focusChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * 付箋の中身のエディタを作る。
 * @param {HTMLElement} parent
 * @param {{ text: string, onChange?: (text: string) => void, onBlur?: () => void }} opts
 */
export function createMdEditor(parent, opts) {
  const editable = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.text,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        livePreview,
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        editable.of(EditorView.editable.of(false)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && opts.onChange) opts.onChange(u.state.doc.toString());
          if (u.focusChanged && !u.view.hasFocus && opts.onBlur) opts.onBlur();
        }),
      ],
    }),
  });
  return {
    view,
    get text() {
      return view.state.doc.toString();
    },
    /** 書ける状態にして、カーソルを置く（atEnd なら最後に） */
    edit(atEnd = true) {
      view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(true)) });
      if (atEnd) view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    },
    /** 見るだけの状態に戻す */
    stop() {
      view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(false)) });
      view.contentDOM.blur();
    },
    setText(text) {
      if (text !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    destroy() {
      view.destroy();
    },
  };
}
