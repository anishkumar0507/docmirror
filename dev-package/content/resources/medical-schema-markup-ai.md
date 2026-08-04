---
title: "Medical Schema Markup for AI Visibility: A Doctor's Setup Guide"
description: "Medical schema markup helps AI assistants read your practice without guessing. A step-by-step setup and testing guide for doctors in the US and India."
date: 2026-08-04
author: The Doc Mirror Team
category: AI Visibility
image: /images/resources/medical-schema-markup-for-ai-visibility.jpeg
imageAlt: medical-schema-markup-for-ai-visibility
tags: [AI Visibility, Schema Markup, Structured Data, AEO]
seoTitle: "Medical Schema Markup for AI Visibility: Doctor Setup | The Doc Mirror"
metaDescription: "Medical schema markup helps AI assistants read your practice without guessing. A step-by-step setup and testing guide for doctors in the US and India."
faq:
  - question: Is medical schema markup required for AI assistants to find me?
    answer: "No. Google states there is no special markup required to appear in AI features, and the same holds broadly for AI assistants. Schema does not unlock visibility on its own. What it does is remove ambiguity, so that when ChatGPT, Gemini, Claude, or Perplexity read your site, your specialty, location, and services are stated as clean data rather than inferred from prose. It is hygiene that reduces the chance of being misread or skipped, not a guarantee of being recommended."
  - question: Which schema types should a solo doctor start with?
    answer: "Start with two: Physician and MedicalBusiness. Physician carries your name, specialty, and qualifications. MedicalBusiness carries your clinic name, address, hours, and phone. Together they answer 'who is this clinician' and 'where is this practice,' the two questions almost every patient search implies. Once those are clean and validated, add FAQPage to your questions page, because AI answers are assembled from question-and-answer pairs and that type is easiest for an assistant to quote."
  - question: How do I test whether my schema is working?
    answer: "Use Google's Rich Results Test and the schema.org validator. Paste your page URL or code into each, then fix every error until both pass cleanly. After that, confirm the page is crawlable, since schema on an unreachable page achieves nothing. Finally, ask ChatGPT, Gemini, Claude, and Perplexity a real patient-style question and observe how you appear. Revalidate every time you change the page or the markup."
  - question: Is schema markup different for doctors in India versus the US?
    answer: "The schema types are identical, because schema.org is a global standard. What differs is framing. A US practice references directories like Healthgrades, Zocdoc, and Vitals and can state services plainly. An Indian clinic references Practo, JustDial, and Apollo 247, and should keep the content strictly factual to stay within NMC rules that restrict self-promotion. You are labeling existing information such as location, timings, and qualifications so it is consistent and findable, not advertising."
  - question: Will schema markup help me appear in "near me" AI searches?
    answer: "It helps by making your location unambiguous. The MedicalBusiness type carries your address, geographic coordinates, and opening hours as structured data, which lets an assistant match you to a query like 'gynaecologist near me in Mumbai' or 'dentist near me in Denver.' It does not override authority or reviews, so it is one input among several. But without it, the AI guesses your location from prose, and guessing is where you get dropped."
  - question: How often should I update my schema?
    answer: "Update it the same day any underlying fact changes: a new address, revised hours, an added service, or a changed phone number. Stale structured data is worse than none, because it states something false with full machine confidence and an AI will trust it. Beyond that, revalidate after any website redesign, since template changes often strip or break existing markup with no visible sign on the page."
---

Medical schema markup is structured code you add to your website that tells search engines and AI assistants exactly what your page means, in a format they cannot misread. It labels your name, specialty, clinic address, hours, and services as data, not just text. This does not force ChatGPT, Gemini, Claude, or Perplexity to recommend you. What it does is remove ambiguity, so an AI reading your site does not have to guess who you are. For a dermatologist in Austin or a gynaecologist in Pune, that clarity is the difference between being parsed correctly and being skipped.

## What is medical schema markup

Schema markup is a shared vocabulary, published at schema.org, that turns plain web content into labeled data. Instead of an AI reading "Dr. Anjali Rao, MBBS, DGO, consulting in Koregaon Park" and inferring the parts, schema states each fact explicitly: this is the physician name, this is the medical specialty, this is the address.

The most common format is JSON-LD, a small block of code that sits in your page's HTML without changing how the page looks to a patient. Google recommends it, and it is the easiest to add and maintain. You are not rewriting your website, you are attaching a machine-readable label to what is already there.

Think of it as the CODE layer of your visibility. Your identity across the web is one layer, whether AI crawlers can reach your site is another, and schema is the layer that makes the content they reach unambiguous. Schema is the one most doctors have never touched.

## Does schema markup make AI recommend you

No, and any tool that promises otherwise is overselling. Google's own documentation is explicit: there is no special markup required to appear in AI features. So it is worth being precise about what schema does.

Schema does not buy you a ranking or manufacture authority you have not earned. What it does is reduce the number of ways your information can be misunderstood. When your specialty, location, and services are stated as data, an AI answering "who is a good paediatric cardiologist near me" has cleaner facts to work with and fewer reasons to omit or garble you.

The honest framing is this: schema is necessary hygiene, not a growth hack. It removes friction, it does not create demand. But where a competing clinic three streets away has zero structured data, clean markup is a quiet, durable edge. It is one part of the broader shift toward [generative engine optimization for doctors](/resources/geo-for-doctors), where being machine-readable is table stakes.

## Which schema types matter for a medical practice

You do not need every type in the schema.org catalog. For a doctor or clinic, five types carry almost all the value.

1. **Physician.** Describes you as an individual clinician. It carries your name, medical specialty, qualifications, languages spoken, and hospital or clinic affiliation. This is your core identity as a person who practises medicine.
2. **MedicalBusiness (or its parent, MedicalClinic).** Describes the practice as a place, carrying the clinic name, address, phone, opening hours, and geographic coordinates. This is what anchors you to a location like Denver or Hyderabad.
3. **FAQPage.** Marks up a list of questions and answers, telling the AI "these are real patient questions and here are the exact answers," which is easy for an assistant to lift and quote.
4. **HowTo.** Marks up step-by-step instructions, for example how to prepare for a test or procedure. Useful for a physiotherapist or a diagnostics-heavy practice with genuine procedural content.
5. **Article.** Marks up your blog posts and educational pages, carrying the headline, author, and publish date so an AI can attribute the writing to you and judge its freshness.

Physician and MedicalBusiness are the non-negotiable pair. FAQPage is the highest-value addition, because AI answers are built from questions. Together these types support [your online presence across the web](/resources/what-is-doctor-online-visibility), the identity layer schema plugs into.

Notice the pattern behind the fields, because the fields are what the AI actually consumes. Each type maps to a question a patient might ask an assistant. Physician answers "who is this clinician," and its `medicalSpecialty` field is critical, because a cardiologist who leaves it blank forces the AI to guess. MedicalBusiness answers "where is this practice and is it open" through its address and hours. FAQPage and Article carry the questions you answer and the writing you author, which feeds the Experience, Expertise, Authoritativeness, Trust (E-E-A-T) signals AI systems weigh when deciding whom to cite. That is why schema and [medical FAQ content](/resources/medical-faq-content-ai) reinforce each other: the FAQ gives the answer, the schema labels it so it is quotable.

## How to set up medical schema markup step by step

You can do a basic setup without a developer, though a developer makes the ongoing version cleaner.

1. **Inventory your facts.** Write down your exact clinic name, full address, phone, hours, specialties, and the qualifications you want to display. Consistency matters, so match these to your Google Business Profile and your directory listings exactly.
2. **Choose your types per page.** Your homepage or about page gets Physician plus MedicalBusiness. Your FAQ page gets FAQPage. A procedure-prep page gets HowTo. Each blog post gets Article. One page can carry more than one type.
3. **Generate the JSON-LD.** Use a reputable schema generator or Google's structured data guidance, and fill in your real values from step 1. Do not mark up information that is not visibly present on the page, because that violates the guidelines.
4. **Add the code to the page.** Paste the JSON-LD block into the page's HTML. On WordPress, a schema or SEO plugin can insert it. On a site builder, use a custom-code or embed block.
5. **Validate before you trust it.** Run every page through a testing tool (covered below) and fix any errors until it passes cleanly.
6. **Keep it current.** When your hours, address, or services change, update the schema the same day. Stale structured data is worse than none, because it tells the AI something false with full confidence.

For an Indian clinic, keep the framing factual. You are labeling information that already exists, such as your location, timings, and qualifications, so it is findable and consistent. Under NMC rules that restrict self-promotion, this is accuracy, not advertising.

## What most doctors get wrong with schema

The failures are predictable, and each one is avoidable.

The first mistake is marking up nothing at all, then blaming the AI for not knowing them. The second is inconsistency: your website says one clinic name, your Google Business Profile says another, and Practo or Healthgrades says a third. Schema cannot fix contradictions it did not create, so fix the facts first, then label them.

The third is marking up invisible or fake content, such as FAQPage schema for questions not on the page, or claiming credentials not shown. This can trigger a manual penalty, so only mark up what a patient can actually see. The fourth is setting it once and forgetting it. A cardiologist who moves clinics in Chennai and leaves the old address in schema is misinforming every AI that reads the page.

## How to test your medical schema markup

Never assume your markup works, because a single syntax error can invalidate the whole block. Use these checks.

1. **Google's Rich Results Test.** Paste your page URL or code. It confirms whether Google can read your structured data and flags errors by type.
2. **The Schema.org validator.** This checks your JSON-LD against the raw schema.org vocabulary, catching field names or nesting that are technically invalid.
3. **A live re-crawl check.** Confirm the page is actually crawlable, because schema on a page AI crawlers cannot reach does nothing. That reachability layer is part of [why AI search engines don't mention your clinic](/resources/chatgpt-doesnt-mention-your-clinic).
4. **A real-question spot check.** Ask ChatGPT, Gemini, Claude, and Perplexity a question a patient would ask, such as "dermatologist for acne scars in New York" or "physiotherapist in Bengaluru for sports injury," and see whether you appear. It tells you what a patient experiences.

Treat testing as recurring. Every time you change the page or the schema, revalidate.

## Get your schema and the rest of your visibility checked

Schema is the CODE layer, and it works only when the identity and crawlability layers around it are healthy too. The fastest way to know where you stand is to see your whole picture at once.

The [Free Audit](/#tool) at thedocmirror.com runs your practice across Google, ChatGPT, Gemini, Claude, Perplexity, and 6 directories, scores you on the [7 pillars](/doctor-visibility-score), and shows which gaps to close first. Your visibility score tells you whether your structured data, your identity, and your reachability are working together or quietly against each other. [See how doctors rank inside ChatGPT](/resources/how-doctors-rank-in-chatgpt) for the demand side of this picture.
