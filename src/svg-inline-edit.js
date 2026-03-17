// src/svg-inline-edit.js
import { svgEl } from "./geometry.js";
import { setInlineEditing } from "./ui_state.js";

let activeSvgEdit = null;

function closeSvgEdit(commit) {
  if (!activeSvgEdit) return;
  const { group, onCommit, buffer, onKeyDown, onPointerDown } = activeSvgEdit;
  if (commit) {
    const value = Number(buffer);
    if (Number.isFinite(value)) {
      onCommit(value);
    }
  }
  if (onKeyDown) document.removeEventListener("keydown", onKeyDown);
  if (onPointerDown) document.removeEventListener("pointerdown", onPointerDown, true);
  group.remove();
  activeSvgEdit = null;
  setInlineEditing(false);
}

function updateEditText() {
  if (!activeSvgEdit) return;
  const { textEl, buffer, prefix } = activeSvgEdit;
  textEl.textContent = `${prefix || ""}|${buffer}`;
}

export function startSvgEdit({ svg, x, y, angle = 0, value, onCommit, onCancel, textStyle, anchor = "middle", prefix = "" }) {
  closeSvgEdit(false);

  const group = svgEl("g", { "data-inline-edit": "true" });
  if (angle) {
    group.setAttribute("transform", `rotate(${angle} ${x} ${y})`);
  }
  const textEl = svgEl("text", { ...textStyle, x, y, "text-anchor": anchor, "dominant-baseline": "middle" });
  group.appendChild(textEl);
  svg.appendChild(group);

  activeSvgEdit = {
    group,
    textEl,
    buffer: Number.isFinite(value) ? value.toFixed(2) : String(value ?? ""),
    onCommit,
    onCancel,
    prefix,
    replaceOnType: true
  };

  updateEditText();
  setInlineEditing(true);

  const onKeyDown = (e) => {
    if (!activeSvgEdit) return;
    if (e.key === "Enter") {
      e.preventDefault();
      closeSvgEdit(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeSvgEdit(false);
      if (activeSvgEdit?.onCancel) activeSvgEdit.onCancel();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      if (activeSvgEdit.replaceOnType) {
        activeSvgEdit.buffer = "";
        activeSvgEdit.replaceOnType = false;
      } else {
        activeSvgEdit.buffer = activeSvgEdit.buffer.slice(0, -1);
      }
      updateEditText();
      return;
    }
    if (e.key.length === 1) {
      const ch = e.key === "," ? "." : e.key;
      if (/^[0-9.\-]$/.test(ch)) {
        e.preventDefault();
        if (activeSvgEdit.replaceOnType) {
          activeSvgEdit.buffer = ch;
          activeSvgEdit.replaceOnType = false;
          updateEditText();
          return;
        }
        if (ch === "-" && activeSvgEdit.buffer.length > 0) return;
        if (ch === "." && activeSvgEdit.buffer.includes(".")) return;
        activeSvgEdit.buffer += ch;
        updateEditText();
      }
    }
  };

  const onPointerDown = (e) => {
    if (!activeSvgEdit) return;
    if (e.composedPath().includes(group)) return;
    closeSvgEdit(true);
    if (activeSvgEdit?.onCancel) activeSvgEdit.onCancel();
  };

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown, true);

  activeSvgEdit.onKeyDown = onKeyDown;
  activeSvgEdit.onPointerDown = onPointerDown;
}

let activeSvgTextEdit = null;

function closeSvgTextEdit(commit) {
  if (!activeSvgTextEdit) return;
  const { group, onCommit, onCancel, buffer, onKeyDown, onPointerDown } = activeSvgTextEdit;
  if (commit && buffer.trim()) {
    onCommit(buffer);
  } else if (!commit && onCancel) {
    onCancel();
  }
  if (onKeyDown) document.removeEventListener("keydown", onKeyDown);
  if (onPointerDown) document.removeEventListener("pointerdown", onPointerDown, true);
  group.remove();
  activeSvgTextEdit = null;
  setInlineEditing(false);
}

function updateTextEditDisplay() {
  if (!activeSvgTextEdit) return;
  const { textEl, buffer } = activeSvgTextEdit;
  textEl.textContent = buffer + "|";
}

/**
 * Start inline text editing for arbitrary text (not just numbers)
 */
export function startSvgTextEdit({ svg, x, y, value, onCommit, onCancel, textStyle, anchor = "middle" }) {
  closeSvgTextEdit(false);
  closeSvgEdit(false);

  const group = svgEl("g", { "data-inline-edit": "true" });
  const textEl = svgEl("text", { ...textStyle, x, y, "text-anchor": anchor, "dominant-baseline": "middle" });
  group.appendChild(textEl);
  svg.appendChild(group);

  activeSvgTextEdit = {
    group,
    textEl,
    buffer: String(value ?? ""),
    onCommit,
    onCancel,
    replaceOnType: true
  };

  updateTextEditDisplay();
  setInlineEditing(true);

  const onKeyDown = (e) => {
    if (!activeSvgTextEdit) return;
    if (e.key === "Enter") {
      e.preventDefault();
      closeSvgTextEdit(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeSvgTextEdit(false);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      if (activeSvgTextEdit.replaceOnType) {
        activeSvgTextEdit.buffer = "";
        activeSvgTextEdit.replaceOnType = false;
      } else {
        activeSvgTextEdit.buffer = activeSvgTextEdit.buffer.slice(0, -1);
      }
      updateTextEditDisplay();
      return;
    }
    // Accept any printable character
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (activeSvgTextEdit.replaceOnType) {
        activeSvgTextEdit.buffer = e.key;
        activeSvgTextEdit.replaceOnType = false;
      } else {
        activeSvgTextEdit.buffer += e.key;
      }
      updateTextEditDisplay();
    }
  };

  const onPointerDown = (e) => {
    if (!activeSvgTextEdit) return;
    if (e.composedPath().includes(group)) return;
    closeSvgTextEdit(true);
  };

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown, true);

  activeSvgTextEdit.onKeyDown = onKeyDown;
  activeSvgTextEdit.onPointerDown = onPointerDown;
}

/** Cancel the current inline edit without committing. */
export function cancelSvgEdit() {
  closeSvgEdit(false);
  closeSvgTextEdit(false);
}

/** Commit the current inline edit. */
export function commitSvgEdit() {
  closeSvgEdit(true);
  closeSvgTextEdit(true);
}
