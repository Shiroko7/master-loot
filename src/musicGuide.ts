/**
 * Editor help for the "music" document style: a quick-insert toolbar and a
 * cheat sheet for ABC notation, the text the staves are engraved from.
 */

import { MAX_DOC_CHARS } from "./constants";
import { MUSIC_EXAMPLE } from "./musicSheet";
import { musicXmlToAbc, readMusicXmlFile, type MusicXmlImport } from "./musicXml";

export const MUSIC_TEMPLATE = [
  "T:Song title",
  "C:Composer",
  "M:4/4",
  "L:1/4",
  "K:C",
  "C D E F | G A B c | c B A G | F E D C |]",
  "w: Do re mi fa sol la ti do, do ti la sol fa mi re do.",
].join("\n");

export const MUSIC_PLACEHOLDER =
  "Write the tune in ABC notation — letters are notes, | is a bar line.\n\n" +
  MUSIC_TEMPLATE +
  "\n\nTunes copied from abcnotation.com or thesession.org can be pasted as they are.";

/** File types offered when importing a score. */
const MUSICXML_ACCEPT =
  ".musicxml,.mxl,.xml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml";

export function createMusicGuide(
  contentInput: HTMLTextAreaElement,
  /** Told about a score that was just imported into the text box. */
  onImport?: (score: MusicXmlImport) => void,
): {
  guide: HTMLElement;
  toolbar: HTMLElement;
  /** Line under the toolbar reporting what an import did. */
  status: HTMLElement;
} {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) => {
    const node = document.createElement(tag);
    node.className = cls;
    return node;
  };

  const insertSnippet = (prefix: string, suffix = "", defaultText = "") => {
    const start = contentInput.selectionStart ?? contentInput.value.length;
    const end = contentInput.selectionEnd ?? contentInput.value.length;
    const current = contentInput.value;
    const middle = current.substring(start, end) || defaultText;
    contentInput.value =
      current.substring(0, start) + prefix + middle + suffix + current.substring(end);
    contentInput.focus();
    contentInput.selectionStart = start + prefix.length;
    contentInput.selectionEnd = start + prefix.length + middle.length;
    contentInput.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const toolbar = el("div", "doc-syntax-toolbar doc-quick-insert");
  const toolbarLabel = el("span", "doc-syntax-toolbar-label");
  toolbarLabel.textContent = "Quick Insert:";
  toolbar.append(toolbarLabel);
  const chip = (label: string, title: string, onClick: () => void, accent = false) => {
    const button = el("button", "doc-syntax-chip");
    if (accent) button.classList.add("doc-syntax-chip-accent");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.onclick = (event) => {
      event.preventDefault();
      onClick();
    };
    toolbar.append(button);
  };

  const status = el("div", "music-import-status");
  status.hidden = true;
  const report = (lines: string[], failed = false) => {
    status.replaceChildren(...lines.map((line) => {
      const row = document.createElement("div");
      row.textContent = line;
      return row;
    }));
    status.classList.toggle("error", failed);
    status.hidden = false;
  };

  /**
   * MusicXML (or compressed .mxl) becomes the ABC in the text box, where it
   * can be edited further; a score too long for one document is cut after
   * the last measure that fits.
   */
  const importScore = async (file: File): Promise<void> => {
    try {
      const score = musicXmlToAbc(await readMusicXmlFile(file), { maxChars: MAX_DOC_CHARS - 120 });
      const current = contentInput.value.trim();
      if (current && current !== MUSIC_EXAMPLE &&
          !window.confirm("Replace the music on this sheet with the imported score?")) {
        return;
      }
      // An untitled score is named after its file.
      const fileTitle = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
      if (!score.title && fileTitle) {
        score.title = fileTitle;
        score.abc = score.abc.replace(/^X:1\n/, `X:1\nT:${fileTitle}\n`);
      }
      contentInput.value = score.abc;
      contentInput.dispatchEvent(new Event("input", { bubbles: true }));
      const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
      report([
        `Imported “${score.title || file.name}”: ${count(score.importedMeasures, "measure")}, ` +
          `${count(score.parts, "part")}. It is now the notation below, yours to edit.`,
        ...score.notes,
      ]);
      onImport?.(score);
    } catch (error) {
      console.error("Master Loot: MusicXML import failed", error);
      report([error instanceof Error ? error.message : "This file could not be imported."], true);
    }
  };

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = MUSICXML_ACCEPT;
  fileInput.hidden = true;
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // the same file can be chosen again
    if (file) void importScore(file);
  };
  toolbar.append(fileInput);
  chip("📂 Import MusicXML…", "Upload a score exported from MuseScore, Finale, Sibelius… (.musicxml, .mxl, .xml)",
    () => fileInput.click(), true);
  // A score file can also be dropped straight onto the text box.
  contentInput.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  contentInput.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    event.preventDefault();
    void importScore(file);
  });

  chip("🎼 New tune", "Start a tune: title, meter, note length, key and a first line", () => {
    const tuneCount = (contentInput.value.match(/^\s*X:/gm) ?? []).length;
    const before = contentInput.value.trim() ? "\n\n" : "";
    insertSnippet(`${before}X:${tuneCount + 1}\n`, "\n", MUSIC_TEMPLATE);
  }, true);
  chip("C D E F", "Notes: C D E F G A B, then c d e… one octave up", () =>
    insertSnippet("", " ", "C D E F"));
  chip("| Bar", "Bar line", () => insertSnippet(" | "));
  chip("|: Repeat :|", "Repeat the selected bars", () =>
    insertSnippet("|: ", " :|", "C D E F"));
  chip("A2 Long", "Twice as long (A3 dotted, A4 four times)", () => insertSnippet("", "2", "A"));
  chip("A/2 Short", "Half as long", () => insertSnippet("", "/2", "A"));
  chip("z Rest", "Rest (z2 is twice as long)", () => insertSnippet("z "));
  chip("^ Sharp", "Sharp: ^F. Flat: _B. Natural: =F", () => insertSnippet("^", "", "F"));
  chip("_ Flat", "Flat: _B", () => insertSnippet("_", "", "B"));
  chip("[CEG]", "Notes played together", () => insertSnippet("[", "]", "CEG"));
  chip('"Am"', "Chord name above the staff", () => insertSnippet('"', '"', "Am"));
  chip("(3 Triplet", "Three notes in the time of two", () => insertSnippet("(3", " ", "ABc"));
  chip("w: Lyrics", "Words under the line of music above; - splits syllables", () =>
    insertSnippet("\nw: ", "\n", "one syl-la-ble per note"));
  chip("|] End", "Final double bar", () => insertSnippet(" |]"));

  const details = el("details", "doc-syntax-guide");
  const summary = el("summary", "doc-syntax-summary");
  const titleSpan = el("span", "doc-syntax-title");
  const titleIcon = document.createElement("span");
  titleIcon.textContent = "🎼";
  const titleText = document.createElement("span");
  titleText.textContent = "Music Notation Guide (ABC)";
  titleSpan.append(titleIcon, " ", titleText);
  const badge = el("span", "doc-syntax-badge");
  badge.textContent = "ABC Notation";
  summary.append(titleSpan, badge);
  details.append(summary);

  const body = el("div", "doc-syntax-body");
  const intro = el("p", "doc-picture-help-text");
  const importHelp = el("p", "doc-picture-help-text");
  importHelp.textContent =
    "Already have the score? 📂 Import MusicXML… (or drop the file on the text box) converts a " +
    ".musicxml, .mxl or .xml file from MuseScore, Finale, Sibelius, Dorico and others into this notation: " +
    "all parts and staves, lyrics, chord symbols, repeats, dynamics and ornaments.";
  body.append(importHelp);
  intro.textContent =
    "A tune is a few header lines (title, meter, key) followed by the notes. " +
    "Only the notes are required; the staves under the text box update as you type. " +
    "Lines are fitted to the paper automatically.";
  body.append(intro);

  const table = el("div", "doc-syntax-grid");
  const addRow = (syntax: string, meaning: string, example: string) => {
    const row = el("div", "doc-syntax-row");
    const synEl = el("code", "doc-syntax-code");
    synEl.textContent = syntax;
    const descEl = el("span", "doc-syntax-desc");
    descEl.textContent = meaning;
    const exEl = el("span", "doc-syntax-example");
    exEl.textContent = example;
    row.append(synEl, descEl, exEl);
    table.append(row);
  };
  addRow("T: C:", "Title and composer, printed above the staves", "T:The Miller's Lament");
  addRow("M:", "Meter (time signature)", "M:3/4");
  addRow("L:", "Length of a plain note: 1/4 quarter, 1/8 eighth", "L:1/8");
  addRow("Q:", "Tempo", "Q:1/4=90");
  addRow("K:", "Key, last header line; add clef=bass for a bass clef", "K:Dm");
  addRow("C D E F G A B", "Notes from middle C up", "C D E F | G A B c |");
  addRow("c d e   c'   C,", "Small letters: one octave up. ' higher still, , lower", "G, C E G c e g c'");
  addRow("A2 A3 A4", "Longer: 2, 3 or 4 times the plain note", "A2 B2 | c4 |");
  addRow("A/2  A3/2", "Shorter: half; 3/2 is a dotted note", "A3/2 B/2 c2");
  addRow("z  z2", "Rest", "A z A z |");
  addRow("^F  _B  =F", "Sharp, flat, natural (before the note)", "^F G _B A");
  addRow("|  ||  |]", "Bar line, double bar, final bar", "C D E F | G4 |]");
  addRow("|:  :|", "Repeat", "|: C D E F :|");
  addRow("[1  [2", "First and second endings", "|: C D [1 E F :| [2 G2 |]");
  addRow("AB  A B", "Eighth notes written together share a beam", "L:1/8 … ABcd efga");
  addRow("[CEG]", "Notes played together", "[CEG]2 [FAc]2");
  addRow('"Am"', "Chord name above the next note", '"Am"A2 "G"G2');
  addRow("(ABc)  A-A", "Slur over notes; tie to the same note", "(ABc) d-|d");
  addRow("(3ABc", "Triplet", "(3ABc d2");
  addRow("!p! !f! !fermata!", "Dynamics and ornaments", "!f!C D !fermata!E2");
  addRow("w: words", "Lyrics under the music line above; - splits syllables, * skips a note", "w: Turn, old wheel, a-gain");
  addRow("W: words", "A verse printed below the tune", "W:2. The second verse…");
  addRow("V:1  V:2", "Several voices or staves", "V:1\nC D E F |\nV:2 clef=bass\nC,4 |");
  addRow("X:2", "Starts another tune on the same sheet", "X:2");
  body.append(table);
  details.append(body);
  return { guide: details, toolbar, status };
}
