export const CAPABILITY_STATUS_STYLES: Record<string, string> = {
  built: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  new: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  now: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  next: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  testing: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  later: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

export const CAPABILITY_STATUS_LABELS: Record<string, string> = {
  built: 'Built',
  new: 'New',
  now: 'Now',
  next: 'Next',
  testing: 'Testing',
  later: 'Later',
};

export const CAPABILITY_STATUS_DOT_COLORS: Record<string, string> = {
  built: 'bg-emerald-500',
  new: 'bg-violet-500',
  now: 'bg-blue-500',
  next: 'bg-amber-500',
  testing: 'bg-cyan-500',
  later: 'bg-gray-500',
};

export const TOS_SECTIONS = [
  { num: 1, title: 'Acceptance', text: 'By creating an account or using E.L.F.I.E. (the "Service"), you agree to these Terms. If you do not agree, do not use the Service.' },
  { num: 2, title: 'Description', text: 'E.L.F.I.E. is a SaaS platform for LEGO and BrickLink inventory management, pricing intelligence, and AI-assisted operations.' },
  { num: 3, title: 'Accounts', text: 'You must provide accurate information when registering. You are responsible for all activity under your account and for keeping credentials secure.' },
  { num: 4, title: 'Acceptable Use', text: 'You agree not to: (a) violate any laws; (b) infringe on intellectual property rights; (c) interfere with or disrupt the Service; (d) attempt to gain unauthorized access; (e) use the Service to build a competing product; (f) bulk-export or redistribute marketplace data beyond internal use.' },
  { num: 5, title: 'Data & Privacy', text: 'We collect and process data necessary to provide the Service. Your inventory, order, and business data remains yours. We do not sell your data to third parties. AI-processed content may be sent to third-party AI providers (OpenAI) for processing under their data policies.' },
  { num: 6, title: 'Third-Party Integrations', text: 'The Service connects to BrickLink, BrickOwl, Rebrickable, Stripe, and OpenAI. Your use of these integrations is subject to their respective terms. You are responsible for ensuring your API credentials are valid and authorized.' },
  { num: 7, title: 'Subscription & Billing', text: 'Paid plans are billed monthly or annually via Stripe. You may cancel at any time; access continues through the end of the billing period. Refunds are handled per our refund policy.' },
  { num: 8, title: 'AI Disclaimer', text: 'AI-generated content (pricing suggestions, chat responses, part identification) is provided "as-is" for reference. Always verify AI outputs before acting on them. We are not liable for decisions made based on AI suggestions.' },
  { num: 9, title: 'Catalog Images', text: 'Part images sourced from BrickLink and Rebrickable are licensed for internal inventory management only. They may not be redistributed or used on public-facing websites.' },
  { num: 10, title: 'Limitation of Liability', text: 'The Service is provided "as-is" without warranties. To the maximum extent permitted by law, we are not liable for any indirect, incidental, or consequential damages arising from your use of the Service.' },
  { num: 11, title: 'Termination', text: 'We may suspend or terminate accounts that violate these Terms. You may delete your account at any time through Settings.' },
  { num: 12, title: 'Changes', text: 'We may update these Terms from time to time. Continued use after changes constitutes acceptance of the updated Terms.' },
  { num: 13, title: 'Contact', text: 'Questions about these Terms can be directed through the in-app support system.' },
];

export const TOS_LAST_UPDATED = 'March 2026';
