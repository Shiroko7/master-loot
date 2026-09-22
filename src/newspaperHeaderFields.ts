import type { LootDocument } from "./types";
import { parseNewspaperPages } from "./newspaperRender";
import { resolveNewspaperHeading } from "./newspaperHeading";

/** The same fields are used in the editor and browser verification. */
export function createNewspaperHeaderFields(doc: LootDocument, onChange: () => void): HTMLElement {
  const fields = document.createElement("div");
  fields.className = "newspaper-header-fields";
  const heading = resolveNewspaperHeading(doc, parseNewspaperPages(doc)[0]);
  function input(label: string, value: string, placeholder: string, hint: string, change: (value: string) => void) {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const caption = document.createElement("span");
    caption.className = "field-label";
    caption.textContent = label;
    const control = document.createElement("input");
    control.value = value;
    control.placeholder = placeholder;
    control.setAttribute("aria-label", label);
    control.oninput = () => { change(control.value); onChange(); };
    const help = document.createElement("small");
    help.className = "hint";
    help.textContent = hint;
    wrap.append(caption, control, help);
    fields.append(wrap);
    return control;
  }
  input("Newspaper name", doc.title, "e.g. The Hidden Light",
    "The publication name printed above the story. Optional.", value => { doc.title = value; });
  const headline = input("Main story headline", heading.headline, "e.g. Sect leader at centre of scandal",
    "The largest text on the front page. If blank, uses the story’s # heading.", value => {
      doc.newspaperHeadline = value;
      updateMove();
    });
  input("Story subheading", heading.deck, "e.g. Witnesses reveal what happened behind closed doors",
    "Optional supporting sentence. If blank, uses the story’s ## subheading.", value => { doc.newspaperDeck = value; });
  const issue = input("Edition, date & price", doc.newspaperIssue ?? "", "e.g. Vol. IV • 21 Midsummer • 2 cp",
    "Optional small print for publication details.", value => {
      doc.newspaperIssue = value;
      updateMove();
    });
  const move = document.createElement("button");
  move.type = "button";
  move.className = "btn newspaper-move-headline";
  move.textContent = "Use edition text as the story headline";
  move.onclick = () => {
    doc.newspaperHeadline = issue.value;
    headline.value = issue.value;
    doc.newspaperIssue = "";
    issue.value = "";
    updateMove();
    onChange();
    headline.focus();
  };
  function updateMove() { move.hidden = Boolean(headline.value.trim()) || !issue.value.trim(); }
  updateMove();
  fields.append(move);
  return fields;
}
