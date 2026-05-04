export type ValidateTemplateId =
  | 'minimal'
  | 'beta-tester'
  | 'feature-vote'
  | 'pricing-test'
  | 'survey-5q';

export interface ValidateTemplate {
  id: ValidateTemplateId;
  name: string;
  description: string;
  bestFor: string;
  defaultCopy: {
    title: string;
    subtitle: string;
    ctaText: string;
  };
  hasCustomFields: boolean;
}

export const validateTemplates: ValidateTemplate[] = [
  {
    id: 'minimal',
    name: 'Pre-launch waitlist',
    description: 'Clean email capture — fastest to validate interest',
    bestFor: 'Idea validation, early demand check',
    defaultCopy: {
      title: 'Join the waitlist',
      subtitle: 'Be first to try [your product]. Limited early access.',
      ctaText: 'Join waitlist',
    },
    hasCustomFields: false,
  },
  {
    id: 'beta-tester',
    name: 'Beta tester recruitment',
    description: 'Email + 2-3 qualifying questions to find ideal early adopters',
    bestFor: 'Finding ideal early adopters',
    defaultCopy: {
      title: 'Become a beta tester',
      subtitle: 'Help shape [your product] and get free lifetime access.',
      ctaText: 'Apply to beta',
    },
    hasCustomFields: true,
  },
  {
    id: 'feature-vote',
    name: 'Feature voting',
    description: 'List of features, users vote which to build first',
    bestFor: 'Prioritization, demand signal',
    defaultCopy: {
      title: 'What should we build next?',
      subtitle: 'Vote on the features that would make [product] essential for you.',
      ctaText: 'Submit votes',
    },
    hasCustomFields: true,
  },
  {
    id: 'pricing-test',
    name: 'Pricing willingness',
    description: 'Validate willingness to pay before building',
    bestFor: 'Pricing strategy validation',
    defaultCopy: {
      title: 'Reserve your spot',
      subtitle: '[Product] launches Q3. Founding members get [X]% off.',
      ctaText: 'Reserve at $X/mo',
    },
    hasCustomFields: true,
  },
  {
    // ID stays 'survey-5q' for back-compat with rows already in DB.
    id: 'survey-5q',
    name: 'Multi-question survey',
    description: 'Custom number of questions + AI analysis of responses',
    bestFor: 'Qualitative insights, problem validation',
    defaultCopy: {
      title: 'Quick survey',
      subtitle: 'Help us understand the problem we should solve.',
      ctaText: 'Submit answers',
    },
    hasCustomFields: true,
  },
];

export function getTemplate(id: string | null | undefined) {
  if (!id) return validateTemplates[0];
  return (
    validateTemplates.find((t) => t.id === id) ?? validateTemplates[0]
  );
}
