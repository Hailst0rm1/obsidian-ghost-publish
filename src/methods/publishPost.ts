/* eslint-disable @typescript-eslint/no-var-requires */
import { SettingsProp, ContentProp, DataProp } from "./../types/index";
import { MarkdownView, Notice, request, FileSystemAdapter, RequestUrlParam, SettingTab, PluginSettingTab } from "obsidian";
import { sign } from "jsonwebtoken";
import { parse } from 'node-html-parser';
import * as fs from 'fs/promises';
import { access } from "fs";
const mime = require('mime-types');
const FormData = require('form-data');
const cheerio = require('cheerio');

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
   const $ = cheerio.load(content);

   const topLevelLists = $('ul:not(ul ul), ol:not(ol ol)').filter(':has(> :not(ol, ul))');

   if (topLevelLists.length > 0) {
      topLevelLists.each((_index: any, list: any) => {
         const listHtml = $.html(list); // Use $.html() to include the outer tags
         const htmlCard = `<!--kg-card-begin: html--><div>${listHtml}</div><!--kg-card-end: html-->`;
         content = content.replace(listHtml, htmlCard);
      });
   }

   return content;
};




// const replaceListsWithHTMLCard = (content: string) => {
// 	// Ghost swallows the list for some reason, so we need to replace them with a HTML card

// 	// let parsedContent = parse(content);
// 	// console.log("content?", parsedContent.toString());
	
// 	// // add font family var(--font-serif) to lists > li and replace content
// 	// const li = parsedContent.querySelectorAll('li').filter(li => {
// 	// 	return li.attributes.class !== 'footnotes-list' && li.attributes.class !== 'checkbox-text';
// 	// });
// 	// li.forEach(li => {
// 	// 	li.setAttribute('style', 'font-family: var(--font-serif)');
// 	// });

// 	// content = parsedContent.toString();
// 	// parsedContent = parse(content); // i couldnt think of a better way to do this lmao

// 	// const lists = parsedContent.querySelectorAll('ul, ol').filter(list => {
// 	// 	console.log("parent", list.parentNode.tagName);
// 	// 	return list.parentNode.tagName === null && list.attributes.class !== 'footnotes-list' && list.attributes.class !== 'checkbox-list';
// 	// });


// 	// wrap list in HTML card const htmlCard = `<!--kg-card-begin: html--><div class="kg-card-markdown">${list[0]}</div><!--kg-card-end: html-->`;
// 	lists.forEach(list => {
// 		const htmlCard = `<!--kg-card-begin: html--><div>${list.outerHTML}</div><!--kg-card-end: html-->`;
// 		content = content.replace(list.outerHTML, htmlCard);
// 	});

// 	return content;
// };

// run all replacers on the content
const replacer = (content: string) => {
	content = replaceListsWithHTMLCard(content);
	content = replaceFootnotesWithHTMLCard(content);
	content = replaceCalloutWithHTMLCard(content);
	content = replaceImageWithHTMLCard(content);
	content = replaceHeaderCardWithHTMLCard(content);
	content = replaceSigninCardWithHTMLCard(content);
	content = replaceAcronymWithHTMLCard(content);
	content = replaceAltquoteWithHTMLCard(content);
	content = replaceToggleCardWithHTMLCard(content);
	content = removeLinksInCode(content);
	content = boldText(content);
	content = replaceCheckboxWithHTMLCard(content);

	return content;
};

const replaceCheckboxWithHTMLCard = (content: string) => {
	const checkboxes = content.match(/<div><ul style="list-style-type: none;list-style-position: inside;padding-left:0;"(.*?)<\/ul><\/div>/gs);
	if (checkboxes) {
		for (const checkbox of checkboxes) {
			const htmlCard = `<!--kg-card-begin: html-->${checkbox}<!--kg-card-end: html-->`;
			content = content.replace(checkbox, htmlCard);
		}
	}

	return content;
}

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
	
	const images = content.match(/<figure class="kg-card kg-image-card(.*?)<\/figure>/gs);
	if (images) {
		for (const image of images) {
			const htmlCard = `<!--kg-card-begin: html-->${image}<!--kg-card-end: html-->`;
			content = content.replace(image, htmlCard);
		}
	}

	return content;
};

// For some reason the header card shits the bed when trying to send the correct html via the api - so we wrap it in a html-block
const replaceHeaderCardWithHTMLCard = (content: string) => {
	const headers = content.match(/<div class="kg-card kg-header-card kg-v2(.*?)<\/div><\/div><\/div>/gs);
	if (headers) {
		for (const header of headers) {
			const htmlCard = `<!--kg-card-begin: html-->${header}<!--kg-card-end: html-->`;
			content = content.replace(header, htmlCard);
		} 
	}

	return content;
}

// When containing links the toggle cards wont include them - thus we make it into a html card
const replaceToggleCardWithHTMLCard = (content: string) => {
	const toggles = content.match(/<div class="kg-card kg-toggle-card"(.*?)<\/div><\/div>/gs);
	if (toggles) {
		for (const toggle of toggles) {
			const htmlCard = `<!--kg-card-begin: html-->${toggle}<!--kg-card-end: html-->`;
			content = content.replace(toggle, htmlCard);
		} 
	}

	return content;
}


// For some reason the signin card shits the bed when trying to send the correct html via the api - so we wrap it in a html-block
const replaceSigninCardWithHTMLCard = (content: string) => {
	const signins = content.match(/<div class="kg-card kg-signup-card kg-v2(.*?)<\/div><\/div><\/div>/gs);
	if (signins) {
		for (const signin of signins) {
			const htmlCard = `<!--kg-card-begin: html-->${signin}<!--kg-card-end: html-->`;
			content = content.replace(signin, htmlCard);
		} 
	}

	return content;
}

// For the a expandable dropdown-acronym cards do display we need to wrap the line in a html block
const replaceAcronymWithHTMLCard = (content: string) => {
	const acronyms = content.match(/(.*)<div class="text-dropdown"><span>(.*?)<\/p><\/div><\/div>(.*)/g);
	if (acronyms) {
		for (const acronym of acronyms) {
			let newAcronym = acronym.replace(
				/<\/div><\/div>(.*?)(?:<div class="text-dropdown">|\n|$)/g,
				(match: any, text: string) => {
 			    	return match.replace(text, `<span>${text}</span>`);
				}
			)
			const htmlCard = `<!--kg-card-begin: html--><div class="acronym-wrapper">${newAcronym}</div><!--kg-card-end: html-->`;
			content = content.replace(acronym, htmlCard);
		} 
	}

	return content;
}

// Alternative blockquote also decides not to apply when sent to ghost, so we wrap it in html
const replaceAltquoteWithHTMLCard = (content: string) => {
	const quotes = content.match(/<blockquote class="kg-blockquote-alt">(.*?)<\/blockquote>/gs);
	if (quotes) {
		for (const quote of quotes) {
			const htmlCard = `<!--kg-card-begin: html-->${quote}<!--kg-card-end: html-->`;
			content = content.replace(quote, htmlCard);
		} 
	}

	return content;
}

// Links will still be replaced with html even if a code block/segment, thus we have to remove them.
const removeLinksInCode = (content: string) => {
	const codeSegments = content.match(/<code(.*?)<\/code>/gs);
	if (codeSegments)  {
		for (const code of codeSegments) {
			let newCodeSegment = code.replace(
				/(?:<|&lt;)a(?:.*?)(?:>|&gt;)(.*?)(?:<|&lt;)\/a(?:>|&gt;)/g,
				(match: any, link: string) => {
					return link;
				}
			)
			content = content.replace(code, newCodeSegment);
		}
	}
	return content;
}

// I've noticed that fore some reason it sometimes misses some of the bolding markdown, thus we fix it here
const boldText = (content: string) => {
	const boldSegments = content.match(/\*\*(?:.*?)\*\*/g);
	if (boldSegments) {
		for (const segment of boldSegments) {
			const segmentWithoutStars = segment.substring(2, segment.length - 2);
			const htmlCard = `<strong>${segmentWithoutStars}</strong>`;
			content = content.replace(segment, htmlCard);
		} 
	}
	return content;
}

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
		feature_image_alt: metaMatter?.feature_image_alt || undefined, 
		feature_image_caption: metaMatter?.feature_image_caption || undefined,
		meta_title: metaMatter?.meta_title || view.file.basename,
		meta_description: metaMatter?.meta_description || undefined,
		canonical_url: metaMatter?.canonical_url || undefined,
		files_upload: metaMatter?.files_upload || false,
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
	
	
	async function uploadContent(file: string) {
		// Get full-path to images
		let files_directory: string;
		let adapter = app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			files_directory = adapter.getBasePath(); // Vault directory
		// 	if (settings.imageFolder) {
		// 		files_directory = `${files_directory}${settings.imageFolder}`;
		// 	}
		// 	if (frontmatter.files_directory) { // Extends the image directory
		// 		files_directory = `${files_directory}${frontmatter.files_directory}`;
		// 	}
		}

		let imagePath = `${files_directory}/${file}`;
		let filename = file;
		let prefix;

		// Make sure it's only filename
		if (filename.includes('|')) {
			filename = filename.split('|')[0];
		}
		if (filename.includes('/')) {
			prefix = filename.split('/')[-2];
			filename = filename.split('/').pop();
		}
		if (filename.includes('\\')) {
			prefix = filename.split('\\')[-2];
			filename = filename.split('\\').pop();
		}

		// If extended directory - add image prefix
		if (prefix) {
			filename = `${prefix.replace(/\//g, "")}-${filename}`;
		}
		
		// Get the image data buffer
		const fileContent = await fs.readFile(imagePath);

		// Determine the file type based on the filename's extension
		const fileExtension = filename.split('.').pop();
		
		// Get the mime type to detirmine which api-endpoint the upload should go to
		let fileType = mime.lookup(fileExtension);
		let purpose = fileType.split('/')[0];
		let apiDest;
		if (purpose === "image") {
			purpose = "image";
			apiDest = "images"
		} else if (purpose === "audio" || purpose === "video") {
			purpose = "media";
			apiDest = "media";
		} else {
			purpose = "file";
			apiDest = "files"
		}


		// Make blob of buffer to allow formdata.append
		const blob = new Blob([fileContent], { type: fileType });

		const formData = new FormData();
		formData.append("file", blob, filename);
		formData.append("purpose", purpose);
		formData.append("ref", filename);

		try {
			const response = await fetch(`${settings.url}/ghost/api/admin/${apiDest}/upload/`, {
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
				console.log(`success ${filename} response`, data);
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





	// Replaces all images and sound with html
	const wikiLinkReplacer = (match: any, p1: string, p2: string) => {
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

				let [picture, alt] = p1.split("|");
				if (frontmatter.files_upload) {
					uploadContent(picture);
				}
				

				// Only takes the filename instead of path (also adds a prefix)
				let prefix;
				if (picture.includes("/")) {
					prefix = picture.split("/")[-2];
					picture = picture.split("/").pop();
				}
				
				let width = "";
				if (alt) {
					if (alt.includes('(wide)')) {width = "kg-width-wide";alt = alt.replace('(wide)',"");}
					if (alt.includes('(full)')) {width = "kg-width-full";alt = alt.replace('(full)',"");}
				} else {
					alt = picture;
				}

				// To avoid naming collision we add a prefix of the extended image directory
				let htmlImage;
				if (prefix) {
					const imageNamePrefix = prefix.replace(/\//g, "");
					htmlImage = `<figure class="kg-card kg-image-card ${width}"><img class="kg-image" alt="${alt}" src="${BASE_URL}/content/images/${year}/${month}/${imageNamePrefix}-${picture
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}"></img>${p2 ? `<figcaption>${p2}</figcaption>` : ""}</figure>`
				} else {
					htmlImage = `<figure class="kg-card kg-image-card ${width}"><img class="kg-image" alt="${alt}" src="${BASE_URL}/content/images/${year}/${month}/${picture
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}"></img>${p2 ? `<figcaption>${p2}</figcaption>` : ""}</figure>`
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

			let [audio, title] = p1.split("|");
			if (!title){title = audio.split('.')[0];}
			if (frontmatter.files_upload) {
				uploadContent(audio);
			}

			// Only takes the filename instead of path (also adds a prefix)
			let prefix;
			if (audio.includes("/")) {
				prefix = audio.split("/")[-2];
				audio = audio.split("/").pop();
			}

			let htmlAudio;
			if (prefix) {
				const audioNamePrefix = prefix.replace(/\//g, "");
				htmlAudio = `<div class="kg-card kg-audio-card">
				<div class="kg-audio-player-container"><audio src="${BASE_URL}/content/media/${year}/${month}/${audioNamePrefix}-${audio
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}" preload="metadata"></audio><div class="kg-audio-title">${title}</div></div></div>`;
			} else {
				htmlAudio = `<div class="kg-card kg-audio-card">
				<div class="kg-audio-player-container"><audio src="${BASE_URL}/content/media/${year}/${month}/${audio
					.replace(/ /g, "-")
					.replace(
						/%20/g,
						"-"
					)}" preload="metadata"></audio><div class="kg-audio-title">${title}</div></div></div>`;
			}
			return htmlAudio;

		} else if (
			p1.toLowerCase().includes(".mp4")
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

				let [video, alt] = p1.split("|");
				if (frontmatter.files_upload) {
					uploadContent(video);
				}

				// Only takes the filename instead of path (also adds a prefix)
				let prefix;
				if (video.includes("/")) {
					prefix = video.split("/")[-2];
					video = video.split("/").pop();
				}

				let width = "";
				if (alt) {
					if (alt.includes('(wide)')) {width = "kg-width-wide";alt = alt.replace('(wide)',"");}
					if (alt.includes('(full)')) {width = "kg-width-full";alt = alt.replace('(full)',"");}
				} else {
					alt = video;
				}

				let htmlVideo;
				if (prefix) {
					const videoNamePrefix = prefix.replace(/\//g, "");
					htmlVideo = `<figure class="kg-card kg-video-card ${width}"><div class="kg-video-container"><video src="${BASE_URL}/content/media/${year}/${month}/${videoNamePrefix}-${video
						.replace(/ /g, "-")
						.replace(
							/%20/g,
							"-"
						)}"></video><figcaption>${p2}</figcaption></div></figure>`
				} else {
					htmlVideo = `<figure class="kg-card kg-video-card ${width}"><div class="kg-video-container"><video src="${BASE_URL}/content/media/${year}/${month}/${video
						.replace(/ /g, "-")
						.replace(
							/%20/g,
							"-"
						)}"></video><figcaption>${p2}</figcaption></div></figure>`
				}
				return htmlVideo
			} catch (err) {
				console.log("is404Req", err);
			}
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

	console.log("data-content (pre uploads/link replacements)", data.content);

	
	// Removes the first image of the file (it's used as a featured_image in my notes and it's main use here is to upload in the previous function)
	if (settings.firstAsFeatured) {
		data.content = data.content.replace(
			/(?:(?:!\[\[(.*?)\]\](?: *\n(.*))?)|(?:!\[(.*?)\]\((.*?)\)(?: *\n(.*))?))/,
			(match: any, imageAndAlt: string, imageCaption: string, imageAlt: string, image2: string, imageCaption2: string) => {
				if (imageAndAlt) {
					let [image, alt] = imageAndAlt.split("|");
					if (frontmatter.files_upload) {
						uploadContent(image);
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
						let prefix;
						if (image.includes("/")) {
							prefix = image.split("/")[-2];
							image = image.split("/").pop();
						}
						if (prefix) {
							const imageNamePrefix = prefix.replace(/\//g, "");
							frontmatter.feature_image = `${settings.baseURL}/content/images/${year}/${month}/${imageNamePrefix}-${image}`
						} else {
							frontmatter.feature_image = `${settings.baseURL}/content/images/${year}/${month}/${image}`
						}
					}
					if (!alt) {alt = imageAndAlt;}
					frontmatter.feature_image_caption = imageCaption;
					frontmatter.feature_image_alt = alt;
					return "";
				} else if (image2) {
					if (!imageAlt) {imageAlt = image2.split("/").pop();}
					frontmatter.feature_image_caption = imageCaption2;
					frontmatter.feature_image_alt = imageAlt;
					frontmatter.feature_image = image2;
					return "";
				}
			}
		);
	}

	// Convert markdown checkbox
	data.content = data.content.replace(
		/(?:\t*- \[(?: |x)\] (?:.*)\n?)+/g,
		(match:any) => {

			const lines: string[] = match.split('\n').slice(0, -1);
			let htmlContent = `<div><ul style="list-style-type: none;list-style-position: inside;padding-left:0;" class="checkbox-list">`;
			let currentIndent = 0;
			let indent = 0;
			let checked;

			for (const line of lines) {
				currentIndent = (line.match(/^\t*/)?.[0].length) || 0;
				if (indent < currentIndent) {
					htmlContent += '<ul style="list-style-type: none;list-style-position: inside;" class="checkbox-list">';
				} else if (indent > currentIndent) {
					htmlContent += '</ul>'.repeat(indent - currentIndent);
				}
				if (line.includes("[x]")) {
					checked = true;
				} else {
					checked = false;
				}
				htmlContent += `<li class="checkbox-text"><input type="checkbox" class="checkbox" ${checked ? 'checked="checked"' : ""}/><label>${line.trim()}</label></li>`
			}

			htmlContent += '</ul></div>';
			
			htmlContent = htmlContent.replace(/- \[(?: |x)\] /g, "");
			
			return htmlContent;
		}
	)

	// Convert markdown list to html
	// data.content = data.content.replace(
	// 	/(?:\t*(?:-|[0-9]+\.) +(?:.*)+n?)+/g,
	// 	(match:any) => {
	// 		let ul = match.includes(/^\t*-/);
	// 		let lists = match.replace(/- +/g, "");

	// 		const lines: string[] = lists.split('\n');
	// 		let htmlContent = `<div><${ul ? 'ul' : 'ol'}>`
	// 	}
	// )


	// Convert "Download: [[file.ext]]" to ghost file card
	data.content = data.content.replace(
		/Download: *!?\[\[(.*?)\]\](?: *\n(.*))?/g,
		(match: any, file: string, description: string) => {
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

			if (!description){description = "";}
			let [filename, title] = file.split("|");
			if (!title){title = filename;}
			
			if (frontmatter.files_upload) {
				uploadContent(filename)
			}

			let prefix;
			if (filename.includes("/")) {
				prefix = filename.split("/")[-2];
				filename = filename.split("/").pop();
			}

			if (prefix) {
				const fileNamePrefix = prefix.replace(/\//g, "");
				return `<div class="kg-card kg-file-card"><a class="kg-file-card-container" href="${BASE_URL}/content/files/${year}/${month}/${fileNamePrefix}-${filename}"><div class="kg-file-card-contents"><div class="kg-file-card-title">${title}</div><div class="kg-file-card-caption">${description}</div></div></div>`;
			}
			return `<div class="kg-card kg-file-card"><a class="kg-file-card-container" href="${BASE_URL}/content/files/${year}/${month}/${filename}"><div class="kg-file-card-contents"><div class="kg-file-card-title">${title}</div><div class="kg-file-card-caption">${description}</div></div></div>`;
		}
	);


	// Convert "Product: ![[image]] \n Description \n [[link|button text]]" to ghost product card
	data.content = data.content.replace(
		/Product: *!\[\[(.*?)\]\](?: *\n(.*))(?: *\n(.*))(?: *\n\[(.*?)\]\((.*?)\))?/g,
		(match: any, image: string, title: string, description: string, buttonText: string, buttonLink: string) => {
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

			if (!description){description = "";}
			let [filename, alt] = image.split("|");
			if (!title){alt = filename;}
			
			if (frontmatter.files_upload) {
				uploadContent(filename)
			}

			let prefix;
			if (filename.includes("/")) {
				prefix = filename.split("/")[-2];
				filename = filename.split("/").pop();
			}

			if (prefix) {
				const fileNamePrefix = prefix.replace(/\//g, "");
				filename = filename.replace(/^/, `${fileNamePrefix}-`)
				console.log('store filename', filename)
			}
			return `<div class="kg-card kg-product-card"><div class="kg-product-card-container"><img src="${BASE_URL}/content/images/${year}/${month}/${filename}" alt="${alt}" class="kg-product-card-image"><div class="kg-product-card-title-container"><h4 class="kg-product-card-title"><span>${title}</span></h4></div><div class="kg-product-card-description"><p><span>${description}</span></p></div><a href="${buttonLink}" class="kg-product-card-button kg-product-card-btn-accent"><span>${buttonText}</span></a></div></div>`
		}
	);

	// Array to store promises
	const replacePromises: any[] = [];

	// Bookmark and embed cards ghost:
	// <empty line>
	// url
	// <empty line>
	data.content = await data.content.replace(
		/\n{2}((?:(?:href|src|xmlns)="\s*)?(?:mailto:)?(?:http(?:s)?:\/\/)?\b(?:[-a-zA-Z0-9@%_\+~#=]\.?){2,256}\.(?:aaa|aarp|abb|abbott|abbvie|abc|able|abogado|abudhabi|ac|academy|accenture|accountant|accountants|aco|actor|ad|ads|adult|ae|aeg|aero|aetna|af|afl|africa|ag|agakhan|agency|ai|aig|airbus|airforce|airtel|akdn|al|alibaba|alipay|allfinanz|allstate|ally|alsace|alstom|am|amazon|americanexpress|americanfamily|amex|amfam|amica|amsterdam|analytics|android|anquan|anz|ao|aol|apartments|app|apple|aq|aquarelle|ar|arab|aramco|archi|army|arpa|art|arte|as|asda|asia|associates|at|athleta|attorney|au|auction|audi|audible|audio|auspost|author|auto|autos|avianca|aw|aws|ax|axa|az|azure|ba|baby|baidu|banamex|bananarepublic|band|bank|bar|barcelona|barclaycard|barclays|barefoot|bargains|baseball|basketball|bauhaus|bayern|bb|bbc|bbt|bbva|bcg|bcn|bd|be|beats|beauty|beer|bentley|berlin|best|bestbuy|bet|bf|bg|bh|bharti|bi|bible|bid|bike|bing|bingo|bio|biz|bj|black|blackfriday|blockbuster|blog|bloomberg|blue|bm|bms|bmw|bn|bnpparibas|bo|boats|boehringer|bofa|bom|bond|boo|book|booking|bosch|bostik|boston|bot|boutique|box|br|bradesco|bridgestone|broadway|broker|brother|brussels|bs|bt|build|builders|business|buy|buzz|bv|bw|by|bz|bzh|ca|cab|cafe|cal|call|calvinklein|cam|camera|camp|canon|capetown|capital|capitalone|car|caravan|cards|care|career|careers|cars|casa|case|cash|casino|cat|catering|catholic|cba|cbn|cbre|cc|cd|center|ceo|cern|cf|cfa|cfd|cg|ch|chanel|channel|charity|chase|chat|cheap|chintai|christmas|chrome|church|ci|cipriani|circle|cisco|citadel|citi|citic|city|ck|cl|claims|cleaning|click|clinic|clinique|clothing|cloud|club|clubmed|cm|cn|co|coach|codes|coffee|college|cologne|com|comcast|commbank|community|company|compare|computer|comsec|condos|construction|consulting|contact|contractors|cooking|cool|coop|corsica|country|coupon|coupons|courses|cpa|cr|credit|creditcard|creditunion|cricket|crown|crs|cruise|cruises|cu|cuisinella|cv|cw|cx|cy|cymru|cyou|cz|dabur|dad|dance|data|date|dating|datsun|day|dclk|dds|de|deal|dealer|deals|degree|delivery|dell|deloitte|delta|democrat|dental|dentist|desi|design|dev|dhl|diamonds|diet|digital|direct|directory|discount|discover|dish|diy|dj|dk|dm|dnp|do|docs|doctor|dog|domains|dot|download|drive|dtv|dubai|dunlop|dupont|durban|dvag|dvr|dz|earth|eat|ec|eco|edeka|edu|education|ee|eg|email|emerck|energy|engineer|engineering|enterprises|epson|equipment|er|ericsson|erni|es|esq|estate|et|eu|eurovision|eus|events|exchange|expert|exposed|express|extraspace|fage|fail|fairwinds|faith|family|fan|fans|farm|farmers|fashion|fast|fedex|feedback|ferrari|ferrero|fi|fidelity|fido|film|final|finance|financial|fire|firestone|firmdale|fish|fishing|fit|fitness|fj|fk|flickr|flights|flir|florist|flowers|fly|fm|fo|foo|food|football|ford|forex|forsale|forum|foundation|fox|fr|free|fresenius|frl|frogans|frontier|ftr|fujitsu|fun|fund|furniture|futbol|fyi|ga|gal|gallery|gallo|gallup|game|games|gap|garden|gay|gb|gbiz|gd|gdn|ge|gea|gent|genting|george|gf|gg|ggee|gh|gi|gift|gifts|gives|giving|gl|glass|gle|global|globo|gm|gmail|gmbh|gmo|gmx|gn|godaddy|gold|goldpoint|golf|goo|goodyear|goog|google|gop|got|gov|gp|gq|gr|grainger|graphics|gratis|green|gripe|grocery|group|gs|gt|gu|guardian|gucci|guge|guide|guitars|guru|gw|gy|hair|hamburg|hangout|haus|hbo|hdfc|hdfcbank|health|healthcare|help|helsinki|here|hermes|hiphop|hisamitsu|hitachi|hiv|hk|hkt|hm|hn|hockey|holdings|holiday|homedepot|homegoods|homes|homesense|honda|horse|hospital|host|hosting|hot|hotels|hotmail|house|how|hr|hsbc|ht|hu|hughes|hyatt|hyundai|ibm|icbc|ice|icu|id|ie|ieee|ifm|ikano|il|im|imamat|imdb|immo|immobilien|in|inc|industries|infiniti|info|ing|ink|institute|insurance|insure|int|international|intuit|investments|io|ipiranga|iq|ir|irish|is|ismaili|ist|istanbul|it|itau|itv|jaguar|java|jcb|je|jeep|jetzt|jewelry|jio|jll|jm|jmp|jnj|jo|jobs|joburg|jot|joy|jp|jpmorgan|jprs|juegos|juniper|kaufen|kddi|ke|kerryhotels|kerrylogistics|kerryproperties|kfh|kg|kh|ki|kia|kids|kim|kindle|kitchen|kiwi|km|kn|koeln|komatsu|kosher|kp|kpmg|kpn|kr|krd|kred|kuokgroup|kw|ky|kyoto|kz|la|lacaixa|lamborghini|lamer|lancaster|land|landrover|lanxess|lasalle|lat|latino|latrobe|law|lawyer|lb|lc|lds|lease|leclerc|lefrak|legal|lego|lexus|lgbt|li|lidl|life|lifeinsurance|lifestyle|lighting|like|lilly|limited|limo|lincoln|link|lipsy|live|living|lk|llc|llp|loan|loans|locker|locus|lol|london|lotte|lotto|love|lpl|lplfinancial|lr|ls|lt|ltd|ltda|lu|lundbeck|luxe|luxury|lv|ly|ma|madrid|maif|maison|makeup|man|management|mango|map|market|marketing|markets|marriott|marshalls|mattel|mba|mc|mckinsey|md|me|med|media|meet|melbourne|meme|memorial|men|menu|merckmsd|mg|mh|miami|microsoft|mil|mini|mint|mit|mitsubishi|mk|ml|mlb|mls|mm|mma|mn|mo|mobi|mobile|moda|moe|moi|mom|monash|money|monster|mormon|mortgage|moscow|moto|motorcycles|mov|movie|mp|mq|mr|ms|msd|mt|mtn|mtr|mu|museum|music|mv|mw|mx|my|mz|na|nab|nagoya|name|natura|navy|nba|nc|ne|nec|net|netbank|netflix|network|neustar|new|news|next|nextdirect|nexus|nf|nfl|ng|ngo|nhk|ni|nico|nike|nikon|ninja|nissan|nissay|nl|no|nokia|norton|now|nowruz|nowtv|np|nr|nra|nrw|ntt|nu|nyc|nz|obi|observer|office|okinawa|olayan|olayangroup|oldnavy|ollo|om|omega|one|ong|onl|online|ooo|open|oracle|orange|org|organic|origins|osaka|otsuka|ott|ovh|pa|page|panasonic|paris|pars|partners|parts|party|pay|pccw|pe|pet|pf|pfizer|pg|ph|pharmacy|phd|philips|phone|photo|photography|photos|physio|pics|pictet|pictures|pid|pin|ping|pink|pioneer|pizza|pk|pl|place|play|playstation|plumbing|plus|pm|pn|pnc|pohl|poker|politie|porn|post|pr|pramerica|praxi|press|prime|pro|prod|productions|prof|progressive|promo|properties|property|protection|pru|prudential|ps|pt|pub|pw|pwc|qa|qpon|quebec|quest|racing|radio|re|read|realestate|realtor|realty|recipes|red|redstone|redumbrella|rehab|reise|reisen|reit|reliance|ren|rent|rentals|repair|report|republican|rest|restaurant|review|reviews|rexroth|rich|richardli|ricoh|ril|rio|rip|ro|rocks|rodeo|rogers|room|rs|rsvp|ru|rugby|ruhr|run|rw|rwe|ryukyu|sa|saarland|safe|safety|sakura|sale|salon|samsclub|samsung|sandvik|sandvikcoromant|sanofi|sap|sarl|sas|save|saxo|sb|sbi|sbs|sc|scb|schaeffler|schmidt|scholarships|school|schule|schwarz|science|scot|sd|se|search|seat|secure|security|seek|select|sener|services|seven|sew|sex|sexy|sfr|sg|shangrila|sharp|shaw|shell|shia|shiksha|shoes|shop|shopping|shouji|show|si|silk|sina|singles|site|sj|sk|ski|skin|sky|skype|sl|sling|sm|smart|smile|sn|sncf|so|soccer|social|softbank|software|sohu|solar|solutions|song|sony|soy|spa|space|sport|spot|sr|srl|ss|st|stada|staples|star|statebank|statefarm|stc|stcgroup|stockholm|storage|store|stream|studio|study|style|su|sucks|supplies|supply|support|surf|surgery|suzuki|sv|swatch|swiss|sx|sy|sydney|systems|sz|tab|taipei|talk|taobao|tatamotors|tatar|tattoo|tax|taxi|tc|tci|td|tdk|team|tech|technology|tel|temasek|tennis|teva|tf|tg|th|thd|theater|theatre|tiaa|tickets|tienda|tips|tires|tirol|tj|tjmaxx|tjx|tk|tkmaxx|tl|tm|tmall|tn|to|today|tokyo|tools|top|toray|toshiba|total|tours|town|toyota|toys|tr|trade|trading|training|travel|travelers|travelersinsurance|trust|trv|tt|tube|tui|tunes|tushu|tv|tvs|tw|tz|ua|ubank|ubs|ug|uk|unicom|university|uno|uol|ups|us|uy|uz|va|vacations|vana|vanguard|vc|ve|vegas|ventures|verisign|versicherung|vet|vg|vi|viajes|video|vig|viking|villas|vin|vip|virgin|visa|vision|viva|vivo|vlaanderen|vn|vodka|volvo|vote|voting|voto|voyage|vu|wales|walmart|walter|wang|wanggou|watch|watches|weather|weatherchannel|webcam|weber|website|wed|wedding|weibo|weir|wf|whoswho|wien|wiki|williamhill|win|windows|wine|winners|wme|wolterskluwer|woodside|work|works|world|wow|ws|wtc|wtf|xbox|xerox|xfinity|xihuan|xin|xxx|xyz|yachts|yahoo|yamaxun|yandex|ye|yodobashi|yoga|yokohama|you|youtube|yt|yun|za|zappos|zara|zero|zip|zm|zone|zuerich|zw)\b(?:[-a-zA-Z0-9@:%_\+.~#?!&//=]*)(?:<\/a>)?)(?: *\n(.*))?\n{2}/g,
		(match: any, link: string, caption: string) => {
			const replacePromise = (async () => {
				if (link.includes("twitter.com") || link.includes("x.com") || link.includes("youtube.com") || link.includes("vimeo.com") || link.includes("unsplash.com") || link.includes("codepen.io") || link.includes("spotify.com") || link.includes("soundcloud.com")) {
					let htmlContent;
					try {
						let jsonResponse = await request({
							url: `${settings.url}/ghost/api/${version}/admin/oembed/?url=${link}&type=embed`, 
							method: "GET",
							contentType: "application/json",
							headers: {
								"Access-Control-Allow-Methods": "GET",
								"Content-Type": "application/json;charset=utf-8",
								Authorization: `Ghost ${token}`,
							},
						});

						// Parse the response as JSON
						const parsedResponse = JSON.parse(jsonResponse);

						// Now you can access the HTML property
						htmlContent = parsedResponse.html;
						htmlContent = htmlContent.replace(/(height|width)="[0-9]+" */g, "")

						// Make it into a embed card
						htmlContent = `<figure class="kg-card kg-embed-card ${caption ? "kg-card-hascaption" : ""}">${htmlContent}${caption ? `<figcaption><p><span>${caption}</span></p></figcaption>` : ""}</figure>`;

						return match.replace(link, htmlContent);

					} catch (error) {
						console.error("Error fetching or parsing the response:", error);
						return match.replace(link, "");
					}
				} else {
					try {
						let jsonResponse = await request({
							url: `${settings.url}/ghost/api/${version}/admin/oembed/?url=${link}&type=bookmark`, 
							method: "GET",
							contentType: "application/json",
							headers: {
								"Access-Control-Allow-Methods": "GET",
								"Content-Type": "application/json;charset=utf-8",
								Authorization: `Ghost ${token}`,
							},
						});

						// Parse the response as JSON
						const parsedResponse = JSON.parse(jsonResponse);

						// Now you can access the HTML property
						const url = parsedResponse.url;
						const title = parsedResponse.metadata.title;
						const description = parsedResponse.metadata.description;
						const author = parsedResponse.metadata.author;
						const publisher = parsedResponse.metadata.publisher;
						const thumbnail = parsedResponse.metadata.thumbnail;
						const icon = parsedResponse.metadata.icon;

						let htmlContent = `<a class="kg-bookmark-container" href="${url}"><div class="kg-bookmark-content"><div class="kg-bookmark-title">${title}</div><div class="kg-bookmark-description">${description}</div><div class="kg-bookmark-metadata"><img class="kg-bookmark-icon" src="${icon}" alt=""><span class="kg-bookmark-author">${author ? author : ""}</span><span class="kg-bookmark-publisher">${publisher ? publisher : ""}</span></div></div><div class="kg-bookmark-thumbnail"><img src="${thumbnail}" alt=""></div></a>`;

						// Make it into a bookmark card
						htmlContent = `<figure class="kg-card kg-bookmark-card ${caption ? "kg-card-hascaption" : ""}">${htmlContent}${caption ? `<figcaption><p><span>${caption}</span></p></figcaption>` : ""}</figure>`;

						return match.replace(link, htmlContent);

					} catch(error) {
						console.error("Error fetching or parsing the response:", error);
						return match.replace(link, `<figure class="kg-card kg-bookmark-card"><a class="kg-bookmark-container" href="${link}"></a></figure>`);
					}
				}
			})();

			replacePromises.push({
				promise: replacePromise,
				originalMatch: match,
			});

			// Returning the original match
			return match;
		}
	);

	// Wait for all replacements to be done before logging 
	await Promise.all(replacePromises.map(async ({ promise, originalMatch }) => {
		const replacement = await promise;
		// Replace the original match with the actual content
		data.content = data.content.replace(originalMatch, replacement);
	}));
	// Removes the original text that now is figcapture
	data.content = data.content.replace(
	/<figure class="kg-card kg-(?:bookmark|embed)-card kg-card-hascaption(?:.*?)<\/span><\/p><\/figcaption><\/figure>(?: *\n([^\n]*))?/gs,
	(match: any, captionText: string) => {
		if (captionText) {
			const lastIndex = match.lastIndexOf(captionText);	
			return match.slice(0, lastIndex) + match.slice(lastIndex + captionText.length);
		} else {
			return match;
		}
	});

	
	// Ghost header card
	data.content = data.content.replace(
		/(#{1,6}) *([^\n]*)\n?([^\n]*)?\n+```header\n(?:Layout: *)?(.*?)\n(?:Alignment: *)?(.*?)\n(?:Background: *)?(.*?)\n(?:Button: *)?(.*?)\n(?:Button colo(?:u)?r: *)?(.*?)\n```/gsu,
		(match: any, headerSizeInput: string, title: string, subtitle: string, layout: string, alignment: string, background: string, button: string, buttonColourInput: string) => {
			// Header size
			let headerSize = headerSizeInput.length;
			
			// Layout
			let layoutClass;
			let layoutImage;
			let layoutImageAlt;
			let layoutSplit;
			if (layout.toLowerCase() === "wide") {
				layoutClass = "kg-width-wide";
			} else if (layout.toLowerCase() === "full" || layout.includes("![")) {
				layoutClass = "kg-width-full kg-content-wide";
			} else if (layout.includes("![")) {
				layoutClass = "kg-width-full kg-layout-split";
				layoutSplit = true;
				if (layout.match(/!\[(?:.*?)\]\((.*?)\)/)) {
					layoutImage = layout.replace(/!\[(?:.*?)\]\((.*?)\)/, '$1');
					layoutImageAlt = layout.replace(/!\[(?:.*?)\]\((?:.*?)\)(?: *(.*))?/, '$1');
					if (frontmatter.files_upload) {
						uploadContent(layoutImage);
					}
				} else if (layout.includes("![[")) {
					layoutImage = layout.replace(/!\[\[ *([^\]|]*) *(?: *\| *(.*?)) *\]\]/, '$1');
					layoutImageAlt = layout.replace(/!\[\[ *([^\]|]*) *(?: *\| *(.*?)) *\]\]/, '$2');
					if (frontmatter.files_upload) {
						uploadContent(layoutImage);
					}
				}
				if (layoutImageAlt.includes("(flip)")) {
					layoutClass += "kg-swapped";
				}
			} else {
				layoutClass = "kg-width-regular";
			}

			// Alignment
			let alignmentClass
			if (alignment.toLowerCase() === "center") {
				alignmentClass = "kg-align-center";
			} else {
				alignmentClass = "";
			}

			// Background
			let backgroundColour;
			let backgroundImage;
			let backgroundImageAlt;
			if (background.includes("![")) {
				if (background.match(/!\[(?:.*?)\]\((.*?)\)/)) {
					backgroundImage = background.replace(/!\[(?:.*?)\]\((.*?)\)/, '$1');
					backgroundImageAlt = background.replace(/!\[(?:.*?)\]\((?:.*?)\)(?: *(.*))?/, '$1');
					if (frontmatter.files_upload) {
						uploadContent(backgroundImage);
					}
				} else if (background.includes("![[")) {
					backgroundImage = background.replace(/!\[\[ *([^\]|]*) *(?: *\| *(.*?)) *\]\]/, '$1');
					backgroundImageAlt = background.replace(/!\[\[ *([^\]|]*) *(?: *\| *(.*?)) *\]\]/, '$2');
					if (frontmatter.files_upload) {
						uploadContent(backgroundImage);
					}
				}
			} else if (background.match(/#?[A-Fa-f0-9]{6}/i)) {
				backgroundColour = background.replace(/#?([A-Fa-f0-9]{6})/i, '$1');
			} else {
				backgroundColour = "kg-style-accent";
			}

			// Button
			let buttonText;
			let buttonLink;
			console.log("button", button);
			if (button.includes("](")) {
				buttonText = button.replace(/\[(.*?)\]\((.*?)\)/, '$1')
				buttonLink = button.replace(/\[(.*?)\]\((.*?)\)/, '$2')
				console.log("button", buttonText);
				console.log("button", buttonLink);
			}

			// Button Colour
			let buttonColour;
			if (buttonColourInput.match(/#?[A-Fa-f0-9]{6}/i)) {
				buttonColour = buttonColourInput.replace(/#?([A-Fa-f0-9]{6})/i, '$1');
			} else {
				buttonColour = "kg-style-accent";
			}

			return `<div class="kg-card kg-header-card kg-v2 ${layoutClass} ${backgroundColour === "kg-style-accent" ? backgroundColour : ''}" style="${backgroundColour !== "kg-style-accent" ? `background-color: #${backgroundColour}` : ''}">${backgroundImage ? '<picture><img class="kg-header-card-image" src="' + backgroundImage + '" alt="' + backgroundImageAlt + '"></picture>' : ""}<div class="kg-header-card-content">${layoutSplit ? '<picture><img class="kg-header-card-image" src="' + layoutImage + '" alt="' + layoutImageAlt + '"></picture>' : ""}<div class="kg-header-card-text ${alignmentClass}"><h${headerSize} id=${title.toLowerCase().replace(/ /, "-")} class="kg-header-card-heading">${title}</h${headerSize}><p class="kg-header-card-subheading">${subtitle}</p>${buttonLink ? '<a href="' + buttonLink + `" class="kg-header-card-button ${buttonColour === "kg-style-accent" ? buttonColour : ""}" style="${buttonColour !== "kg-style-accent" ? `background-color: #${buttonColour}` : ''}">${buttonText}</a>` : ""}</div></div></div>`;
		}
	);

	// Signup card
	data.content = data.content.replace(
		/#{1,6} *([^\n]*)\n?([^\n]*)?\n+```signup\n(?:Layout: *)?(.*?)\n(?:Alignment: *)?(.*?)\n(?:Background: *)?(.*?)\n(?:Button: *)?(.*?)\n(?:Button colo(?:u)?r: *)?(.*?)\n```(?: *\n(.*?)\n)?/gsu,
		(match: any, title: string, subtitle: string, layout: string, alignment: string, background: string, button: string, buttonColourInput: string, disclaimer: string) => {
			// Layout
			let layoutClass;
			let layoutImage;
			let layoutImageAlt;
			let layoutSplit;
			if (layout.toLowerCase() === "wide") {
				layoutClass = "kg-width-wide";
			} else if (layout.toLowerCase() === "full" || layout.includes("![")) {
				layoutClass = "kg-width-full kg-content-wide";
			} else if (layout.includes("![")) {
				layoutClass = "kg-width-full kg-layout-split";
				layoutSplit = true;
				if (layout.match(/!\[(?:.*?)\]\((.*?)\)/)) {
					layoutImage = layout.replace(/!\[(?:.*?)\]\((.*?)\)/, '$1');
					layoutImageAlt = layout.replace(/!\[(?:.*?)\]\((?:.*?)\)(?: *(.*))?/, '$1');
					if (frontmatter.files_upload) {
						uploadContent(layoutImage);
					}
				} else if (layout.includes("![[")) {
					layoutImage = layout.replace(/!\[\[ *([^\]|]*) *(?: *\| *(.*?)) *\]\]/, '$1');
					layoutImageAlt = layout.replace(/!\[\[ *([^\]|]*) *(?: *\| *(.*?)) *\]\]/, '$2');
					if (frontmatter.files_upload) {
						uploadContent(layoutImage);
					}
				}
				if (layoutImageAlt.includes("(flip)")) {
					layoutClass += "kg-swapped";
				}
			} else {
				layoutClass = "kg-width-regular";
			}

			// Alignment
			let alignmentClass
			if (alignment.toLowerCase() === "center") {
				alignmentClass = "kg-align-center";
			} else {
				alignmentClass = "";
			}

			// Background
			let backgroundColour;
			let backgroundImage;
			let backgroundImageAlt;
			if (background.includes("![")) {
				if (background.match(/!\[(?:.*?)\]\((.*?)\)/)) {
					backgroundImage = background.replace(/!\[(?:.*?)\]\((.*?)\)/, '$1');
					backgroundImageAlt = background.replace(/!\[(?:.*?)\]\((?:.*?)\)(?: *(.*))?/, '$1');
					if (frontmatter.files_upload) {
						uploadContent(backgroundImage);
					}
				} else if (background.includes("![[")) {
					backgroundImage = background.replace(/!\[\[ *([^\]|]*) *(?: *\| *(.*?)) *\]\]/, '$1');
					backgroundImageAlt = background.replace(/!\[\[ *([^\]|]*) *(?: *\| *(.*?)) *\]\]/, '$2');
					if (frontmatter.files_upload) {
						uploadContent(backgroundImage);
					}
				}
			} else if (background.match(/#?[A-Fa-f0-9]{6}/i)) {
				backgroundColour = background.replace(/#?([A-Fa-f0-9]{6})/i, '$1');
			} else {
				backgroundColour = "kg-style-accent";
			}

			// Button Colour
			let buttonColour;
			if (buttonColourInput.match(/#?[A-Fa-f0-9]{6}/i)) {
				buttonColour = buttonColourInput.replace(/#?([A-Fa-f0-9]{6})/i, '$1');
			} else {
				buttonColour = "kg-style-accent";
			}

			return `<div class="kg-card kg-signup-card kg-v2 ${layoutClass} ${backgroundColour === "kg-style-accent" ? backgroundColour : ''}" style="${backgroundColour !== "kg-style-accent" ? `background-color: #${backgroundColour}` : ''}">${backgroundImage ? '<picture><img class="kg-signup-card-image" src="' + backgroundImage + '" alt="' + backgroundImageAlt + '"></picture>' : ""}<div class="kg-signup-card-content">${layoutSplit ? '<picture><img class="kg-signup-card-image" src="' + layoutImage + '" alt="' + layoutImageAlt + '"></picture>' : ""}<div class="kg-signup-card-text ${alignmentClass}"><h2 id=${title.toLowerCase().replace(/ /, "-")} class="kg-signup-card-heading">${title}</h2><p class="kg-signup-card-subheading">${subtitle}</p><form class="kg-signup-card-form" data-members-form="signup"><div class="kg-signup-card-fields"><input class="kg-signup-card-input" id="email" data-members-email="" type="email" required="true" placeholder="Your email"><button class="kg-signup-card-button ${buttonColour === "kg-style-accent" ? buttonColour : ""}" style="${buttonColour !== "kg-style-accent" ? `background-color: #${buttonColour}` : ""}"><span class="kg-signup-card-button-default">${button}</span><span class="kg-signup-card-button-loading"><svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 24 24">
			<g stroke-linecap="round" stroke-width="2" fill="currentColor" stroke="none" stroke-linejoin="round" class="nc-icon-wrapper" style="--darkreader-inline-stroke: none; --darkreader-inline-fill: currentColor;" data-darkreader-inline-stroke="" data-darkreader-inline-fill="">
				<g class="nc-loop-dots-4-24-icon-o">
					<circle cx="4" cy="12" r="3"></circle>
					<circle cx="12" cy="12" r="3"></circle>
					<circle cx="20" cy="12" r="3"></circle>
				</g>
				<style data-cap="butt">
					.nc-loop-dots-4-24-icon-o{--animation-duration:0.8s}
					.nc-loop-dots-4-24-icon-o *{opacity:.4;transform:scale(.75);animation:nc-loop-dots-4-anim var(--animation-duration) infinite}
					.nc-loop-dots-4-24-icon-o :nth-child(1){transform-origin:4px 12px;animation-delay:-.3s;animation-delay:calc(var(--animation-duration)/-2.666)}
					.nc-loop-dots-4-24-icon-o :nth-child(2){transform-origin:12px 12px;animation-delay:-.15s;animation-delay:calc(var(--animation-duration)/-5.333)}
					.nc-loop-dots-4-24-icon-o :nth-child(3){transform-origin:20px 12px}
					@keyframes nc-loop-dots-4-anim{0%,100%{opacity:.4;transform:scale(.75)}50%{opacity:1;transform:scale(1)}}
				</style><style class="darkreader darkreader--sync" media="screen"></style>
			</g>
		</svg></span></button></div><div class="kg-signup-card-success">Email sent! Check your inbox to complete your signup.</div><div class="kg-signup-card-error" data-members-error="" data-darkreader-inline-color=""></div></form><p class="kg-signup-card-disclaimer"><span>${disclaimer}</span></p></div></div></div>`;
		}
	);

	// Ghost button card
	data.content = data.content.replace(
		/Button( *\(c\) *)?: *\[(.*?)\]\((.*?)\)/g,
		(match: any, c: boolean, buttonText: string, buttonLink: string) => {
			let position;
			if (c){position = "kg-align-center";} else {position = "kg-align-left";}
			return `<div class="kg-card kg-button-card ${position}"><a class="kg-btn kg-btn-accent" href="${buttonLink}">${buttonText}</a></div>`;
		}
	);

	// ghost callouts
	// colours: grey, white, blue, green, yellow, red, pink, purple, accent (brand colour)
	data.content = data.content.replace(
		/```(.) *(grey|white|blue|green|yellow|red|pink|purple|accent)\n([^`]*)```/gsu,
		(match: any, emoji: string, colour: string, calloutContent: string) => {
			return `<div class="kg-card kg-callout-card kg-callout-card-${colour}"><div class="kg-callout-emoji">${emoji}</div><div class="kg-callout-text">${calloutContent}</div></div>`;
		}
	);


	// convert [[link]] to <a href="BASE_URL/id" class="link-previews">Internal Micro</a>for Ghost
	// Includes media files (audio/video)
	const content = data.content.replace(
		/!?\[\[(.*?)\]\](?: *\n(.*))?/g,
		wikiLinkReplacer
	);

	data.content = content;

	// Convert ![test](https://hailstormsec.com/image.png) to an image 
	data.content = data.content.replace(
		/!\[(.*?)\]\((.*?)\)(?: *\n(.*))?/g,
		(match: any, p1: string, link: string, imageCaption: string) => {
			let alt;
			let width;
			if (p1.includes('(wide)')) {
				width = "kg-width-wide";alt = p1.replace('(wide)',"");
			} else if (p1.includes('(full)')) {
				width = "kg-width-full";alt = p1.replace('(full)',"");
		 	} else {
				alt = p1;
			}
			return `<figure class="kg-card kg-image-card ${width ? width : alt}"><img class="kg-image" alt="${alt}" src="${link}"></img>${imageCaption ? `<figcaption>${imageCaption}</figcaption>` : ""}</figure>`;
		}
	);

	// Convert [test](https://hailstormsec.com) to link 
	// Will also convest [Acronym](What it stands for) to a dropdown
	data.content = data.content.replace(
		/\[(.*?)\]\((.*?)\)(?: *\n(.*))?/g,
		(match: any, p1: string, link: string, imageCaption: string) => {
			let result;
			if (/((?:(?:href|src|xmlns)="\s*)?(?:mailto:)?(?:http(?:s)?:\/\/)?\b(?:[-a-zA-Z0-9@%_\+~#=]\.?){2,256}\.(?:aaa|aarp|abb|abbott|abbvie|abc|able|abogado|abudhabi|ac|academy|accenture|accountant|accountants|aco|actor|ad|ads|adult|ae|aeg|aero|aetna|af|afl|africa|ag|agakhan|agency|ai|aig|airbus|airforce|airtel|akdn|al|alibaba|alipay|allfinanz|allstate|ally|alsace|alstom|am|amazon|americanexpress|americanfamily|amex|amfam|amica|amsterdam|analytics|android|anquan|anz|ao|aol|apartments|app|apple|aq|aquarelle|ar|arab|aramco|archi|army|arpa|art|arte|as|asda|asia|associates|at|athleta|attorney|au|auction|audi|audible|audio|auspost|author|auto|autos|avianca|aw|aws|ax|axa|az|azure|ba|baby|baidu|banamex|bananarepublic|band|bank|bar|barcelona|barclaycard|barclays|barefoot|bargains|baseball|basketball|bauhaus|bayern|bb|bbc|bbt|bbva|bcg|bcn|bd|be|beats|beauty|beer|bentley|berlin|best|bestbuy|bet|bf|bg|bh|bharti|bi|bible|bid|bike|bing|bingo|bio|biz|bj|black|blackfriday|blockbuster|blog|bloomberg|blue|bm|bms|bmw|bn|bnpparibas|bo|boats|boehringer|bofa|bom|bond|boo|book|booking|bosch|bostik|boston|bot|boutique|box|br|bradesco|bridgestone|broadway|broker|brother|brussels|bs|bt|build|builders|business|buy|buzz|bv|bw|by|bz|bzh|ca|cab|cafe|cal|call|calvinklein|cam|camera|camp|canon|capetown|capital|capitalone|car|caravan|cards|care|career|careers|cars|casa|case|cash|casino|cat|catering|catholic|cba|cbn|cbre|cc|cd|center|ceo|cern|cf|cfa|cfd|cg|ch|chanel|channel|charity|chase|chat|cheap|chintai|christmas|chrome|church|ci|cipriani|circle|cisco|citadel|citi|citic|city|ck|cl|claims|cleaning|click|clinic|clinique|clothing|cloud|club|clubmed|cm|cn|co|coach|codes|coffee|college|cologne|com|comcast|commbank|community|company|compare|computer|comsec|condos|construction|consulting|contact|contractors|cooking|cool|coop|corsica|country|coupon|coupons|courses|cpa|cr|credit|creditcard|creditunion|cricket|crown|crs|cruise|cruises|cu|cuisinella|cv|cw|cx|cy|cymru|cyou|cz|dabur|dad|dance|data|date|dating|datsun|day|dclk|dds|de|deal|dealer|deals|degree|delivery|dell|deloitte|delta|democrat|dental|dentist|desi|design|dev|dhl|diamonds|diet|digital|direct|directory|discount|discover|dish|diy|dj|dk|dm|dnp|do|docs|doctor|dog|domains|dot|download|drive|dtv|dubai|dunlop|dupont|durban|dvag|dvr|dz|earth|eat|ec|eco|edeka|edu|education|ee|eg|email|emerck|energy|engineer|engineering|enterprises|epson|equipment|er|ericsson|erni|es|esq|estate|et|eu|eurovision|eus|events|exchange|expert|exposed|express|extraspace|fage|fail|fairwinds|faith|family|fan|fans|farm|farmers|fashion|fast|fedex|feedback|ferrari|ferrero|fi|fidelity|fido|film|final|finance|financial|fire|firestone|firmdale|fish|fishing|fit|fitness|fj|fk|flickr|flights|flir|florist|flowers|fly|fm|fo|foo|food|football|ford|forex|forsale|forum|foundation|fox|fr|free|fresenius|frl|frogans|frontier|ftr|fujitsu|fun|fund|furniture|futbol|fyi|ga|gal|gallery|gallo|gallup|game|games|gap|garden|gay|gb|gbiz|gd|gdn|ge|gea|gent|genting|george|gf|gg|ggee|gh|gi|gift|gifts|gives|giving|gl|glass|gle|global|globo|gm|gmail|gmbh|gmo|gmx|gn|godaddy|gold|goldpoint|golf|goo|goodyear|goog|google|gop|got|gov|gp|gq|gr|grainger|graphics|gratis|green|gripe|grocery|group|gs|gt|gu|guardian|gucci|guge|guide|guitars|guru|gw|gy|hair|hamburg|hangout|haus|hbo|hdfc|hdfcbank|health|healthcare|help|helsinki|here|hermes|hiphop|hisamitsu|hitachi|hiv|hk|hkt|hm|hn|hockey|holdings|holiday|homedepot|homegoods|homes|homesense|honda|horse|hospital|host|hosting|hot|hotels|hotmail|house|how|hr|hsbc|ht|hu|hughes|hyatt|hyundai|ibm|icbc|ice|icu|id|ie|ieee|ifm|ikano|il|im|imamat|imdb|immo|immobilien|in|inc|industries|infiniti|info|ing|ink|institute|insurance|insure|int|international|intuit|investments|io|ipiranga|iq|ir|irish|is|ismaili|ist|istanbul|it|itau|itv|jaguar|java|jcb|je|jeep|jetzt|jewelry|jio|jll|jm|jmp|jnj|jo|jobs|joburg|jot|joy|jp|jpmorgan|jprs|juegos|juniper|kaufen|kddi|ke|kerryhotels|kerrylogistics|kerryproperties|kfh|kg|kh|ki|kia|kids|kim|kindle|kitchen|kiwi|km|kn|koeln|komatsu|kosher|kp|kpmg|kpn|kr|krd|kred|kuokgroup|kw|ky|kyoto|kz|la|lacaixa|lamborghini|lamer|lancaster|land|landrover|lanxess|lasalle|lat|latino|latrobe|law|lawyer|lb|lc|lds|lease|leclerc|lefrak|legal|lego|lexus|lgbt|li|lidl|life|lifeinsurance|lifestyle|lighting|like|lilly|limited|limo|lincoln|link|lipsy|live|living|lk|llc|llp|loan|loans|locker|locus|lol|london|lotte|lotto|love|lpl|lplfinancial|lr|ls|lt|ltd|ltda|lu|lundbeck|luxe|luxury|lv|ly|ma|madrid|maif|maison|makeup|man|management|mango|map|market|marketing|markets|marriott|marshalls|mattel|mba|mc|mckinsey|md|me|med|media|meet|melbourne|meme|memorial|men|menu|merckmsd|mg|mh|miami|microsoft|mil|mini|mint|mit|mitsubishi|mk|ml|mlb|mls|mm|mma|mn|mo|mobi|mobile|moda|moe|moi|mom|monash|money|monster|mormon|mortgage|moscow|moto|motorcycles|mov|movie|mp|mq|mr|ms|msd|mt|mtn|mtr|mu|museum|music|mv|mw|mx|my|mz|na|nab|nagoya|name|natura|navy|nba|nc|ne|nec|net|netbank|netflix|network|neustar|new|news|next|nextdirect|nexus|nf|nfl|ng|ngo|nhk|ni|nico|nike|nikon|ninja|nissan|nissay|nl|no|nokia|norton|now|nowruz|nowtv|np|nr|nra|nrw|ntt|nu|nyc|nz|obi|observer|office|okinawa|olayan|olayangroup|oldnavy|ollo|om|omega|one|ong|onl|online|ooo|open|oracle|orange|org|organic|origins|osaka|otsuka|ott|ovh|pa|page|panasonic|paris|pars|partners|parts|party|pay|pccw|pe|pet|pf|pfizer|pg|ph|pharmacy|phd|philips|phone|photo|photography|photos|physio|pics|pictet|pictures|pid|pin|ping|pink|pioneer|pizza|pk|pl|place|play|playstation|plumbing|plus|pm|pn|pnc|pohl|poker|politie|porn|post|pr|pramerica|praxi|press|prime|pro|prod|productions|prof|progressive|promo|properties|property|protection|pru|prudential|ps|pt|pub|pw|pwc|qa|qpon|quebec|quest|racing|radio|re|read|realestate|realtor|realty|recipes|red|redstone|redumbrella|rehab|reise|reisen|reit|reliance|ren|rent|rentals|repair|report|republican|rest|restaurant|review|reviews|rexroth|rich|richardli|ricoh|ril|rio|rip|ro|rocks|rodeo|rogers|room|rs|rsvp|ru|rugby|ruhr|run|rw|rwe|ryukyu|sa|saarland|safe|safety|sakura|sale|salon|samsclub|samsung|sandvik|sandvikcoromant|sanofi|sap|sarl|sas|save|saxo|sb|sbi|sbs|sc|scb|schaeffler|schmidt|scholarships|school|schule|schwarz|science|scot|sd|se|search|seat|secure|security|seek|select|sener|services|seven|sew|sex|sexy|sfr|sg|shangrila|sharp|shaw|shell|shia|shiksha|shoes|shop|shopping|shouji|show|si|silk|sina|singles|site|sj|sk|ski|skin|sky|skype|sl|sling|sm|smart|smile|sn|sncf|so|soccer|social|softbank|software|sohu|solar|solutions|song|sony|soy|spa|space|sport|spot|sr|srl|ss|st|stada|staples|star|statebank|statefarm|stc|stcgroup|stockholm|storage|store|stream|studio|study|style|su|sucks|supplies|supply|support|surf|surgery|suzuki|sv|swatch|swiss|sx|sy|sydney|systems|sz|tab|taipei|talk|taobao|tatamotors|tatar|tattoo|tax|taxi|tc|tci|td|tdk|team|tech|technology|tel|temasek|tennis|teva|tf|tg|th|thd|theater|theatre|tiaa|tickets|tienda|tips|tires|tirol|tj|tjmaxx|tjx|tk|tkmaxx|tl|tm|tmall|tn|to|today|tokyo|tools|top|toray|toshiba|total|tours|town|toyota|toys|tr|trade|trading|training|travel|travelers|travelersinsurance|trust|trv|tt|tube|tui|tunes|tushu|tv|tvs|tw|tz|ua|ubank|ubs|ug|uk|unicom|university|uno|uol|ups|us|uy|uz|va|vacations|vana|vanguard|vc|ve|vegas|ventures|verisign|versicherung|vet|vg|vi|viajes|video|vig|viking|villas|vin|vip|virgin|visa|vision|viva|vivo|vlaanderen|vn|vodka|volvo|vote|voting|voto|voyage|vu|wales|walmart|walter|wang|wanggou|watch|watches|weather|weatherchannel|webcam|weber|website|wed|wedding|weibo|weir|wf|whoswho|wien|wiki|williamhill|win|windows|wine|winners|wme|wolterskluwer|woodside|work|works|world|wow|ws|wtc|wtf|xbox|xerox|xfinity|xihuan|xin|xxx|xyz|yachts|yahoo|yamaxun|yandex|ye|yodobashi|yoga|yokohama|you|youtube|yt|yun|za|zappos|zara|zero|zip|zm|zone|zuerich|zw)\b(?:[-a-zA-Z0-9@:%_\+.~#?!&//=]*)(?:<\/a>)?)/.test(link)) {
				let linkText = p1;
				return `<a href="${link}">${linkText}</a>`;
			} else {
				let meaning = link;
				let acronym = p1;
				return `<div class="text-dropdown"><span>${acronym}</span><div class="text-dropdown-content"><p>${meaning}</p></div></div>`;
			}
		}
	);

	// replaces remaining links with a-tags
	data.content = data.content.replace(
		/((?:(?:href|src|xmlns)="\s*)?(?:mailto:)?(?:http(?:s)?:\/\/)?\b(?:[-a-zA-Z0-9@%_\+~#=]\.?){2,256}\.(?:aaa|aarp|abb|abbott|abbvie|abc|able|abogado|abudhabi|ac|academy|accenture|accountant|accountants|aco|actor|ad|ads|adult|ae|aeg|aero|aetna|af|afl|africa|ag|agakhan|agency|ai|aig|airbus|airforce|airtel|akdn|al|alibaba|alipay|allfinanz|allstate|ally|alsace|alstom|am|amazon|americanexpress|americanfamily|amex|amfam|amica|amsterdam|analytics|android|anquan|anz|ao|aol|apartments|app|apple|aq|aquarelle|ar|arab|aramco|archi|army|arpa|art|arte|as|asda|asia|associates|at|athleta|attorney|au|auction|audi|audible|audio|auspost|author|auto|autos|avianca|aw|aws|ax|axa|az|azure|ba|baby|baidu|banamex|bananarepublic|band|bank|bar|barcelona|barclaycard|barclays|barefoot|bargains|baseball|basketball|bauhaus|bayern|bb|bbc|bbt|bbva|bcg|bcn|bd|be|beats|beauty|beer|bentley|berlin|best|bestbuy|bet|bf|bg|bh|bharti|bi|bible|bid|bike|bing|bingo|bio|biz|bj|black|blackfriday|blockbuster|blog|bloomberg|blue|bm|bms|bmw|bn|bnpparibas|bo|boats|boehringer|bofa|bom|bond|boo|book|booking|bosch|bostik|boston|bot|boutique|box|br|bradesco|bridgestone|broadway|broker|brother|brussels|bs|bt|build|builders|business|buy|buzz|bv|bw|by|bz|bzh|ca|cab|cafe|cal|call|calvinklein|cam|camera|camp|canon|capetown|capital|capitalone|car|caravan|cards|care|career|careers|cars|casa|case|cash|casino|cat|catering|catholic|cba|cbn|cbre|cc|cd|center|ceo|cern|cf|cfa|cfd|cg|ch|chanel|channel|charity|chase|chat|cheap|chintai|christmas|chrome|church|ci|cipriani|circle|cisco|citadel|citi|citic|city|ck|cl|claims|cleaning|click|clinic|clinique|clothing|cloud|club|clubmed|cm|cn|co|coach|codes|coffee|college|cologne|com|comcast|commbank|community|company|compare|computer|comsec|condos|construction|consulting|contact|contractors|cooking|cool|coop|corsica|country|coupon|coupons|courses|cpa|cr|credit|creditcard|creditunion|cricket|crown|crs|cruise|cruises|cu|cuisinella|cv|cw|cx|cy|cymru|cyou|cz|dabur|dad|dance|data|date|dating|datsun|day|dclk|dds|de|deal|dealer|deals|degree|delivery|dell|deloitte|delta|democrat|dental|dentist|desi|design|dev|dhl|diamonds|diet|digital|direct|directory|discount|discover|dish|diy|dj|dk|dm|dnp|do|docs|doctor|dog|domains|dot|download|drive|dtv|dubai|dunlop|dupont|durban|dvag|dvr|dz|earth|eat|ec|eco|edeka|edu|education|ee|eg|email|emerck|energy|engineer|engineering|enterprises|epson|equipment|er|ericsson|erni|es|esq|estate|et|eu|eurovision|eus|events|exchange|expert|exposed|express|extraspace|fage|fail|fairwinds|faith|family|fan|fans|farm|farmers|fashion|fast|fedex|feedback|ferrari|ferrero|fi|fidelity|fido|film|final|finance|financial|fire|firestone|firmdale|fish|fishing|fit|fitness|fj|fk|flickr|flights|flir|florist|flowers|fly|fm|fo|foo|food|football|ford|forex|forsale|forum|foundation|fox|fr|free|fresenius|frl|frogans|frontier|ftr|fujitsu|fun|fund|furniture|futbol|fyi|ga|gal|gallery|gallo|gallup|game|games|gap|garden|gay|gb|gbiz|gd|gdn|ge|gea|gent|genting|george|gf|gg|ggee|gh|gi|gift|gifts|gives|giving|gl|glass|gle|global|globo|gm|gmail|gmbh|gmo|gmx|gn|godaddy|gold|goldpoint|golf|goo|goodyear|goog|google|gop|got|gov|gp|gq|gr|grainger|graphics|gratis|green|gripe|grocery|group|gs|gt|gu|guardian|gucci|guge|guide|guitars|guru|gw|gy|hair|hamburg|hangout|haus|hbo|hdfc|hdfcbank|health|healthcare|help|helsinki|here|hermes|hiphop|hisamitsu|hitachi|hiv|hk|hkt|hm|hn|hockey|holdings|holiday|homedepot|homegoods|homes|homesense|honda|horse|hospital|host|hosting|hot|hotels|hotmail|house|how|hr|hsbc|ht|hu|hughes|hyatt|hyundai|ibm|icbc|ice|icu|id|ie|ieee|ifm|ikano|il|im|imamat|imdb|immo|immobilien|in|inc|industries|infiniti|info|ing|ink|institute|insurance|insure|int|international|intuit|investments|io|ipiranga|iq|ir|irish|is|ismaili|ist|istanbul|it|itau|itv|jaguar|java|jcb|je|jeep|jetzt|jewelry|jio|jll|jm|jmp|jnj|jo|jobs|joburg|jot|joy|jp|jpmorgan|jprs|juegos|juniper|kaufen|kddi|ke|kerryhotels|kerrylogistics|kerryproperties|kfh|kg|kh|ki|kia|kids|kim|kindle|kitchen|kiwi|km|kn|koeln|komatsu|kosher|kp|kpmg|kpn|kr|krd|kred|kuokgroup|kw|ky|kyoto|kz|la|lacaixa|lamborghini|lamer|lancaster|land|landrover|lanxess|lasalle|lat|latino|latrobe|law|lawyer|lb|lc|lds|lease|leclerc|lefrak|legal|lego|lexus|lgbt|li|lidl|life|lifeinsurance|lifestyle|lighting|like|lilly|limited|limo|lincoln|link|lipsy|live|living|lk|llc|llp|loan|loans|locker|locus|lol|london|lotte|lotto|love|lpl|lplfinancial|lr|ls|lt|ltd|ltda|lu|lundbeck|luxe|luxury|lv|ly|ma|madrid|maif|maison|makeup|man|management|mango|map|market|marketing|markets|marriott|marshalls|mattel|mba|mc|mckinsey|md|me|med|media|meet|melbourne|meme|memorial|men|menu|merckmsd|mg|mh|miami|microsoft|mil|mini|mint|mit|mitsubishi|mk|ml|mlb|mls|mm|mma|mn|mo|mobi|mobile|moda|moe|moi|mom|monash|money|monster|mormon|mortgage|moscow|moto|motorcycles|mov|movie|mp|mq|mr|ms|msd|mt|mtn|mtr|mu|museum|music|mv|mw|mx|my|mz|na|nab|nagoya|name|natura|navy|nba|nc|ne|nec|net|netbank|netflix|network|neustar|new|news|next|nextdirect|nexus|nf|nfl|ng|ngo|nhk|ni|nico|nike|nikon|ninja|nissan|nissay|nl|no|nokia|norton|now|nowruz|nowtv|np|nr|nra|nrw|ntt|nu|nyc|nz|obi|observer|office|okinawa|olayan|olayangroup|oldnavy|ollo|om|omega|one|ong|onl|online|ooo|open|oracle|orange|org|organic|origins|osaka|otsuka|ott|ovh|pa|page|panasonic|paris|pars|partners|parts|party|pay|pccw|pe|pet|pf|pfizer|pg|ph|pharmacy|phd|philips|phone|photo|photography|photos|physio|pics|pictet|pictures|pid|pin|ping|pink|pioneer|pizza|pk|pl|place|play|playstation|plumbing|plus|pm|pn|pnc|pohl|poker|politie|porn|post|pr|pramerica|praxi|press|prime|pro|prod|productions|prof|progressive|promo|properties|property|protection|pru|prudential|ps|pt|pub|pw|pwc|qa|qpon|quebec|quest|racing|radio|re|read|realestate|realtor|realty|recipes|red|redstone|redumbrella|rehab|reise|reisen|reit|reliance|ren|rent|rentals|repair|report|republican|rest|restaurant|review|reviews|rexroth|rich|richardli|ricoh|ril|rio|rip|ro|rocks|rodeo|rogers|room|rs|rsvp|ru|rugby|ruhr|run|rw|rwe|ryukyu|sa|saarland|safe|safety|sakura|sale|salon|samsclub|samsung|sandvik|sandvikcoromant|sanofi|sap|sarl|sas|save|saxo|sb|sbi|sbs|sc|scb|schaeffler|schmidt|scholarships|school|schule|schwarz|science|scot|sd|se|search|seat|secure|security|seek|select|sener|services|seven|sew|sex|sexy|sfr|sg|shangrila|sharp|shaw|shell|shia|shiksha|shoes|shop|shopping|shouji|show|si|silk|sina|singles|site|sj|sk|ski|skin|sky|skype|sl|sling|sm|smart|smile|sn|sncf|so|soccer|social|softbank|software|sohu|solar|solutions|song|sony|soy|spa|space|sport|spot|sr|srl|ss|st|stada|staples|star|statebank|statefarm|stc|stcgroup|stockholm|storage|store|stream|studio|study|style|su|sucks|supplies|supply|support|surf|surgery|suzuki|sv|swatch|swiss|sx|sy|sydney|systems|sz|tab|taipei|talk|taobao|tatamotors|tatar|tattoo|tax|taxi|tc|tci|td|tdk|team|tech|technology|tel|temasek|tennis|teva|tf|tg|th|thd|theater|theatre|tiaa|tickets|tienda|tips|tires|tirol|tj|tjmaxx|tjx|tk|tkmaxx|tl|tm|tmall|tn|to|today|tokyo|tools|top|toray|toshiba|total|tours|town|toyota|toys|tr|trade|trading|training|travel|travelers|travelersinsurance|trust|trv|tt|tube|tui|tunes|tushu|tv|tvs|tw|tz|ua|ubank|ubs|ug|uk|unicom|university|uno|uol|ups|us|uy|uz|va|vacations|vana|vanguard|vc|ve|vegas|ventures|verisign|versicherung|vet|vg|vi|viajes|video|vig|viking|villas|vin|vip|virgin|visa|vision|viva|vivo|vlaanderen|vn|vodka|volvo|vote|voting|voto|voyage|vu|wales|walmart|walter|wang|wanggou|watch|watches|weather|weatherchannel|webcam|weber|website|wed|wedding|weibo|weir|wf|whoswho|wien|wiki|williamhill|win|windows|wine|winners|wme|wolterskluwer|woodside|work|works|world|wow|ws|wtc|wtf|xbox|xerox|xfinity|xihuan|xin|xxx|xyz|yachts|yahoo|yamaxun|yandex|ye|yodobashi|yoga|yokohama|you|youtube|yt|yun|za|zappos|zara|zero|zip|zm|zone|zuerich|zw)\b(?:[-a-zA-Z0-9@:%_\+.~#?!&//=]*)(?:<\/a>)?)/g,
		(match: any, p1: string) => {
			if (p1.includes('href="') || p1.includes('src="') || p1.includes('xmlns="') || p1.includes('</a>')) {
				return p1;
			} else {
				return `<a href="${p1}">${p1}</a>`;
			}
		}
	)


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

	// replace callouts with callout html (directly compatible with [Obsidian theme](coming soon))
		// If not using the Obsidian theme you will need the css bellow:
		
		// .callout-fold-button {
		// 	transition: transform 0.3s ease; /* Add a transition property for the transform */
		// }

		// .callout-fold-button.foldable-true {
		// 	transform: rotate(0deg);
		// }

		// .callout-fold-button.foldable-false {
		// 	transform: rotate(90deg);
		// }

		// .callout-content {
		// 	-moz-transition: height .3s;
		// 	-ms-transition: height .3s;
		// 	-o-transition: height .3s;
		// 	-webkit-transition: height .3s;
		// 	transition: height .3s;
		// 	overflow: hidden;
		// }

		// Modify for each callout type:
		// .callout-warning, .callout-caution, .callout-attention {
		// 	background-color: #3c2c22;
		// 	--tw-border-opacity: 1;
		// 	border-color: #f85c01;
		// 	color: #f85c01;
		// 	stroke: #f85c01;
		// }
	data.content = data.content.replace(
		/>\s*\[!(\w+)\](-?)\s*(.*?)((?=\n>\s*)\s*.*?(?=\n(?!>\s*)))/gs,
		(match: any, calloutType: string, foldableBool: any, calloutTitle: string, calloutBody: string) => {
			if (foldableBool) {
				foldableBool = true;
			} else {
				foldableBool = false;
			}

			// If there is no title, make the type the title
			if (!calloutTitle) {
				calloutTitle = calloutType;
				calloutTitle[0].toUpperCase();
			}

			calloutBody = calloutBody.replace(/^>\s*/gm, "");
			calloutBody = md.render(calloutBody);

			// If calloutType is toggle or cite it will make a toggle-card or cite-card
			// The callout title has to be either "Default" or "Alternative", for the blockquote to apply
			if (calloutType === "toggle") {
				return `<div class="kg-card kg-toggle-card" data-kg-toggle-state="close"><div class="kg-toggle-heading"><h4 class="kg-toggle-heading-text">${calloutTitle}</h4></div><div class="kg-toggle-content">${calloutBody}</div></div>`;
			} else if (calloutType === "cite" || calloutType === "quote") {
				if (calloutTitle.toLowerCase() === "default") {
					return `<blockquote>${calloutBody}</blockquote>`
				} else if (calloutTitle.toLowerCase() === "alternative") {
					return `<blockquote class="kg-blockquote-alt">${calloutBody}</blockquote>`
				}
			}

			// Define an object where keys are callout types and values are SVG strings
			const calloutSVGs: { [key: string]: string } = {
				"cite": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-quote"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',
				"quote": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-quote"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',
				"warning": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>', // SVG for "warning"
				"caution": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>', // SVG for "caution"
				"attention": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>', // SVG for "attention"
				"help": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-help-circle"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
				"faq": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-help-circle"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
				"question": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-help-circle"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
				"success": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><polyline points="20 6 9 17 4 12"/></svg>',
				"check": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><polyline points="20 6 9 17 4 12"/></svg>',
				"done": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check"><polyline points="20 6 9 17 4 12"/></svg>',
				"important": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flame"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
				"tip": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flame"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
				"hint": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flame"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
				"abstract": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clipboard-list"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>',
				"summary": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clipboard-list"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>',
				"tldr": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clipboard-list"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>',
				"failure": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
				"fail": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
				"missing": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
				"danger": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
				"error": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
				"target": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-crosshair"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>',
				"pro": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-thumbs-up"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg>',
				"con": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-thumbs-down"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg>',
				"flag": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>',
				"info": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-info"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
				"todo": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-todo"><rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>',
				"note": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
				"example": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
				"bug": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bug"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>',
				"missinig": '<svg style="margin-right:0.5rem;" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ban"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>'
			};
			const arrow = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right"><path d="m9 18 6-6-6-6"/></svg>'

			// Use the calloutSVGs object to get the SVG based on calloutType
			const svg = calloutSVGs[calloutType] || 'missing'; // Default to an empty string if calloutType is not found

			return `<div class="callout-card callout-${calloutType.toLowerCase()}" style="display:flex;flex-direction:column;border-radius: 0.5rem;border-left-width: 4px;padding: 1rem;--tw-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);--tw-shadow-colored: 0 4px 6px -1px var(--tw-shadow-color), 0 2px 4px -2px var(--tw-shadow-color);box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);margin-top: 1rem;margin-bottom: 1rem;"><div style="display:flex;align-items:center; margin-bottom:0.5rem;">${svg}<p style="font-weight: 600;" class="callout-${calloutType.toLowerCase()}">${calloutTitle}</p><button class="callout-${calloutType.toLowerCase()} callout-fold-button foldable-${foldableBool}" style="margin-left:0.5rem;">${arrow}</button></div><div style="color:white;" class="callout-content"><div class="wrapper">${calloutBody}</div></div></div>`;
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
		console.log("slug", frontmatter.slug);
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
				console.log("htmlcontent", htmlContent.posts[0].html);
				
				try {
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
				} catch(error) {
					console.error("Request error:", error);
				}
			} else {
				const htmlContent = contentPost(frontmatter, data);
				htmlContent.posts[0].html = replacer(htmlContent.posts[0].html);
				console.log("htmlcontent", htmlContent.posts[0].html);

				// upload post
				try {
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
				} catch(error) {
					console.error("Request error:", error);
				}
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
				console.log("htmlcontent", htmlContent.pages[0].html);

				
				try {
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
				} catch(error) {
					console.error("Request error:", error);
				}
			} else {
				const htmlContent = contentPage(frontmatter, data);
				htmlContent.pages[0].html = replacer(htmlContent.pages[0].html);
				console.log("htmlcontent", htmlContent.pages[0].html);


				try {
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
				} catch(error) {
					console.error("Request error:", error);
				}
			}
		}
	}
};
