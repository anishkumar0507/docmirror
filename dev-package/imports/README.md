# /imports — blog drop-zone

Drop a blog **Markdown file** and its **hero image** here, then run:

```
npm run import-resources
```

For each Markdown file this automatically:

- moves the image → `../public/images/resources/` (renamed to the post slug, collision-safe)
- writes the post → `../content/resources/<slug>.md` with a correct, website-relative image path
- makes it appear on `/resources` (featured if newest), its own page, and the sitemap
- **deletes the consumed files from this folder** on success

### Image pairing (first match wins)
1. an image with the **same name** as the post — `my-post.md` + `my-post.png`
2. the image **referenced in the post's frontmatter** (matched by filename)
3. if there's exactly **one** Markdown file and **one** image, they pair automatically

Unmatched files are **left here** (never deleted) with a warning, so nothing is lost.

> This README and `.gitkeep` are ignored by the importer.
