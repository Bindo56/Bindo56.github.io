export interface Experience {
  role: string
  company: string
  period: string
  highlights: readonly string[]
  /** A YouTube link, played with sound at the top of this job's popup on the slide. Empty for none. */
  video?: string
  /** The company's or the product's website, linked in the popup. Empty for none. */
  website?: string
}

/**
 * Newest first, as the portfolio menu shows it. The slide runs the other way: the oldest at the top, the
 * present at its last stop.
 */
export const experience: readonly Experience[] = [
  {
    role: 'Unity Developer',
    company: 'Kalp Studio',
    period: '2026 June – Present',
    highlights: ['Replace with something you shipped.', 'And the difference it made.'],
    video: '',
    website: '',
  },
 
  {
        role: 'Unity Developer',
        company: 'Wharf Street Studio',
        period: 'Jan 2025 – Nov 2025',
        highlights: ['Replace with a highlight.'],
        video: '',
        website: '',
  },
    {
        role: 'Unity Developer',
        company: 'Metronome Tech',
        period: 'June 2024 – Dec 2024',
        highlights: ['Replace with a highlight.'],
        video: '',
        website: '',
    },
    {
        role: 'Unity SDK Developer (Contract)',
        company: 'Leadr SDK',
        period: 'Contract',
        highlights: ['Replace with a highlight.'],
        video: '',
        website: '',
    },
    {
        role: 'Unreal Developer (Contract)',
        company: 'Cyrus 365',
        period: 'Contract',
        highlights: ['Replace with a highlight.'],
        video: '',
        website: '',
    },
    {
        role: 'Technical Artist (Unreal Engine) (Contract)',
        company: 'Fathom Marine Consultants Pvt Ltd',
        period: 'Contract',
        highlights: ['Replace with a highlight.'],
        video: '',
        website: '',
    },

]
