// PR #82 — Sprint 7.7: "You opened 7 tabs" problem-frame section.
//
// Sits between the hero (which sells the category) and the
// solution pillars (which prove the category). Job-to-be-done: in
// 4 short paragraphs, mirror the founder's lived experience back
// to them so they self-identify before reading what Helm does.
//
// Layout: centered single column, generous vertical rhythm so the
// list of 7 tools reads as recognition rather than copy. The
// emphasis on "Helm fixes it." mirrors the hero's "Marketing OS"
// claim without restating it.
export function LandingProblemStatement() {
  return (
    <section className="px-4 md:px-8 py-20 md:py-28 max-w-3xl mx-auto">
      <h2 className="font-display text-4xl md:text-5xl font-light tracking-tight leading-[1.1] mb-10 text-center">
        You opened 7 tabs to publish one post.
      </h2>

      <div className="space-y-6 text-base md:text-lg text-text-2 leading-relaxed">
        <p>
          Notion for the strategy. ChatGPT for the draft. Figma for the
          image. Buffer for the schedule. Twitter Analytics for the
          metrics. Reddit for the audience research. Google Docs for the
          recap.
        </p>
        <p>
          Marketing isn&apos;t supposed to feel like firefighting. But every
          solo founder, indie hacker, and one-person marketing team knows
          the truth: the tooling is broken.
        </p>
        <p className="text-text-1 font-medium">Helm fixes it.</p>
      </div>
    </section>
  );
}
