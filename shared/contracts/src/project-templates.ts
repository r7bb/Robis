import type { IssuePriority } from './domain.ts';

/**
 * Starter projects (C5): a first project that already says what goes in
 * it. Each template files a handful of issues a team of that kind would
 * write first, all to do, which the team then edits or deletes.
 */

export const PROJECT_TEMPLATES = ['software', 'event', 'coursework'] as const;
export type ProjectTemplate = (typeof PROJECT_TEMPLATES)[number];

type StarterIssue = { title: string; priority: IssuePriority };

export const TEMPLATE_DETAILS: Readonly<
  Record<ProjectTemplate, { label: string; description: string; issues: readonly StarterIssue[] }>
> = {
  software: {
    label: 'Software',
    description: 'Ship a product: bugs, features and releases.',
    issues: [
      { title: 'Write down what the first release must do', priority: 'HIGH' },
      { title: 'Set up continuous integration', priority: 'MEDIUM' },
      { title: 'Fix the first bug someone reports', priority: 'MEDIUM' },
      { title: 'Plan the first release date', priority: 'LOW' },
      { title: 'Write a short README for new teammates', priority: 'LOW' },
    ],
  },
  event: {
    label: 'Event planning',
    description: 'Run an event: venue, speakers, tickets and the day itself.',
    issues: [
      { title: 'Choose a date and book the venue', priority: 'URGENT' },
      { title: 'Confirm the speakers', priority: 'HIGH' },
      { title: 'Open ticket sales', priority: 'HIGH' },
      { title: 'Arrange catering', priority: 'MEDIUM' },
      { title: 'Send the reminder the day before', priority: 'LOW' },
    ],
  },
  coursework: {
    label: 'Coursework',
    description: 'Get through a course: readings, assignments and exams.',
    issues: [
      { title: 'Read the syllabus and note every deadline', priority: 'HIGH' },
      { title: 'Start the first assignment', priority: 'HIGH' },
      { title: 'Form a study group', priority: 'MEDIUM' },
      { title: 'Book office hours before the midterm', priority: 'MEDIUM' },
      { title: 'Make a revision plan for the final', priority: 'LOW' },
    ],
  },
};
