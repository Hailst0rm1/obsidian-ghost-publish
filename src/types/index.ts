export interface SettingsProp {
	url: string;
	adminToken: string;
	baseURL: string;
	imageFolder: string;
	firstAsFeatured: boolean;
}

export const DEFAULT_SETTINGS: SettingsProp = {
	url: "",
	adminToken: "",
	baseURL: "",
	imageFolder: "",
	firstAsFeatured: true,
};

export interface ContentProp {
	title: string;
	tags?: string[];
	featured?: boolean;
	status: string;
	excerpt?: string | undefined;
	feature_image?: string;
}

export interface DataProp {
	content: string;
}
