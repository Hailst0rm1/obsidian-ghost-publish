/* eslint-disable @typescript-eslint/no-var-requires */
import { SettingsProp, ContentProp, DataProp } from "./../types/index";
import { MarkdownView, Notice, request, FileSystemAdapter, RequestUrlParam, SettingTab, PluginSettingTab } from "obsidian";
import { sign } from "jsonwebtoken";
import { parse } from 'node-html-parser';
import * as fs from 'fs/promises';
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

	return content;
};

const replaceCalloutWithHTMLCard = (content: string) => {
	
	const calloutCards = content.match(/<div class="callout-(.*?)<\/div><\/div>/gs);
	console.log("cards", calloutCards);
	if (calloutCards) {
		for (const callout of calloutCards) {
			const htmlCard = `<!--kg-card-begin: html-->${callout}<!--kg-card-end: html-->`;
			content = content.replace(callout, htmlCard);
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
		title: metaMatter?.title || view.file.basename,
		tags: metaMatter?.tags || [],
		featured: metaMatter?.featured || false,
		slug: (metaMatter?.slug || view.file.basename).toLowerCase().replace(/\s+/g, "-"),
		status: metaMatter?.published ? "published" : "draft",
		custom_excerpt: metaMatter?.excerpt || undefined,
		feature_image: metaMatter?.feature_image || undefined,
		meta_title: metaMatter?.meta_title || view.file.basename,
		meta_description: metaMatter?.meta_description || undefined,
		canonical_url: metaMatter?.canonical_url || undefined,
		imageDirectory: metaMatter?.imageDirectory || undefined,
		updated_at: metaMatter?.updated_at || undefined,
		"date modified": metaMatter && metaMatter["date modified"] ? metaMatter["date modified"] : undefined,
		imagesYear: metaMatter && metaMatter["ghost-images-year"] ? metaMatter["ghost-images-year"] : undefined,
		imagesMonth: metaMatter && metaMatter["ghost-images-month"] ? metaMatter["ghost-images-month"] : undefined,
	};

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
		let imageRegex = /!*\[\[(.*?)\]\]/g;

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

			console.log(filename);
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

			console.log("filename", filename);
			// console.log("imagePath", imagePath);
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
					console.log(data);
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
					htmlImage = `<figure class="kg-card kg-image-card"><img src="${BASE_URL}/content/images/${year}/${month}/${imageNamePrefix}-${p1
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}" alt="${p1
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}"></img><figcaption>${BASE_URL}/content/images/${year}/${month}/${imageNamePrefix}-${p1}</figcaption></figure>`
				} else {
					htmlImage = `<figure class="kg-card kg-image-card"><img src="${BASE_URL}/content/images/${year}/${month}/${p1
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}" alt="${p1
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}"></img><figcaption>${BASE_URL}/content/images/${year}/${month}/${p1}</figcaption></figure>`
				}
				console.log("htmlImage", htmlImage);

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

		const [link, text] = p1.split("|");
		const [id, slug] = link.split("#");

		// Get frontmatter of the linked note
		const linkedNote = app.metadataCache.getFirstLinkpathDest(id, noteFile.path);
		const linkedNoteMeta = app.metadataCache.getFileCache(linkedNote)?.frontmatter;

		// Get slug from frontmatter
		const linkedNoteSlug = linkedNoteMeta?.slug;

		const url = `${BASE_URL}/${linkedNoteSlug || slug || id}`;
		const linkText = text || id || slug;
		const linkHTML = `<a href="${url}">${linkText}</a>`;
		return linkHTML;
	}

	console.log("data-content", data.content)
	uploadImages(data.content);
	
	// Removes the first image of the file (it's used as a featured_image in my notes and it's main use here is to upload in the previous function)
	data.content = data.content.replace(/!*\[\[(.*?)\]\]/, "");

	// convert [[link]] to <a href="BASE_URL/id" class="link-previews">Internal Micro</a>for Ghost
	const content = data.content.replace(
		/!*\[\[(.*?)\]\]/g,
		wikiLinkReplacer
	);

	data.content = content;


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

	// replace callouts with callout html
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
			
			// console.log("foldable", foldableBool);
			// console.log("body", calloutBody);
			return `<div class="callout-${calloutType} flex flex-col rounded-lg border-l-4  p-4 shadow-md"><div class="flex items-center mb-2"><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 callout-${calloutType} mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9l-1 1-1-1M12 17v-6"></path></svg><p class="font-semibold callout-${calloutType}">${calloutTitle}</p><button class="callout-${calloutType} ml-2 calloutFoldButton foldable-${foldableBool}"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path id="arrowPath" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg></button></div><div id="calloutContent" style="display: block;">${calloutBody}</div></div>`;
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
	

	const htmlContent = contentPost(frontmatter, data);
			htmlContent.posts[0].html = replacer(htmlContent.posts[0].html);
	
	console.log("content", htmlContent.posts[0].html);


	if (sendToGhost) {
		// use the ghosts admin /post api to see if post with slug exists
		const slugExistsRes = await request({
			url: `${settings.url}/ghost/api/${version}/admin/posts/?source=html&filter=slug:${frontmatter.slug}`,
			method: "GET",
			contentType: "application/json",
			headers: {
				"Access-Control-Allow-Methods": "GET",
				"Content-Type": "application/json;charset=utf-8",
				Authorization: `Ghost ${token}`,
			},
		});

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
			
			// if slug exists, update the post
			const result = await request({
				url: `${settings.url}/ghost/api/${version}/admin/posts/${id}/?source=html`,
				method: "PUT",
				contentType: "application/json",
				headers: {
					"Access-Control-Allow-Methods": "PUT",
					"Content-Type": "application/json;charset=utf-8",
					Authorization: `Ghost ${token}`,
				},
				body: JSON.stringify(htmlContent),
			});

			// console.log(contentPost(frontmatter, data));

			const json = JSON.parse(result);

			if (json?.posts) {
				new Notice(
					`"${json?.posts?.[0]?.title}" update has been ${json?.posts?.[0]?.status} successful!`
				);
				// https://bram-adams.ghost.io/ghost/#/editor/post/63d3246b7932ae003df67c64
				openInBrowser(
					`${settings.url}/ghost/#/editor/post/${json?.posts?.[0]?.id}`
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
				url: `${settings.url}/ghost/api/${version}/admin/posts/?source=html`,
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
					`${settings.url}/ghost/#/editor/post/${json?.posts?.[0]?.id}`
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
};
