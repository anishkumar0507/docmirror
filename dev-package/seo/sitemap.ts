// app/sitemap.ts
// Auto-served at thedocmirror.com/sitemap.xml
//
// v4: Static sitemap only. The 620 specialty×city pages have been REMOVED.
// The new SEO strategy is the 4 resource pages + per-doctor preview pages
// (which are added dynamically via the Supabase preview_pages table — see below).

import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

const BASE = 'https://thedocmirror.com'
const TODAY = new Date().toISOString().split('T')[0]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const urls: MetadataRoute.Sitemap = [
    { url: `${BASE}/`,                                changeFrequency: 'weekly',  priority: 1.0, lastModified: TODAY },
    { url: `${BASE}/resources`,                       changeFrequency: 'monthly', priority: 0.9, lastModified: TODAY },
    { url: `${BASE}/ai-visibility-for-doctors`,       changeFrequency: 'monthly', priority: 0.9, lastModified: TODAY },
    { url: `${BASE}/doctor-visibility-score`,         changeFrequency: 'monthly', priority: 0.9, lastModified: TODAY },
    { url: `${BASE}/how-doctors-rank-in-chatgpt`,     changeFrequency: 'monthly', priority: 0.9, lastModified: TODAY },
    { url: `${BASE}/google-visibility-for-doctors`,   changeFrequency: 'monthly', priority: 0.9, lastModified: TODAY },
    { url: `${BASE}/privacy`,                         changeFrequency: 'yearly',  priority: 0.4, lastModified: TODAY },
    { url: `${BASE}/terms`,                           changeFrequency: 'yearly',  priority: 0.4, lastModified: TODAY },
  ]

  // Append public preview pages from Supabase
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data } = await supabase
      .from('preview_pages')
      .select('slug, made_public_at')
      .eq('is_public', true)

    if (data) {
      for (const p of data) {
        urls.push({
          url: `${BASE}/preview/${p.slug}`,
          changeFrequency: 'weekly',
          priority: 0.7,
          lastModified: p.made_public_at?.split('T')[0] || TODAY,
        })
      }
    }
  } catch (e) {
    console.error('Failed to fetch preview pages for sitemap', e)
  }

  return urls
}
