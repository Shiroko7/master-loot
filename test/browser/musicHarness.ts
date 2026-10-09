import "@fontsource/im-fell-english/400.css";
import "@fontsource/cinzel/600.css";
import "@fontsource/caveat/400.css";
import "../../src/styles/ui.css";
import "../../src/styles/paper.css";
import { renderDocument, type RenderedDocument } from "../../src/paperRender";
import { MUSIC_RENDER_EVENT, type MusicRenderDetail } from "../../src/musicSheet";
import { createLootDocument, type LootDocument } from "../../src/types";
import { musicXmlToAbc, readMusicXmlFile } from "../../src/musicXml";
import { createMusicGuide } from "../../src/musicGuide";

document.body.style.cssText = "margin:0;background:#272522";
const stage = document.querySelector<HTMLElement>("#stage")!;
let rendered: RenderedDocument;

export const sampleTune = [
  "X:1",
  "T:The Miller's Lament",
  "C:Trad., as sung in Daggerford",
  "M:6/8",
  "L:1/8",
  "Q:3/8=96",
  "K:Em",
  '|: "Em"E2B B2A | "D"F2A A2F | "Em"E2B B2A | "B7"^D2F B,3 :|',
  "w: Turn, old wheel, a-gain, turn through the rain, grind the gold-en grain, home.",
  '"G"G2B d2B | "D"A2F D2F | "Em"E2G "B7"F2^D | "Em"E6 |]',
  "w: Wa-ter runs, the stone it hums, soft-ly the night it comes.",
].join("\n");

const api = {
  /** Resolves with the engraver's warnings once the staves are drawn. */
  render(doc: LootDocument): Promise<string[]> {
    return new Promise((resolve) => {
      stage.addEventListener(
        MUSIC_RENDER_EVENT,
        (event) => resolve((event as CustomEvent<MusicRenderDetail>).detail.warnings),
        { once: true },
      );
      rendered = renderDocument(stage, doc);
    });
  },
  async settle() {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    rendered.relayout();
    await new Promise(requestAnimationFrame);
  },
  prefs(fontScale = 1, zoom = 1) {
    stage.style.setProperty("--font-scale", String(fontScale));
    stage.style.setProperty("--zoom", String(zoom));
    rendered.relayout();
  },
  position: () => rendered.getPosition(),
  next() { rendered.next(); },
  sampleTune,
  /** MusicXML text to the sheet's ABC; errors come back as their message. */
  convert(xml: string, maxChars?: number) {
    try {
      return musicXmlToAbc(xml, { maxChars });
    } catch (error) {
      return { error: (error as Error).message };
    }
  },
  /** As the editor reads an uploaded file, .mxl included. */
  readFile: (bytes: number[], name: string) => readMusicXmlFile(new File([new Uint8Array(bytes)], name)),
  /** The editor's notation box with its toolbar, as the Write tab builds it. */
  mountGuide(content: string) {
    const box = document.createElement("div");
    box.id = "guide";
    const input = document.createElement("textarea");
    input.value = content;
    const imported: string[] = [];
    const { guide, toolbar, status } = createMusicGuide(input, (score) => imported.push(score.title));
    box.append(guide, toolbar, status, input);
    document.body.prepend(box);
    Object.assign(window, { importedTitles: imported });
  },
  /** The document a GM gets from the editor's Music tile. */
  newSheet: () => createLootDocument("music").document!,
};
Object.assign(window, { musicTest: api });

// This URL doubles as a local, inspectable example: a brand new music sheet.
void api.render(api.newSheet());
