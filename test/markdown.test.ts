// Mock browser globals for Node testing
(globalThis as any).window = {
  location: { search: "", origin: "http://localhost:5173" },
  localStorage: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
};

class MockElement {
  tagName: string;
  className = "";
  textContent = "";
  src = "";
  href = "";
  alt = "";
  target = "";
  rel = "";
  title = "";
  type = "";
  disabled = false;
  checked = false;
  style: Record<string, string> = {};
  children: (MockElement | MockTextNode)[] = [];

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  append(...nodes: (MockElement | MockTextNode | string)[]) {
    for (const n of nodes) {
      if (typeof n === "string") {
        this.children.push(new MockTextNode(n));
      } else {
        this.children.push(n);
      }
    }
  }

  classList = {
    add: (...cls: string[]) => {
      const set = new Set(this.className.split(" ").filter(Boolean));
      cls.forEach((c) => set.add(c));
      this.className = [...set].join(" ");
    },
    remove: (...cls: string[]) => {
      const set = new Set(this.className.split(" ").filter(Boolean));
      cls.forEach((c) => set.delete(c));
      this.className = [...set].join(" ");
    },
  };

  setAttribute(name: string, val: string) {
    (this as any)[name] = val;
  }
}

class MockTextNode {
  nodeValue: string;
  constructor(text: string) {
    this.nodeValue = text;
  }
}

class MockDocumentFragment {
  children: (MockElement | MockTextNode)[] = [];
  append(...nodes: (MockElement | MockTextNode | string)[]) {
    for (const n of nodes) {
      if (typeof n === "string") {
        this.children.push(new MockTextNode(n));
      } else {
        this.children.push(n);
      }
    }
  }
}

(globalThis as any).document = {
  createElement: (tag: string) => new MockElement(tag),
  createTextNode: (text: string) => new MockTextNode(text),
  createDocumentFragment: () => new MockDocumentFragment(),
  body: new MockElement("body"),
};

import test from "node:test";
import assert from "node:assert/strict";

import {
  isSafeUrl,
  normalizeImageUrl,
  isImgurAlbumUrl,
  renderInlineMarkdown,
  renderMarkdown,
  renderMarkdownInto,
} from "../src/markdown";

test("isSafeUrl: validates safe web and mailto protocols and blocks dangerous ones", () => {
  assert.equal(isSafeUrl("https://example.com/item.png"), true);
  assert.equal(isSafeUrl("http://5e.tools/items.html"), true);
  assert.equal(isSafeUrl("mailto:dm@realm.org"), true);
  assert.equal(isSafeUrl("data:image/png;base64,iVBOR..."), true);

  assert.equal(isSafeUrl("javascript:alert(1)"), false);
  assert.equal(isSafeUrl("JAVASCRIPT:alert(1)"), false);
  assert.equal(isSafeUrl("vbscript:msgbox(1)"), false);
  assert.equal(isSafeUrl("data:text/html,<script>"), false);
});

test("isImgurAlbumUrl: correctly identifies Imgur album and gallery webpage links", () => {
  assert.equal(
    isImgurAlbumUrl("https://imgur.com/a/sesbian-lex-warning-ai-slop-Q3zH7GO"),
    true
  );
  assert.equal(isImgurAlbumUrl("https://imgur.com/a/Q3zH7GO"), true);
  assert.equal(isImgurAlbumUrl("https://imgur.com/gallery/Q3zH7GO"), true);
  assert.equal(isImgurAlbumUrl("http://imgur.com/a/Bnew4HG"), true);

  // Direct images and single-image pages are not albums
  assert.equal(isImgurAlbumUrl("https://imgur.com/Bnew4HG"), false);
  assert.equal(isImgurAlbumUrl("https://i.imgur.com/Bnew4HG.jpeg"), false);
  assert.equal(isImgurAlbumUrl("https://i.imgur.com/Bnew4HG.png"), false);
});

test("normalizeImageUrl: converts imgur, google drive, and dropbox links to direct image URLs", () => {
  assert.equal(
    normalizeImageUrl("https://imgur.com/Bnew4HG"),
    "https://i.imgur.com/Bnew4HG.png"
  );
  assert.equal(
    normalizeImageUrl("http://imgur.com/Bnew4HG"),
    "https://i.imgur.com/Bnew4HG.png"
  );
  assert.equal(
    normalizeImageUrl("https://m.imgur.com/Bnew4HG"),
    "https://i.imgur.com/Bnew4HG.png"
  );
  assert.equal(
    normalizeImageUrl("https://imgur.com/sesbian-lex-Bnew4HG"),
    "https://i.imgur.com/Bnew4HG.png"
  );
  assert.equal(
    normalizeImageUrl("https://i.imgur.com/Bnew4HG.jpg"),
    "https://i.imgur.com/Bnew4HG.jpg"
  );

  assert.equal(
    normalizeImageUrl("https://drive.google.com/file/d/12345ABCDE/view?usp=sharing"),
    "https://lh3.googleusercontent.com/d/12345ABCDE"
  );
  assert.equal(
    normalizeImageUrl("https://drive.google.com/open?id=12345ABCDE"),
    "https://lh3.googleusercontent.com/d/12345ABCDE"
  );

  assert.equal(
    normalizeImageUrl("https://www.dropbox.com/s/xyz/photo.png?dl=0"),
    "https://www.dropbox.com/s/xyz/photo.png?raw=1"
  );

  assert.equal(
    normalizeImageUrl("https://example.com/art.png"),
    "https://example.com/art.png"
  );
});

test("renderInlineMarkdown: parses bold, italic, bold-italic, strike, code, links", () => {
  const frag = renderInlineMarkdown(
    "Check **bold text**, *italic notes*, ***bold italic***, ~~struck~~, and `inline code`."
  ) as unknown as MockDocumentFragment;

  assert.ok(frag.children.length > 0);
  const elements = frag.children.filter((c): c is MockElement => c instanceof MockElement);

  // Bold
  const strong = elements.find((e) => e.tagName === "STRONG" && !e.children.some((c) => (c as MockElement).tagName === "EM"));
  assert.ok(strong, "Should find <strong> element for bold");

  // Italic
  const em = elements.find((e) => e.tagName === "EM");
  assert.ok(em, "Should find <em> element for italic");

  // Bold Italic
  const boldItalic = elements.find((e) => e.tagName === "STRONG" && e.children.some((c) => (c as MockElement).tagName === "EM"));
  assert.ok(boldItalic, "Should find <strong><em> element for bold-italic");

  // Strike
  const del = elements.find((e) => e.tagName === "DEL");
  assert.ok(del, "Should find <del> element for strikethrough");

  // Code
  const code = elements.find((e) => e.tagName === "CODE" && e.className.includes("md-inline-code"));
  assert.ok(code, "Should find <code> element with md-inline-code");
  assert.equal(code.textContent, "inline code");
});

test("renderInlineMarkdown: parses links and images with safe URLs", () => {
  const frag = renderInlineMarkdown(
    "Look at [The Map](https://waterdeep.org/map) and ![Compass](https://waterdeep.org/compass.png)."
  ) as unknown as MockDocumentFragment;

  const elements = frag.children.filter((c): c is MockElement => c instanceof MockElement);

  const link = elements.find((e) => e.tagName === "A");
  assert.ok(link, "Should parse link as <a> tag");
  assert.equal(link.href, "https://waterdeep.org/map");
  assert.equal(link.target, "_blank");

  const img = elements.find((e) => e.tagName === "IMG");
  assert.ok(img, "Should parse image as <img> tag");
  assert.equal(img.src, "https://waterdeep.org/compass.png");
  assert.equal(img.alt, "Compass");
});

test("renderInlineMarkdown: parses D&D dice tags {@dice ...}", () => {
  const frag = renderInlineMarkdown("Deal {@dice 2d6+3} slashing damage.") as unknown as MockDocumentFragment;
  const elements = frag.children.filter((c): c is MockElement => c instanceof MockElement);

  const tag = elements.find((e) => e.tagName === "SPAN" && e.className.includes("md-tag-dice"));
  assert.ok(tag, "Should parse {@dice ...} as md-tag-dice span");
  assert.equal(tag.textContent, "2d6+3");
});

test("renderMarkdownInto: parses headings from # to ####", () => {
  const target = new MockElement("div");
  const markdown = `# Main Title
## Section Title
### Subsection Title
#### Detail Title`;

  renderMarkdownInto(target as unknown as HTMLElement, markdown);

  const h1 = target.children.find((c) => (c as MockElement).tagName === "H2" && (c as MockElement).className.includes("md-h1"));
  assert.ok(h1, "Should render # as h2 with class md-h1");

  const h2 = target.children.find((c) => (c as MockElement).tagName === "H3" && (c as MockElement).className.includes("md-h2"));
  assert.ok(h2, "Should render ## as h3 with class md-h2");

  const h3 = target.children.find((c) => (c as MockElement).tagName === "H4" && (c as MockElement).className.includes("md-h3"));
  assert.ok(h3, "Should render ### as h4 with class md-h3");
});

test("renderMarkdownInto: parses blockquotes (> text)", () => {
  const target = new MockElement("div");
  const markdown = `> "Keep your blades sharp and your wits sharper."
> — Captain Harbrek`;

  renderMarkdownInto(target as unknown as HTMLElement, markdown);

  const bq = target.children.find((c) => (c as MockElement).tagName === "BLOCKQUOTE" && (c as MockElement).className.includes("md-quote"));
  assert.ok(bq, "Should render blockquote with md-quote");
});

test("renderMarkdownInto: parses unordered lists and task checklists", () => {
  const target = new MockElement("div");
  const markdown = `- Regular bullet
- [ ] Incomplete task
- [x] Completed task`;

  renderMarkdownInto(target as unknown as HTMLElement, markdown);

  const ul = target.children.find((c) => (c as MockElement).tagName === "UL" && (c as MockElement).className.includes("md-ul"));
  assert.ok(ul, "Should render <ul> with md-ul");
  assert.equal(ul.children.length, 3, "Should have 3 <li> items");

  const liTaskIncomplete = ul.children[1] as MockElement;
  const checkboxIncomplete = liTaskIncomplete.children.find((c) => (c as MockElement).tagName === "INPUT") as MockElement;
  assert.ok(checkboxIncomplete);
  assert.equal(checkboxIncomplete.checked, false);

  const liTaskDone = ul.children[2] as MockElement;
  const checkboxDone = liTaskDone.children.find((c) => (c as MockElement).tagName === "INPUT") as MockElement;
  assert.ok(checkboxDone);
  assert.equal(checkboxDone.checked, true);
});

test("renderMarkdownInto: parses ordered lists (1. item)", () => {
  const target = new MockElement("div");
  const markdown = `1. First step
2. Second step
3. Third step`;

  renderMarkdownInto(target as unknown as HTMLElement, markdown);

  const ol = target.children.find((c) => (c as MockElement).tagName === "OL" && (c as MockElement).className.includes("md-ol"));
  assert.ok(ol, "Should render <ol> with md-ol");
  assert.equal(ol.children.length, 3, "Should have 3 <li elements");
});

test("renderMarkdownInto: parses markdown tables with alignments", () => {
  const target = new MockElement("div");
  const markdown = `| Item | Value | Weight |
| :--- | :---: | ---: |
| Dagger | 2 gp | 1 lb |
| Potion | 50 gp | 0.5 lb |`;

  renderMarkdownInto(target as unknown as HTMLElement, markdown);

  const table = target.children.find((c) => (c as MockElement).tagName === "TABLE" && (c as MockElement).className.includes("md-table")) as MockElement;
  assert.ok(table, "Should render <table> with md-table");

  const thead = table.children.find((c) => (c as MockElement).tagName === "THEAD") as MockElement;
  assert.ok(thead, "Should render <thead>");
  const thRow = thead.children[0] as MockElement;
  assert.equal(thRow.children.length, 3, "Header row should have 3 columns");

  const tbody = table.children.find((c) => (c as MockElement).tagName === "TBODY") as MockElement;
  assert.ok(tbody, "Should render <tbody>");
  assert.equal(tbody.children.length, 2, "Body should have 2 rows");
});

test("renderMarkdownInto: parses fenced code blocks (```lang)", () => {
  const target = new MockElement("div");
  const markdown = "```typescript\nconst loot = 100;\nconsole.log(loot);\n```";

  renderMarkdownInto(target as unknown as HTMLElement, markdown);

  const pre = target.children.find((c) => (c as MockElement).tagName === "PRE" && (c as MockElement).className.includes("md-code-block")) as MockElement;
  assert.ok(pre, "Should render <pre> with md-code-block");
  const code = pre.children.find((c) => (c as MockElement).tagName === "CODE") as MockElement;
  assert.ok(code);
  assert.ok(code.textContent.includes("const loot = 100;"));
});

test("renderMarkdown: returns a wrapper container element", () => {
  const result = renderMarkdown("Hello **world**!") as unknown as MockElement;
  assert.equal(result.tagName, "DIV");
  assert.equal(result.className, "md-container");
  assert.ok(result.children.length > 0);
});
