/**
 * MusicXML import for music sheets. A score exported from MuseScore, Finale,
 * Sibelius, Dorico… (.musicxml / .xml, or compressed .mxl) is converted to
 * the ABC notation the sheet stores and engraves (see musicSheet.ts): ABC is
 * a fraction of the size, which matters in Owlbear's shared metadata, and the
 * DM can keep editing it as text.
 *
 * Carried over: title and composer; every part, staff and voice; clefs, key
 * and time signatures and their changes; notes, rests, chords, dots, tuplets,
 * grace notes, accidentals, ties, slurs and beams; repeats, endings and bar
 * styles; lyrics (all verses), chord symbols, tempo, dynamics, hairpins,
 * text directions, articulations, ornaments and fingerings.
 * Left out, as ABC has no place for them: page layout, tablature staves,
 * cue notes, and playback-only data.
 */
import { unzipSync } from "fflate";

export interface MusicXmlImport {
  abc: string;
  title: string;
  parts: number;
  /** Measures in the file, and how many of them made it into `abc`. */
  measures: number;
  importedMeasures: number;
  /** Things the DM should know: truncation, skipped staves… */
  notes: string[];
}

export class MusicXmlError extends Error {}

// --- small helpers -------------------------------------------------------------

const kids = (parent: Element, name?: string): Element[] =>
  Array.from(parent.children).filter((child) => !name || child.tagName === name);
const kid = (parent: Element | undefined | null, name: string): Element | undefined =>
  parent ? Array.from(parent.children).find((child) => child.tagName === name) : undefined;
const text = (parent: Element | undefined | null, name: string): string =>
  kid(parent, name)?.textContent?.trim() ?? "";
const num = (parent: Element | undefined | null, name: string): number | undefined => {
  const value = parseFloat(text(parent, name));
  return Number.isFinite(value) ? value : undefined;
};

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** A note length as ABC writes it after the pitch: "", "2", "/", "3/2"… */
function lengthSuffix(numerator: number, denominator: number): string {
  // Divisions are integers in well-formed files; tolerate the odd decimal.
  const scale = Number.isInteger(numerator) ? 1 : 1000;
  let n = Math.round(numerator * scale);
  let d = denominator * scale;
  const common = gcd(n, d);
  n /= common;
  d /= common;
  if (n <= 0) return "";
  if (d === 1) return n === 1 ? "" : String(n);
  if (n === 1) return d === 2 ? "/" : `/${d}`;
  return `${n}/${d}`;
}

/**
 * A silence of any length as rests a staff can show: five sixteenths is a
 * quarter plus a sixteenth, not one "x5". `wholes` is in whole notes.
 */
function restTokens(symbol: string, wholes: number, unit: number): string {
  let left = Math.round(wholes * 4096);
  let tokens = "";
  for (let value = 8 * 4096; value >= 16 && left > 0; value /= 2) {
    // Longest first, dotted before plain.
    for (const size of [value * 1.5, value]) {
      while (size <= left && Number.isInteger(size)) {
        tokens += `${symbol}${lengthSuffix(size, unit * 4096)} `;
        left -= size;
      }
    }
  }
  if (left > 0) tokens += `${symbol}${lengthSuffix(left, unit * 4096)} `;
  return tokens;
}

/** Note values as fractions of a whole note. */
const TYPE_WHOLES: Record<string, number> = {
  maxima: 8, long: 4, breve: 2, whole: 1, half: 1 / 2, quarter: 1 / 4, eighth: 1 / 8,
  "16th": 1 / 16, "32nd": 1 / 32, "64th": 1 / 64, "128th": 1 / 128, "256th": 1 / 256,
};

const FIFTHS_LINE = [
  "Fb", "Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B",
  "F#", "C#", "G#", "D#", "A#", "E#", "B#",
];
/** Tonic's distance from the major tonic along the line of fifths, and ABC's suffix. */
const MODES: Record<string, [number, string]> = {
  major: [0, ""], ionian: [0, ""], minor: [3, "m"], aeolian: [3, "m"], dorian: [2, "dor"],
  phrygian: [4, "phr"], lydian: [-1, "lyd"], mixolydian: [1, "mix"], locrian: [5, "loc"],
};
const SHARP_ORDER = "FCGDAEB";

function keyName(fifths: number, mode: string): string {
  const [offset, suffix] = MODES[mode.toLowerCase()] ?? MODES.major;
  return (FIFTHS_LINE[8 + fifths + offset] ?? "C") + suffix;
}

/** The alteration the key signature gives each note letter. */
function keyAlterations(fifths: number): Record<string, number> {
  const alter: Record<string, number> = {};
  for (let i = 0; i < Math.min(7, Math.abs(fifths)); i++) {
    if (fifths > 0) alter[SHARP_ORDER[i]] = 1;
    else alter[SHARP_ORDER[6 - i]] = -1;
  }
  return alter;
}

const ACCIDENTAL_MARK: Record<number, string> = { [-2]: "__", [-1]: "_", 0: "=", 1: "^", 2: "^^" };

function abcPitch(step: string, octave: number): string {
  if (octave >= 5) return step.toLowerCase() + "'".repeat(octave - 5);
  return step.toUpperCase() + ",".repeat(4 - octave);
}

function clefName(clef: Element): string | undefined {
  const sign = text(clef, "sign").toUpperCase();
  const line = num(clef, "line");
  if (sign === "TAB") return undefined;
  if (sign === "PERCUSSION") return "perc";
  if (sign === "F") return line === 3 ? "bass3" : "bass";
  if (sign === "C") return line === 4 ? "tenor" : line === 1 ? "alto1" : line === 2 ? "alto2" : "alto";
  return "treble";
}

const DYNAMICS = new Set(["p", "pp", "ppp", "pppp", "f", "ff", "fff", "ffff", "mp", "mf", "sfz"]);
const ARTICULATIONS: Record<string, string> = {
  staccato: ".", accent: "!accent!", "strong-accent": "!marcato!", tenuto: "!tenuto!",
  staccatissimo: "!wedge!", "breath-mark": "!breath!", "detached-legato": "!tenuto!.",
};
const ORNAMENTS: Record<string, string> = {
  "trill-mark": "!trill!", mordent: "!mordent!", "inverted-mordent": "!pralltriller!",
  turn: "!turn!", "inverted-turn": "!invertedturn!", "delayed-turn": "!turn!",
};
const TECHNICAL: Record<string, string> = {
  "up-bow": "!upbow!", "down-bow": "!downbow!", "open-string": "!open!", stopped: "!+!",
  "snap-pizzicato": "!snap!", harmonic: "!open!",
};
const BEAT_UNITS: Record<string, [number, number]> = {
  whole: [1, 1], half: [1, 2], quarter: [1, 4], eighth: [1, 8], "16th": [1, 16], "32nd": [1, 32],
};

/** Chord-symbol quality as jazz charts write it, by MusicXML `kind`. */
const HARMONY_KINDS: Record<string, string> = {
  major: "", minor: "m", augmented: "aug", diminished: "dim", dominant: "7",
  "major-seventh": "maj7", "minor-seventh": "m7", "diminished-seventh": "dim7",
  "augmented-seventh": "aug7", "half-diminished": "m7b5", "major-minor": "m(maj7)",
  "major-sixth": "6", "minor-sixth": "m6", "dominant-ninth": "9", "major-ninth": "maj9",
  "minor-ninth": "m9", "dominant-11th": "11", "major-11th": "maj11", "minor-11th": "m11",
  "dominant-13th": "13", "major-13th": "maj13", "minor-13th": "m13",
  "suspended-second": "sus2", "suspended-fourth": "sus4", power: "5", none: "N.C.",
};

const quoted = (value: string): string => value.replace(/\s+/g, " ").replace(/"/g, "'").trim();
const alterMark = (alter: number): string => (alter > 0 ? "#".repeat(alter) : "b".repeat(-alter));

function harmonyText(harmony: Element): string {
  const root = kid(harmony, "root");
  if (!root) return "";
  const kind = kid(harmony, "kind");
  const kindName = kind?.textContent?.trim() ?? "major";
  if (kindName === "none") return "N.C.";
  const shown = kind?.getAttribute("text");
  let chord = text(root, "root-step") + alterMark(Math.round(num(root, "root-alter") ?? 0));
  chord += shown !== null && shown !== undefined ? shown : HARMONY_KINDS[kindName] ?? "";
  for (const degree of kids(harmony, "degree")) {
    const value = text(degree, "degree-value");
    if (!value || text(degree, "degree-type") === "subtract") continue;
    chord += `(${alterMark(Math.round(num(degree, "degree-alter") ?? 0))}${value})`;
  }
  const bass = kid(harmony, "bass");
  if (bass) chord += `/${text(bass, "bass-step")}${alterMark(Math.round(num(bass, "bass-alter") ?? 0))}`;
  return quoted(chord);
}

/** A lyric syllable as a `w:` token: ABC's own punctuation is escaped. */
function lyricToken(lyric: Element): string {
  const words = kids(lyric, "text").map((part) => part.textContent ?? "").join("~");
  if (!words.trim()) return "";
  const token = words.trim().replace(/([-_*|\\])/g, "\\$1").replace(/\s+/g, "~");
  const syllabic = text(lyric, "syllabic");
  return syllabic === "begin" || syllabic === "middle" ? `${token}-` : token;
}

// --- conversion ----------------------------------------------------------------

/** One ABC voice: a MusicXML voice on one staff of one part. */
interface Voice {
  staff: number;
  number: string;
  /** ABC of each measure this voice plays in; silent measures are filled later. */
  measures: Map<number, string[]>;
  lyrics: Map<number, Map<string, string[]>>;
  /** Sounded notes per measure: each is one syllable slot in every verse. */
  slots: Map<number, number>;
  verses: Set<string>;
  /** Where this voice has written up to within the current measure. */
  cursor: number;
  sounded: boolean;
  accidentals: Record<string, number>;
  chord: PendingChord | undefined;
  graces: string[];
  graceSlash: boolean;
  tuplet: { at: number; measure: number; actual: number; normal: number; count: number } | undefined;
  extend: Set<string>;
}

interface PendingChord {
  before: string;
  pitches: string[];
  after: string;
  length: string;
  space: boolean;
  closesTuplet: boolean;
  lyrics: Map<string, string> | undefined;
  rest: boolean;
}

interface PartResult {
  name: string;
  voices: Voice[];
  clefs: Map<number, string>;
  /** Inline fields at the start of a measure: per staff (clefs) and for all (key, meter). */
  staffFields: Map<string, string>;
  fields: Map<number, string>;
  bars: { left: string; right: string }[];
  lengths: number[];
  key: string;
  meter: string;
}

interface Context {
  unit: number;
  trustAccidentals: boolean;
  hasBeams: boolean;
  hasTupletMarks: boolean;
  maxMeasures: number;
  tempo: string;
  /** The tempo in force, and whether the part being read may change it. */
  lastTempo: string;
  leadPart: boolean;
  notes: Set<string>;
}

function convertPart(part: Element, name: string, context: Context): PartResult {
  const result: PartResult = {
    name, voices: [], clefs: new Map(), staffFields: new Map(), fields: new Map(),
    bars: [], lengths: [], key: "", meter: "",
  };
  const voices = new Map<string, Voice>();
  let divisions = 1;
  let fifths = 0;
  let keyAlter = keyAlterations(0);
  /** Beat and measure length as fractions of a whole note. */
  let beatWholes = 1 / 4;
  let measureWholes = 1;
  const tabStaves = new Set<number>();
  const clefShift = new Map<number, number>();
  const currentClef = new Map<number, string>();
  /** Chord symbols, dynamics and text waiting for the next note. */
  let pending = "";
  /** Inline fields (a tempo change) waiting for the next note. */
  let pendingFields = "";
  let wedge = "";

  const toLength = (duration: number): string =>
    lengthSuffix(duration, divisions * 4 * context.unit);

  const measures = kids(part, "measure").slice(0, context.maxMeasures);
  measures.forEach((measure, index) => {
    let position = 0;
    let reached = 0;
    const bar = { left: "", right: "|" };
    result.bars.push(bar);
    for (const voice of voices.values()) {
      voice.cursor = 0;
      voice.accidentals = {};
    }

    const out = (voice: Voice): string[] => {
      let list = voice.measures.get(index);
      if (!list) voice.measures.set(index, (list = []));
      return list;
    };
    const flush = (voice: Voice): void => {
      const chord = voice.chord;
      if (!chord) return;
      voice.chord = undefined;
      // A tie follows the length (c2-); inside a chord each note carries its own.
      const tie = chord.pitches.length === 1 && chord.pitches[0].endsWith("-") ? "-" : "";
      const body = chord.pitches.length > 1
        ? `[${chord.pitches.join("")}]`
        : chord.pitches[0].replace(/-$/, "");
      const list = out(voice);
      list.push(chord.before + body + chord.length + tie + chord.after + (chord.space ? " " : ""));
      if (voice.tuplet) {
        voice.tuplet.count += 1;
        if (chord.closesTuplet || voice.tuplet.count >= 9) closeTuplet(voice);
      }
      if (chord.rest) return;
      // Every sounded note takes one syllable slot in every verse.
      const slot = voice.slots.get(index) ?? 0;
      voice.slots.set(index, slot + 1);
      for (const verse of chord.lyrics?.keys() ?? []) voice.verses.add(verse);
      if (voice.verses.size === 0) return;
      let sung = voice.lyrics.get(index);
      if (!sung) voice.lyrics.set(index, (sung = new Map()));
      for (const verse of voice.verses) {
        let tokens = sung.get(verse);
        if (!tokens) sung.set(verse, (tokens = []));
        while (tokens.length < slot) tokens.push("*");
        tokens.push(chord.lyrics?.get(verse) ?? (voice.extend.has(verse) ? "_" : "*"));
      }
    };
    const closeTuplet = (voice: Voice): void => {
      const open = voice.tuplet;
      if (!open) return;
      voice.tuplet = undefined;
      const list = voice.measures.get(open.measure);
      if (list) list[open.at] = `(${open.actual}:${open.normal}:${open.count}` + list[open.at];
    };
    const voiceFor = (staff: number, number: string): Voice => {
      const key = `${staff}:${number}`;
      let voice = voices.get(key);
      if (!voice) {
        voice = {
          staff, number, measures: new Map(), lyrics: new Map(), slots: new Map(),
          verses: new Set(), cursor: 0, sounded: false,
          accidentals: {}, chord: undefined, graces: [], graceSlash: false, tuplet: undefined,
          extend: new Set(),
        };
        voices.set(key, voice);
      }
      return voice;
    };
    /** Bring a voice up to `to` with invisible rests. */
    const pad = (voice: Voice, to: number): void => {
      if (to <= voice.cursor + 1e-9) return;
      flush(voice);
      out(voice).push(restTokens("x", (to - voice.cursor) / (divisions * 4), context.unit));
      voice.cursor = to;
    };

    for (const element of kids(measure)) {
      switch (element.tagName) {
        case "attributes": {
          divisions = num(element, "divisions") ?? divisions;
          let fields = "";
          const key = kid(element, "key");
          if (key && kid(key, "fifths")) {
            fifths = Math.round(num(key, "fifths") ?? 0);
            keyAlter = keyAlterations(fifths);
            const name = keyName(fifths, text(key, "mode") || "major");
            if (index === 0 && !result.key) result.key = name;
            else fields += `[K:${name}]`;
          }
          const time = kid(element, "time");
          if (time) {
            const beats = text(time, "beats");
            const beatType = num(time, "beat-type") ?? 4;
            const symbol = time.getAttribute("symbol");
            const count = beats.split("+").reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
            const meter = !beats ? "none"
              : symbol === "common" ? "C" : symbol === "cut" ? "C|" : `${beats}/${beatType}`;
            if (count) measureWholes = count / beatType;
            // Compound meters (6/8, 9/8…) beat in dotted quarters.
            beatWholes = beatType === 8 && count % 3 === 0 ? 3 / 8 : 1 / 4;
            if (index === 0 && !result.meter) result.meter = meter;
            else fields += `[M:${meter}]`;
          }
          if (fields) result.fields.set(index, (result.fields.get(index) ?? "") + fields);
          for (const clef of kids(element, "clef")) {
            const staff = parseInt(clef.getAttribute("number") ?? "1", 10) || 1;
            const name = clefName(clef);
            if (!name) {
              tabStaves.add(staff);
              context.notes.add("Tablature staves are left out; the notes are on the staff above.");
              continue;
            }
            tabStaves.delete(staff);
            // An "8" clef is drawn as its plain clef, the notes moved to match.
            clefShift.set(staff, -(num(clef, "clef-octave-change") ?? 0));
            if (index === 0 && !result.clefs.has(staff)) result.clefs.set(staff, name);
            else if ((currentClef.get(staff) ?? "treble") !== name) {
              result.staffFields.set(`${staff}:${index}`, `[K:clef=${name}]`);
            }
            currentClef.set(staff, name);
          }
          break;
        }
        case "backup":
          for (const voice of voices.values()) flush(voice);
          position = Math.max(0, position - (num(element, "duration") ?? 0));
          break;
        case "forward":
          position += num(element, "duration") ?? 0;
          reached = Math.max(reached, position);
          break;
        case "harmony": {
          const chord = harmonyText(element);
          if (chord) pending += `"${chord}"`;
          break;
        }
        case "direction": {
          const below = element.getAttribute("placement") === "below";
          for (const type of kids(element, "direction-type")) {
            for (const mark of kids(type)) {
              if (mark.tagName === "dynamics") {
                for (const dynamic of kids(mark)) {
                  const name = dynamic.tagName === "sf" || dynamic.tagName === "sfp" ? "sfz" : dynamic.tagName;
                  pending += DYNAMICS.has(name) ? `!${name}!` : `"_${quoted(dynamic.textContent || name)}"`;
                }
              } else if (mark.tagName === "words" || mark.tagName === "rehearsal") {
                const words = quoted(mark.textContent ?? "");
                if (words) pending += `"${below ? "_" : "^"}${words}"`;
              } else if (mark.tagName === "wedge") {
                const kind = mark.getAttribute("type");
                if (kind === "crescendo" || kind === "diminuendo") {
                  wedge = kind === "crescendo" ? "<" : ">";
                  pending += `!${wedge}(!`;
                } else if (kind === "stop" && wedge) {
                  pending += `!${wedge})!`;
                  wedge = "";
                }
              } else if (mark.tagName === "segno") pending += "!segno!";
              else if (mark.tagName === "coda") pending += "!coda!";
              else if (mark.tagName === "metronome") {
                const unit = BEAT_UNITS[text(mark, "beat-unit")];
                const perMinute = parseFloat(text(mark, "per-minute").replace(/[^\d.]/g, ""));
                if (!unit || !Number.isFinite(perMinute)) continue;
                const dotted = kid(mark, "beat-unit-dot") ? 3 : 2;
                const common = gcd(unit[0] * dotted, unit[1] * 2);
                const tempo = `${(unit[0] * dotted) / common}/${(unit[1] * 2) / common}=${Math.round(perMinute)}`;
                // Every part repeats the tempo marks; the first part's count.
                if (!context.leadPart || tempo === context.lastTempo) continue;
                context.lastTempo = tempo;
                if (index === 0 && position === 0 && !context.tempo) context.tempo = tempo;
                else pendingFields += `[Q:${tempo}]`;
              }
            }
          }
          break;
        }
        case "barline": {
          const location = element.getAttribute("location") ?? "right";
          const style = text(element, "bar-style");
          const repeat = kid(element, "repeat")?.getAttribute("direction");
          const ending = kid(element, "ending");
          if (location === "left") {
            if (repeat === "forward") bar.left = "|:" + bar.left;
            if (ending?.getAttribute("type") === "start") {
              bar.left += `[${(ending.getAttribute("number") ?? "1").replace(/\s+/g, "")} `;
            }
          } else {
            if (repeat === "backward") bar.right = ":|";
            else if (style === "light-heavy") bar.right = "|]";
            else if (style === "light-light") bar.right = "||";
            else if (style === "none" || style === "dashed" || style === "dotted") bar.right = ".|";
          }
          break;
        }
        case "note": {
          const staff = parseInt(text(element, "staff"), 10) || 1;
          const duration = num(element, "duration") ?? 0;
          const isChord = !!kid(element, "chord");
          const isGrace = !!kid(element, "grace");
          if (tabStaves.has(staff) || kid(element, "cue")) {
            // Skipped, but time still passes.
            if (!isChord && !isGrace) {
              position += duration;
              reached = Math.max(reached, position);
            }
            break;
          }
          const voice = voiceFor(staff, text(element, "voice") || "1");
          const rest = kid(element, "rest");
          const pitch = kid(element, "pitch") ?? kid(element, "unpitched");
          const notations = kids(element, "notations");
          const marks = (group: string): Element[] =>
            notations.flatMap((notation) => kids(notation, group)).flatMap((holder) => kids(holder));
          const direct = (name: string): Element[] => notations.flatMap((notation) => kids(notation, name));

          // Pitch, with its accidental where the staff shows (or needs) one.
          let body = "z";
          if (rest) {
            body = element.getAttribute("print-object") === "no" ? "x" : "z";
          } else if (pitch) {
            const step = (text(pitch, "step") || text(pitch, "display-step") || "B").toUpperCase();
            const octave = (num(pitch, "octave") ?? num(pitch, "display-octave") ?? 4) + (clefShift.get(staff) ?? 0);
            const alter = Math.round(num(pitch, "alter") ?? 0);
            const slot = `${step}${octave}`;
            const current = voice.accidentals[slot] ?? keyAlter[step] ?? 0;
            const tiedIn = kids(element, "tie").some((tie) => tie.getAttribute("type") === "stop");
            const shown = context.trustAccidentals
              ? !!kid(element, "accidental")
              : alter !== current && !tiedIn;
            if (shown) voice.accidentals[slot] = alter;
            body = (shown ? ACCIDENTAL_MARK[alter] ?? "" : "") + abcPitch(step, octave);
            if (kids(element, "tie").some((tie) => tie.getAttribute("type") === "start") ||
                direct("tied").some((tie) => tie.getAttribute("type") === "start")) {
              body += "-";
            }
            voice.sounded = true;
          }

          if (isGrace) {
            const wholes = TYPE_WHOLES[text(element, "type")] ?? 1 / 8;
            const slurs = direct("slur");
            voice.graces.push(
              "(".repeat(slurs.filter((slur) => slur.getAttribute("type") === "start").length) +
                body.replace(/-$/, "") + lengthSuffix(wholes * 1024, context.unit * 1024) +
                ")".repeat(slurs.filter((slur) => slur.getAttribute("type") === "stop").length),
            );
            voice.graceSlash ||= kid(element, "grace")?.getAttribute("slash") === "yes";
            break;
          }
          if (isChord && voice.chord && !voice.chord.rest) {
            voice.chord.pitches.push(body);
            break;
          }

          flush(voice);
          pad(voice, position);

          // What is written inside a tuplet is the un-squeezed note value.
          const modification = kid(element, "time-modification");
          const actual = num(modification, "actual-notes") ?? 1;
          const normal = num(modification, "normal-notes") ?? 1;
          const squeezed = !!modification && actual !== normal;
          if (voice.tuplet && !squeezed) closeTuplet(voice);
          if (squeezed && !voice.tuplet) {
            voice.tuplet = { at: out(voice).length, measure: index, actual, normal, count: 0 };
          }
          const written = squeezed ? (duration * actual) / normal : duration;
          // Files without tuplet brackets: a group is as many notes as its ratio says.
          const closesTuplet = !!voice.tuplet && (
            direct("tuplet").some((tuplet) => tuplet.getAttribute("type") === "stop") ||
            (!context.hasTupletMarks && voice.tuplet.count + 1 >= voice.tuplet.actual)
          );

          let before = pendingFields;
          pendingFields = "";
          before += "(".repeat(direct("slur").filter((slur) => slur.getAttribute("type") === "start").length);
          if (voice.graces.length > 0 && !rest) {
            before += `{${voice.graceSlash ? "/" : ""}${voice.graces.join("")}}`;
            voice.graces = [];
            voice.graceSlash = false;
          }
          before += pending;
          pending = "";
          for (const mark of marks("articulations")) before += ARTICULATIONS[mark.tagName] ?? "";
          for (const mark of marks("ornaments")) before += ORNAMENTS[mark.tagName] ?? "";
          for (const mark of marks("technical")) {
            if (mark.tagName === "fingering" && /^[0-5]$/.test(mark.textContent?.trim() ?? "")) {
              before += `!${mark.textContent!.trim()}!`;
            } else before += TECHNICAL[mark.tagName] ?? "";
          }
          if (direct("fermata").length > 0) before += "!fermata!";
          if (direct("arpeggiate").length > 0) before += "!arpeggio!";
          const after = ")".repeat(direct("slur").filter((slur) => slur.getAttribute("type") === "stop").length);

          // Notes under one beam are written without a space between them.
          const end = position + duration;
          const beam = kids(element, "beam").find((entry) => (entry.getAttribute("number") ?? "1") === "1");
          const beamed = beam?.textContent?.trim();
          const space = context.hasBeams
            ? !(beamed === "begin" || beamed === "continue")
            : duration >= divisions || Number.isInteger(Math.round((end / (beatWholes * 4 * divisions)) * 1e6) / 1e6);

          let lyrics: Map<string, string> | undefined;
          for (const lyric of kids(element, "lyric")) {
            const verse = lyric.getAttribute("number") ?? lyric.getAttribute("name") ?? "1";
            const token = lyricToken(lyric);
            const extend = kid(lyric, "extend");
            if (token) {
              (lyrics ??= new Map()).set(verse, token);
              voice.extend.delete(verse);
            }
            if (extend && extend.getAttribute("type") !== "stop") voice.extend.add(verse);
            else if (extend) voice.extend.delete(verse);
          }

          // The printed note value is exact where durations are rounded (a
          // septuplet in 480 divisions); the duration decides when they disagree,
          // as for a "whole" rest filling a 3/4 measure.
          const typeWholes = TYPE_WHOLES[text(element, "type")];
          const dotted = typeWholes ? typeWholes * (2 - 1 / 2 ** kids(element, "dot").length) : 0;
          const writtenWholes = written / (divisions * 4);
          const length = dotted && Math.abs(dotted - writtenWholes) <= writtenWholes * 0.02
            ? lengthSuffix(Math.round(dotted * 4096), context.unit * 4096)
            : toLength(written);
          voice.chord = {
            before, pitches: [body], after, space: space || !pitch, closesTuplet, lyrics, rest: !pitch,
            length,
          };
          voice.cursor = end;
          position = end;
          reached = Math.max(reached, position);
          break;
        }
      }
    }

    // Close the measure: every voice that played fills it to the end.
    const length = reached > 0 ? reached : measureWholes * 4 * divisions;
    for (const voice of voices.values()) {
      flush(voice);
      if (voice.tuplet) closeTuplet(voice);
      if (voice.measures.has(index)) pad(voice, length);
    }
    result.lengths.push(length / (divisions * 4 * context.unit));
  });

  if (result.bars.length > 0 && kids(part, "measure").length === measures.length) {
    const last = result.bars[result.bars.length - 1];
    if (last.right === "|") last.right = "|]";
  }
  result.voices = [...voices.values()]
    .filter((voice) => voice.sounded)
    .sort((a, b) => a.staff - b.staff || a.number.localeCompare(b.number, undefined, { numeric: true }));
  return result;
}

/** Measures per line of ABC text; the sheet re-wraps them to the paper anyway. */
const MEASURES_PER_LINE = 4;

function writeVoice(part: PartResult, voice: Voice, lines: string[], unit: number): void {
  const count = part.bars.length;
  // A measure this voice sits out: the staff's first voice shows the rest,
  // further voices on that staff stay invisible.
  const first = part.voices.find((other) => other.staff === voice.staff) === voice;
  for (let start = 0; start < count; start += MEASURES_PER_LINE) {
    let music = "";
    const verses = new Map<string, string[]>();
    for (let index = start; index < Math.min(count, start + MEASURES_PER_LINE); index++) {
      const bar = part.bars[index];
      const fields = (part.fields.get(index) ?? "") + (part.staffFields.get(`${voice.staff}:${index}`) ?? "");
      const content = voice.measures.get(index)?.join("").trim()
        ?? restTokens(first ? "z" : "x", part.lengths[index] * unit, unit).trim();
      music += `${bar.left}${fields}${content} ${bar.right} `;
      // Keep the verses in step: measures without words still hold their notes' slots.
      const slots = voice.slots.get(index) ?? 0;
      for (const verse of voice.verses) {
        let tokens = verses.get(verse);
        if (!tokens) verses.set(verse, (tokens = []));
        const here = voice.lyrics.get(index)?.get(verse) ?? [];
        tokens.push(...here, ...Array.from({ length: slots - here.length }, () => "*"));
      }
    }
    lines.push(music.trim().replace(/\| \|:/g, "|:").replace(/:\| \|:/g, "::").replace(/:\|:/g, "::"));
    for (const verse of [...verses.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const tokens = verses.get(verse)!;
      while (tokens.length > 0 && (tokens[tokens.length - 1] === "*" || tokens[tokens.length - 1] === "_")) tokens.pop();
      if (!tokens.some((token) => token !== "*" && token !== "_")) continue;
      let line = "";
      for (const token of tokens) {
        if (token === "_") line = line.trimEnd() + "_ ";
        else line += token.endsWith("-") && !token.endsWith("\\-") ? token : `${token} `;
      }
      lines.push(`w: ${line.trim()}`);
    }
  }
}

function build(root: Element, maxMeasures: number): MusicXmlImport {
  const parts = kids(root, "part");
  if (parts.length === 0) throw new MusicXmlError("This MusicXML file has no parts with music in it.");

  // The most common note value becomes ABC's unit, so most notes need no length.
  const histogram = new Map<string, number>();
  for (const type of Array.from(root.querySelectorAll("note > type"))) {
    const name = type.textContent?.trim() ?? "";
    histogram.set(name, (histogram.get(name) ?? 0) + 1);
  }
  const commonest = [...histogram].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "eighth";
  const commonWholes = TYPE_WHOLES[commonest] ?? 1 / 8;
  const unit = commonWholes >= 1 / 4 ? 1 / 4 : commonWholes >= 1 / 8 ? 1 / 8 : 1 / 16;

  const context: Context = {
    unit,
    trustAccidentals: !!root.querySelector("note > accidental"),
    hasBeams: !!root.querySelector("note > beam"),
    hasTupletMarks: !!root.querySelector("notations > tuplet"),
    maxMeasures,
    tempo: "",
    lastTempo: "",
    leadPart: true,
    notes: new Set(),
  };

  const names = new Map<string, string>();
  for (const scorePart of Array.from(root.querySelectorAll("part-list > score-part"))) {
    names.set(scorePart.getAttribute("id") ?? "", text(scorePart, "part-name"));
  }
  const converted = parts
    .map((part) => {
      const result = convertPart(part, names.get(part.getAttribute("id") ?? "") ?? "", context);
      context.leadPart = false;
      return result;
    })
    .filter((part) => part.voices.length > 0);
  if (converted.length === 0) throw new MusicXmlError("This MusicXML file has no notes in it.");

  const credit = (type: string): string =>
    Array.from(root.querySelectorAll("identification > creator"))
      .find((creator) => creator.getAttribute("type") === type)?.textContent?.trim() ?? "";
  const title = quoted(
    text(kid(root, "work"), "work-title") || text(root, "movement-title") ||
    Array.from(root.querySelectorAll("credit"))
      .find((credit) => text(credit, "credit-type") === "title")
      ?.querySelector("credit-words")?.textContent || "",
  );

  const first = converted[0];
  const lines = ["X:1"];
  if (title) lines.push(`T:${title}`);
  const composer = quoted(credit("composer"));
  if (composer) lines.push(`C:${composer}`);
  const lyricist = quoted(credit("lyricist") || credit("poet"));
  if (lyricist && lyricist !== composer) lines.push(`C:Words: ${lyricist}`);
  lines.push(`M:${first.meter || "4/4"}`, `L:1/${Math.round(1 / unit)}`);
  if (context.tempo) lines.push(`Q:${context.tempo}`);

  const total = converted.reduce((sum, part) => sum + part.voices.length, 0);
  const key = first.key || "C";
  const body: string[] = [];
  if (total === 1) {
    const clef = first.clefs.get(first.voices[0].staff) ?? "treble";
    lines.push(`K:${key}${clef === "treble" ? "" : ` clef=${clef}`}`);
    writeVoice(first, first.voices[0], body, unit);
  } else {
    // One ABC voice per MusicXML voice; %%score says which share a staff
    // (round brackets) and which staves are braced as one instrument.
    let id = 0;
    const score: string[] = [];
    const definitions: string[] = [];
    for (const part of converted) {
      const staves = [...new Set(part.voices.map((voice) => voice.staff))];
      const groups = staves.map((staff) => {
        const ids = part.voices.filter((voice) => voice.staff === staff).map((voice) => {
          id += 1;
          const clef = part.clefs.get(staff) ?? "treble";
          definitions.push(`V:${id} clef=${clef}`);
          body.push(`V:${id}`);
          const start = body.length;
          writeVoice(part, voice, body, unit);
          if (part.key && part.key !== key) body[start] = `[K:${part.key}]${body[start]}`;
          return id;
        });
        return ids.length > 1 ? `(${ids.join(" ")})` : String(ids[0]);
      });
      score.push(groups.length > 1 ? `{${groups.join(" | ")}}` : groups[0]);
    }
    lines.push(`%%score ${score.join(" ")}`, ...definitions, `K:${key}`);
  }

  const measures = Math.max(...parts.map((part) => kids(part, "measure").length));
  return {
    abc: [...lines, ...body].join("\n"),
    title,
    parts: converted.length,
    measures,
    importedMeasures: Math.min(measures, maxMeasures),
    notes: [...context.notes],
  };
}

/**
 * Converts MusicXML text to ABC. With `maxChars`, a score too long for one
 * document is cut after the last whole measure that fits, and says so.
 */
export function musicXmlToAbc(xml: string, options: { maxChars?: number } = {}): MusicXmlImport {
  const parsed = new DOMParser().parseFromString(xml.replace(/^\uFEFF/, "").trimStart(), "application/xml");
  const root = parsed.documentElement;
  if (!root || parsed.querySelector("parsererror")) {
    throw new MusicXmlError("This file is not valid XML, so it cannot be read as MusicXML.");
  }
  if (root.tagName === "score-timewise") {
    throw new MusicXmlError(
      "This file uses MusicXML's rare “timewise” layout. Export it again as a regular (partwise) MusicXML file.",
    );
  }
  if (root.tagName !== "score-partwise") {
    throw new MusicXmlError("This file is XML, but not a MusicXML score.");
  }

  let result = build(root, Infinity);
  const limit = options.maxChars ?? Infinity;
  if (result.abc.length > limit) {
    let keep = Math.floor((result.measures * limit) / result.abc.length);
    while (keep >= 1) {
      result = build(root, keep);
      if (result.abc.length <= limit) break;
      keep = Math.min(keep - 1, Math.floor(keep * 0.95));
    }
    if (keep < 1 || result.abc.length > limit) {
      throw new MusicXmlError("Even the first measure of this score is too long for one document.");
    }
    result.notes.unshift(
      `The score is too long for one document: measures 1–${result.importedMeasures} of ` +
        `${result.measures} were imported. Put the rest on further music sheets.`,
    );
  }
  return result;
}

/** Text of a .musicxml / .xml file, or of the score inside a compressed .mxl. */
export async function readMusicXmlFile(file: File): Promise<string> {
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  // .mxl is a zip: its container names the score, else take the first XML.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch {
      throw new MusicXmlError("This compressed MusicXML (.mxl) file is damaged and cannot be opened.");
    }
    const container = entries["META-INF/container.xml"];
    let path = container
      ? new DOMParser().parseFromString(new TextDecoder().decode(container), "application/xml")
          .querySelector("rootfile")?.getAttribute("full-path") ?? ""
      : "";
    if (!entries[path]) {
      path = Object.keys(entries).find((name) => !name.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(name)) ?? "";
    }
    if (!entries[path]) throw new MusicXmlError("This .mxl file has no score inside it.");
    bytes = entries[path];
  }
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  return new TextDecoder(encoding).decode(bytes);
}
