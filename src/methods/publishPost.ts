/* eslint-disable @typescript-eslint/no-var-requires */
import { SettingsProp, ContentProp, DataProp } from "./../types/index";
import { MarkdownView, Notice, request, FileSystemAdapter, RequestUrlParam, SettingTab, PluginSettingTab } from "obsidian";
import { sign } from "jsonwebtoken";
import { parse } from 'node-html-parser';
import * as fs from 'fs/promises';
import { access } from "fs";
const FormData = require('form-data');

const md_footnote = require("markdown-it-footnote");
const matter = require("gray-matter");
const MarkdownIt = require("markdown-it");
const GhostAdminAPI = require("@tryghost/admin-api");

const sendToGhost = true; // set to false to test locally

const md = new MarkdownIt({
	html: true,
}).use(md_footnote);

const version = "v4";

const contentPost = (frontmatter: ContentProp, data: DataProp) => ({
	posts: [
		{
			...frontmatter,
			html: md.render(data.content),
		},
	],
});

const contentPage = (frontmatter: ContentProp, data: DataProp) => ({
	pages: [
		{
			...frontmatter,
			html: md.render(data.content),
		},
	],
});

const replaceListsWithHTMLCard = (content: string) => {
	// Ghost swallows the list for some reason, so we need to replace them with a HTML card

	let parsedContent = parse(content);
	// add font family var(--font-serif) to lists > li and replace content
	const li = parsedContent.querySelectorAll('li').filter(li => {
		return li.attributes.class !== 'footnotes-list';
	});
	li.forEach(li => {
		li.setAttribute('style', 'font-family: var(--font-serif)');
	});

	content = parsedContent.toString();
	parsedContent = parse(content); // i couldnt think of a better way to do this lmao

	const lists = parsedContent.querySelectorAll('ul, ol').filter(list => {
		return list.parentNode.tagName === null && list.attributes.class !== 'footnotes-list';
	});

	// wrap list in HTML card const htmlCard = `<!--kg-card-begin: html--><div class="kg-card-markdown">${list[0]}</div><!--kg-card-end: html-->`;
	lists.forEach(list => {
		const htmlCard = `<!--kg-card-begin: html--><div>${list.outerHTML}</div><!--kg-card-end: html-->`;
		content = content.replace(list.outerHTML, htmlCard);
	});

	return content;
};

// run all replacers on the content
const replacer = (content: string) => {
	content = replaceListsWithHTMLCard(content);
	content = replaceFootnotesWithHTMLCard(content);
	content = replaceCalloutWithHTMLCard(content);
	content = replaceImageWithHTMLCard(content);

	return content;
};

const replaceCalloutWithHTMLCard = (content: string) => {
	
	const calloutCards = content.match(/<div class="callout-(.*?)<\/div><\/div><\/div>/gs);
	if (calloutCards) {
		for (const callout of calloutCards) {
			const htmlCard = `<!--kg-card-begin: html-->${callout}<!--kg-card-end: html-->`;
			content = content.replace(callout, htmlCard);
		}
	}

	return content;
};

const replaceImageWithHTMLCard = (content: string) => {
	
	const images = content.match(/<figure class="kg-card kg-image-card"><label><input type="checkbox">(.*?)<\/figcaption><\/figure>/gs);
	if (images) {
		for (const image of images) {
			const htmlCard = `<!--kg-card-begin: html-->${image}<!--kg-card-end: html-->`;
			content = content.replace(image, htmlCard);
		}
	}

	return content;
};



const replaceFootnotesWithHTMLCard = (content: string) => {
	// Ghost swallows the footnote links for some reason, so we need to replace them with a HTML card
	/*
	<hr class="footnotes-sep">
	<section class="footnotes">
	<ol class="footnotes-list">
	<li id="fn1" class="footnote-item"><p>test <a href="#fnref1" class="footnote-backref">↩︎</a></p>
	</li>
	<li id="fn2" class="footnote-item"><p>test2 <a href="#fnref2" class="footnote-backref">↩︎</a></p>
	</li>
	</ol>
	</section>

	needs to be surrounded with `<!--kg-card-begin: html-->` and `<!--kg-card-end: html-->`
	*/

	const footnotes = content.match(
		/<hr class="footnotes-sep">(.*)<\/section>/s
	);
	if (footnotes) {
		const htmlCard = `<!--kg-card-begin: html--><div class="kg-card-markdown">${footnotes[0]}</div><!--kg-card-end: html-->`;
		content = content.replace(
			/<hr class="footnotes-sep">(.*)<\/section>/s,
			htmlCard
		);

		//  the footnote links
		content = content.replace(/<a href="#fnref.*<\/a>/g, "");
	}

	return content;
};

const openInBrowser = (url: string) => {
	const a = document.createElement("a");
	a.href = url;
	a.target = "_blank";
	a.rel = "noopener noreferrer";
	a.click();
};

export const publishPost = async (
	view: MarkdownView,
	settings: SettingsProp
) => {

	// Configure Ghost SDK (https://github.com/TryGhost/SDK)
	const api = new GhostAdminAPI({
		url: settings.url,
		key: settings.adminToken,
		version: version
	});

	// Ghost Url and Admin API key
	const key = settings.adminToken;
	const [id, secret] = key.split(":");

	// Create the token (including decoding secret)
	const token = sign({}, Buffer.from(secret, "hex"), {
		keyid: id,
		algorithm: "HS256",
		expiresIn: "5m",
		audience: `/${version}/admin/`,
	});

	// Get frontmatter
	const noteFile = app.workspace.getActiveFile();
	const metaMatter = app.metadataCache.getFileCache(noteFile).frontmatter;
	const data = matter(view.getViewData());

	const frontmatter = {
		type: metaMatter?.type || "post",
		title: metaMatter?.title || view.file.basename,
		slug: (metaMatter?.slug || metaMatter?.title || view.file.basename).toLowerCase().replace(/\s+/g, "-"),
		tags: metaMatter?.tags || [],
		featured: metaMatter?.featured || false,
		status: metaMatter?.published ? "published" : "draft",
		visibility: metaMatter?.access || "public",
		custom_excerpt: metaMatter?.excerpt || undefined,
		feature_image: metaMatter?.feature_image || undefined,
		meta_title: metaMatter?.meta_title || view.file.basename,
		meta_description: metaMatter?.meta_description || undefined,
		canonical_url: metaMatter?.canonical_url || undefined,
		imageDirectory: metaMatter?.imageDirectory || undefined,
		imageUpload: metaMatter?.imageUpload || false,
		updated_at: metaMatter?.updated_at || undefined,
		"date modified": metaMatter && metaMatter["date modified"] ? metaMatter["date modified"] : undefined,
		imagesYear: metaMatter && metaMatter["ghost-images-year"] ? metaMatter["ghost-images-year"] : undefined,
		imagesMonth: metaMatter && metaMatter["ghost-images-month"] ? metaMatter["ghost-images-month"] : undefined,
	};

	let type: string;
	if (frontmatter.type == "post") {
		type = "posts";
	} else if (frontmatter.type == "page") {
		type = "pages";
	} else {
		new Notice('The type given is neither "post" or "page"');
		return;
	}

	let BASE_URL: string;
	if (settings.baseURL) {
		BASE_URL = settings.baseURL;
	} else {
		BASE_URL = settings.url;
	}

	if (frontmatter.custom_excerpt && frontmatter.custom_excerpt.length > 300) {
		new Notice("Excerpt is too long. Max 300 characters.");
		return;
	}

	async function uploadImages(html: string) {
		// Find images that Ghost Upload supports
		let imageRegex = /!\[\[(.*?)\]\]/g;

		// Get full-path to images
		let imageDirectory: string;
		let adapter = app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			imageDirectory = adapter.getBasePath(); // Vault directory
			if (settings.imageFolder) {
				imageDirectory = `${imageDirectory}${settings.imageFolder}`;
			}
			if (frontmatter.imageDirectory) { // Extends the image directory
				imageDirectory = `${imageDirectory}${frontmatter.imageDirectory}`;
			}
		}

		let result: RegExpExecArray | null; // Declare the 'result' variable

		while((result = imageRegex.exec(html)) !== null) {
			let imagePath = `${imageDirectory}/${result[1]}`;
			let filename = result[1];

			// Make sure it's only filename
			if (filename.includes('/')) {
				filename = filename.split('/').pop();
				imagePath = `${imageDirectory}/${filename}`;
			}
			if (filename.includes('\\')) {
				filename = filename.split('\\').pop();
				imagePath = `${imageDirectory}/${filename}`;
			}

			// If extended directory - add image prefix
			if (frontmatter.imageDirectory) {
				filename = `${frontmatter.imageDirectory.replace(/\//g, "")}-${filename}`;
			}

			// Get the image data buffer
			const fileContent = await fs.readFile(imagePath);

			// Determine the file type based on the filename's extension
			const fileExtension = filename.split('.').pop();
			let fileType = '';

			if (fileExtension === 'png') {
			fileType = 'image/png';
			} else if (fileExtension === 'jpeg' || fileExtension === 'jpg') {
			fileType = 'image/jpeg';
			} // Add more file types if needed

			// Make blob of buffer to allow formdata.append
			const blob = new Blob([fileContent], { type: fileType });

			console.log("image-filename", filename);
			const formData = new FormData();
			formData.append("file", blob, filename);
			formData.append("purpose", "image");
			formData.append("ref", filename);

			try {
				const response = await fetch(`${settings.url}/ghost/api/admin/images/upload/`, {
					method: "POST",
					headers: {
						Authorization: `Ghost ${token}`,
						'Accept-Version': `${version}.0`
					},
					body: formData
				});
				if (response.ok) {
					// Handle success
					const data = await response.json();
					console.log("success image response", data);
				} else {
					// Handle errors
					console.error("Error:", response.statusText);
					console.error("Error:", response.statusText);
					console.error("Status Code:", response.status); // Add status code
					console.error("Response Headers:", response.headers); // Log response headers
					response.text().then(errorText => {
						console.error("Error Response Text:", errorText); // Log the response body as text
					}).catch(error => {
						console.error("Error parsing response text:", error);
					});
				}
			} catch (error) {
				console.error("Request error:", error);
			}
		}
	}

	// Replaces all images and sound with html
	const wikiLinkReplacer = (match: any, p1: string) => {
		if (
			p1.toLowerCase().includes(".png") ||
			p1.toLowerCase().includes(".jpg") ||
			p1.toLowerCase().includes(".jpeg") ||
			p1.toLowerCase().includes(".gif")
		) {
			try {
				let year;
				let month;
				if (frontmatter.imagesYear && frontmatter.imagesMonth) {
					year = frontmatter.imagesYear;
					month = frontmatter.imagesMonth;

					if (month < 10) {
						month = `0${month}`;
					}
				} else {
					// get the year
					year = new Date().getFullYear();
					// get the month
					const monthNum = new Date().getMonth() + 1;
					month = monthNum.toString();
					if (monthNum < 10) {
						month = `0${monthNum}`;
					}
				}

				// To avoid naming collision we add a prefix of the extended image directory
				let htmlImage;
				if (frontmatter.imageDirectory) {
					const imageNamePrefix = frontmatter.imageDirectory.replace(/\//g, "");
					htmlImage = `<figure class="kg-card kg-image-card"><label><input type="checkbox"><img src="${BASE_URL}/content/images/${year}/${month}/${imageNamePrefix}-${p1
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}" alt="${p1
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}"></img></label><figcaption>${p1}</figcaption></figure>`
				} else {
					htmlImage = `<figure class="kg-card kg-image-card"><label><input type="checkbox"><img src="${BASE_URL}/content/images/${year}/${month}/${p1
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}" alt="${p1
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}"></img></label><figcaption>${p1}</figcaption></figure>`
				}
				return htmlImage;
			} catch (err) {
				console.log("is404Req", err);
			}
		} else if (
			p1.toLowerCase().includes(".m4a") ||
			p1.toLowerCase().includes(".mp3") ||
			p1.toLowerCase().includes(".wav")
		) {
			let year;
			let month;
			if (frontmatter.imagesYear && frontmatter.imagesMonth) {
				year = frontmatter.imagesYear;
				month = frontmatter.imagesMonth;

				if (month < 10) {
					month = `0${month}`;
				}
			} else {
				// get the year
				year = new Date().getFullYear();
				// get the month
				const monthNum = new Date().getMonth() + 1;
				month = monthNum.toString();
				if (monthNum < 10) {
					month = `0${monthNum}`;
				}
			}

			return `<div class="kg-card kg-audio-card">
			<div class="kg-audio-player-container"><audio src="${BASE_URL}/content/media/${year}/${month}/${p1
				.replace(/ /g, "-")
				.replace(
					/%20/g,
					"-"
				)}" preload="metadata"></audio><div class="kg-audio-title">${p1
				.replace(".m4a", "")
				.replace(".wav", "")
				.replace(
					".mp3",
					""
				)}</div></div></div>`;
		}


		let page;
		let header;
		let [link, text] = p1.split("|");

		if (link.includes("#")) {
			[page, header] = link.split("#");
			if (!page) {
				// Same page referense [[#Header]]
				return `<a href="#${header.replace(/ /g, "-").toLowerCase()}">${header}</a>`
			}
		}
		

		// Get frontmatter of the linked note
		let linkedNote;
		let linkedNoteMeta;
		try {
			linkedNote = app.metadataCache.getFirstLinkpathDest(page || link, noteFile.path);
			linkedNoteMeta = app.metadataCache.getFileCache(linkedNote)?.frontmatter;

			// Get full url from frontmatter
			let uri = (linkedNoteMeta?.slug || linkedNoteMeta?.title || view.file.basename).toLowerCase().replace(/\s+/g, "-");
			if (header && uri) {
				uri += `#${header.replace(/ /g, "-").toLowerCase()}`
			}

			const url = `${BASE_URL}/${uri}` || `${BASE_URL}/${page}#${header}`;
			const linkText = text || header || page || link;
			const linkHTML = `<a href="${url}">${linkText}</a>`;	
		
			return linkHTML;		
		} catch (error) {
			console.error("No link found:", error);
			console.error("Link name:", link);
			return `[[${p1}]]`; // Return p1 enclosed in double square brackets
		}
	}

	console.log("data-content (pre img upload)", data.content);
	console.log("imageUpload", frontmatter.imageUpload);
	if (frontmatter.imageUpload) {
		uploadImages(data.content);
	}

	// Removes the first image of the file (it's used as a featured_image in my notes and it's main use here is to upload in the previous function)
	data.content = data.content.replace(/!\[\[(.*?)\]\]/, "");

	// convert [[link]] to <a href="BASE_URL/id" class="link-previews">Internal Micro</a>for Ghost
	const content = data.content.replace(
		/!?\[\[(.*?)\]\]/g,
		wikiLinkReplacer
	);

	data.content = content;

	data.content = data.content.replace(
		/((?:http(?:s)?:\/\/)?(?<!(?:(?:href|src|xmlns)="\s*|\]\()(?:http(?:s)?:\/\/)?(?:www\.)?)\b(?:[-a-zA-Z0-9@:%_\+~#=]\.?){2,256}\.(?!(pdf|doc|docx|xls|xlsx|ppt|pptx|jpg|jpeg|png|gif|txt|rtf|html|htm|csv|xml|zip|rar|7z|tar|gz|mp3|mp4|avi|mov|mkv|flv|wav|ogg|flac|mpg|mpeg|bmp|tif|tiff|eps|ai|psd|svg|css|js|php|asp|py|cpp|java|jar|bat|sh|log|json|yaml|ini|cfg|db|sql|sqlite|pdf|djvu|txt|rtf|html|md|epub|pptm|pptx|docm|dotx|xlsx|xlsm|xlsb|odt|ods|odp|odg|pptx|pptm|odp|txt|ini|json|csv|sql|sqlitedb|tar|gz|xml|yaml|yml|jpg|jpeg|png|bmp|gif|tiff|doc|docx|pdf|xls|xlsx|ppt|pptx|log|zip|html|css|js|php|asp|svg|psd|ico|cur|wav|mp3|avi|mp4|mkv|mov|flv|exe|msi|bat|cmd|jar|app|deb|rpm|sh|vb|vbs|bin|so|tar.gz|tgz|ko|elf|sh|bash|zsh|cli|dev.log))[a-z]{2,6}\b(?:[-a-zA-Z0-9@:%_\+.~#?&//=]*))/g,
		(match: any, p1: string) => {
			return `<a href="${p1}">${p1}</a>`;
		}
	)


	// convert youtube embeds to ghost embeds
	data.content = data.content.replace(
		/<iframe.*src="https:\/\/www.youtube.com\/embed\/(.*?)".*<\/iframe>/g,
		(match: any, p1: string) => {
			return `<figure class="kg-card kg-embed-card"><div class="kg-embed-card"><iframe width="560" height="315" src="https://www.youtube.com/embed/${p1}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div></figure>`;
		}
	);

	// take the url from view tweet format and replace the entire blockquote with a tweet embed iframe
	// add a new line before every ([View Tweet]
	// data.content = data.content.replace(
	// 	/\(\[View Tweet\]/gm,
	// 	"\n([View Tweet]"
	// );

	// data.content = data.content.replace(
	// 	/(^>.*\n.*)*\(https:\/\/twitter.com\/(.*)\/status\/(\d+)\)\)/gm,
	// 	(match: any, p1: string, p2: string, p3: string) => {
	// 		console.log("p1", p1);
	// 		console.log("p2", p2);

	// 		const url = `https://twitter.com/${p2}/status/${p3}?ref_src=twsrc%5Etfw`;
	// 		return `<figure class="kg-card kg-embed-card"><div class="twitter-tweet twitter-tweet-rendered"><iframe src="${url}" width="550" height="550" frameborder="0" scrolling="no" allowfullscreen="true" style="border: none; max-width: 100%; min-width: 100%;"></iframe></div></figure>`;
	// 	}
	// );

	// replace ==highlight== with highlight span
	data.content = data.content.replace(
		/==([\S\s]*?)==/g,
		(match: any, p1: string) => {
			return `<b>${p1}</b>`;
		}
	);

	// Not functional, but if needed:
	// replace ```bookmark ...``` with callout block
	// data.content = data.content.replace(
	// 	/```bookmark([\S\s]*?)```/g,
	// 	(match: any, p1: string) => {
	// 		console.log("p1", p1);
	// 		return `<figure class="kg-card kg-embed-card"><a href="${p1}">${p1}</a></div></figure>`;
	// 	}
	// );

	// replace callouts with callout html (this is done with tailwindscss, change if you're using something else)
	data.content = data.content.replace(
		/>\s*\[!(\w+)\](-?)\s*(.*?)((?=\n>\s*)\s*.*?(?=\n(?!>\s*)))/gs,
		(match: any, calloutType: string, foldableBool: any, calloutTitle: string, calloutBody: string) => {
			if (foldableBool) {
				foldableBool = true;
			} else {
				foldableBool = false;
			}
			calloutBody = calloutBody.replace(/^>\s*/gm, "");
			calloutBody = md.render(calloutBody);

			// Define an object where keys are callout types and values are SVG strings
			const calloutSVGs: { [key: string]: string } = {
				"cite": '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" class="mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-quote"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',
				"quote": '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" class="mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-quote"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',
				"warning": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>', // SVG for "warning"
				"caution": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>', // SVG for "caution"
				"attention": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>', // SVG for "attention"
				"help": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-help-circle"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
				"faq": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-help-circle"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
				"question": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-help-circle"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
				"success": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><polyline points="20 6 9 17 4 12"/></svg>',
				"check": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><polyline points="20 6 9 17 4 12"/></svg>',
				"done": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><polyline points="20 6 9 17 4 12"/></svg>',
				"important": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flame"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
				"tip": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flame"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
				"hint": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flame"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
				"abstract": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clipboard-list"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>',
				"summary": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clipboard-list"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>',
				"tldr": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clipboard-list"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>',
				"failure": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
				"fail": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
				"missing": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
				"danger": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
				"error": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
				"target": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-crosshair"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>',
				"pro": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-thumbs-up"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg>',
				"con": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-thumbs-down"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg>',
				"flag": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>',
				"info": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-info"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
				"todo": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-todo"><rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>',
				"note": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
				"example": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
				"bug": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bug"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>',
				"missinig": '<svg class="mr-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ban"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>'
			};
			const arrow = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right"><path d="m9 18 6-6-6-6"/></svg>'

			// Use the calloutSVGs object to get the SVG based on calloutType
			const svg = calloutSVGs[calloutType] || 'missing'; // Default to an empty string if calloutType is not found

			return `<div class="callout-${calloutType} flex flex-col rounded-lg border-l-4  p-4 shadow-md my-4"><div class="flex items-center mb-2">${svg}<p class="font-semibold callout-${calloutType}">${calloutTitle}</p><button class="callout-${calloutType} ml-2 callout-fold-button foldable-${foldableBool}">${arrow}</button></div><div class="text-white callout-content"><div class="wrapper">${calloutBody}</div></div></div>`;
		}
	);

	console.log("data.content", data.content);

	// replace =begin-chatgpt-md-comment to =end-chatgpt-md-comment with callout block
	// data.content = data.content.replace(
	// 	/=begin-chatgpt-md-comment([\S\s]*?)=end-chatgpt-md-comment/g,
	// 	(match: any, p1: string) => {
	// 		const p1HrefLink = p1.replace(
	// 			/(\[.*?\])(\(.*?\))/g,
	// 			(match: any, p1: string, p2: string) => {
	// 				return `<a href="${p2.replace(
	// 					/[\(\)]/g,
	// 					""
	// 				)}">${p1.slice(1,-1)}</a>`;
	// 			}
	// 		);

	// 		const p1WikiLink = p1HrefLink.replace(
	// 			/!*\[\[(.*?)\]\]/g,
	// 			wikiLinkReplacer
	// 		);

	// 		return `<div class="kg-card kg-callout-card-yellow kg-callout-card"><div class="kg-callout-card-yellow"><div class="kg-callout-emoji">💡</div><div class="kg-callout-text">${p1WikiLink}</div></div></div>`; // color does not work ghost ruins it for some reason
	// 	}
	// );
	

	let htmlContent;
	if (type == "posts") {
		htmlContent = contentPost(frontmatter, data);
		htmlContent.posts[0].html = replacer(htmlContent.posts[0].html);
		console.log("content", htmlContent.posts[0].html);
	} else if (type == "pages)") {
		htmlContent = contentPage(frontmatter, data);
		htmlContent.pages[0].html = replacer(htmlContent.pages[0].html);
		console.log("content", htmlContent.pages[0].html);
	}
	


	if (sendToGhost) {
		// use the ghosts admin /post api to see if post with slug exists
		// const slugExistsRes = await request({
		// 	url: `${settings.url}/ghost/api/${version}/admin/${type}/?source=html&filter=slug:${frontmatter.slug}`,
		// 	method: "GET",
		// 	contentType: "application/json",
		// 	headers: {
		// 		"Access-Control-Allow-Methods": "GET",
		// 		"Content-Type": "application/json;charset=utf-8",
		// 		Authorization: `Ghost ${token}`,
		// 	},
		// });

		const slugExistsRes = await request({
			url: `${settings.url}/ghost/api/${version}/admin/${type}/?source=html&filter=slug:${frontmatter.slug}`, 
			method: "GET",
			contentType: "application/json",
			headers: {
				"Access-Control-Allow-Methods": "GET",
				"Content-Type": "application/json;charset=utf-8",
				Authorization: `Ghost ${token}`,
			},
		});

		console.log("page/post check", slugExistsRes);

		if (type == "posts") {
			const slugExists = JSON.parse(slugExistsRes).posts.length > 0;
			if (slugExists) {
				// get id of post if it exists
				const id = JSON.parse(slugExistsRes).posts[0].id;
				console.log("slug exists -- updating post:" + id);

				// add updated_at iso string to frontmatter
				frontmatter.updated_at =
					JSON.parse(slugExistsRes).posts[0].updated_at;

				const htmlContent = contentPost(frontmatter, data);
				htmlContent.posts[0].html = replacer(htmlContent.posts[0].html);
				console.log("htmlcontent", htmlContent);
				
				// if slug exists, update the post
				const result = await request({
					url: `${settings.url}/ghost/api/${version}/admin/${type}/${id}/?source=html`,
					method: "PUT",
					contentType: "application/json",
					headers: {
						"Access-Control-Allow-Methods": "PUT",
						"Content-Type": "application/json;charset=utf-8",
						Authorization: `Ghost ${token}`,
					},
					body: JSON.stringify(htmlContent),
				});

				console.log("result", result);
			

				const json = JSON.parse(result);

				if (json?.posts) {
					new Notice(
						`"${json?.posts?.[0]?.title}" update has been ${json?.posts?.[0]?.status} successful!`
					);
					// https://bram-adams.ghost.io/ghost/#/editor/post/63d3246b7932ae003df67c64
					openInBrowser(
						`${settings.url}/ghost/#/editor/${frontmatter.type}/${json?.posts?.[0]?.id}`
					);
				} else {
					console.log(
						`${json.errors[0]?.details[0].message} - ${json.errors[0]?.details[0].params.allowedValues}`
					);
					console.log(
						`${json.errors[0].context || json.errors[0].message}`
					);
				}
			} else {
				const htmlContent = contentPost(frontmatter, data);
				htmlContent.posts[0].html = replacer(htmlContent.posts[0].html);
				// upload post
				const result = await request({
					url: `${settings.url}/ghost/api/${version}/admin/${type}/?source=html`,
					method: "POST",
					contentType: "application/json",
					headers: {
						"Access-Control-Allow-Methods": "POST",
						"Content-Type": "application/json;charset=utf-8",
						Authorization: `Ghost ${token}`,
					},
					body: JSON.stringify(htmlContent),
				});

				const json = JSON.parse(result);
				console.log("content2", result)

				if (json?.posts) {
					new Notice(
						`"${json?.posts?.[0]?.title}" has been ${json?.posts?.[0]?.status} successful!`
					);
					openInBrowser(
						`${settings.url}/ghost/#/editor/${frontmatter.type}/${json?.posts?.[0]?.id}`
					);
				} else {
					new Notice(
						`${json.errors[0].context || json.errors[0].message}`
					);
					new Notice(
						`${json.errors[0]?.details[0].message} - ${json.errors[0]?.details[0].params.allowedValues}`
					);
				}

				return json;
			}
		} else if (type == "pages") {
			const slugExists = JSON.parse(slugExistsRes).pages.length > 0;
			if (slugExists) {
				// get id of page if it exists
				const id = JSON.parse(slugExistsRes).pages[0].id;
				console.log("slug exists -- updating page:" + id);

				// add updated_at iso string to frontmatter
				frontmatter.updated_at =
					JSON.parse(slugExistsRes).pages[0].updated_at;

				const htmlContent = contentPage(frontmatter, data);
				htmlContent.pages[0].html = replacer(htmlContent.pages[0].html);
				
				// if slug exists, update the page
				const result = await request({
					url: `${settings.url}/ghost/api/${version}/admin/${type}/${id}/?source=html`,
					method: "PUT",
					contentType: "application/json",
					headers: {
						"Access-Control-Allow-Methods": "PUT",
						"Content-Type": "application/json;charset=utf-8",
						Authorization: `Ghost ${token}`,
					},
					body: JSON.stringify(htmlContent),
				});
			
				const json = JSON.parse(result);

				if (json?.pages) {
					new Notice(
						`"${json?.pages?.[0]?.title}" update has been ${json?.pages?.[0]?.status} successful!`
					);
					// https://bram-adams.ghost.io/ghost/#/editor/post/63d3246b7932ae003df67c64
					openInBrowser(
						`${settings.url}/ghost/#/editor/${frontmatter.type}/${json?.pages?.[0]?.id}`
					);
				} else {
					console.log(
						`${json.errors[0]?.details[0].message} - ${json.errors[0]?.details[0].params.allowedValues}`
					);
					console.log(
						`${json.errors[0].context || json.errors[0].message}`
					);
				}
			} else {
				const htmlContent = contentPage(frontmatter, data);
				htmlContent.pages[0].html = replacer(htmlContent.pages[0].html);
				// upload post
				const result = await request({
					url: `${settings.url}/ghost/api/${version}/admin/${type}/?source=html`,
					method: "POST",
					contentType: "application/json",
					headers: {
						"Access-Control-Allow-Methods": "POST",
						"Content-Type": "application/json;charset=utf-8",
						Authorization: `Ghost ${token}`,
					},
					body: JSON.stringify(htmlContent),
				});

				const json = JSON.parse(result);
				console.log("content2", result)

				if (json?.pages) {
					new Notice(
						`"${json?.pages?.[0]?.title}" has been ${json?.pages?.[0]?.status} successful!`
					);
					openInBrowser(
						`${settings.url}/ghost/#/editor/${frontmatter.type}/${json?.pages?.[0]?.id}`
					);
				} else {
					new Notice(
						`${json.errors[0].context || json.errors[0].message}`
					);
					new Notice(
						`${json.errors[0]?.details[0].message} - ${json.errors[0]?.details[0].params.allowedValues}`
					);
				}

				return json;
			}
		}
	}
};
