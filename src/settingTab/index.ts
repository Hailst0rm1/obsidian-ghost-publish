import { App, PluginSettingTab, Setting } from "obsidian";
import GhostPublish from "src/main";

export class SettingTab extends PluginSettingTab {
	plugin: GhostPublish;

	constructor(app: App, plugin: GhostPublish) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl("h1", { text: "Obsidian Ghost Publish" });

		const document = containerEl.createEl("p", {
			text: `Need help or have a feature request? Look at `,
		});

		document.createEl("a", {
			attr: {
				href: "https://github.com/jaynguyens/obsidian-ghost-publish/blob/master/README.md",
			},
			text: "the documentation",
		});

		const donation = containerEl.createEl("p", {
			text: "You can support future development by ",
		});

		donation.createEl("a", {
			attr: {
				href: "https://www.buymeacoffee.com/jaynguyens",
			},
			text: "donating to me",
		});

		const note = containerEl.createEl("p", {
			text: "* - Required"
		})

		containerEl.createEl("br");

		new Setting(containerEl)
			.setName("API URL *")
			.setDesc(
				"Your full URL to reach the API e.g: https://example.com or https://admin.example.com."
			)
			.addText((text) =>
				text
					.setPlaceholder("https://example.com")
					.setValue(this.plugin.settings.url)
					.onChange(async (value) => {
						console.log("Blog URL: " + value);
						this.plugin.settings.url = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Admin API Key *")
			.setDesc("Your custom integration Admin API Key. See https://ghost.org/integrations/custom-integrations/.")
			.addText((text) =>
				text
					.setPlaceholder("6251555c94ca6...")
					.setValue(this.plugin.settings.adminToken)
					.onChange(async (value) => {
						console.log("admin api key: " + value);
						this.plugin.settings.adminToken = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Base URL")
			.setDesc("Your website/blog URL, if it varies from your admin URL e.g.: you make api requests to https://admin.example.com but your blog is located at https://example.com.")
			.addText((text) =>
				text
					.setPlaceholder("https://blog.com")
					.setValue(this.plugin.settings.baseURL)
					.onChange(async (value) => {
						console.log("Base URL: " + value);
						this.plugin.settings.baseURL = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Image Folder")
			.setDesc("Your image folder e.g: /images (no trailing slash)")
			.addText((text) =>
				text
					.setPlaceholder("/images")
					.setValue(this.plugin.settings.imageFolder)
					.onChange(async (value) => {
						console.log("Screenshots Folder: " + value);
						this.plugin.settings.imageFolder = value;
						await this.plugin.saveSettings();
					})
			);

	}
}
