# Resources — publishing guide

Posts live in **`content/resources/`** (this folder) and hero images in
**`public/images/resources/`**. Add a post and it appears automatically on the
listing at **/resources**, at its own URL, in the sitemap, and with full SEO
metadata. **No code changes required.**

## Easiest: the /imports drop-zone

Drop a blog Markdown file **and** its hero image into `../imports/`, then run:

```
npm run import-resources
```

It moves the image into `public/images/resources/`, writes the post here with a
correct image path, and cleans `/imports` on success. See `../imports/README.md`.

## Or auto-publish from anywhere on disk

```
npm run publish-resource -- path/to/post.md path/to/image.png
```

It derives the slug from the title, copies the image into
`../public/images/resources/` renamed after the slug (collision-safe — never
overwrites), writes a guaranteed-correct **website-relative** `image:` path into
the frontmatter, saves the post here as `<slug>.md`, and verifies the image
renders on both the card and the article before finishing. The image path can
never be wrong.

Options: `--title`, `--slug`, `--category`, `--author`, `--excerpt`,
`--date YYYY-MM-DD`, `--force` (overwrite an existing image of the same slug).

## Or publish manually in 3 steps

1. **Drop a Markdown file** in this folder, e.g. `my-new-guide.md`.
   The filename becomes the URL slug → `/resources/my-new-guide`.
2. **Drop a hero image** in `../public/images/resources/`
   (recommended: JPG or PNG, 1200×675). Reference it in the frontmatter.
3. **Deploy.** It now appears on `/resources`, at `/resources/my-new-guide`,
   in `/sitemap.xml`, and with Open Graph / Twitter / Schema.org tags.

## Frontmatter template

```markdown
---
title: My New Guide                      # required
description: One-line summary (also the card excerpt & meta description).
date: 2026-07-09                          # YYYY-MM-DD — used for sort order
author: The Doc Mirror
category: AI Visibility                    # shown as the card tag
image: /images/resources/my-new-guide.jpg  # hero image (optional; falls back to a branded placeholder)
imageAlt: Descriptive alt text
tags: [AI Visibility, ChatGPT]             # used for tagging
seoTitle: My New Guide — Custom SEO Title | The Doc Mirror   # optional, defaults to title
metaDescription: Optional custom meta description.           # optional, defaults to description
faq:                                        # optional — renders an FAQ accordion + FAQ schema
  - question: A question about this topic?
    answer: The answer shown when the item is expanded.
  - question: Another question?
    answer: Another answer.
---

Write the body in normal Markdown below the frontmatter.
```

`featuredImage` (instead of `image`), `excerpt` (instead of `description`), and
`readTime` are also accepted as aliases.

## Optional flags

- `slug: custom-url` — override the URL slug (defaults to the filename).
- `published: false` or `draft: true` — hide a file from the site.

## What renders automatically

- H1 / H2 / H3, lists, tables, images, blockquotes, code blocks
- Reading time (≈200 words/min), formatted date, URL slug, excerpt
- Listing card (image, category, date, reading time, title, excerpt)
- Article page (hero image, title, metadata, content, related resources,
  Back to Resources, and the "Run a free visibility audit" CTA)
- Canonical URL, Open Graph, Twitter Card, Schema.org Article + Breadcrumb
- A `/sitemap.xml` entry
