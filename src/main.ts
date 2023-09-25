import { MarkdownView, Notice, Plugin, TFile, App, Modal, Vault, Setting } from "obsidian";

import { DEFAULT_SETTINGS, SettingsProp } from "./types/index";
import { SettingTab } from "./settingTab";
import { publishPost } from "./methods/publishPost";
export default class GhostPublish extends Plugin {
	settings: SettingsProp;

	async onload() {
		// load the settings first
		await this.loadSettings();

		// 2 ways to publish:
		// 1. Click on the ghost icon on the left
		this.addRibbonIcon("ghost", "Publish Ghost", () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) {
				new Notice(
					"Open the markdown file first before publish your post"
				);
				return;
			}

			publishPost(view, this.settings);
		});

		// 2. Run the by command + P
		this.addCommand({
			id: "publish",
			name: "Publish current document",
			editorCallback: (_, view: MarkdownView) => {
				if (!view) {
					new Notice(
						"Open the markdown file first before publish your post"
					);
					return;
				}

				publishPost(view, this.settings);
			},
		});

		this.addCommand({
			id: "move-image-under-cursor",
			name: "Move image under cursor",
			editorCallback: async (editor, view: MarkdownView) => {
				if (!view) {
					new Notice("No active view");
					return;
				}

				const cursorPos = editor.getCursor();
				const lineText = editor.getLine(cursorPos.line);
				const match = /!\[\[(.+)\]\]/.exec(lineText);

				if (!match || !match[1]) {
					console.error(
						"No valid file link found at cursor position"
					);
					return;
				}

				const fileName = match[1];

				try {
					// Get abstract representation of source file based on its path
					const sourceFilePath = `${this.settings.imageFolder}/${fileName}`;
					const sourceFile: TFile | null =
						(await this.app.vault.getAbstractFileByPath(
							sourceFilePath
						)) as TFile;

					if (!sourceFile) {
						console.error(`Could not find file ${fileName}`);
						return;
					}

					// Move/rename the file by changing its parent folder
					// const newParentFolderName = this.settings.attachmentsFolder;


					// let renamedFile = sourceFile.name;

					// const result = await renameFileModal(
					// 	this.app,
					// 	this.app.vault,
					// 	sourceFile.name
					// );

					// if (result) {
					// 	if (result !== sourceFile.name && result !== "") {
					// 		renamedFile = result;
					// 	}
					// } else {
					// 	return;
					// }


					// this.app.fileManager.renameFile(
					// 	sourceFile,
					// 	`${newParentFolderName}/${renamedFile}.png`
					// );



					// console.log(
					// 	`Successfully moved/renamed ${fileName} to ${newParentFolderName}/${renamedFile}.png`
					// );
				} catch (error) {
					console.error(error);
				}
			},
		});

		this.addCommand({
			id: "replace roles with names",
			name: "Replace roles with names",
			editorCallback: async (editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				const replaced = selection.replace(/role::assistant/g, "**GPT:**").replace(/role::user/g, "**Bram:**");

				/*
				---
				title: "Test"
				---

				post

				converted to

				```
				---
				title: "Test"
				---
				```
				post
				*/


				const surroundYAMLWithBackticks = (text: string) => {
					const lines = text.split("\n");
					const yamlLines = [];
					let yaml = false;
					for (const line of lines) {
						if (line.startsWith("---")) {
							yaml = !yaml;
						}
						if (yaml) {
							yamlLines.push(line);
						}
					}
					if (yamlLines.length > 0) {
						return "```\n" + yamlLines.join("\n") + "\n---\n```\n" + text.replace(yamlLines.join("\n") + "\n---", "");
					}
					return text;
				}
					
				editor.replaceSelection(surroundYAMLWithBackticks(replaced));
			},
		})

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {}
	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

export const renameFileModal = async (
	app: App,
	vault: Vault,
	fileName: string,
) => {
	const folderCreationModal = new FileRenameModal(
		app,
		fileName
	);

	folderCreationModal.open();
	const result = await folderCreationModal.waitForModalValue();

    return result;
};

class FileRenameModal extends Modal {
	result: string;
	fileName: string;
	modalPromise: Promise<string>;
	resolveModalPromise: (value: string) => void;

	constructor(
		app: App,
		fileName: string
	) {
		super(app);

		this.result = fileName;
		this.modalPromise = new Promise((resolve) => {
			this.resolveModalPromise = resolve;
		});
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl("h2", {
			text: `Rename image`,
		});

        new Setting(contentEl).addText((text) =>
			text
				.setPlaceholder("File Name")
				.setValue(this.fileName)
				.onChange((value) => {
					this.fileName = value;
				})
		);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Submit")
				.setTooltip("Rename File")
				.setCta()
				.onClick(() => {
					this.resolveModalPromise(this.fileName);
					this.close();
				})
		);


	}

	waitForModalValue() {
		return this.modalPromise;
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}