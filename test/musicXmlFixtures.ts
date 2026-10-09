/** Hand-written MusicXML scores for the import tests. */

const note = (inner: string) => `<note>${inner}</note>`;
const pitch = (step: string, octave: number, alter?: number) =>
  `<pitch><step>${step}</step>${alter === undefined ? "" : `<alter>${alter}</alter>`}<octave>${octave}</octave></pitch>`;
const lyric = (verse: number, text: string, syllabic = "single") =>
  `<lyric number="${verse}"><syllabic>${syllabic}</syllabic><text>${text}</text></lyric>`;

/**
 * A lead sheet in G, 3/4, with most of what a song export carries: tempo,
 * chord symbols, two verses, a dynamic, a tie, a slur, an accidental, a
 * chord, a grace note, a triplet, a fermata, and a repeat with two endings.
 */
export const leadSheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>The Ferryman's "Round"</work-title></work>
  <identification><creator type="composer">Anon.</creator><creator type="lyricist">A. Poet</creator></identification>
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>12</divisions><key><fifths>1</fifths><mode>major</mode></key>
        <time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <barline location="left"><repeat direction="forward"/></barline>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type></direction>
      <direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type></direction>
      <harmony><root><root-step>G</root-step></root><kind>major</kind></harmony>
      ${note(`${pitch("G", 4)}<duration>12</duration><voice>1</voice><type>quarter</type>${lyric(1, "Row", "single")}${lyric(2, "Pull")}`)}
      ${note(`${pitch("B", 4)}<duration>6</duration><voice>1</voice><type>eighth</type><beam number="1">begin</beam><notations><slur type="start" number="1"/></notations>${lyric(1, "o", "begin")}${lyric(2, "on")}`)}
      ${note(`${pitch("D", 5)}<duration>6</duration><voice>1</voice><type>eighth</type><beam number="1">end</beam><notations><slur type="stop" number="1"/></notations>`)}
      <harmony><root><root-step>E</root-step></root><kind>minor-seventh</kind><bass><bass-step>B</bass-step></bass></harmony>
      ${note(`${pitch("E", 5)}<duration>12</duration><tie type="start"/><voice>1</voice><type>quarter</type><notations><tied type="start"/></notations>${lyric(1, "ver", "end")}${lyric(2, "home")}`)}
    </measure>
    <measure number="2">
      ${note(`${pitch("E", 5)}<duration>12</duration><tie type="stop"/><voice>1</voice><type>quarter</type><notations><tied type="stop"/></notations>`)}
      ${note(`${pitch("C", 5, 1)}<duration>18</duration><voice>1</voice><type>quarter</type><dot/><accidental>sharp</accidental>${lyric(1, "the")}`)}
      ${note(`<rest/><duration>6</duration><voice>1</voice><type>eighth</type>`)}
    </measure>
    <measure number="3">
      <barline location="left"><ending number="1" type="start"/></barline>
      ${note(`<grace slash="yes"/>${pitch("A", 4)}<voice>1</voice><type>eighth</type>`)}
      ${note(`${pitch("B", 4)}<duration>4</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">begin</beam><notations><tuplet type="start"/></notations>${lyric(1, "wa", "begin")}`)}
      ${note(`${pitch("A", 4)}<duration>4</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">continue</beam>${lyric(1, "ter", "end")}`)}
      ${note(`${pitch("G", 4)}<duration>4</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><beam number="1">end</beam><notations><tuplet type="stop"/></notations>${lyric(1, "wide")}`)}
      ${note(`${pitch("D", 4)}<duration>24</duration><voice>1</voice><type>half</type>`)}
      ${note(`<chord/>${pitch("F", 4, 1)}<duration>24</duration><voice>1</voice><type>half</type>`)}
      ${note(`<chord/>${pitch("A", 4)}<duration>24</duration><voice>1</voice><type>half</type>`)}
      <barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/></barline>
    </measure>
    <measure number="4">
      <barline location="left"><ending number="2" type="start"/></barline>
      ${note(`${pitch("G", 4)}<duration>36</duration><voice>1</voice><type>half</type><dot/><notations><fermata/></notations>${lyric(1, "shore.")}`)}
      <barline location="right"><bar-style>light-heavy</bar-style><ending number="2" type="discontinue"/></barline>
    </measure>
  </part>
</score-partwise>`;

/** What the lead sheet becomes. */
export const leadSheetAbc = [
  "X:1",
  "T:The Ferryman's 'Round'",
  "C:Anon.",
  "C:Words: A. Poet",
  "M:3/4",
  "L:1/8",
  "Q:1/4=96",
  "K:G",
  '|:!mf!"G"G2 (Bd) "Em7/B"e2- | e2 ^c3 z | [1 (3:2:3{/A}BAG [DFA]4 :| [2 !fermata!G6 |]',
  "w: Row o-* ver * the wa-ter wide * shore.",
  "w: Pull on * home",
].join("\n");

const measureOf = (number: number, inner: string) => `<measure number="${number}">${inner}</measure>`;
const half = (step: string, octave: number, voice: number, staff: number) =>
  note(`${pitch(step, octave)}<duration>2</duration><voice>${voice}</voice><type>half</type><staff>${staff}</staff>`);
const quarter = (step: string, octave: number, voice: number, staff: number) =>
  note(`${pitch(step, octave)}<duration>1</duration><voice>${voice}</voice><type>quarter</type><staff>${staff}</staff>`);

/**
 * A piano part: two staves, a second voice in the right hand that only
 * enters in the second measure, and a left hand reached with <backup>.
 */
export const pianoXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <movement-title>Two Hands</movement-title>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    ${measureOf(1, `<attributes><divisions>1</divisions><key><fifths>-1</fifths></key>
        <time symbol="common"><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${half("F", 4, 1, 1)}${half("A", 4, 1, 1)}
      <backup><duration>4</duration></backup>
      ${note(`${pitch("F", 2)}<duration>4</duration><voice>5</voice><type>whole</type><staff>2</staff>`)}`)}
    ${measureOf(2, `${half("C", 5, 1, 1)}${half("G", 4, 1, 1)}
      <backup><duration>4</duration></backup>
      <forward><duration>1</duration><voice>2</voice><staff>1</staff></forward>
      ${quarter("E", 4, 2, 1)}${half("D", 4, 2, 1)}
      <backup><duration>4</duration></backup>
      ${half("C", 3, 5, 2)}${half("G", 2, 5, 2)}`)}
  </part>
</score-partwise>`;

export const pianoAbc = [
  "X:1",
  "T:Two Hands",
  "M:C",
  "L:1/4",
  "%%score {(1 2) | 3}",
  "V:1 clef=treble",
  "V:2 clef=treble",
  "V:3 clef=bass",
  "K:F",
  "V:1",
  "F2 A2 | c2 G2 |]",
  "V:2",
  "x4 | x E D2 |]",
  "V:3",
  "F,,4 | C,2 G,,2 |]",
].join("\n");

/** A long single-line tune, for the size limit. */
export function longTuneXml(measures: number): string {
  const body = Array.from({ length: measures }, (_, index) => measureOf(index + 1,
    (index === 0 ? `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>` : "") +
    ["C", "D", "E", "F"].map((step) => note(`${pitch(step, 4)}<duration>1</duration><type>quarter</type>`)).join(""))).join("");
  return `<score-partwise><part-list><score-part id="P1"><part-name/></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}
