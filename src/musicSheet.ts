/**
 * Sheet music: the "music" document style. The content is ABC notation
 * (https://abcnotation.com), a plain-text way of writing a tune, and abcjs
 * engraves it as staves. abcjs builds its SVG node by node, so DM-authored
 * text is never parsed as HTML here either.
 */

/** Bubbles from the score element after every engraving. */
export const MUSIC_RENDER_EVENT = "musicrender";

/**
 * What a new music sheet starts with: the "Ode to Joy" theme, a melody most
 * people can hum, so the DM sees at once how the text becomes staves. It
 * shows a header, a key signature, quarter, dotted, eighth and half notes,
 * slurred pairs, a low note (`A,`) and lyrics, and is meant to be replaced.
 */
export const MUSIC_EXAMPLE = [
  "T:Ode to Joy",
  "C:Ludwig van Beethoven",
  "M:4/4",
  "L:1/4",
  "Q:1/4=120",
  "K:D",
  "F F G A | A G F E | D D E F | F3/2 E/2 E2 |",
  "w: Freu-de, schö-ner Göt-ter-fun-ken, Toch-ter aus E-ly-si-um,",
  "F F G A | A G F E | D D E F | E3/2 D/2 D2 |",
  "w: Wir be-tre-ten feu-er-trun-ken, Himm-li-sche, dein Hei-lig-tum!",
  "E E F D | E (F/2G/2) F D | E (F/2G/2) F E | D E A,2 |",
  "w: Dei-ne Zau-ber bin-den_ wie-der, was die_ Mo-de streng ge-teilt;",
  "F F G A | A G F E | D D E F | E3/2 D/2 D2 |]",
  "w: al-le Men-schen wer-den Brü-der, wo dein sanf-ter Flü-gel weilt.",
].join("\n");

export interface MusicRenderDetail {
  /** Plain-text notes from the engraver about notation it could not read. */
  warnings: string[];
}

export interface MusicFont {
  /** CSS family list, as in DOC_FONT_META; the first family is used. */
  family: string;
  adjust: number;
}

export interface MusicScore {
  /** Engrave again if the reader's text size changed since the last time. */
  relayout(): void;
}

/**
 * Staff width in abcjs units when the text size is 100%. The score always
 * scales to the paper's width, so a narrower staff means larger notes.
 */
const STAFF_WIDTH = 710;

const FIELD_LINE = /^[A-Za-z]:/;

/**
 * Splits the content into tunes (a line starting with `X:` begins the next
 * one) and repairs what ABC is strict about but a DM should not need to
 * know: a blank line would end the tune, and notes are ignored until a
 * `K:` key line. So blank lines are dropped, and a tune written without
 * its header (just `C D E F | G A B c |`) gets `X:` and `K:C`.
 */
export function splitTunes(source: string): string[] {
  const tunes: string[][] = [];
  let current: string[] = [];
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^X:/.test(line) && current.length > 0) {
      tunes.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) tunes.push(current);

  return tunes.map((lines, index) => {
    // The header is the leading run of `T:`-style fields and % comments;
    // it ends with the key.
    let headerEnd = 0;
    let hasKey = false;
    while (
      headerEnd < lines.length &&
      !hasKey &&
      (FIELD_LINE.test(lines[headerEnd]) || lines[headerEnd].startsWith("%"))
    ) {
      hasKey = /^K:/.test(lines[headerEnd]);
      headerEnd++;
    }
    const fixed = [...lines];
    if (!hasKey) fixed.splice(headerEnd, 0, "K:C");
    if (!/^X:/.test(fixed[0])) fixed.unshift(`X:${index + 1}`);
    return fixed.join("\n");
  });
}

function fontDirective(font: MusicFont, size: number, extra = ""): string {
  const face = font.family.split(",")[0].trim().replace(/"/g, "");
  return `"${face}" ${Math.round(size * font.adjust)}${extra}`;
}

/**
 * abcjs reports problems as HTML: "Music Line:6:9: Unknown character
 * ignored: G A B | <span …>q</span>2 c |]". Keep the message and the marked
 * character, as plain text. The line number is dropped: it counts lines of
 * the repaired tune (see splitTunes), not of what the DM typed.
 */
function plainWarning(html: string): string {
  return html
    .replace(/<span[^>]*>([^<]*)<\/span>/g, "→$1←")
    .replace(/<[^>]*>/g, "")
    .replace(/^Music Line:\d+:\d+:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Engraves `source` into `target`. abcjs is loaded on demand, so the staves
 * appear a moment after the paper; MUSIC_RENDER_EVENT fires when they do.
 */
export function renderMusicInto(
  target: HTMLElement,
  source: string,
  font: MusicFont,
): MusicScore {
  target.classList.add("music-score");
  const tunes = splitTunes(source);
  if (tunes.length === 0) {
    const note = document.createElement("p");
    note.className = "paper-note";
    note.textContent = "(The staves are empty.)";
    target.append(note);
    return { relayout() {} };
  }

  let abcjs: typeof import("abcjs") | undefined;
  let drawnScale = 0;

  const draw = (): void => {
    // Measuring text and splitting the score into lines need a laid-out
    // element; a detached one is drawn on the next relayout instead.
    if (!abcjs || !target.isConnected) return;
    const fontScale =
      parseFloat(getComputedStyle(target).getPropertyValue("--font-scale")) || 1;
    if (fontScale === drawnScale) return;
    drawnScale = fontScale;

    target.replaceChildren();
    const warnings: string[] = [];
    for (const tune of tunes) {
      const holder = document.createElement("div");
      holder.className = "music-tune";
      target.append(holder);
      const [drawn] = abcjs.renderAbc(holder, tune, {
        add_classes: true,
        responsive: "resize",
        // One SVG per staff line, so paged documents break between lines.
        oneSvgPerLine: true,
        staffwidth: Math.round(STAFF_WIDTH / fontScale),
        // Lines are fitted to the paper, not to the line breaks typed.
        wrap: { minSpacing: 1.3, maxSpacing: 2.4, preferredMeasuresPerLine: 4 },
        paddingtop: 0,
        paddingbottom: 6,
        paddingleft: 2,
        paddingright: 6,
        selectTypes: false,
        // Ink comes from the paper's CSS color.
        foregroundColor: "currentColor",
        format: {
          titlefont: fontDirective(font, 20),
          subtitlefont: fontDirective(font, 15),
          composerfont: fontDirective(font, 13, " italic"),
          infofont: fontDirective(font, 13, " italic"),
          tempofont: fontDirective(font, 13, " bold"),
          partsfont: fontDirective(font, 14),
          gchordfont: fontDirective(font, 13),
          annotationfont: fontDirective(font, 13, " italic"),
          vocalfont: fontDirective(font, 14),
          wordsfont: fontDirective(font, 14),
          textfont: fontDirective(font, 14),
        },
      });
      for (const warning of drawn?.warnings ?? []) warnings.push(plainWarning(warning));
    }
    target.dispatchEvent(
      new CustomEvent<MusicRenderDetail>(MUSIC_RENDER_EVENT, {
        bubbles: true,
        detail: { warnings },
      }),
    );
  };

  void import("abcjs").then(
    (module) => {
      abcjs = module.default ?? module;
      draw();
    },
    (error) => {
      console.error("Master Loot: failed to load the music engraver", error);
      target.textContent = "(The music could not be drawn.)";
    },
  );

  return { relayout: draw };
}
