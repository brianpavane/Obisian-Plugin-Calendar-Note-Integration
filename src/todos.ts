/**
 * @file todos.ts
 * @description My To-Dos: one checklist note in the Meeting Hub for tasks
 * that didn't come from a meeting. Its items count as the user's own in the
 * Meeting Tracker's Focus, the action items panel and the weekly review.
 * The "Add a to-do" box adds one without opening the note.
 */

import { App, Modal, Setting } from "obsidian";
import { actionLine, type ActionItem } from "./assistant";
import { appendToSection } from "./sections";

export const TODOS_FILENAME = "My To-Dos.md";
export const TODOS_TYPE = "meeting-todos";
export const TODOS_TITLE = "My To-Dos";
const TODOS_SECTION = "To-dos";

export interface NewTodo {
  text: string;
  /** YYYY-MM-DD */
  due?: string;
  priority?: ActionItem["priority"];
}

export function newTodosNote(): string {
  return [
    "---",
    `type: ${TODOS_TYPE}`,
    "tags:",
    `  - ${TODOS_TYPE}`,
    "---",
    "",
    `# ${TODOS_TITLE}`,
    "",
    "*Tasks that didn't come from a meeting. Add one here, or from anywhere with **Add a to-do**. They're ranked with your meeting items in the Meeting Tracker's Focus.*",
    "",
    `## ${TODOS_SECTION}`,
    "",
  ].join("\n");
}

/** The note with the to-do added at the end of its To-dos section, stamped with `today` as its created date. */
export function addTodo(content: string, todo: NewTodo, today: string): string {
  const line = actionLine({ task: todo.text.trim(), due: todo.due, priority: todo.priority }, today);
  return appendToSection(content, [TODOS_SECTION], [line]);
}

const PRIORITIES: Array<[string, string]> = [
  ["", "No priority"],
  ["High", "High ⏫"],
  ["Medium", "Medium 🔼"],
  ["Low", "Low 🔽"],
  ["Someday", "Someday ⏬"],
];

export class AddTodoModal extends Modal {
  constructor(app: App, private readonly onSubmit: (todo: NewTodo) => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Add a to-do");
    const todo: NewTodo = { text: "" };
    const submit = () => {
      if (!todo.text.trim()) return;
      this.close();
      this.onSubmit(todo);
    };
    new Setting(this.contentEl).setName("To-do").addText((text) => {
      text.setPlaceholder("What needs doing").onChange((value) => (todo.text = value));
      text.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
      window.setTimeout(() => text.inputEl.focus());
    });
    new Setting(this.contentEl).setName("Due").setDesc("Optional").addText((text) => {
      text.inputEl.type = "date";
      text.onChange((value) => (todo.due = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined));
    });
    new Setting(this.contentEl).setName("Priority").addDropdown((dropdown) => {
      for (const [value, label] of PRIORITIES) dropdown.addOption(value, label);
      dropdown.onChange((value) => (todo.priority = (value || undefined) as NewTodo["priority"]));
    });
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Add").setCta().onClick(submit));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
