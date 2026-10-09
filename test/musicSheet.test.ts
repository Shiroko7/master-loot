import { splitTunes } from "../src/musicSheet";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`,
  );
}

equal(splitTunes(""), [], "empty content has no tunes");
equal(splitTunes(" \n\r\n  "), [], "blank content has no tunes");

equal(
  splitTunes("C D E F | G A B c |"),
  ["X:1\nK:C\nC D E F | G A B c |"],
  "bare notes get an index and a key",
);

equal(
  splitTunes("T:Song\nM:3/4\nC D E |\nw: la la la"),
  ["X:1\nT:Song\nM:3/4\nK:C\nC D E |\nw: la la la"],
  "a missing key goes after the header, not after the lyrics",
);

equal(
  splitTunes("X:7\nT:Song\nK:Dm\nD E F G |"),
  ["X:7\nT:Song\nK:Dm\nD E F G |"],
  "a complete tune is left alone",
);

equal(
  splitTunes("T:Song\r\nK:G\r\n\r\nG A B c |\r\n\r\n  d e f g |\r\n"),
  ["X:1\nT:Song\nK:G\nG A B c |\nd e f g |"],
  "blank lines (which end an ABC tune) and CRLF are removed",
);

equal(
  splitTunes("% a comment\nT:Song\nG A B c |\nK:D\nd e f g |"),
  ["X:1\n% a comment\nT:Song\nK:C\nG A B c |\nK:D\nd e f g |"],
  "a key change in the body is not mistaken for the header key",
);

equal(
  splitTunes("X:1\nT:One\nK:G\nG A B c |\n\nX:2\nT:Two\nD E F G |"),
  ["X:1\nT:One\nK:G\nG A B c |", "X:2\nT:Two\nK:C\nD E F G |"],
  "X: starts the next tune; each is repaired on its own",
);

equal(
  splitTunes("C D E F |\nX:2\nK:G\nG A B c |"),
  ["X:1\nK:C\nC D E F |", "X:2\nK:G\nG A B c |"],
  "a headerless first tune before an X: line is kept",
);

console.log("musicSheet tests passed");
