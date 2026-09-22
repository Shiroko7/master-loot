import { NEWSPAPER_LAYOUTS, NEWSPAPER_LAYOUT_META, normalizeNewspaperLayout, type NewspaperLayout } from "./types";

/** Small composition diagrams describe the page structure before selecting it. */
export function createNewspaperLayoutPicker(
  current: NewspaperLayout | undefined,
  onChange: (layout: NewspaperLayout) => void,
): HTMLElement {
  const picker = document.createElement("fieldset");
  picker.className = "newspaper-layout-picker";
  const legend = document.createElement("legend");
  legend.textContent = "Newspaper composition";
  picker.append(legend);
  const normalized = normalizeNewspaperLayout(current);
  const selected = normalized === "split-lead" ? "auto" : normalized;
  for (const layout of NEWSPAPER_LAYOUTS) {
    const meta = NEWSPAPER_LAYOUT_META[layout];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "newspaper-layout-choice";
    button.setAttribute("aria-pressed", String(layout === selected));
    button.title = meta.description;
    const diagram = document.createElement("span");
    diagram.className = `newspaper-layout-diagram diagram-${layout}`;
    diagram.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 5; index++) diagram.append(document.createElement("i"));
    const name = document.createElement("span");
    name.textContent = meta.label;
    button.append(diagram, name);
    button.onclick = () => onChange(layout);
    picker.append(button);
  }
  const description = document.createElement("p");
  description.className = "newspaper-layout-description";
  description.textContent = NEWSPAPER_LAYOUT_META[selected].description;
  picker.append(description);
  return picker;
}
