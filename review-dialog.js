// A decision may require a note, an additional staff form, or a server operation.
// Each caller supplies only the decisions its current user may take.
const ReviewDialog = {
  open({ host = document.body, title, subject, choices, after }) {
    if (!choices.length || document.querySelector(".review-dialog[open]"))
      return;
    const dialog = document.createElement("dialog"),
      form = document.createElement("form");
    dialog.className = "review-dialog form-approval";
    dialog.dir = "rtl";
    const heading = document.createElement("h2");
    heading.textContent = title;
    dialog.setAttribute("aria-label", title);
    const context = document.createElement("p");
    context.textContent = subject || "";
    context.hidden = !subject;
    const select = document.createElement("select");
    select.setAttribute("aria-label", "القرار");
    choices.forEach((c, i) => select.add(new Option(c.name, String(i))));
    select.hidden = choices.length === 1;
    const label = document.createElement("label"),
      caption = document.createElement("span"),
      note = document.createElement("textarea");
    note.rows = 3;
    note.maxLength = 240;
    label.append(caption, note);
    const footer = document.createElement("footer"),
      submit = document.createElement("button"),
      close = document.createElement("button"),
      status = document.createElement("output");
    close.type = "button";
    close.title = close.ariaLabel = "إلغاء";
    close.innerHTML = Archive.icon("close");
    close.onclick = () => dialog.close();
    submit.type = "submit";
    status.setAttribute("role", "status");
    let busy = false;
    const sync = () => {
      const c = choices[select.selectedIndex];
      caption.textContent = c.note || "";
      label.hidden = !c.note;
      note.required = !!c.note;
      note.value = c.value || "";
      submit.textContent = c.confirm || c.name;
      status.textContent = "";
    };
    select.onchange = sync;
    sync();
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      const c = choices[select.selectedIndex],
        value = note.value.trim();
      if (c.note && !value) {
        note.focus();
        return;
      }
      busy = submit.disabled = close.disabled = select.disabled = true;
      status.replaceChildren(Activity.indicator("جارٍ حفظ القرار"));
      try {
        await c.apply(value);
        dialog.close();
      } catch (error) {
        status.textContent = error.message;
        return;
      } finally {
        busy = submit.disabled = close.disabled = select.disabled = false;
      }
      if (after)
        try {
          await after();
        } catch (error) {
          await Feedback.notice(error.message);
        }
    };
    dialog.oncancel = (e) => {
      if (busy) e.preventDefault();
    };
    dialog.onclose = () => dialog.remove();
    footer.append(submit, close);
    form.append(heading, context, select, label, footer, status);
    dialog.append(form);
    host.append(dialog);
    dialog.showModal();
    if (!select.hidden) select.focus();
    else if (!label.hidden) note.focus();
  },
};
