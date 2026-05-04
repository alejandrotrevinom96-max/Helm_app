import chromium from '@sparticuz/chromium';
import { chromium as playwright } from 'playwright-core';
import type { BrandBible } from '@/lib/types/brand';

export interface CarouselSlide {
  type: 'hook' | 'point' | 'closing';
  title?: string;
  body: string;
  highlight?: string;
}

export type CarouselTemplate =
  | 'milestone'
  | 'educational'
  | 'behind-scenes'
  | 'hot-take';

export interface CarouselInput {
  template: CarouselTemplate;
  slides: CarouselSlide[];
  brandBible: BrandBible | null;
  aspectRatio?: '1:1' | '4:5';
}

export interface CarouselResult {
  slides: Array<{ url: string; index: number }>;
  totalSlides: number;
}

const SLIDE_DIMENSIONS = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
} as const;

interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
}

// Render N slides with a single Chromium instance — launching playwright per
// slide is ~3s of overhead each time, so reuse the browser and only spawn
// new pages. Fail-soft: returns null if Chromium can't launch (common on
// dev machines without the @sparticuz binary).
export async function generateCarousel(
  input: CarouselInput
): Promise<CarouselResult | null> {
  const aspect = input.aspectRatio ?? '1:1';
  const dims = SLIDE_DIMENSIONS[aspect];
  const bible = input.brandBible;

  const colors: BrandColors = {
    primary: bible?.visual?.colors?.primary ?? '#0a0a0a',
    secondary: bible?.visual?.colors?.secondary ?? '#ffffff',
    accent: bible?.visual?.colors?.accent ?? '#ff6b3d',
  };

  let browser;
  try {
    browser = await playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  } catch (e) {
    console.error(
      '[carousel] Chromium launch failed:',
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }

  const slidesOutput: Array<{ url: string; index: number }> = [];

  try {
    for (let i = 0; i < input.slides.length; i++) {
      const slide = input.slides[i];
      const html = renderSlideHtml(
        slide,
        i,
        input.slides.length,
        colors,
        input.template,
        bible,
        dims
      );

      const page = await browser.newPage({
        viewport: dims,
        deviceScaleFactor: 2,
      });

      await page.setContent(html, { waitUntil: 'networkidle' });

      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: false,
        clip: { x: 0, y: 0, width: dims.width, height: dims.height },
      });

      // MVP: data URL. Persisting to Supabase Storage is a follow-up;
      // base64 inline works for the immediate preview-and-schedule flow.
      const dataUrl = `data:image/png;base64,${Buffer.from(screenshot).toString('base64')}`;
      slidesOutput.push({ url: dataUrl, index: i });

      await page.close();
    }
  } catch (e) {
    console.error(
      '[carousel] render failed:',
      e instanceof Error ? e.message : String(e)
    );
    await browser.close().catch(() => {});
    return null;
  }

  await browser.close();
  return {
    slides: slidesOutput,
    totalSlides: input.slides.length,
  };
}

function renderSlideHtml(
  slide: CarouselSlide,
  idx: number,
  total: number,
  colors: BrandColors,
  template: CarouselTemplate,
  bible: BrandBible | null,
  dims: { width: number; height: number }
): string {
  const isHook = idx === 0;
  const isClosing = idx === total - 1;

  return `<!DOCTYPE html>
<html>
<head>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,500;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: ${dims.width}px;
    height: ${dims.height}px;
    font-family: 'Inter', sans-serif;
    background: ${colors.primary};
    color: ${colors.secondary};
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    padding: 80px;
    position: relative;
  }

  .slide-marker {
    position: absolute;
    top: 40px;
    right: 60px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    opacity: 0.6;
  }

  .template-tag {
    position: absolute;
    top: 40px;
    left: 60px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    opacity: 0.5;
  }

  .brand-mark {
    position: absolute;
    bottom: 40px;
    left: 60px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    opacity: 0.5;
  }

  .highlight {
    font-family: 'Fraunces', serif;
    font-size: ${isHook ? '180px' : '120px'};
    font-weight: 300;
    color: ${colors.accent};
    line-height: 0.9;
    margin-bottom: 40px;
  }

  .title {
    font-family: 'Fraunces', serif;
    font-size: ${isHook ? '72px' : '56px'};
    font-weight: 300;
    line-height: 1.1;
    margin-bottom: 32px;
    max-width: 800px;
  }

  .body {
    font-family: 'Inter', sans-serif;
    font-size: 32px;
    line-height: 1.4;
    font-weight: 400;
    max-width: 800px;
    opacity: 0.9;
  }

  .closing-cta {
    font-family: 'Fraunces', serif;
    font-size: 80px;
    font-weight: 300;
    color: ${colors.accent};
    margin-top: 40px;
  }
</style>
</head>
<body>
  <div class="template-tag">${escapeHtml(template)}</div>
  <div class="slide-marker">${idx + 1} / ${total}</div>

  ${slide.highlight ? `<div class="highlight">${escapeHtml(slide.highlight)}</div>` : ''}

  ${slide.title ? `<div class="title">${escapeHtml(slide.title)}</div>` : ''}

  <div class="body">${escapeHtml(slide.body)}</div>

  ${isClosing ? `<div class="closing-cta">→</div>` : ''}

  <div class="brand-mark">${escapeHtml(bible?.identity?.name ?? '')}</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
