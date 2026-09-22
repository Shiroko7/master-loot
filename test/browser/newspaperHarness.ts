import "@fontsource/im-fell-english/400.css";
import "@fontsource/cinzel/600.css";
import "@fontsource/caveat/400.css";
import "../../src/styles/ui.css";
import "../../src/styles/paper.css";
import { renderNewspaperDocument, type RenderedDocument } from "../../src/newspaperRender";
import type { LootDocument } from "../../src/types";
import { newspaperRegressionFixture } from "../newspaperFixture";

document.body.style.cssText = "margin:0;background:#272522";
const stage = document.querySelector<HTMLElement>("#stage")!;
let rendered: RenderedDocument;
const api = {
  render(doc: LootDocument) { rendered = renderNewspaperDocument(stage, doc); },
  async settle() {
    await document.fonts.ready;
    await Promise.all(Array.from(stage.querySelectorAll("img"), (img) => img.decode().catch(() => {})));
    await new Promise(requestAnimationFrame);
    rendered.relayout();
    await new Promise(requestAnimationFrame);
  },
  prefs(fontScale = 1, zoom = 1) {
    stage.style.setProperty("--font-scale", String(fontScale));
    stage.style.setProperty("--zoom", String(zoom));
    rendered.relayout();
  },
  goTo(index: number) { rendered.goTo(index); },
  next() { rendered.next(); },
  prev() { rendered.prev(); },
  regression: newspaperRegressionFixture,
};
Object.assign(window, { newspaperTest: api });

// This URL doubles as a local, inspectable reproduction of the reported article.
const doc = newspaperRegressionFixture();
doc.content = doc.content.replace(/\n\n---\n\n/g, "\n\n");
doc.images = [];
api.render(doc);
