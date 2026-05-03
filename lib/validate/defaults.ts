import type { ValidateTemplateId } from './templates';

export interface QualifyingQuestion {
  question: string;
  type: 'text' | 'select';
  options?: string[];
}

export interface VoteFeature {
  id: string;
  title: string;
  description: string;
}

export interface TemplateConfig {
  subtitle?: string;
  ctaText?: string;
  qualifyingQuestions?: QualifyingQuestion[];
  features?: VoteFeature[];
  maxVotesPerUser?: number;
  pricePerMonth?: number;
  priceVariant?: 'a' | 'b';
  discountPct?: number;
  questions?: string[];
}

export function getDefaultConfig(templateId: ValidateTemplateId | string): TemplateConfig {
  switch (templateId) {
    case 'minimal':
      return {
        subtitle: 'Be first to try [your product]. Limited early access.',
        ctaText: 'Join waitlist',
      };
    case 'beta-tester':
      return {
        subtitle: 'Help shape this product and get free lifetime access.',
        ctaText: 'Apply to beta',
        qualifyingQuestions: [
          {
            question: 'What product/SaaS are you currently building?',
            type: 'text',
          },
          {
            question: 'How big is your team?',
            type: 'select',
            options: ['Just me', '2-5', '6-20', '20+'],
          },
        ],
      };
    case 'feature-vote':
      return {
        subtitle: 'Vote on the features that would make this essential for you.',
        ctaText: 'Submit votes',
        maxVotesPerUser: 3,
        features: [
          { id: 'feat-1', title: 'Feature A', description: 'Description here' },
          { id: 'feat-2', title: 'Feature B', description: 'Description here' },
          { id: 'feat-3', title: 'Feature C', description: 'Description here' },
        ],
      };
    case 'pricing-test':
      return {
        subtitle: 'Founding members get a permanent discount.',
        ctaText: 'Reserve my spot',
        pricePerMonth: 19,
        priceVariant: 'a',
        discountPct: 50,
      };
    case 'survey-5q':
      return {
        subtitle: 'Help us understand the problem we should solve.',
        ctaText: 'Submit answers',
        questions: [
          'What problem are you trying to solve right now?',
          "What tools have you tried? Why didn't they work?",
          'How much time per week does this problem cost you?',
          'Would you pay for a solution? At what price?',
          'What would make you switch tools tomorrow?',
        ],
      };
    default:
      return {};
  }
}
