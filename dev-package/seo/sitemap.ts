// filepath: /Users/kunalsingh/Downloads/docmirror/dev-package/seo/sitemap.ts
// app/sitemap.ts
// Auto-served at thedocmirror.com/sitemap.xml
//
// v4: Static sitemap only. The 620 specialty×city pages have been REMOVED.
// The new SEO strategy is the 4 resource pages + per-doctor preview pages
// (which are added dynamically via the Supabase preview_pages table — see below).

import { MetadataRoute } from 'next'

const BASE = 'https://thedocmirror.com'
const TODAY = new Date().toISOString().split('T')[0]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const urls: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: 'weekly', priority: 1.0, lastModified: TODAY },
    { url: `${BASE}/pages/resources.html`, changeFrequency: 'monthly', priority: 0.9, lastModified: TODAY },
    { url: `${BASE}/pages/ai-visibility-for-doctors.html`, changeFrequency: 'monthly', priority: 0.9, lastModified: TODAY },
    { url: `${BASE}/pages/doctor-visibility-score.html`, changeFrequency: 'monthly', priority: 0.9, lastModified: TODAY },
    { url: `${BASE}/pages/how-doctors-rank-in-chatgpt.html`, changeFrequency: 'monthly', priority: 0.9, lastModified: TODAY },
    { url: `${BASE}/pages/google-visibility-for-doctors.html`, changeFrequency: 'monthly', priority: 0.9, lastModified: TODAY },
  ]

  return urls
}
