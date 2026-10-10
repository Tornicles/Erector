/**
 * TONDE marketing site content.
 *
 * Source: `tonde_unified_site.zip` from branch `Tornicles-patch-1`.
 * The four original designs are preserved byte-identical under
 * `frontend/public/marketing/originals/`; working embed copies live under
 * `frontend/public/marketing/legacy/`.
 *
 * ROUTING DECISIONS (app routes always win; see `frontend/src/App.tsx`):
 * - `/`                    marketing home (embed area1#home); app home stays `/home`
 * - `/studio`              kept for the authenticated app; the marketing Studio
 *                          introduction embed is served at `/product/studio`
 * - `/discover`, `/discover/techniques` kept for the app; marketing discovery
 *                          embeds are served at `/explore`, `/explore/techniques`
 * - `/help`                kept for the app; marketing help is `/resources/help`
 * - `/login`, `/signup`, `/forgot-password` reuse the real `AuthPage`
 *                          (no prototype auth). All other marketing paths match
 *                          the source archive 1:1 (trailing slash optional).
 */

export interface EmbedSpec {
  kind: 'embed';
  path: string;
  title: string;
  description: string;
  /** Legacy working copy served from /marketing/legacy/. */
  file:
    | 'tonde_brand_product_area1.html'
    | 'tonde_creation_modes_area2.html'
    | 'tonde_solutions_discover_area3.html'
    | 'tonde_resources_company_area4.html';
  anchor: string;
}

export interface NativeFeature {
  num: string;
  heading: string;
  text: string;
}

export interface NativeContent {
  eyebrow: string;
  h1: string;
  lede: string;
  features: NativeFeature[];
}

export interface NativeSpec {
  kind: 'native';
  path: string;
  title: string;
  description: string;
  content: NativeContent;
}

export type MarketingSpec = EmbedSpec | NativeSpec;

const END_CTA_PARAGRAPH =
  "TONDE's existing marketing prototype shows how production intent, plans, shots, results and creator approval stay connected. Feature availability must be verified in the deployed application.";

export const END_CTA_HEADING = 'From intention to execution.';

function native(
  path: string,
  title: string,
  description: string,
  eyebrow: string,
  h1: string,
  lede: string,
  features: Array<[string, string]>,
): NativeSpec {
  return {
    kind: 'native',
    path,
    title: `TONDE | ${title}`,
    description,
    content: {
      eyebrow,
      h1,
      lede,
      features: features.map(([heading, text], i) => ({
        num: String(i + 1).padStart(2, '0'),
        heading,
        text,
      })),
    },
  };
}

function embed(
  path: string,
  title: string,
  description: string,
  file: EmbedSpec['file'],
  anchor: string,
): EmbedSpec {
  return { kind: 'embed', path, title: `TONDE | ${title}`, description, file, anchor };
}

const AREA1 = 'tonde_brand_product_area1.html' as const;
const AREA2 = 'tonde_creation_modes_area2.html' as const;
const AREA3 = 'tonde_solutions_discover_area3.html' as const;
const AREA4 = 'tonde_resources_company_area4.html' as const;

export const MARKETING_ROUTES: MarketingSpec[] = [
  embed('/', 'Your AI Production Director', 'Describe what you want to create. TONDE connects direction and execution.', AREA1, 'home'),
  embed('/product', 'Product', 'Explore the TONDE production intelligence system.', AREA1, 'product'),
  embed('/how-it-works', 'How TONDE Works', 'From creative intent to approved production.', AREA1, 'how'),
  embed('/product/studio', 'Studio', 'Direct and manage productions with TONDE Studio.', AREA1, 'studio'),
  embed('/production-memory', 'Production Memory', 'Decisions and evidence across your production.', AREA1, 'memory'),
  embed('/about', 'About TONDE', 'TONDE company and product principles.', AREA1, 'about'),
  embed('/create/real-production', 'Real Production', 'Production direction adapted to your actual kit.', AREA2, 'real'),
  embed('/create/ai-creation', 'AI Creation', 'Create AI media with production-aware direction.', AREA2, 'ai'),
  embed('/create/hybrid-production', 'Hybrid Production', 'Combine real and AI execution in one production.', AREA2, 'hybrid'),
  embed('/shot-match', 'Shot Match', 'Compare planned shots with actual results.', AREA2, 'shotmatch'),
  embed('/solutions', 'Solutions', 'Creative solutions for different production types.', AREA3, 'solutions'),
  embed('/solutions/film-video', 'Film and Video', 'Direct stories for the screen.', AREA3, 'film'),
  embed('/solutions/photography', 'Photography', 'Plan intentional photographs and sequences.', AREA3, 'photo'),
  embed('/solutions/commercial-product', 'Commercial and Product', 'Direct brand and product production.', AREA3, 'commercial'),
  embed('/solutions/music-video', 'Music Video', 'Direct video to musical structure.', AREA3, 'music'),
  embed('/solutions/documentary-interviews', 'Documentary and Interviews', 'Direct truthful documentary and interview coverage.', AREA3, 'documentary'),
  embed('/solutions/youtube-social', 'YouTube and Social', 'Create repeatable social and online video.', AREA3, 'social'),
  embed('/solutions/series-recurring', 'Series and Recurring', 'Manage recurring formats with continuity.', AREA3, 'series'),
  embed('/solutions/weddings', 'Weddings', 'Protect the moments that cannot be repeated.', AREA3, 'events'),
  embed('/explore', 'Discover', 'Explore creative production techniques.', AREA3, 'discover'),
  embed('/explore/techniques', 'Production Techniques', 'Find visual and audio techniques to apply.', AREA3, 'technique'),
  embed('/resources/guides', 'Guides', 'Production guides and practical education.', AREA4, 'guides'),
  embed('/resources/examples', 'Examples', 'Explore TONDE production examples.', AREA4, 'examples'),
  embed('/resources/case-study', 'Case Study', 'A TONDE production example from concept to result.', AREA4, 'case'),
  embed('/resources/help', 'Help Center', 'Learn how to use TONDE.', AREA4, 'help'),
  embed('/resources/updates', 'What’s New', 'Product updates.', AREA4, 'updates'),
  embed('/pricing', 'Pricing', 'TONDE plans and early access information.', AREA4, 'pricing'),
  embed('/security', 'Security', 'Learn about the TONDE security approach.', AREA4, 'security'),
  embed('/privacy', 'Privacy', 'The current prototype of TONDE privacy information.', AREA4, 'privacy'),
  embed('/terms', 'Terms', 'The current prototype of TONDE terms.', AREA4, 'terms'),
  embed('/content-rights', 'AI and Content Rights', 'Understand reference, permission, and content provenance.', AREA4, 'rights'),
  native('/contact', 'Contact TONDE', 'This website package does not include a verified live contact backend. Please use the official contact channel once published.', 'TONDE / CONTACT TONDE', 'Connect with the TONDE team.', 'This website package does not include a verified live contact backend. Please use the official contact channel once published.', [
    ['General questions', 'Product and company information.'],
    ['Support', 'Help center and account guidance.'],
    ['Teams', 'Discuss deployment needs after team support is verified.'],
  ]),
  native('/for/creators', 'For Creators', 'Whether you shoot, photograph, generate or combine approaches, TONDE is designed to connect intention with executable decisions.', 'TONDE / FOR CREATORS', 'Direct more than one way of making.', 'Whether you shoot, photograph, generate or combine approaches, TONDE is designed to connect intention with executable decisions.', [
    ['Start from intent', 'Use your idea, references or existing media.'],
    ['Plan for reality', 'Work with available gear and time.'],
    ['Stay in control', 'Approve results and revisions.'],
  ]),
  native('/for/production-teams', 'For Production Teams', 'Teams need a reliable picture of creative intent, scenes, shots and decisions. Collaboration and access capabilities must be validated against the deployed product before being offered.', 'TONDE / FOR PRODUCTION TEAMS', 'One production truth, more shared context.', 'Teams need a reliable picture of creative intent, scenes, shots and decisions. Collaboration and access capabilities must be validated against the deployed product before being offered.', [
    ['Coordinate', 'Keep decisions and coverage requirements explicit.'],
    ['Review', 'Compare results to production plans.'],
    ['Govern', 'Keep human approval separate from AI recommendations.'],
  ]),
  native('/for/brands-agencies', 'For Brands and Agencies', 'Plan campaigns, product shoots and branded narratives around visual intent, constraints and coherent execution.', 'TONDE / FOR BRANDS AND AGENCIES', 'Direction that protects product truth.', 'Plan campaigns, product shoots and branded narratives around visual intent, constraints and coherent execution.', [
    ['Brief', 'Make audience, product and format explicit.'],
    ['Visual rules', 'Protect product identity and continuity.'],
    ['Review', 'Compare deliverables against plans.'],
  ]),
  native('/for/event-creators', 'For Event Creators', 'Plan coverage of ceremonies, conferences, concerts, celebrations and games with a clear hierarchy of must-have and opportunistic moments.', 'TONDE / FOR EVENT CREATORS', 'Capture the moments no one can recreate.', 'Plan coverage of ceremonies, conferences, concerts, celebrations and games with a clear hierarchy of must-have and opportunistic moments.', [
    ['Prepare', 'Map moments and roles.'],
    ['Adapt', 'Respond when reality changes.'],
    ['Review', 'Find candidate highlights and stills.'],
  ]),
  native('/product/moment-intelligence', 'Moment Intelligence', 'Important moments are more than timestamps. TONDE connects priorities, events, people, speech and visual action to help identify candidate highlights in recorded footage.', 'TONDE / MOMENT INTELLIGENCE', 'Find the moments that matter.', 'Important moments are more than timestamps. TONDE connects priorities, events, people, speech and visual action to help identify candidate highlights in recorded footage.', [
    ['Before capture', 'Set moment priorities, critical people and expected events.'],
    ['During coverage', 'Protect essential action, reactions, context and clean audio.'],
    ['After capture', 'Review candidate moments, transcripts, timecodes, selects and highlight structures.'],
    ['Human approval', 'The creator decides which moments matter and what can be published.'],
  ]),
  native('/solutions/live-events', 'Live Events', 'Live events change in real time. TONDE’s production approach can help prioritize capture of scheduled and unscripted moments without assuming every moment can be staged again.', 'TONDE / LIVE EVENTS', 'Plan what you can. Protect what you cannot repeat.', 'Live events change in real time. TONDE’s production approach can help prioritize capture of scheduled and unscripted moments without assuming every moment can be staged again.', [
    ['Plan coverage', 'Build a timeline and identify priority moments.'],
    ['Protect reactions', 'Capture speakers, audiences, participants and atmosphere.'],
    ['Track changes', 'Adapt shooting priorities when events change.'],
    ['Review highlights', 'Identify candidate moments and assemble a recap.'],
  ]),
  native('/solutions/conferences', 'Conferences and Corporate Events', 'Cover keynotes, panels, launches, audience questions, networking and interviews with priorities for both clean capture and future recap editing.', 'TONDE / CONFERENCES AND CORPORATE EVENTS', 'The important moment might not be on the run of show.', 'Cover keynotes, panels, launches, audience questions, networking and interviews with priorities for both clean capture and future recap editing.', [
    ['Stage coverage', 'Speaker, presentation, audience and reaction angles.'],
    ['Audio', 'Capture clean speech and room tone.'],
    ['Unscripted developments', 'Protect questions, announcements and surprises.'],
    ['Recap', 'Organize quotes, key moments and session highlights.'],
  ]),
  native('/solutions/sports-live-action', 'Sports and Live Action', 'From youth sports to organized competitions, production is about anticipating action, covering more than the ball, and reviewing the moments worth keeping.', 'TONDE / SPORTS AND LIVE ACTION', 'The play. The reaction. The moment that changes everything.', 'From youth sports to organized competitions, production is about anticipating action, covering more than the ball, and reviewing the moments worth keeping.', [
    ['Anticipate', 'Plan likely action zones and operator positions.'],
    ['Context', 'Capture sideline, coaches, fans and atmosphere.'],
    ['Review', 'Select candidate decisive plays and reactions.'],
    ['Deliver', 'Build athlete galleries and event recaps with human review.'],
  ]),
  native('/solutions/parties-celebrations', 'Parties and Celebrations', 'Structure flexible coverage for milestone celebrations, birthdays, graduations and community gatherings without over-directing real life.', 'TONDE / PARTIES AND CELEBRATIONS', 'Remember more than the obvious moments.', 'Structure flexible coverage for milestone celebrations, birthdays, graduations and community gatherings without over-directing real life.', [
    ['Milestones', 'Know what cannot be repeated.'],
    ['People', 'Protect reactions and relationships.'],
    ['Atmosphere', 'Capture the details that tell the story.'],
    ['Recap', 'Create still-image selections and highlight sequences.'],
  ]),
  native('/solutions/concerts-performances', 'Concerts and Performances', 'Direct performances, audiences, stage coverage and backstage context around timing, movement, energy and sound.', 'TONDE / CONCERTS AND PERFORMANCES', 'Performance has its own rhythm.', 'Direct performances, audiences, stage coverage and backstage context around timing, movement, energy and sound.', [
    ['Show flow', 'Understand set lists and changing scenes.'],
    ['Coverage', 'Protect performers and crowd reactions.'],
    ['Sound', 'Identify dependable audio sources.'],
    ['Highlights', 'Review songs, transitions and peak moments.'],
  ]),
];

export const END_CTA_COPY = END_CTA_PARAGRAPH;

export interface NavLink {
  label: string;
  to: string;
}

export const MARKETING_NAV: NavLink[] = [
  { label: 'Product', to: '/product' },
  { label: 'Create', to: '/create/real-production' },
  { label: 'Solutions', to: '/solutions' },
  { label: 'Discover', to: '/explore' },
  { label: 'Resources', to: '/resources/guides' },
  { label: 'Pricing', to: '/pricing' },
];

export interface FooterColumn {
  heading: string;
  links: NavLink[];
}

export const MARKETING_FOOTER: FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Overview', to: '/product' },
      { label: 'How it works', to: '/how-it-works' },
      { label: 'Studio', to: '/product/studio' },
      { label: 'Moment Intelligence', to: '/product/moment-intelligence' },
      { label: 'Shot Match', to: '/shot-match' },
    ],
  },
  {
    heading: 'Create',
    links: [
      { label: 'Real Production', to: '/create/real-production' },
      { label: 'AI Creation', to: '/create/ai-creation' },
      { label: 'Hybrid', to: '/create/hybrid-production' },
    ],
  },
  {
    heading: 'Explore',
    links: [
      { label: 'Solutions', to: '/solutions' },
      { label: 'Live Events', to: '/solutions/live-events' },
      { label: 'Sports', to: '/solutions/sports-live-action' },
      { label: 'Discover', to: '/explore' },
      { label: 'Examples', to: '/resources/examples' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Contact', to: '/contact' },
      { label: 'Security', to: '/security' },
      { label: 'Privacy', to: '/privacy' },
      { label: 'Terms', to: '/terms' },
      { label: 'Content Rights', to: '/content-rights' },
    ],
  },
];

export const MARKETING_FINEPRINT =
  '© 2026 TONDE · This is a website integration preview. Authentication, pricing and legal policies require live-service validation before launch.';

export const MARKETING_TAGLINE = 'Your AI Production Director. Show TONDE what you want to make. TONDE tells you exactly how to make it.';

/**
 * Map an absolute site path emitted by a legacy embed (postMessage `navigate`)
 * to the SPA route served by this app. Unknown paths pass through.
 */
export function legacyPathToSpa(path: string): string {
  const clean = path.split('#')[0].replace(/\/+$/, '') || '/';
  switch (clean) {
    case '/discover':
      return '/explore';
    case '/discover/techniques':
      return '/explore/techniques';
    case '/studio':
      return '/product/studio';
    default:
      return clean;
  }
}
