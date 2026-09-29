/**
 * In-window confirmation (the app's own dialog, not the browser's), used
 * before an item actually moves so a stray click never takes something.
 */
export function confirmDialog(options: {
  title: string;
  message: string;
  confirmLabel: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    const modal = document.createElement("div");
    modal.className = "dialog-modal";
    modal.role = "dialog";
    modal.ariaModal = "true";

    const heading = document.createElement("h3");
    heading.textContent = options.title;
    const text = document.createElement("p");
    text.className = "dialog-text";
    text.textContent = options.message;

    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.className = "btn btn-gold";
    confirm.textContent = options.confirmLabel;
    actions.append(cancel, confirm);

    modal.append(heading, text, actions);
    backdrop.append(modal);
    document.body.append(backdrop);
    cancel.focus();

    const finish = (answer: boolean) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    cancel.onclick = () => finish(false);
    confirm.onclick = () => finish(true);
    backdrop.onclick = (event) => {
      if (event.target === backdrop) finish(false);
    };
  });
}
