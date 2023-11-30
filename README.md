# Obsidian Ghost Publish

Plugin for publish to [Ghost](https://ghost.org/) site for [Obsidian](https://obsidian.md/) with a single click.

Do you like the plugin? 
Support me here: https://www.paypal.com/donate/?hosted_button_id=ZGJD7B5YPFLRE 
Or subscribe to my blog: https://hailstormsec.com/#/portal
And follow me here: https://hailstormsec.com/about

## How to use

- Create a custom integration follow this [link](https://ghost.org/integrations/custom-integrations/). You would need an **Admin API Key** and **API URL**.
- Once you install the plugin, enable the plugin and add the API KEy and API URL to the setting.
- That's it! you now are able to publish the current document by click on the ghost icon on the sidebar or use the command pallete (CMD+P).

## Functionality

- Post directly from Obsidian
    - Including callouts (Note: not admonitions)
    - Uploads images
    - Create dropdown text
    - If post exist, updates it
- Create and upload Ghost cards from Obsidian
    - Use the syntax bellow
    - Gallery is the only one not implemented

## Plugin settings

Documented in the plugin settings.

## Frontmatter format

Obsidian Ghost Publish use frontmatter to specify on how you want to publish your post.

At the moment, the format is limited to:

```md
type: string (default: post)
title: string (default: file name)
slug: string (default: filename in lowercase and spaces = "-")
tags: (default: [])
- tag1
- tag2
featured: boolean (default: false)
published: boolean (default: false)
access: string (default: public)
excerpt: string (default: undefined)
feature_image: string (default: undefined) (URL)
meta_title: string (default: file name)
meta_description: string (default: undefined)
canonical_url: string (default: undefined)
files_directory: string (default: undefined)
files_upload: boolean (default: false)
```
type: Post/Page
title: Post title
slug: post-title
tags: Post tags
featured: Featured post (yes/no)
published: Publish post, otherwise draft (yes/no)
access: Post accessability (public/members/paid)
excerpt: The post excerpt
feature_image: Featured image of post
meta_title: Title displayed to search engine result pages
meta_description: Description displayed to search engine result pages
canonical_url: The url displayed to search engine result pages
files_directory: Directory for images, relative path to vault (require "/" in beginning, will extend the "Image Folder" setting if set). Mostly to avoid a messy image folder.
files_upload: Upload images inside of your note to ghost. Default off to avoid duplicate pictures on server.

### Example
At the top of your obsidian note:
```md
---
type: post
title: Example Post
slug: example-post
tags:
- Exampletag
- Test
featured: true
published: false
access: paid
excerpt: This is a test post with the goal of showcasing this plugin
feature_image: https://myblog.com/content/images/2023/09/example.png
meta_title: Example Post - MyObsidian Blog
meta_description: Struggeling to submit content to ghot? We will show you in this article!
canonical_url: https://myblog.com/example-post-but-better
files_directory: /example-post-images
files_upload: true
---
```

## Ghost cards syntax

At the bottom of the page you will find the markdown file with the syntax used to create the page: https://hailstormsec.com/style-guide

## How to run on dev

- Clone this repo.
- `npm i` or `yarn` to install dependencies
- `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Run `npm run build`
- Copy over `main.js` and `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## FAQ

Q: Why doesn't my images upload?
A: Probably due to your CORS settings. Double check by opening dev-tools in obsidian (CTRL+SHIFT+I) If you have control over the server you can implement [these nginx settings](https://enable-cors.org/server_nginx.html).

Q: Some elements look ugly, can I fix that?
A: The majority of elements created with this plugin uses ghosts own css classes (class="kg-..."). In the ghost headers you can override anything you're not happy with. If it doesn't use a ghost class, you can simply override the element:

```html
<!-- Example -->
<style>
    .kg-embed-card {
        /* your-css */
    }

    table {
        /* your-css */
    }
</style>
```

Q: Why is the first image getting removed?
A: I have a featured image on my posts even in obsidian, but to prevent getting two of the same image in ghost, the plugin removes the first image in the note.

### Issues & Requests

- For feature requests, please take use of Discussions.
- For any issues with current versions, please use Issues.

## Credits

Major credits to the original developer [Jay](https://github.com/jaynguyens) and [Bram](https://github.com/bramses) for initial fork with added functionality and assistance.