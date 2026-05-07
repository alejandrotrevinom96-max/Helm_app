// PR #27 — Sprint 4: Image validation loop.
//
// 12 marketing surfaces a brand actually shows up on. The grid in
// /marketing → Brand Bible → Validate visually renders one image per
// context so the user can confirm Helm is reading their voice across
// realistic use cases — not just "a generic product photo".
//
// `dimensions` is mapped to the closest fal.ai image_size in
// generate-validation-images.ts. Adding a context only requires
// updating this list — the generator + UI iterate over it.
export interface ImageContext {
  id: string;
  label: string;
  description: string;
  // Only the four ratios we currently render. Map to fal sizes in
  // the generator; expand here when adding new contexts.
  dimensions: '1:1' | '16:9' | '9:16' | '4:5';
  promptStyle: string;
}

export const IMAGE_CONTEXTS: ImageContext[] = [
  {
    id: 'instagram_cover',
    label: 'Instagram post cover',
    description: 'Square, vibrant, scroll-stopping',
    dimensions: '1:1',
    promptStyle:
      'vibrant social media square image, eye-catching composition, scroll-stopping aesthetic',
  },
  {
    id: 'linkedin_header',
    label: 'LinkedIn header background',
    description: 'Professional, wide format',
    dimensions: '16:9',
    promptStyle:
      'professional banner background, wide cinematic format, business-appropriate',
  },
  {
    id: 'website_hero',
    label: 'Website hero banner',
    description: 'Brand statement, bold',
    dimensions: '16:9',
    promptStyle:
      'website hero image, bold brand statement, high-impact visual',
  },
  {
    id: 'quote_tile',
    label: 'Quote tile',
    description: 'Minimal, text-friendly',
    dimensions: '1:1',
    promptStyle:
      'minimal quote tile background, clean composition leaving generous negative space for text overlay, subtle texture',
  },
  {
    id: 'founder_photo',
    label: 'Founder photo style',
    description: 'Portrait, authentic',
    dimensions: '4:5',
    promptStyle:
      'authentic founder portrait style, candid lifestyle photography, natural lighting, real not staged',
  },
  {
    id: 'product_mockup',
    label: 'Product mockup',
    description: 'Showcase, clean',
    dimensions: '1:1',
    promptStyle:
      'clean product mockup composition, showcase styling, neutral backdrop',
  },
  {
    id: 'behind_scenes',
    label: 'Behind-the-scenes',
    description: 'Authentic, candid',
    dimensions: '16:9',
    promptStyle:
      'behind-the-scenes candid shot, authentic workspace, real moment captured, natural light',
  },
  {
    id: 'testimonial',
    label: 'Testimonial card',
    description: 'Customer-focused, warm',
    dimensions: '1:1',
    promptStyle:
      'warm testimonial backdrop, customer-focused composition, inviting and friendly',
  },
  {
    id: 'stats_viz',
    label: 'Stats visualization',
    description: 'Data-driven, clean',
    dimensions: '16:9',
    promptStyle:
      'data visualization aesthetic, clean charts and numbers, infographic style, no real numbers',
  },
  {
    id: 'announcement',
    label: 'Announcement banner',
    description: 'News-worthy, bold',
    dimensions: '16:9',
    promptStyle:
      'announcement banner style, news-worthy bold composition, attention-grabbing',
  },
  {
    id: 'lifestyle',
    label: 'Lifestyle scene',
    description: 'Aspirational, real',
    dimensions: '1:1',
    promptStyle:
      'lifestyle scene photography, aspirational but real, target audience moment',
  },
  {
    id: 'brand_mood',
    label: 'Brand mood',
    description: 'Abstract feeling',
    dimensions: '1:1',
    promptStyle:
      'abstract brand mood imagery, conveying brand feeling, visual identity expression',
  },
];
