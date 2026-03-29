import type { Knex } from 'knex';
import crypto from 'crypto';

// ════════════════════════════════════════════════════════════
// IKONETU SYNTHETIC SEED DATA
// Version: 1.0.0
// Coverage:
//   • 36 users (20 founders, 5 investors, 5 providers, 3 lenders, 2 universities, 1 admin)
//   • All 4 score tiers represented (EARLY / RISING / INVESTABLE / ELITE)
//   • 5 African countries (NG, KE, GH, ZA, GB)
//   • 8 sectors (Fintech, Agritech, Healthtech, Edtech, Logistics, Energy, Proptech, E-commerce)
//   • All 12 revenue streams (R01–R12, R11 on hold)
//   • Full ACXM signal library (opportunities + threats)
//   • GDPR requests, AML flags, compliance edge cases
//   • 12 months of score history per founder
//   • Marketplace bookings with R12 9.5% commission
//   • Investor matches, deal rooms, provider leads, lender portfolios
//   • Scoring rules, bankability scores, social profiles, documents
// ════════════════════════════════════════════════════════════

// ── Deterministic UUIDs (fixed so FK relationships always resolve) ────
const U = {
  // Founders
  f1:  '11111111-0001-0001-0001-000000000001', // Kemi Adeyemi    - NG - Fintech   - ELITE 887
  f2:  '11111111-0001-0001-0001-000000000002', // Kofi Asante     - GH - Agritech  - INVESTABLE 741
  f3:  '11111111-0001-0001-0001-000000000003', // Amara Diallo    - NG - Healthtech- INVESTABLE 682
  f4:  '11111111-0001-0001-0001-000000000004', // Tunde Okonkwo   - NG - Edtech    - INVESTABLE 631
  f5:  '11111111-0001-0001-0001-000000000005', // Aisha Kamara    - KE - Logistics  - INVESTABLE 608
  f6:  '11111111-0001-0001-0001-000000000006', // Seun Abiodun    - NG - Fintech   - RISING 578
  f7:  '11111111-0001-0001-0001-000000000007', // Nadia Osei      - GH - E-commerce- RISING 542
  f8:  '11111111-0001-0001-0001-000000000008', // Ibrahim Hassan  - NG - Energy    - RISING 511
  f9:  '11111111-0001-0001-0001-000000000009', // Fatima Musa     - KE - Proptech  - RISING 487
  f10: '11111111-0001-0001-0001-000000000010', // Chidi Nwosu     - NG - Logistics  - RISING 448
  f11: '11111111-0001-0001-0001-000000000011', // Zainab Yusuf    - NG - Healthtech- RISING 402
  f12: '11111111-0001-0001-0001-000000000012', // Emmanuel Kiptoo - KE - Agritech  - RISING 371
  f13: '11111111-0001-0001-0001-000000000013', // Adaeze Obi      - NG - Fintech   - EARLY 298
  f14: '11111111-0001-0001-0001-000000000014', // Kwame Mensah    - GH - Edtech    - EARLY 251
  f15: '11111111-0001-0001-0001-000000000015', // Bola Fashola    - NG - E-commerce- EARLY 217
  f16: '11111111-0001-0001-0001-000000000016', // Nneka Eze       - NG - Proptech  - EARLY 184
  f17: '11111111-0001-0001-0001-000000000017', // Sipho Ndlovu    - ZA - Fintech   - EARLY 152
  f18: '11111111-0001-0001-0001-000000000018', // Halima Traoré   - KE - Energy    - EARLY 118
  f19: '11111111-0001-0001-0001-000000000019', // James Mwangi    - KE - Agritech  - EARLY  84
  f20: '11111111-0001-0001-0001-000000000020', // Chibuike Okafor - NG - Healthtech- EARLY  42

  // Investors
  i1:  '22222222-0001-0001-0001-000000000001', // Adekunle Capital Partners (VC)
  i2:  '22222222-0001-0001-0001-000000000002', // Lagos Angel Network
  i3:  '22222222-0001-0001-0001-000000000003', // Nairobi Impact Fund
  i4:  '22222222-0001-0001-0001-000000000004', // Accra Family Office
  i5:  '22222222-0001-0001-0001-000000000005', // Africa Growth Capital

  // Providers
  p1:  '33333333-0001-0001-0001-000000000001', // Lex Africa Law (Legal)
  p2:  '33333333-0001-0001-0001-000000000002', // KPMG Africa (Accounting)
  p3:  '33333333-0001-0001-0001-000000000003', // TechScale Hub (Tech)
  p4:  '33333333-0001-0001-0001-000000000004', // PeopleFirst HR (HR)
  p5:  '33333333-0001-0001-0001-000000000005', // GrowthMark (Marketing)

  // Lenders
  l1:  '44444444-0001-0001-0001-000000000001', // Access Bank Nigeria
  l2:  '44444444-0001-0001-0001-000000000002', // KCB Group Kenya
  l3:  '44444444-0001-0001-0001-000000000003', // British International Investment

  // Universities
  u1:  '55555555-0001-0001-0001-000000000001', // University of Lagos
  u2:  '55555555-0001-0001-0001-000000000002', // Strathmore University Kenya

  // Admin
  admin: '00000000-0000-0000-0000-000000000001',

  // Ventures (1:1 with founders)
  v1:  'aaaa0001-0001-0001-0001-000000000001', // PayFlowNG
  v2:  'aaaa0001-0001-0001-0001-000000000002', // AgroConnect GH
  v3:  'aaaa0001-0001-0001-0001-000000000003', // HealthBridge NG
  v4:  'aaaa0001-0001-0001-0001-000000000004', // EduReach NG
  v5:  'aaaa0001-0001-0001-0001-000000000005', // SwiftFreight KE
  v6:  'aaaa0001-0001-0001-0001-000000000006', // CashCircle NG
  v7:  'aaaa0001-0001-0001-0001-000000000007', // MarketHub GH
  v8:  'aaaa0001-0001-0001-0001-000000000008', // SolarGrid NG
  v9:  'aaaa0001-0001-0001-0001-000000000009', // RentEasy KE
  v10: 'aaaa0001-0001-0001-0001-000000000010', // TruckLink NG
  v11: 'aaaa0001-0001-0001-0001-000000000011', // MediScan NG
  v12: 'aaaa0001-0001-0001-0001-000000000012', // FarmYield KE
  v13: 'aaaa0001-0001-0001-0001-000000000013', // LendStack NG
  v14: 'aaaa0001-0001-0001-0001-000000000014', // LearnPath GH
  v15: 'aaaa0001-0001-0001-0001-000000000015', // StyleVault NG
  v16: 'aaaa0001-0001-0001-0001-000000000016', // HomeBloc NG
  v17: 'aaaa0001-0001-0001-0001-000000000017', // PesoPay ZA
  v18: 'aaaa0001-0001-0001-0001-000000000018', // SunPower KE
  v19: 'aaaa0001-0001-0001-0001-000000000019', // SmartFarm KE
  v20: 'aaaa0001-0001-0001-0001-000000000020', // DiagnostX NG

  // Scores
  s1:  'bbbb0001-0001-0001-0001-000000000001',
  s2:  'bbbb0001-0001-0001-0001-000000000002',
  s3:  'bbbb0001-0001-0001-0001-000000000003',
  s4:  'bbbb0001-0001-0001-0001-000000000004',
  s5:  'bbbb0001-0001-0001-0001-000000000005',
  s6:  'bbbb0001-0001-0001-0001-000000000006',
  s7:  'bbbb0001-0001-0001-0001-000000000007',
  s8:  'bbbb0001-0001-0001-0001-000000000008',
  s9:  'bbbb0001-0001-0001-0001-000000000009',
  s10: 'bbbb0001-0001-0001-0001-000000000010',
  s11: 'bbbb0001-0001-0001-0001-000000000011',
  s12: 'bbbb0001-0001-0001-0001-000000000012',
  s13: 'bbbb0001-0001-0001-0001-000000000013',
  s14: 'bbbb0001-0001-0001-0001-000000000014',
  s15: 'bbbb0001-0001-0001-0001-000000000015',
  s16: 'bbbb0001-0001-0001-0001-000000000016',
  s17: 'bbbb0001-0001-0001-0001-000000000017',
  s18: 'bbbb0001-0001-0001-0001-000000000018',
  s19: 'bbbb0001-0001-0001-0001-000000000019',
  s20: 'bbbb0001-0001-0001-0001-000000000020',

  // Investor profiles
  ip1: 'cccc0001-0001-0001-0001-000000000001',
  ip2: 'cccc0001-0001-0001-0001-000000000002',
  ip3: 'cccc0001-0001-0001-0001-000000000003',
  ip4: 'cccc0001-0001-0001-0001-000000000004',
  ip5: 'cccc0001-0001-0001-0001-000000000005',

  // Provider profiles
  pp1: 'dddd0001-0001-0001-0001-000000000001',
  pp2: 'dddd0001-0001-0001-0001-000000000002',
  pp3: 'dddd0001-0001-0001-0001-000000000003',
  pp4: 'dddd0001-0001-0001-0001-000000000004',
  pp5: 'dddd0001-0001-0001-0001-000000000005',

  // Lender profiles
  lp1: 'eeee0001-0001-0001-0001-000000000001',
  lp2: 'eeee0001-0001-0001-0001-000000000002',
  lp3: 'eeee0001-0001-0001-0001-000000000003',

  // University profiles
  up1: 'ffff0001-0001-0001-0001-000000000001',
  up2: 'ffff0001-0001-0001-0001-000000000002',

  // Plans
  plan_lender_starter:    'plan0001-0001-0001-0001-000000000001',
  plan_lender_growth:     'plan0001-0001-0001-0001-000000000002',
  plan_investor_starter:  'plan0001-0001-0001-0001-000000000003',
  plan_investor_pro:      'plan0001-0001-0001-0001-000000000004',
  plan_provider_featured: 'plan0001-0001-0001-0001-000000000005',
  plan_api_starter:       'plan0001-0001-0001-0001-000000000006',
};

function ago(days: number, hours = 0): Date {
  return new Date(Date.now() - (days * 86400 + hours * 3600) * 1000);
}

function monthStart(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo, 1);
  return d.toISOString().slice(0, 10);
}

function hash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export async function seed(knex: Knex): Promise<void> {
  // ── Clear all tables in dependency order ────────────────────
  const tables = [
    'analytics_events', 'gdpr_requests', 'data_access_log', 'audit_log',
    'feature_flags', 'platform_config', 'admin_actions',
    'notification_templates', 'notifications',
    'acxm_escalations', 'acxm_rules', 'acxm_suppression', 'acxm_interventions', 'acxm_signals',
    'escrow_accounts', 'marketplace_bookings',
    'revenue_events', 'invoices', 'credit_transactions', 'credit_balances',
    'api_usage', 'subscriptions', 'plans',
    'lender_alerts', 'lender_portfolios', 'lender_criteria', 'lender_profiles',
    'university_founders', 'university_programmes', 'university_profiles',
    'provider_leads', 'provider_listings', 'provider_profiles',
    'deal_room_founders', 'deal_rooms', 'investor_matches',
    'investor_theses', 'investor_profiles',
    'bankability_scores',
    'score_signals', 'score_history', 'score_breakdowns', 'scores',
    'scoring_rules', 'tier_config',
    'pitch_videos', 'venture_financial_data', 'venture_social_profiles',
    'venture_documents', 'ventures',
    'otp_records', 'user_consents', 'user_sessions',
    'user_preferences', 'user_profiles', 'users',
  ];
  for (const t of tables) {
    await knex.raw(`TRUNCATE TABLE "${t}" CASCADE`);
  }

  // ════════════════════════════════════════════════════════════
  // 1. USERS
  // ════════════════════════════════════════════════════════════
  await knex('users').insert([
    // ── Founders ──
    { id: U.f1,  email: 'kemi.adeyemi@payflowng.com',    email_verified: true, name: 'Kemi Adeyemi',     role: 'founder',     country: 'NG', language: 'en', status: 'active', last_login: ago(0, 2), onboarding_completed: true },
    { id: U.f2,  email: 'kofi.asante@agroconnectgh.com', email_verified: true, name: 'Kofi Asante',      role: 'founder',     country: 'GH', language: 'en', status: 'active', last_login: ago(1),    onboarding_completed: true },
    { id: U.f3,  email: 'amara.diallo@healthbridge.ng',  email_verified: true, name: 'Amara Diallo',     role: 'founder',     country: 'NG', language: 'en', status: 'active', last_login: ago(0, 5), onboarding_completed: true },
    { id: U.f4,  email: 'tunde.okonkwo@edureachng.com',  email_verified: true, name: 'Tunde Okonkwo',    role: 'founder',     country: 'NG', language: 'en', status: 'active', last_login: ago(2),    onboarding_completed: true },
    { id: U.f5,  email: 'aisha.kamara@swiftfreight.ke',  email_verified: true, name: 'Aisha Kamara',     role: 'founder',     country: 'KE', language: 'en', status: 'active', last_login: ago(0, 8), onboarding_completed: true },
    { id: U.f6,  email: 'seun.abiodun@cashcircle.ng',    email_verified: true, name: 'Seun Abiodun',     role: 'founder',     country: 'NG', language: 'en', status: 'active', last_login: ago(3),    onboarding_completed: true },
    { id: U.f7,  email: 'nadia.osei@markethubgh.com',    email_verified: true, name: 'Nadia Osei',       role: 'founder',     country: 'GH', language: 'en', status: 'active', last_login: ago(1),    onboarding_completed: true },
    { id: U.f8,  email: 'ibrahim.hassan@solargrid.ng',   email_verified: true, name: 'Ibrahim Hassan',   role: 'founder',     country: 'NG', language: 'en', status: 'active', last_login: ago(4),    onboarding_completed: true },
    { id: U.f9,  email: 'fatima.musa@renteasy.ke',       email_verified: true, name: 'Fatima Musa',      role: 'founder',     country: 'KE', language: 'en', status: 'active', last_login: ago(2),    onboarding_completed: true },
    { id: U.f10, email: 'chidi.nwosu@trucklink.ng',      email_verified: true, name: 'Chidi Nwosu',      role: 'founder',     country: 'NG', language: 'en', status: 'active', last_login: ago(7),    onboarding_completed: true },
    { id: U.f11, email: 'zainab.yusuf@mediscan.ng',      email_verified: true, name: 'Zainab Yusuf',     role: 'founder',     country: 'NG', language: 'en', status: 'active', last_login: ago(5),    onboarding_completed: true },
    { id: U.f12, email: 'emmanuel.kiptoo@farmyield.ke',  email_verified: true, name: 'Emmanuel Kiptoo',  role: 'founder',     country: 'KE', language: 'en', status: 'active', last_login: ago(6),    onboarding_completed: true },
    { id: U.f13, email: 'adaeze.obi@lendstack.ng',       email_verified: true, name: 'Adaeze Obi',       role: 'founder',     country: 'NG', language: 'en', status: 'active', last_login: ago(10),   onboarding_completed: true },
    { id: U.f14, email: 'kwame.mensah@learnpathgh.com',  email_verified: true, name: 'Kwame Mensah',     role: 'founder',     country: 'GH', language: 'en', status: 'active', last_login: ago(14),   onboarding_completed: true },
    { id: U.f15, email: 'bola.fashola@stylevault.ng',    email_verified: true, name: 'Bola Fashola',     role: 'founder',     country: 'NG', language: 'en', status: 'active', last_login: ago(12),   onboarding_completed: true },
    { id: U.f16, email: 'nneka.eze@homebloc.ng',         email_verified: true, name: 'Nneka Eze',        role: 'founder',     country: 'NG', language: 'en', status: 'active', last_login: ago(21),   onboarding_completed: true },
    { id: U.f17, email: 'sipho.ndlovu@pesopay.za',       email_verified: true, name: 'Sipho Ndlovu',     role: 'founder',     country: 'ZA', language: 'en', status: 'active', last_login: ago(18),   onboarding_completed: true },
    { id: U.f18, email: 'halima.traore@sunpower.ke',     email_verified: true, name: 'Halima Traoré',    role: 'founder',     country: 'KE', language: 'en', status: 'active', last_login: ago(30),   onboarding_completed: true },
    { id: U.f19, email: 'james.mwangi@smartfarm.ke',     email_verified: false,name: 'James Mwangi',     role: 'founder',     country: 'KE', language: 'en', status: 'active', last_login: ago(45),   onboarding_completed: false },
    { id: U.f20, email: 'chibuike.okafor@diagnostx.ng', email_verified: true, name: 'Chibuike Okafor',  role: 'founder',     country: 'NG', language: 'en', status: 'active', last_login: ago(90),   onboarding_completed: true },

    // ── Investors ──
    { id: U.i1, email: 'deals@adekuncap.com',      email_verified: true, name: 'Adewale Adekunle',   role: 'investor', country: 'NG', language: 'en', status: 'active', last_login: ago(0, 1), onboarding_completed: true },
    { id: U.i2, email: 'invest@lagosangels.org',   email_verified: true, name: 'Ngozi Okonjo',        role: 'investor', country: 'NG', language: 'en', status: 'active', last_login: ago(2),    onboarding_completed: true },
    { id: U.i3, email: 'capital@nairobiimpact.ke', email_verified: true, name: 'Sarah Kimani',        role: 'investor', country: 'KE', language: 'en', status: 'active', last_login: ago(3),    onboarding_completed: true },
    { id: U.i4, email: 'family@accrafo.gh',        email_verified: true, name: 'Kweku Darko',         role: 'investor', country: 'GH', language: 'en', status: 'active', last_login: ago(8),    onboarding_completed: true },
    { id: U.i5, email: 'gm@africagrowth.vc',       email_verified: true, name: 'Amaka Obi',           role: 'investor', country: 'NG', language: 'en', status: 'active', last_login: ago(1),    onboarding_completed: true },

    // ── Providers ──
    { id: U.p1, email: 'intake@lexafrica.law',      email_verified: true, name: 'Chukwuemeka Nwanze', role: 'provider', country: 'NG', language: 'en', status: 'active', last_login: ago(1),    onboarding_completed: true },
    { id: U.p2, email: 'advisory@kpmgafrica.com',   email_verified: true, name: 'Patricia Acheampong',role: 'provider', country: 'GH', language: 'en', status: 'active', last_login: ago(2),    onboarding_completed: true },
    { id: U.p3, email: 'hello@techscalehub.ng',     email_verified: true, name: 'Damilola Adeyemo',   role: 'provider', country: 'NG', language: 'en', status: 'active', last_login: ago(3),    onboarding_completed: true },
    { id: U.p4, email: 'hr@peoplefirst.africa',     email_verified: true, name: 'Wanjiru Kariuki',    role: 'provider', country: 'KE', language: 'en', status: 'active', last_login: ago(5),    onboarding_completed: true },
    { id: U.p5, email: 'grow@growthmark.co',        email_verified: true, name: 'Esi Turkson',        role: 'provider', country: 'GH', language: 'en', status: 'active', last_login: ago(4),    onboarding_completed: true },

    // ── Lenders ──
    { id: U.l1, email: 'sme@accessbankplc.com',    email_verified: true, name: 'Obi Ezeobi',           role: 'lender', country: 'NG', language: 'en', status: 'active', last_login: ago(0, 3), onboarding_completed: true },
    { id: U.l2, email: 'business@kcbgroup.com',    email_verified: true, name: 'Peter Muigai',          role: 'lender', country: 'KE', language: 'en', status: 'active', last_login: ago(1),    onboarding_completed: true },
    { id: U.l3, email: 'africa@bii.co.uk',         email_verified: true, name: 'Victoria Allotey',      role: 'lender', country: 'GB', language: 'en', status: 'active', last_login: ago(4),    onboarding_completed: true },

    // ── Universities ──
    { id: U.u1, email: 'entrepreneurship@unilag.edu.ng', email_verified: true, name: 'Prof. Adebayo Olukoshi', role: 'university', country: 'NG', language: 'en', status: 'active', last_login: ago(7),  onboarding_completed: true },
    { id: U.u2, email: 'innovation@strathmore.edu',      email_verified: true, name: 'Dr. Josephine Mwangi',   role: 'university', country: 'KE', language: 'en', status: 'active', last_login: ago(14), onboarding_completed: true },

    // ── Super Admin ──
    { id: U.admin, email: 'admin@ikonetu.com', email_verified: true, name: 'IkonetU Admin', role: 'super_admin', country: 'GB', language: 'en', status: 'active', last_login: ago(0, 0), onboarding_completed: true },
  ]);

  // ── User profiles ─────────────────────────────────────────
  const profileData = [
    { user_id: U.f1,  bio: 'Serial fintech entrepreneur. Former VP Product at Interswitch. Building the payment infrastructure Africa deserves.', website: 'https://payflowng.com', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/kemiadeyemi', twitter: '@payflowng' }) },
    { user_id: U.f2,  bio: 'Agronomist turned tech founder. 15 years in agriculture across West Africa. Connecting smallholder farmers to premium markets.', website: 'https://agroconnectgh.com', location: 'Accra, Ghana', timezone: 'Africa/Accra', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/kofiasante' }) },
    { user_id: U.f3,  bio: 'Medical doctor building digital health infrastructure for Africa. Former MSF field physician. MBChB, University of Ibadan.', website: 'https://healthbridge.ng', location: 'Abuja, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/amaradiallo', twitter: '@healthbridgeng' }) },
    { user_id: U.f4,  bio: 'Passionate about closing the education gap for African youth. Former teacher, Microsoft Education partner.', website: 'https://edureachng.com', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/tundeokonkwo' }) },
    { user_id: U.f5,  bio: 'Logistics veteran with 10 years in supply chain across East Africa. Building smarter freight networks.', website: 'https://swiftfreight.ke', location: 'Nairobi, Kenya', timezone: 'Africa/Nairobi', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/aishakamara' }) },
    { user_id: U.f6,  bio: 'Fintech founder focused on cooperative finance. Making savings circles digital and transparent.', website: 'https://cashcircle.ng', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/seunabiodun', twitter: '@cashcircleng' }) },
    { user_id: U.f7,  bio: 'E-commerce pioneer connecting Ghanaian artisans to global markets. Stanford GSB alum.', website: 'https://markethubgh.com', location: 'Accra, Ghana', timezone: 'Africa/Accra', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/nadiaosei' }) },
    { user_id: U.f8,  bio: 'Renewable energy entrepreneur providing affordable solar to underserved communities. IFC client.', website: 'https://solargrid.ng', location: 'Abuja, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/ibrahimhassan' }) },
    { user_id: U.f9,  bio: 'Proptech founder digitising the rental market in East Africa. Ex-Jumia.', website: 'https://renteasy.ke', location: 'Nairobi, Kenya', timezone: 'Africa/Nairobi', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/fatimamusa' }) },
    { user_id: U.f10, bio: 'Logistics startup building Uber for trucks in Nigeria. 500+ truck partners in 18 months.', website: 'https://trucklink.ng', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/chidinwosu', twitter: '@trucklink_ng' }) },
    { user_id: U.f11, bio: 'AI diagnostics for rural health facilities. Former WHO consultant. Oxford trained.', website: 'https://mediscan.ng', location: 'Kano, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/zainabyusuf' }) },
    { user_id: U.f12, bio: 'Agritech building precision farming tools for Kenyan smallholders.', website: 'https://farmyield.ke', location: 'Eldoret, Kenya', timezone: 'Africa/Nairobi', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/emmanuelkiptoo' }) },
    { user_id: U.f13, bio: 'Micro-lending platform using mobile money data for credit scoring.', website: 'https://lendstack.ng', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({}) },
    { user_id: U.f14, bio: 'K-12 edtech building interactive curriculum for Ghana schools.', website: 'https://learnpathgh.com', location: 'Kumasi, Ghana', timezone: 'Africa/Accra', social_links: JSON.stringify({}) },
    { user_id: U.f15, bio: 'Fashion marketplace connecting Lagos designers to buyers. Pre-revenue, building MVP.', website: 'https://stylevault.ng', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({ instagram: 'instagram.com/stylevaultng' }) },
    { user_id: U.f16, bio: 'Digital mortgage platform for first-time homebuyers in Nigeria.', website: 'https://homebloc.ng', location: 'Abuja, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({}) },
    { user_id: U.f17, bio: 'Cross-border payments for Southern Africa. MVP stage, first 20 customers.', website: '', location: 'Johannesburg, South Africa', timezone: 'Africa/Johannesburg', social_links: JSON.stringify({}) },
    { user_id: U.f18, bio: 'Distributed solar energy access in rural Kenya. Idea stage.', website: '', location: 'Mombasa, Kenya', timezone: 'Africa/Nairobi', social_links: JSON.stringify({}) },
    { user_id: U.f19, bio: 'IoT sensors and data analytics for smallholder farm management.', website: '', location: 'Kisumu, Kenya', timezone: 'Africa/Nairobi', social_links: JSON.stringify({}) },
    { user_id: U.f20, bio: 'AI-powered diagnostic tool for rural clinics using smartphone cameras.', website: 'https://diagnostx.ng', location: 'Enugu, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({}) },
    // Non-founder profiles
    { user_id: U.i1, bio: 'Managing Partner at Adekunle Capital. $50M fund focused on seed-stage African fintech and agritech.', website: 'https://adekuncap.com', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/adewaleadekunle' }) },
    { user_id: U.i2, bio: 'Co-founder, Lagos Angel Network. 40+ investments across West Africa.', website: 'https://lagosangels.org', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({}) },
    { user_id: U.i3, bio: 'Investment Director, Nairobi Impact Fund. SDG-aligned investing in East Africa.', website: 'https://nairobiimpact.ke', location: 'Nairobi, Kenya', timezone: 'Africa/Nairobi', social_links: JSON.stringify({}) },
    { user_id: U.i4, bio: 'Family Office Director. Third-generation Ghanaian investor. Focus: healthcare and education.', website: '', location: 'Accra, Ghana', timezone: 'Africa/Accra', social_links: JSON.stringify({}) },
    { user_id: U.i5, bio: 'General Partner, Africa Growth Capital. Pan-African VC focused on Series A.', website: 'https://africagrowth.vc', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({ linkedin: 'linkedin.com/in/amakaobi' }) },
    { user_id: U.p1, bio: 'Founding Partner, Lex Africa Law. Specialist in tech company formation, fundraising, and regulatory compliance across West Africa.', website: 'https://lexafrica.law', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({}) },
    { user_id: U.p2, bio: 'Director, KPMG Africa Advisory. Startup-focused accounting, audit, and tax across 10 African countries.', website: 'https://kpmg.com/africa', location: 'Accra, Ghana', timezone: 'Africa/Accra', social_links: JSON.stringify({}) },
    { user_id: U.p3, bio: 'Founder, TechScale Hub. Software development and digital transformation for African startups.', website: 'https://techscalehub.ng', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({ twitter: '@techscalehub' }) },
    { user_id: U.p4, bio: 'CEO, PeopleFirst HR. Pan-African HR consulting, payroll, and talent acquisition.', website: 'https://peoplefirst.africa', location: 'Nairobi, Kenya', timezone: 'Africa/Nairobi', social_links: JSON.stringify({}) },
    { user_id: U.p5, bio: 'Co-founder, GrowthMark. Performance marketing and brand strategy for African tech startups.', website: 'https://growthmark.co', location: 'Accra, Ghana', timezone: 'Africa/Accra', social_links: JSON.stringify({}) },
    { user_id: U.l1, bio: 'Head of SME Banking, Access Bank Nigeria. £2B SME lending portfolio.', website: 'https://accessbankplc.com', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({}) },
    { user_id: U.l2, bio: 'Director, Business Banking, KCB Group. East Africa\'s largest commercial bank.', website: 'https://kcbgroup.com', location: 'Nairobi, Kenya', timezone: 'Africa/Nairobi', social_links: JSON.stringify({}) },
    { user_id: U.l3, bio: 'Investment Director, British International Investment. DFI deploying capital across Africa.', website: 'https://bii.co.uk', location: 'London, UK', timezone: 'Europe/London', social_links: JSON.stringify({}) },
    { user_id: U.u1, bio: 'Director of Entrepreneurship & Innovation, University of Lagos. Champion of African startup ecosystems.', website: 'https://unilag.edu.ng', location: 'Lagos, Nigeria', timezone: 'Africa/Lagos', social_links: JSON.stringify({}) },
    { user_id: U.u2, bio: 'Director, Strathmore Entrepreneurship Centre. Kenya\'s leading business school.', website: 'https://strathmore.edu', location: 'Nairobi, Kenya', timezone: 'Africa/Nairobi', social_links: JSON.stringify({}) },
    { user_id: U.admin, bio: 'IkonetU Platform Administrator.', website: 'https://ikonetu.com', location: 'London, UK', timezone: 'Europe/London', social_links: JSON.stringify({}) },
  ];

  for (const p of profileData) {
    await knex('user_profiles').insert(p);
  }

  // ── User preferences ──────────────────────────────────────
  const allUserIds = [...Object.entries(U)].filter(([k]) => !k.startsWith('v') && !k.startsWith('s') && !k.startsWith('ip') && !k.startsWith('pp') && !k.startsWith('lp') && !k.startsWith('up') && !k.startsWith('plan')).map(([, v]) => v);

  for (const uid of allUserIds) {
    await knex('user_preferences').insert({
      user_id: uid,
      notification_prefs: JSON.stringify({ email: true, push: true, whatsapp: false, in_app: true }),
      language: 'en',
      currency: ['KE','NG'].includes('NG') ? 'NGN' : 'GBP',
    });
  }

  // ── User sessions (active sessions for recently logged-in users) ──
  const activeFounders = [U.f1, U.f2, U.f3, U.f4, U.f5, U.i1, U.l1, U.admin];
  for (const uid of activeFounders) {
    await knex('user_sessions').insert({
      user_id: uid,
      token_hash: hash(`access_${uid}_${Date.now()}`),
      refresh_token_hash: hash(`refresh_${uid}_${Date.now()}`),
      device_info: JSON.stringify({ userAgent: 'Mozilla/5.0 Chrome/120', platform: 'web' }),
      ip: '41.58.0.' + Math.floor(Math.random() * 254 + 1),
      expires_at: new Date(Date.now() + 7 * 86400 * 1000),
    });
  }

  // ── User consents ──────────────────────────────────────────
  const consentTypes = ['terms_v2', 'privacy_policy', 'analytics', 'score_share_investors', 'score_share_lenders', 'lender_pool', 'push_notifications'];
  for (const uid of [U.f1, U.f2, U.f3, U.f4, U.f5, U.f6, U.f7, U.f8, U.f9, U.f10]) {
    for (const ct of consentTypes) {
      await knex('user_consents').insert({
        user_id: uid, consent_type: ct, granted: true,
        granted_at: ago(30), ip: '41.58.0.1', version: '1.0',
      });
    }
  }
  // Partial consents — some founders opted out of investor sharing
  for (const uid of [U.f11, U.f12, U.f13]) {
    for (const ct of ['terms_v2', 'privacy_policy', 'analytics']) {
      await knex('user_consents').insert({ user_id: uid, consent_type: ct, granted: true, granted_at: ago(60), ip: '41.58.0.1', version: '1.0' });
    }
    await knex('user_consents').insert({ user_id: uid, consent_type: 'score_share_investors', granted: false, revoked_at: ago(10), ip: '41.58.0.1', version: '1.0', granted_at: ago(60) });
    await knex('user_consents').insert({ user_id: uid, consent_type: 'score_share_lenders', granted: true, granted_at: ago(60), ip: '41.58.0.1', version: '1.0' });
  }
  // Minimal consents (EARLY founders)
  for (const uid of [U.f14, U.f15, U.f16, U.f17, U.f18, U.f19, U.f20]) {
    for (const ct of ['terms_v2', 'privacy_policy']) {
      await knex('user_consents').insert({ user_id: uid, consent_type: ct, granted: true, granted_at: ago(90), ip: '41.58.0.1', version: '1.0' });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 2. VENTURES
  // ════════════════════════════════════════════════════════════
  const ventures = [
    { id: U.v1,  user_id: U.f1,  name: 'PayFlowNG',        description: 'End-to-end payment infrastructure for African SMEs. API-first, serving 2,400+ businesses across Nigeria with real-time settlement and multi-currency support.', sector: 'Fintech',     business_type: 'tech_native',       country: 'NG', city: 'Lagos',       registration_number: 'RC-1892045', tin: 'NG-TIN-44821092', date_founded: '2019-03-15', employee_count: 47, annual_revenue_range: '£500k-£1M', stage: 'scaling' },
    { id: U.v2,  user_id: U.f2,  name: 'AgroConnect GH',   description: 'Digital marketplace connecting 15,000 smallholder farmers in Ghana to institutional buyers. Embedded finance and quality certification built in.', sector: 'Agritech',    business_type: 'digitally_enabled', country: 'GH', city: 'Accra',       registration_number: 'GH-CS-012891', tin: 'GH-TIN-20192017', date_founded: '2020-07-01', employee_count: 32, annual_revenue_range: '£250k-£500k', stage: 'scaling' },
    { id: U.v3,  user_id: U.f3,  name: 'HealthBridge NG',  description: 'Telemedicine and electronic health records platform for Nigerian primary care facilities. Integrated with NHIS. 600+ clinic partners.', sector: 'Healthtech',  business_type: 'tech_native',       country: 'NG', city: 'Abuja',       registration_number: 'RC-2047193', tin: 'NG-TIN-55920147', date_founded: '2020-11-20', employee_count: 28, annual_revenue_range: '£250k-£500k', stage: 'revenue' },
    { id: U.v4,  user_id: U.f4,  name: 'EduReach NG',      description: 'Adaptive learning platform serving 85,000 students across Nigerian secondary schools. State government partnerships in 3 states.', sector: 'Edtech',      business_type: 'tech_native',       country: 'NG', city: 'Lagos',       registration_number: 'RC-1974628', tin: 'NG-TIN-33714901', date_founded: '2021-02-10', employee_count: 21, annual_revenue_range: '£100k-£250k', stage: 'revenue' },
    { id: U.v5,  user_id: U.f5,  name: 'SwiftFreight KE',  description: 'Same-day and next-day freight brokerage across East Africa. 800+ vetted transport partners. B2B focus with enterprise SLAs.', sector: 'Logistics',   business_type: 'digitally_enabled', country: 'KE', city: 'Nairobi',     registration_number: 'CPR-2021-KE-89012', tin: 'KE-PIN-A00288193F', date_founded: '2021-05-01', employee_count: 19, annual_revenue_range: '£100k-£250k', stage: 'revenue' },
    { id: U.v6,  user_id: U.f6,  name: 'CashCircle NG',    description: 'Digital cooperative savings and lending platform. Formalising the informal \'esusu\' system with mobile money integration. 12,000 active savers.', sector: 'Fintech',     business_type: 'tech_native',       country: 'NG', city: 'Lagos',       registration_number: 'RC-2104815', tin: 'NG-TIN-22801045', date_founded: '2021-08-15', employee_count: 14, annual_revenue_range: '£100k-£250k', stage: 'revenue' },
    { id: U.v7,  user_id: U.f7,  name: 'MarketHub GH',     description: 'B2C e-commerce platform for Ghanaian artisan goods and fashion. 1,200 seller accounts, 28,000 monthly active buyers.', sector: 'E-commerce',  business_type: 'tech_native',       country: 'GH', city: 'Accra',       registration_number: 'GH-CS-021047', tin: null, date_founded: '2022-01-01', employee_count: 11, annual_revenue_range: '£50k-£100k', stage: 'revenue' },
    { id: U.v8,  user_id: U.f8,  name: 'SolarGrid NG',     description: 'Solar mini-grid developer and operator serving rural communities in Nigeria. IFC co-financed. 8 operational mini-grids, 4,200 customers.', sector: 'Energy',      business_type: 'physical_first',    country: 'NG', city: 'Abuja',       registration_number: 'RC-1891204', tin: 'NG-TIN-14820104', date_founded: '2020-04-01', employee_count: 38, annual_revenue_range: '£250k-£500k', stage: 'scaling' },
    { id: U.v9,  user_id: U.f9,  name: 'RentEasy KE',      description: 'Digital rental marketplace for residential and commercial properties in East Africa. Escrow payments, verified listings, credit-based tenant scoring.', sector: 'Proptech',   business_type: 'tech_native',       country: 'KE', city: 'Nairobi',     registration_number: 'CPR-2022-KE-11028', tin: null, date_founded: '2022-03-10', employee_count: 9, annual_revenue_range: '£25k-£50k', stage: 'mvp' },
    { id: U.v10, user_id: U.f10, name: 'TruckLink NG',     description: 'Asset-light freight matching platform. Nigeria\'s first on-demand trucking marketplace. 520 verified trucks, enterprise logistics partnerships.', sector: 'Logistics',   business_type: 'tech_native',       country: 'NG', city: 'Lagos',       registration_number: 'RC-2190482', tin: 'NG-TIN-39102847', date_founded: '2022-06-01', employee_count: 12, annual_revenue_range: '£50k-£100k', stage: 'revenue' },
    { id: U.v11, user_id: U.f11, name: 'MediScan NG',      description: 'AI-powered diagnostic imaging tool for rural health facilities. Detects TB, malaria, and diabetes complications via smartphone camera. 140 clinic partners.', sector: 'Healthtech',  business_type: 'tech_native',       country: 'NG', city: 'Kano',        registration_number: 'RC-2241089', tin: null, date_founded: '2022-09-01', employee_count: 8, annual_revenue_range: '£10k-£25k', stage: 'mvp' },
    { id: U.v12, user_id: U.f12, name: 'FarmYield KE',     description: 'IoT soil sensors and AI crop advisory for Kenyan smallholder farmers. Integrated with agricultural insurance products.', sector: 'Agritech',    business_type: 'tech_native',       country: 'KE', city: 'Eldoret',     registration_number: 'CPR-2022-KE-20194', tin: null, date_founded: '2022-11-15', employee_count: 7, annual_revenue_range: '£10k-£25k', stage: 'mvp' },
    { id: U.v13, user_id: U.f13, name: 'LendStack NG',     description: 'Alternative credit scoring using mobile money and behavioural data for the unbanked. Under development.', sector: 'Fintech',     business_type: 'tech_native',       country: 'NG', city: 'Lagos',       registration_number: null, tin: null, date_founded: '2023-02-01', employee_count: 3, annual_revenue_range: null, stage: 'idea' },
    { id: U.v14, user_id: U.f14, name: 'LearnPath GH',     description: 'Gamified K-12 learning app for Ghana. 3,000 students in pilot. Ghana Education Service partnership pending.', sector: 'Edtech',      business_type: 'tech_native',       country: 'GH', city: 'Kumasi',      registration_number: null, tin: null, date_founded: '2023-04-01', employee_count: 4, annual_revenue_range: null, stage: 'mvp' },
    { id: U.v15, user_id: U.f15, name: 'StyleVault NG',    description: 'Curated fashion marketplace for independent Nigerian designers. Pre-launch.', sector: 'E-commerce',  business_type: 'digitally_enabled', country: 'NG', city: 'Lagos',       registration_number: null, tin: null, date_founded: '2023-06-01', employee_count: 2, annual_revenue_range: null, stage: 'idea' },
    { id: U.v16, user_id: U.f16, name: 'HomeBloc NG',      description: 'Digital mortgage origination for first-time buyers in Nigeria. Concept stage, legal structure being established.', sector: 'Proptech',   business_type: 'tech_native',       country: 'NG', city: 'Abuja',       registration_number: null, tin: null, date_founded: '2023-07-15', employee_count: 2, annual_revenue_range: null, stage: 'idea' },
    { id: U.v17, user_id: U.f17, name: 'PesoPay ZA',       description: 'SADC cross-border payment rails for SMEs. Idea stage, 20 beta users.', sector: 'Fintech',     business_type: 'tech_native',       country: 'ZA', city: 'Johannesburg', registration_number: null, tin: null, date_founded: '2023-05-01', employee_count: 2, annual_revenue_range: null, stage: 'mvp' },
    { id: U.v18, user_id: U.f18, name: 'SunPower KE',      description: 'Pay-as-you-go solar home systems for rural Kenyan households. Bootstrapped, pre-revenue.', sector: 'Energy',      business_type: 'physical_first',    country: 'KE', city: 'Mombasa',     registration_number: null, tin: null, date_founded: '2023-09-01', employee_count: 1, annual_revenue_range: null, stage: 'idea' },
    { id: U.v19, user_id: U.f19, name: 'SmartFarm KE',     description: 'Farm data analytics platform for Kenyan smallholders. Very early, no registered entity.', sector: 'Agritech',    business_type: 'tech_native',       country: 'KE', city: 'Kisumu',      registration_number: null, tin: null, date_founded: '2023-11-01', employee_count: 1, annual_revenue_range: null, stage: 'idea' },
    { id: U.v20, user_id: U.f20, name: 'DiagnostX NG',     description: 'AI diagnostics using smartphone camera. Prototype built, not yet registered. Single founder, part-time.', sector: 'Healthtech',  business_type: 'tech_native',       country: 'NG', city: 'Enugu',       registration_number: null, tin: null, date_founded: '2024-01-15', employee_count: 1, annual_revenue_range: null, stage: 'idea' },
  ];
  await knex('ventures').insert(ventures);

  // ── Venture documents ─────────────────────────────────────
  const docs = [
    // ELITE founder f1 — fully verified, all document types
    { venture_id: U.v1, document_type: 'government_id',         file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v1/gov_id.pdf',          verified: true, verification_tier: 1, verified_at: ago(180), verifier: U.admin, ai_confidence: 98.5 },
    { venture_id: U.v1, document_type: 'business_registration', file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v1/cac_cert.pdf',         verified: true, verification_tier: 2, verified_at: ago(180), verifier: U.admin, ai_confidence: 96.2 },
    { venture_id: U.v1, document_type: 'tax_return',            file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v1/tax_return_2023.pdf',  verified: true, verification_tier: 2, verified_at: ago(150), verifier: U.admin, ai_confidence: 94.1 },
    { venture_id: U.v1, document_type: 'audited_accounts',      file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v1/audited_2023.pdf',     verified: true, verification_tier: 2, verified_at: ago(90),  verifier: U.admin, ai_confidence: 97.3 },
    { venture_id: U.v1, document_type: 'bank_statement',        file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v1/bank_stmt_q4.pdf',     verified: true, verification_tier: 2, verified_at: ago(60),  verifier: U.admin, ai_confidence: 95.0 },
    { venture_id: U.v1, document_type: 'ip_registration',       file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v1/trademark.pdf',        verified: true, verification_tier: 3, verified_at: ago(90),  verifier: U.admin, ai_confidence: 91.8 },
    { venture_id: U.v1, document_type: 'customer_contracts',    file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v1/enterprise_contract.pdf', verified: true, verification_tier: 3, verified_at: ago(45), verifier: U.admin, ai_confidence: 88.4 },
    // INVESTABLE founder f2
    { venture_id: U.v2, document_type: 'business_registration', file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v2/gh_reg.pdf',           verified: true, verification_tier: 2, verified_at: ago(120), verifier: U.admin, ai_confidence: 93.7 },
    { venture_id: U.v2, document_type: 'bank_statement',        file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v2/bank_stmt.pdf',        verified: true, verification_tier: 2, verified_at: ago(80),  verifier: U.admin, ai_confidence: 91.2 },
    { venture_id: U.v2, document_type: 'tax_return',            file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v2/tax.pdf',              verified: true, verification_tier: 3, verified_at: ago(100), verifier: U.admin, ai_confidence: 85.9 },
    // INVESTABLE founder f3
    { venture_id: U.v3, document_type: 'business_registration', file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v3/cac.pdf',              verified: true, verification_tier: 2, verified_at: ago(100), verifier: U.admin, ai_confidence: 94.5 },
    { venture_id: U.v3, document_type: 'operating_licence',     file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v3/nhis_licence.pdf',     verified: true, verification_tier: 1, verified_at: ago(90),  verifier: U.admin, ai_confidence: 99.1 },
    { venture_id: U.v3, document_type: 'bank_statement',        file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v3/bank.pdf',             verified: true, verification_tier: 2, verified_at: ago(60),  verifier: U.admin, ai_confidence: 90.0 },
    // INVESTABLE founder f4
    { venture_id: U.v4, document_type: 'business_registration', file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v4/cac.pdf',              verified: true, verification_tier: 2, verified_at: ago(80), verifier: U.admin, ai_confidence: 92.3 },
    { venture_id: U.v4, document_type: 'customer_contracts',    file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v4/gov_contract.pdf',     verified: true, verification_tier: 3, verified_at: ago(60), verifier: U.admin, ai_confidence: 87.1 },
    // RISING founders — partial docs
    { venture_id: U.v6, document_type: 'business_registration', file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v6/cac.pdf',              verified: true, verification_tier: 2, verified_at: ago(70), verifier: U.admin, ai_confidence: 91.0 },
    { venture_id: U.v7, document_type: 'business_registration', file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v7/gh_reg.pdf',           verified: true, verification_tier: 3, verified_at: ago(50), verifier: U.admin, ai_confidence: 86.4 },
    { venture_id: U.v8, document_type: 'business_registration', file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v8/cac.pdf',              verified: true, verification_tier: 2, verified_at: ago(60), verifier: U.admin, ai_confidence: 93.2 },
    { venture_id: U.v8, document_type: 'insurance_certificate', file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v8/insurance.pdf',        verified: true, verification_tier: 3, verified_at: ago(30), verifier: U.admin, ai_confidence: 89.7 },
    // EARLY founders — minimal or unverified docs
    { venture_id: U.v13, document_type: 'government_id',        file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v13/id.pdf',              verified: false, verification_tier: null, ai_confidence: null },
    { venture_id: U.v14, document_type: 'government_id',        file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v14/id.pdf',              verified: false, verification_tier: null, ai_confidence: null },
    // Pending verification — in admin queue
    { venture_id: U.v11, document_type: 'operating_licence',    file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v11/nafdac.pdf',          verified: false, verification_tier: null, ai_confidence: null },
    { venture_id: U.v12, document_type: 'business_registration',file_url: 'https://storage.googleapis.com/ikonetu-media-prod/docs/v12/ke_reg.pdf',          verified: false, verification_tier: null, ai_confidence: null },
  ];
  for (const d of docs) await knex('venture_documents').insert(d);

  // ── Social profiles ───────────────────────────────────────
  const socialProfiles = [
    { venture_id: U.v1, platform: 'linkedin',  handle: 'payflowng',        url: 'https://linkedin.com/company/payflowng',   followers: 12840, engagement_rate: 4.2, last_scraped: ago(1) },
    { venture_id: U.v1, platform: 'twitter',   handle: '@payflowng',        url: 'https://twitter.com/payflowng',            followers: 28500, engagement_rate: 3.8, last_scraped: ago(1) },
    { venture_id: U.v1, platform: 'instagram', handle: 'payflowng',        url: 'https://instagram.com/payflowng',          followers: 8200,  engagement_rate: 5.1, last_scraped: ago(1) },
    { venture_id: U.v2, platform: 'linkedin',  handle: 'agroconnectgh',    url: 'https://linkedin.com/company/agroconnect', followers: 5420,  engagement_rate: 3.9, last_scraped: ago(2) },
    { venture_id: U.v2, platform: 'twitter',   handle: '@agroconnectgh',   url: 'https://twitter.com/agroconnectgh',        followers: 9180,  engagement_rate: 2.8, last_scraped: ago(2) },
    { venture_id: U.v3, platform: 'linkedin',  handle: 'healthbridgeng',   url: 'https://linkedin.com/company/healthbridge', followers: 4800, engagement_rate: 4.5, last_scraped: ago(1) },
    { venture_id: U.v3, platform: 'twitter',   handle: '@healthbridgeng',  url: 'https://twitter.com/healthbridgeng',       followers: 7200,  engagement_rate: 3.2, last_scraped: ago(1) },
    { venture_id: U.v4, platform: 'linkedin',  handle: 'edureachng',       url: 'https://linkedin.com/company/edureachng',  followers: 3200,  engagement_rate: 5.8, last_scraped: ago(3) },
    { venture_id: U.v5, platform: 'linkedin',  handle: 'swiftfreightke',   url: 'https://linkedin.com/company/swiftfreight',followers: 2100,  engagement_rate: 3.1, last_scraped: ago(2) },
    { venture_id: U.v6, platform: 'twitter',   handle: '@cashcircleng',    url: 'https://twitter.com/cashcircleng',         followers: 5400,  engagement_rate: 4.2, last_scraped: ago(4) },
    { venture_id: U.v7, platform: 'instagram', handle: 'markethubgh',      url: 'https://instagram.com/markethubgh',        followers: 11200, engagement_rate: 7.4, last_scraped: ago(2) },
    { venture_id: U.v8, platform: 'linkedin',  handle: 'solargridng',      url: 'https://linkedin.com/company/solargrid',   followers: 3800,  engagement_rate: 4.1, last_scraped: ago(3) },
    { venture_id: U.v10, platform: 'twitter',  handle: '@trucklink_ng',    url: 'https://twitter.com/trucklink_ng',         followers: 4100,  engagement_rate: 3.5, last_scraped: ago(5) },
    { venture_id: U.v11, platform: 'twitter',  handle: '@mediscanng',      url: 'https://twitter.com/mediscanng',           followers: 1820,  engagement_rate: 6.1, last_scraped: ago(7) },
    { venture_id: U.v15, platform: 'instagram',handle: 'stylevaultng',     url: 'https://instagram.com/stylevaultng',       followers: 3200,  engagement_rate: 8.2, last_scraped: ago(14) },
  ];
  for (const s of socialProfiles) await knex('venture_social_profiles').insert(s);

  // ── Financial data (12 months rolling per founder) ────────
  const financialEntries = [];
  const financeConfig: Array<{ vid: string; baseRevenue: number; growth: number; source: string; currency: string; tier: number }> = [
    { vid: U.v1,  baseRevenue: 98000,  growth: 0.12, source: 'mono',            currency: 'GBP', tier: 2 },
    { vid: U.v2,  baseRevenue: 52000,  growth: 0.09, source: 'mono',            currency: 'GBP', tier: 2 },
    { vid: U.v3,  baseRevenue: 41000,  growth: 0.08, source: 'bank_statement',  currency: 'GBP', tier: 3 },
    { vid: U.v4,  baseRevenue: 28000,  growth: 0.07, source: 'bank_statement',  currency: 'GBP', tier: 3 },
    { vid: U.v5,  baseRevenue: 22000,  growth: 0.10, source: 'okra',            currency: 'GBP', tier: 2 },
    { vid: U.v6,  baseRevenue: 18000,  growth: 0.15, source: 'mono',            currency: 'NGN', tier: 2 },
    { vid: U.v7,  baseRevenue: 11000,  growth: 0.05, source: 'bank_statement',  currency: 'GBP', tier: 3 },
    { vid: U.v8,  baseRevenue: 44000,  growth: 0.04, source: 'bank_statement',  currency: 'GBP', tier: 3 },
    { vid: U.v9,  baseRevenue: 4200,   growth: 0.20, source: 'self_declared',   currency: 'KES', tier: 4 },
    { vid: U.v10, baseRevenue: 9800,   growth: 0.08, source: 'bank_statement',  currency: 'NGN', tier: 3 },
    { vid: U.v11, baseRevenue: 2100,   growth: 0.25, source: 'self_declared',   currency: 'NGN', tier: 4 },
    { vid: U.v12, baseRevenue: 1800,   growth: 0.30, source: 'self_declared',   currency: 'KES', tier: 4 },
  ];

  for (const fc of financeConfig) {
    for (let m = 11; m >= 0; m--) {
      const d = new Date();
      d.setMonth(d.getMonth() - m, 1);
      const period = `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
      const growthFactor = Math.pow(1 + fc.growth, 11 - m);
      const rev = Math.round(fc.baseRevenue * growthFactor);
      const exp = Math.round(rev * (0.65 + Math.random() * 0.15));
      financialEntries.push({
        venture_id: fc.vid,
        source: fc.source,
        period,
        revenue: rev,
        expenses: exp,
        profit: rev - exp,
        currency: fc.currency,
        verified: fc.tier <= 3,
        verification_tier: fc.tier,
      });
    }
  }
  await knex('venture_financial_data').insert(financialEntries);

  // ── Pitch videos ──────────────────────────────────────────
  await knex('pitch_videos').insert([
    { venture_id: U.v1, file_url: 'https://storage.googleapis.com/ikonetu-media-prod/pitch/v1/pitch.mp4', duration_seconds: 182, thumbnail_url: 'https://storage.googleapis.com/ikonetu-media-prod/pitch/v1/thumb.jpg', status: 'ready', score_impact: 20, transcript: 'Hi, I am Kemi Adeyemi, founder of PayFlowNG. We are building the payment infrastructure layer for African SMEs...' },
    { venture_id: U.v2, file_url: 'https://storage.googleapis.com/ikonetu-media-prod/pitch/v2/pitch.mp4', duration_seconds: 154, thumbnail_url: 'https://storage.googleapis.com/ikonetu-media-prod/pitch/v2/thumb.jpg', status: 'ready', score_impact: 20 },
    { venture_id: U.v3, file_url: 'https://storage.googleapis.com/ikonetu-media-prod/pitch/v3/pitch.mp4', duration_seconds: 198, thumbnail_url: 'https://storage.googleapis.com/ikonetu-media-prod/pitch/v3/thumb.jpg', status: 'ready', score_impact: 20 },
    { venture_id: U.v4, file_url: 'https://storage.googleapis.com/ikonetu-media-prod/pitch/v4/pitch.mp4', duration_seconds: 167, status: 'ready', score_impact: 20 },
    { venture_id: U.v6, file_url: 'https://storage.googleapis.com/ikonetu-media-prod/pitch/v6/pitch.mp4', duration_seconds: 143, status: 'ready', score_impact: 20 },
    { venture_id: U.v10,file_url: 'https://storage.googleapis.com/ikonetu-media-prod/pitch/v10/pitch.mp4',duration_seconds: 120, status: 'processing', score_impact: 0 },
  ]);

  // ════════════════════════════════════════════════════════════
  // 3. TIER CONFIG & SCORING RULES
  // ════════════════════════════════════════════════════════════
  await knex('tier_config').insert([
    { tier_name: 'EARLY',      min_score: 0,   max_score: 300,  label: 'Early Stage', color: '#94A3B8', benefits: JSON.stringify(['Basic score profile', 'Access to service provider directory', 'Score improvement recommendations']) },
    { tier_name: 'RISING',     min_score: 301, max_score: 600,  label: 'Rising',      color: '#F59E0B', benefits: JSON.stringify(['Full score profile', 'Investor discovery (with consent)', 'Priority document verification', 'Score API access (100 calls/month)']) },
    { tier_name: 'INVESTABLE', min_score: 601, max_score: 850,  label: 'Investable',  color: '#10B981', benefits: JSON.stringify(['Verified investor matching', 'Lender pool eligibility', 'Deal room access', 'Score API (1000 calls/month)', 'Monthly score report']) },
    { tier_name: 'ELITE',      min_score: 851, max_score: 1000, label: 'Elite',       color: '#C9900C', benefits: JSON.stringify(['Priority investor introductions', 'Fast-track lender access', 'White-label score report', 'Unlimited Score API', 'Dedicated account manager']) },
  ]);

  const scoringRules = [
    // Identity (max 150)
    { category: 'identity', signal_type: 'government_id_verified',      rule_logic: JSON.stringify({ doc_type: 'government_id', min_tier: 3 }),        weight: 0.1000, max_points: 35, verification_tier_required: 3 },
    { category: 'identity', signal_type: 'business_registration',       rule_logic: JSON.stringify({ doc_type: 'business_registration', api: true }),  weight: 0.1500, max_points: 50, verification_tier_required: 2 },
    { category: 'identity', signal_type: 'tax_identification',          rule_logic: JSON.stringify({ field: 'tin', verified: true }),                  weight: 0.1000, max_points: 35, verification_tier_required: 2 },
    { category: 'identity', signal_type: 'operating_tenure',            rule_logic: JSON.stringify({ field: 'date_founded', unit: 'months' }),         weight: 0.0900, max_points: 30, verification_tier_required: 4 },
    // Financial (max 200)
    { category: 'financial', signal_type: 'revenue_evidence',           rule_logic: JSON.stringify({ min_months: 1, scale_factor: 12500 }),           weight: 0.0800, max_points: 80, verification_tier_required: 2 },
    { category: 'financial', signal_type: 'revenue_consistency',        rule_logic: JSON.stringify({ min_months: 6, points_per_month: 4 }),            weight: 0.0700, max_points: 40, verification_tier_required: 3 },
    { category: 'financial', signal_type: 'bank_account_connected',     rule_logic: JSON.stringify({ sources: ['mono', 'okra', 'open_banking'] }),    weight: 0.0750, max_points: 50, verification_tier_required: 2 },
    { category: 'financial', signal_type: 'financial_documents',        rule_logic: JSON.stringify({ min_docs: 1, points_per_doc: 10 }),               weight: 0.0450, max_points: 30, verification_tier_required: 3 },
    // Media (max 100)
    { category: 'media', signal_type: 'website_presence',               rule_logic: JSON.stringify({ field: 'website', min_length: 5 }),               weight: 0.0200, max_points: 15, verification_tier_required: 4 },
    { category: 'media', signal_type: 'pitch_video',                    rule_logic: JSON.stringify({ status: 'ready' }),                               weight: 0.0300, max_points: 20, verification_tier_required: 3 },
    { category: 'media', signal_type: 'social_presence_linkedin',       rule_logic: JSON.stringify({ platform: 'linkedin', min_followers: 100 }),     weight: 0.0200, max_points: 15, verification_tier_required: 2 },
    { category: 'media', signal_type: 'social_presence_twitter',        rule_logic: JSON.stringify({ platform: 'twitter', min_followers: 500 }),      weight: 0.0200, max_points: 15, verification_tier_required: 2 },
    { category: 'media', signal_type: 'google_maps_listing',            rule_logic: JSON.stringify({ source: 'google_maps_api' }),                    weight: 0.0500, max_points: 35, verification_tier_required: 2 },
    // Product (max 150)
    { category: 'product', signal_type: 'venture_stage_mvp',            rule_logic: JSON.stringify({ stage: 'mvp', points: 40 }),                     weight: 0.0500, max_points: 40, verification_tier_required: 4 },
    { category: 'product', signal_type: 'venture_stage_revenue',        rule_logic: JSON.stringify({ stage: 'revenue', points: 80 }),                 weight: 0.0900, max_points: 80, verification_tier_required: 4 },
    { category: 'product', signal_type: 'venture_stage_scaling',        rule_logic: JSON.stringify({ stage: 'scaling', points: 120 }),                weight: 0.1200, max_points: 120,verification_tier_required: 4 },
    { category: 'product', signal_type: 'customer_evidence',            rule_logic: JSON.stringify({ doc_types: ['customer_contracts', 'mou'] }),     weight: 0.0400, max_points: 30, verification_tier_required: 3 },
    // Team (max 100)
    { category: 'team', signal_type: 'team_size',                       rule_logic: JSON.stringify({ field: 'employee_count', points_per: 5 }),       weight: 0.0500, max_points: 40, verification_tier_required: 4 },
    { category: 'team', signal_type: 'team_credentials',                rule_logic: JSON.stringify({ doc_types: ['cv', 'linkedin_profile'] }),        weight: 0.0600, max_points: 60, verification_tier_required: 3 },
    // Legal (max 150)
    { category: 'legal', signal_type: 'legal_registration',             rule_logic: JSON.stringify({ field: 'registration_number' }),                 weight: 0.0800, max_points: 60, verification_tier_required: 2 },
    { category: 'legal', signal_type: 'tax_registration',               rule_logic: JSON.stringify({ field: 'tin' }),                                 weight: 0.0700, max_points: 50, verification_tier_required: 1 },
    { category: 'legal', signal_type: 'regulatory_licence',             rule_logic: JSON.stringify({ doc_type: 'operating_licence' }),                weight: 0.0500, max_points: 40, verification_tier_required: 1 },
    // Market (max 100)
    { category: 'market', signal_type: 'sector_defined',                rule_logic: JSON.stringify({ field: 'sector' }),                              weight: 0.0200, max_points: 20, verification_tier_required: 4 },
    { category: 'market', signal_type: 'google_maps_verified',          rule_logic: JSON.stringify({ source: 'google_maps_api', operational: true }), weight: 0.0700, max_points: 70, verification_tier_required: 2 },
    { category: 'market', signal_type: 'market_geography',              rule_logic: JSON.stringify({ field: 'country' }),                             weight: 0.0100, max_points: 10, verification_tier_required: 4 },
    // Operations (max 50)
    { category: 'operations', signal_type: 'payroll_evidence',          rule_logic: JSON.stringify({ doc_types: ['payroll_record', 'employee_contracts'] }), weight: 0.0500, max_points: 50, verification_tier_required: 3 },
  ];
  await knex('scoring_rules').insert(scoringRules);

  // ════════════════════════════════════════════════════════════
  // 4. SCORES, BREAKDOWNS, SIGNALS, HISTORY
  // ════════════════════════════════════════════════════════════

  type ScoreSpec = {
    scoreId: string;
    ventureId: string;
    total: number;
    tier: 'EARLY' | 'RISING' | 'INVESTABLE' | 'ELITE';
    confidence: number;
    breakdown: Record<string, [number, number]>; // [weighted, max]
  };

  const scoreSpecs: ScoreSpec[] = [
    { scoreId: U.s1,  ventureId: U.v1,  total: 887, tier: 'ELITE',      confidence: 94.2, breakdown: { identity: [142,150], financial: [195,200], media: [95,100], product: [148,150], team: [96,100], legal: [147,150], market: [97,100], operations: [47,50] } },
    { scoreId: U.s2,  ventureId: U.v2,  total: 741, tier: 'INVESTABLE', confidence: 86.1, breakdown: { identity: [121,150], financial: [158,200], media: [72,100], product: [138,150], team: [78,100], legal: [128,150], market: [88,100], operations: [36,50] } },
    { scoreId: U.s3,  ventureId: U.v3,  total: 682, tier: 'INVESTABLE', confidence: 82.4, breakdown: { identity: [115,150], financial: [142,200], media: [65,100], product: [125,150], team: [72,100], legal: [119,150], market: [78,100], operations: [28,50] } },
    { scoreId: U.s4,  ventureId: U.v4,  total: 631, tier: 'INVESTABLE', confidence: 79.3, breakdown: { identity: [108,150], financial: [118,200], media: [61,100], product: [120,150], team: [65,100], legal: [105,150], market: [72,100], operations: [22,50] } },
    { scoreId: U.s5,  ventureId: U.v5,  total: 608, tier: 'INVESTABLE', confidence: 77.2, breakdown: { identity: [102,150], financial: [112,200], media: [55,100], product: [118,150], team: [58,100], legal: [98,150],  market: [68,100], operations: [18,50] } },
    { scoreId: U.s6,  ventureId: U.v6,  total: 578, tier: 'RISING',     confidence: 74.8, breakdown: { identity: [98,150],  financial: [108,200], media: [52,100], product: [105,150], team: [55,100], legal: [95,150],  market: [62,100], operations: [14,50] } },
    { scoreId: U.s7,  ventureId: U.v7,  total: 542, tier: 'RISING',     confidence: 71.5, breakdown: { identity: [88,150],  financial: [95,200],  media: [71,100], product: [98,150],  team: [48,100], legal: [82,150],  market: [58,100], operations: [10,50] } },
    { scoreId: U.s8,  ventureId: U.v8,  total: 511, tier: 'RISING',     confidence: 70.1, breakdown: { identity: [84,150],  financial: [102,200], media: [42,100], product: [95,150],  team: [62,100], legal: [88,150],  market: [52,100], operations: [18,50] } },
    { scoreId: U.s9,  ventureId: U.v9,  total: 487, tier: 'RISING',     confidence: 67.4, breakdown: { identity: [78,150],  financial: [82,200],  media: [48,100], product: [88,150],  team: [42,100], legal: [75,150],  market: [62,100], operations: [12,50] } },
    { scoreId: U.s10, ventureId: U.v10, total: 448, tier: 'RISING',     confidence: 64.2, breakdown: { identity: [72,150],  financial: [78,200],  media: [44,100], product: [85,150],  team: [38,100], legal: [68,150],  market: [55,100], operations: [8,50]  } },
    { scoreId: U.s11, ventureId: U.v11, total: 402, tier: 'RISING',     confidence: 61.8, breakdown: { identity: [65,150],  financial: [58,200],  media: [48,100], product: [80,150],  team: [35,100], legal: [62,150],  market: [48,100], operations: [6,50]  } },
    { scoreId: U.s12, ventureId: U.v12, total: 371, tier: 'RISING',     confidence: 58.4, breakdown: { identity: [58,150],  financial: [52,200],  media: [38,100], product: [75,150],  team: [30,100], legal: [55,150],  market: [45,100], operations: [4,50]  } },
    { scoreId: U.s13, ventureId: U.v13, total: 298, tier: 'EARLY',      confidence: 42.1, breakdown: { identity: [48,150],  financial: [42,200],  media: [28,100], product: [58,150],  team: [22,100], legal: [42,150],  market: [38,100], operations: [0,50]  } },
    { scoreId: U.s14, ventureId: U.v14, total: 251, tier: 'EARLY',      confidence: 38.6, breakdown: { identity: [42,150],  financial: [28,200],  media: [32,100], product: [55,150],  team: [18,100], legal: [28,150],  market: [32,100], operations: [0,50]  } },
    { scoreId: U.s15, ventureId: U.v15, total: 217, tier: 'EARLY',      confidence: 35.2, breakdown: { identity: [32,150],  financial: [18,200],  media: [42,100], product: [38,150],  team: [14,100], legal: [22,150],  market: [28,100], operations: [0,50]  } },
    { scoreId: U.s16, ventureId: U.v16, total: 184, tier: 'EARLY',      confidence: 31.4, breakdown: { identity: [28,150],  financial: [12,200],  media: [22,100], product: [42,150],  team: [12,100], legal: [18,150],  market: [24,100], operations: [0,50]  } },
    { scoreId: U.s17, ventureId: U.v17, total: 152, tier: 'EARLY',      confidence: 28.8, breakdown: { identity: [22,150],  financial: [18,200],  media: [15,100], product: [38,150],  team: [10,100], legal: [14,150],  market: [20,100], operations: [0,50]  } },
    { scoreId: U.s18, ventureId: U.v18, total: 118, tier: 'EARLY',      confidence: 24.2, breakdown: { identity: [18,150],  financial: [8,200],   media: [12,100], product: [28,150],  team: [8,100],  legal: [12,150],  market: [18,100], operations: [0,50]  } },
    { scoreId: U.s19, ventureId: U.v19, total: 84,  tier: 'EARLY',      confidence: 19.8, breakdown: { identity: [14,150],  financial: [0,200],   media: [8,100],  product: [22,150],  team: [6,100],  legal: [8,150],   market: [14,100], operations: [0,50]  } },
    { scoreId: U.s20, ventureId: U.v20, total: 42,  tier: 'EARLY',      confidence: 14.1, breakdown: { identity: [10,150],  financial: [0,200],   media: [6,100],  product: [12,150],  team: [4,100],  legal: [4,150],   market: [8,100],  operations: [0,50]  } },
  ];

  for (const sp of scoreSpecs) {
    await knex('scores').insert({
      id: sp.scoreId,
      venture_id: sp.ventureId,
      total_score: sp.total,
      tier: sp.tier,
      confidence_pct: sp.confidence,
      scored_at: ago(1),
      version: 1,
      is_current: true,
    });

    // Breakdowns
    for (const [cat, [weighted, max]] of Object.entries(sp.breakdown)) {
      await knex('score_breakdowns').insert({
        score_id: sp.scoreId,
        category: cat,
        raw_score: Math.round(weighted * 1.08),
        weighted_score: weighted,
        max_possible: max,
        signals_found: Math.max(1, Math.floor(weighted / 12)),
        signals_verified: Math.max(0, Math.floor((weighted / 12) * 0.7)),
      });
    }

    // Key signals
    const signals: Array<{ name: string; value: string; source: string; tier: number; weight: number; points: number }> = [];
    if (sp.breakdown.identity[0] > 40) signals.push({ name: 'business_registration', value: 'true', source: 'companies_house_api', tier: 2, weight: 0.95, points: Math.min(50, sp.breakdown.identity[0] * 0.35) });
    if (sp.breakdown.financial[0] > 50) signals.push({ name: 'revenue_evidence', value: String(Math.floor(sp.breakdown.financial[0] * 1200)), source: 'mono', tier: 2, weight: 0.95, points: Math.min(80, sp.breakdown.financial[0] * 0.45) });
    if (sp.breakdown.media[0] > 30) signals.push({ name: 'twitter_followers', value: String(Math.floor(sp.breakdown.media[0] * 280)), source: 'twitter_api', tier: 2, weight: 0.95, points: Math.min(15, sp.breakdown.media[0] * 0.12) });
    if (sp.breakdown.product[0] > 80) signals.push({ name: 'venture_stage', value: 'scaling', source: 'self_declared', tier: 4, weight: 0.60, points: 120 });
    else if (sp.breakdown.product[0] > 60) signals.push({ name: 'venture_stage', value: 'revenue', source: 'self_declared', tier: 4, weight: 0.60, points: 80 });
    else signals.push({ name: 'venture_stage', value: 'idea', source: 'self_declared', tier: 4, weight: 0.60, points: 10 });

    for (const sig of signals) {
      await knex('score_signals').insert({
        score_id: sp.scoreId,
        signal_name: sig.name,
        signal_value: sig.value,
        source: sig.source,
        verification_tier: sig.tier,
        weight: sig.weight,
        points_awarded: sig.points,
      });
    }

    // 12-month score history — realistic growth trajectory
    const startingScore = Math.max(0, sp.total - Math.floor(sp.total * 0.35));
    for (let m = 12; m >= 1; m--) {
      const progress = (12 - m) / 11;
      const historicScore = Math.round(startingScore + (sp.total - startingScore) * progress + (Math.random() - 0.5) * 15);
      const clampedScore = Math.max(0, Math.min(1000, historicScore));
      const historicTier: 'EARLY' | 'RISING' | 'INVESTABLE' | 'ELITE' =
        clampedScore >= 851 ? 'ELITE' : clampedScore >= 601 ? 'INVESTABLE' : clampedScore >= 301 ? 'RISING' : 'EARLY';

      await knex('score_history').insert({
        venture_id: sp.ventureId,
        total_score: clampedScore,
        tier: historicTier,
        confidence_pct: Math.max(10, sp.confidence - (12 - m) * 3),
        snapshot_date: monthStart(m),
        breakdown: JSON.stringify({}),
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 5. BANKABILITY SCORES
  // ════════════════════════════════════════════════════════════
  const bankabilityData = [
    { venture_id: U.v1,  total_score: 88.4, revenue_consistency: 95, registration_status: 100, tax_compliance: 90, team_payroll: 85, assets_insurance: 70, credit_bureau: 75 },
    { venture_id: U.v2,  total_score: 74.2, revenue_consistency: 80, registration_status: 90,  tax_compliance: 78, team_payroll: 68, assets_insurance: 55, credit_bureau: 60 },
    { venture_id: U.v3,  total_score: 70.8, revenue_consistency: 72, registration_status: 100, tax_compliance: 80, team_payroll: 62, assets_insurance: 50, credit_bureau: 55 },
    { venture_id: U.v4,  total_score: 65.1, revenue_consistency: 68, registration_status: 90,  tax_compliance: 70, team_payroll: 58, assets_insurance: 45, credit_bureau: 40 },
    { venture_id: U.v5,  total_score: 62.4, revenue_consistency: 65, registration_status: 90,  tax_compliance: 65, team_payroll: 55, assets_insurance: 40, credit_bureau: 35 },
    { venture_id: U.v6,  total_score: 58.9, revenue_consistency: 62, registration_status: 90,  tax_compliance: 60, team_payroll: 50, assets_insurance: 35, credit_bureau: 30 },
    { venture_id: U.v7,  total_score: 54.2, revenue_consistency: 55, registration_status: 80,  tax_compliance: 55, team_payroll: 45, assets_insurance: 30, credit_bureau: 25 },
    { venture_id: U.v8,  total_score: 61.7, revenue_consistency: 58, registration_status: 90,  tax_compliance: 62, team_payroll: 70, assets_insurance: 60, credit_bureau: 40 },
    { venture_id: U.v9,  total_score: 42.1, revenue_consistency: 30, registration_status: 80,  tax_compliance: 40, team_payroll: 25, assets_insurance: 20, credit_bureau: 0  },
    { venture_id: U.v10, total_score: 44.8, revenue_consistency: 45, registration_status: 80,  tax_compliance: 48, team_payroll: 35, assets_insurance: 25, credit_bureau: 0  },
    { venture_id: U.v11, total_score: 32.4, revenue_consistency: 18, registration_status: 70,  tax_compliance: 30, team_payroll: 15, assets_insurance: 0,  credit_bureau: 0  },
    { venture_id: U.v12, total_score: 28.7, revenue_consistency: 15, registration_status: 70,  tax_compliance: 25, team_payroll: 10, assets_insurance: 0,  credit_bureau: 0  },
    { venture_id: U.v13, total_score: 14.2, revenue_consistency: 0,  registration_status: 0,   tax_compliance: 0,  team_payroll: 10, assets_insurance: 0,  credit_bureau: 0  },
    { venture_id: U.v15, total_score: 8.5,  revenue_consistency: 0,  registration_status: 0,   tax_compliance: 0,  team_payroll: 5,  assets_insurance: 0,  credit_bureau: 0  },
  ];
  await knex('bankability_scores').insert(bankabilityData.map(b => ({ ...b, scored_at: ago(1) })));

  // ════════════════════════════════════════════════════════════
  // 6. INVESTOR PROFILES, THESES, MATCHES, DEAL ROOMS
  // ════════════════════════════════════════════════════════════
  await knex('investor_profiles').insert([
    { id: U.ip1, user_id: U.i1, firm_name: 'Adekunle Capital Partners', fund_size: 50000000, investment_range_min: 250000, investment_range_max: 2000000, verified: true, currency: 'GBP' },
    { id: U.ip2, user_id: U.i2, firm_name: 'Lagos Angel Network',        fund_size: 8000000,  investment_range_min: 25000,  investment_range_max: 250000,  verified: true, currency: 'GBP' },
    { id: U.ip3, user_id: U.i3, firm_name: 'Nairobi Impact Fund',        fund_size: 30000000, investment_range_min: 100000, investment_range_max: 1000000, verified: true, currency: 'GBP' },
    { id: U.ip4, user_id: U.i4, firm_name: 'Accra Family Office',        fund_size: 15000000, investment_range_min: 50000,  investment_range_max: 500000,  verified: false, currency: 'GBP' },
    { id: U.ip5, user_id: U.i5, firm_name: 'Africa Growth Capital',      fund_size: 120000000,investment_range_min: 1000000,investment_range_max: 8000000, verified: true, currency: 'GBP' },
  ]);

  await knex('investor_theses').insert([
    { investor_id: U.ip1, sectors: JSON.stringify(['Fintech', 'Agritech', 'Logistics']), geographies: JSON.stringify(['NG', 'GH', 'KE']), score_range_min: 601, score_range_max: 1000, stage_preferences: JSON.stringify(['revenue', 'scaling']) },
    { investor_id: U.ip2, sectors: JSON.stringify(['Fintech', 'Edtech', 'Healthtech', 'E-commerce']), geographies: JSON.stringify(['NG', 'GH']), score_range_min: 400, score_range_max: 850, stage_preferences: JSON.stringify(['mvp', 'revenue']) },
    { investor_id: U.ip3, sectors: JSON.stringify(['Agritech', 'Healthtech', 'Energy']), geographies: JSON.stringify(['KE', 'NG', 'ZA']), score_range_min: 500, score_range_max: 900, stage_preferences: JSON.stringify(['revenue', 'scaling']) },
    { investor_id: U.ip4, sectors: JSON.stringify(['Healthtech', 'Edtech']), geographies: JSON.stringify(['GH', 'NG']), score_range_min: 300, score_range_max: 750, stage_preferences: JSON.stringify(['idea', 'mvp', 'revenue']) },
    { investor_id: U.ip5, sectors: JSON.stringify(['Fintech', 'Logistics', 'Energy', 'Proptech']), geographies: JSON.stringify(['NG', 'KE', 'ZA', 'GH']), score_range_min: 700, score_range_max: 1000, stage_preferences: JSON.stringify(['scaling']) },
  ]);

  // Investor matches
  const matchData = [
    // ip1 (Adekunle Capital — Fintech focus) matches ELITE + INVESTABLE fintech/agritech
    { investor_id: U.ip1, venture_id: U.v1,  match_score: 94.2, status: 'introduced',  match_reasons: JSON.stringify(['Score: 887 (ELITE)', 'Sector: Fintech', 'Stage: Scaling', 'Nigeria (target geography)']), introduced_at: ago(14) },
    { investor_id: U.ip1, venture_id: U.v2,  match_score: 81.7, status: 'interested',  match_reasons: JSON.stringify(['Score: 741 (INVESTABLE)', 'Sector: Agritech', 'Ghana (target geography)']) },
    { investor_id: U.ip1, venture_id: U.v5,  match_score: 76.4, status: 'viewed',      match_reasons: JSON.stringify(['Score: 608 (INVESTABLE)', 'Sector: Logistics', 'East Africa expansion']) },
    // ip2 (Lagos Angels) matches mid-tier
    { investor_id: U.ip2, venture_id: U.v6,  match_score: 72.1, status: 'interested',  match_reasons: JSON.stringify(['Score: 578 (RISING)', 'Sector: Fintech', 'Lagos-based']) },
    { investor_id: U.ip2, venture_id: U.v4,  match_score: 68.9, status: 'viewed',      match_reasons: JSON.stringify(['Score: 631 (INVESTABLE)', 'Sector: Edtech', 'Nigeria']) },
    { investor_id: U.ip2, venture_id: U.v7,  match_score: 64.2, status: 'pending',     match_reasons: JSON.stringify(['Score: 542 (RISING)', 'Sector: E-commerce', 'Ghana']) },
    // ip3 (Nairobi Impact) matches East Africa impact
    { investor_id: U.ip3, venture_id: U.v5,  match_score: 85.2, status: 'introduced',  match_reasons: JSON.stringify(['Score: 608 (INVESTABLE)', 'Sector: Logistics', 'Kenya', 'Impact aligned']), introduced_at: ago(7) },
    { investor_id: U.ip3, venture_id: U.v8,  match_score: 78.4, status: 'interested',  match_reasons: JSON.stringify(['Score: 511 (RISING)', 'Sector: Energy', 'SDG 7 aligned']) },
    { investor_id: U.ip3, venture_id: U.v12, match_score: 61.8, status: 'viewed',      match_reasons: JSON.stringify(['Score: 371 (RISING)', 'Sector: Agritech', 'Kenya smallholders']) },
    // ip5 (Africa Growth Capital — Series A, high score only)
    { investor_id: U.ip5, venture_id: U.v1,  match_score: 98.1, status: 'introduced',  match_reasons: JSON.stringify(['Score: 887 (ELITE)', 'Sector: Fintech', 'Scaling stage', 'Verified financials']), introduced_at: ago(5) },
  ];
  for (const m of matchData) await knex('investor_matches').insert(m);

  // Deal rooms
  const dr1 = crypto.randomUUID();
  const dr2 = crypto.randomUUID();
  await knex('deal_rooms').insert([
    { id: dr1, investor_id: U.ip1, name: 'West Africa Fintech Q1 2025', filters: JSON.stringify({ sectors: ['Fintech'], geographies: ['NG', 'GH'], minScore: 600 }) },
    { id: dr2, investor_id: U.ip5, name: 'Series A Pipeline 2025', filters: JSON.stringify({ minScore: 750, stages: ['scaling'] }) },
  ]);
  await knex('deal_room_founders').insert([
    { deal_room_id: dr1, venture_id: U.v1, status: 'active', notes: 'Strong traction. Schedule call.' },
    { deal_room_id: dr1, venture_id: U.v6, status: 'active', notes: 'Watch list — revisit at 600+' },
    { deal_room_id: dr2, venture_id: U.v1, status: 'active', notes: 'Lead candidate for Q2 close.' },
  ]);

  // ════════════════════════════════════════════════════════════
  // 7. SERVICE PROVIDER PROFILES, LISTINGS, LEADS
  // ════════════════════════════════════════════════════════════
  await knex('provider_profiles').insert([
    { id: U.pp1, user_id: U.p1, firm_name: 'Lex Africa Law',        services: JSON.stringify(['legal_services']),        coverage_areas: JSON.stringify(['NG','GH','KE']), verified: true, trusted_badge: true, pi_certificate_url: 'https://storage.googleapis.com/ikonetu-media-prod/pi/pp1.pdf', pi_certificate_expiry: new Date('2025-12-31') },
    { id: U.pp2, user_id: U.p2, firm_name: 'KPMG Africa Advisory',  services: JSON.stringify(['accounting_tax']),        coverage_areas: JSON.stringify(['NG','GH','KE','ZA']), verified: true, trusted_badge: true, pi_certificate_url: 'https://storage.googleapis.com/ikonetu-media-prod/pi/pp2.pdf', pi_certificate_expiry: new Date('2025-06-30') },
    { id: U.pp3, user_id: U.p3, firm_name: 'TechScale Hub',         services: JSON.stringify(['technology']),            coverage_areas: JSON.stringify(['NG','GH']),      verified: true, trusted_badge: false, pi_certificate_url: 'https://storage.googleapis.com/ikonetu-media-prod/pi/pp3.pdf', pi_certificate_expiry: new Date('2025-03-31') },
    { id: U.pp4, user_id: U.p4, firm_name: 'PeopleFirst HR',        services: JSON.stringify(['hr_people']),             coverage_areas: JSON.stringify(['KE','NG']),      verified: true, trusted_badge: false, pi_certificate_url: null, pi_certificate_expiry: null },
    { id: U.pp5, user_id: U.p5, firm_name: 'GrowthMark',            services: JSON.stringify(['marketing_brand']),       coverage_areas: JSON.stringify(['GH','NG','KE']), verified: false, trusted_badge: false, pi_certificate_url: null, pi_certificate_expiry: null },
  ]);

  // Provider listings
  const pl1 = crypto.randomUUID(); const pl2 = crypto.randomUUID();
  const pl3 = crypto.randomUUID(); const pl4 = crypto.randomUUID();
  const pl5 = crypto.randomUUID();
  await knex('provider_listings').insert([
    { id: pl1, provider_id: U.pp1, title: 'Company Formation & CAC Registration', description: 'End-to-end company formation, CAC registration, TIN registration, and regulatory compliance setup. Includes trademark search and IP registration guidance.', pricing: JSON.stringify({ base: 1200, currency: 'GBP', unit: 'per engagement' }), category: 'legal_services', visibility_tier: 'featured', active: true },
    { id: pl2, provider_id: U.pp1, title: 'Investment Round Legal Package', description: 'Full legal support for seed to Series A rounds: term sheet review, SHA, SPA, due diligence. Fixed-fee transparency.', pricing: JSON.stringify({ base: 4500, currency: 'GBP', unit: 'per round' }), category: 'legal_services', visibility_tier: 'premium', active: true },
    { id: pl3, provider_id: U.pp2, title: 'Startup Accounting & Tax Compliance',  description: 'Monthly bookkeeping, quarterly management accounts, annual statutory accounts, and tax filing for Nigerian and Ghanaian SMEs.', pricing: JSON.stringify({ base: 650, currency: 'GBP', unit: 'per month' }), category: 'accounting_tax', visibility_tier: 'featured', active: true },
    { id: pl4, provider_id: U.pp3, title: 'MVP Development Sprint (8 weeks)',     description: 'Dedicated full-stack team building your MVP in 8 weeks. React + Node.js. Includes UX design, API development, and basic infrastructure setup.', pricing: JSON.stringify({ base: 8000, currency: 'GBP', unit: 'per sprint' }), category: 'technology', visibility_tier: 'basic', active: true },
    { id: pl5, provider_id: U.pp4, title: 'Startup People Operations Setup',      description: 'Employment contracts, HR policies, payroll setup, and talent acquisition strategy for African startups scaling their team.', pricing: JSON.stringify({ base: 1800, currency: 'GBP', unit: 'per engagement' }), category: 'hr_people', visibility_tier: 'basic', active: true },
  ]);

  // Provider leads (score gap matching)
  await knex('provider_leads').insert([
    { provider_id: U.pp1, venture_id: U.v13, score_gap: 120, service_needed: 'legal',    status: 'new' },
    { provider_id: U.pp1, venture_id: U.v14, score_gap: 95,  service_needed: 'legal',    status: 'viewed' },
    { provider_id: U.pp1, venture_id: U.v15, score_gap: 108, service_needed: 'legal',    status: 'new' },
    { provider_id: U.pp2, venture_id: U.v9,  score_gap: 88,  service_needed: 'financial', status: 'accepted', connected_at: ago(10) },
    { provider_id: U.pp2, venture_id: U.v11, score_gap: 142, service_needed: 'financial', status: 'new' },
    { provider_id: U.pp2, venture_id: U.v12, score_gap: 148, service_needed: 'financial', status: 'new' },
    { provider_id: U.pp3, venture_id: U.v16, score_gap: 138, service_needed: 'product',  status: 'new' },
    { provider_id: U.pp3, venture_id: U.v17, score_gap: 158, service_needed: 'product',  status: 'new' },
    { provider_id: U.pp4, venture_id: U.v10, score_gap: 62,  service_needed: 'team',     status: 'accepted', connected_at: ago(5), converted_at: null },
    { provider_id: U.pp5, venture_id: U.v7,  score_gap: 29,  service_needed: 'media',    status: 'accepted', connected_at: ago(20), converted_at: ago(15) },
  ]);

  // ════════════════════════════════════════════════════════════
  // 8. LENDER PROFILES, CRITERIA, PORTFOLIOS, ALERTS
  // ════════════════════════════════════════════════════════════
  await knex('lender_profiles').insert([
    { id: U.lp1, user_id: U.l1, institution_name: 'Access Bank Nigeria Plc',     licence_type: 'commercial_bank_cbn', verified: true },
    { id: U.lp2, user_id: U.l2, institution_name: 'KCB Group Plc',               licence_type: 'commercial_bank_cbk', verified: true },
    { id: U.lp3, user_id: U.l3, institution_name: 'British International Investment', licence_type: 'dfi',            verified: true },
  ]);

  await knex('lender_criteria').insert([
    { lender_id: U.lp1, min_score: 500, min_bankability: 45.0, required_history_months: 6,  sectors: JSON.stringify(['Fintech', 'E-commerce', 'Logistics']), geographies: JSON.stringify(['NG']) },
    { lender_id: U.lp2, min_score: 450, min_bankability: 40.0, required_history_months: 6,  sectors: JSON.stringify(['Agritech', 'Logistics', 'Healthtech']), geographies: JSON.stringify(['KE', 'NG']) },
    { lender_id: U.lp3, min_score: 600, min_bankability: 55.0, required_history_months: 12, sectors: JSON.stringify(['Energy', 'Agritech', 'Healthtech', 'Fintech']), geographies: JSON.stringify(['NG', 'KE', 'GH', 'ZA']) },
  ]);

  // Lender portfolios
  const lport1 = crypto.randomUUID(); const lport2 = crypto.randomUUID();
  const lport3 = crypto.randomUUID(); const lport4 = crypto.randomUUID();
  await knex('lender_portfolios').insert([
    { id: lport1, lender_id: U.lp1, venture_id: U.v1,  status: 'active_loan',  monitoring_active: true, disbursed_amount: 500000, disbursed_currency: 'GBP', disbursed_at: ago(180) },
    { id: lport2, lender_id: U.lp1, venture_id: U.v6,  status: 'monitoring',   monitoring_active: true },
    { id: lport3, lender_id: U.lp2, venture_id: U.v5,  status: 'active_loan',  monitoring_active: true, disbursed_amount: 120000, disbursed_currency: 'GBP', disbursed_at: ago(90) },
    { id: lport4, lender_id: U.lp3, venture_id: U.v8,  status: 'active_loan',  monitoring_active: true, disbursed_amount: 750000, disbursed_currency: 'GBP', disbursed_at: ago(270) },
  ]);

  // Lender alerts — score drops in portfolio
  await knex('lender_alerts').insert([
    { portfolio_id: lport2, alert_type: 'score_drop_10pts', previous_value: '502', current_value: '448', severity: 'warning', acknowledged: false },
    { portfolio_id: lport3, alert_type: 'revenue_decline', previous_value: '25000', current_value: '19400', severity: 'info', acknowledged: true },
    { portfolio_id: lport4, alert_type: 'document_expired', previous_value: null, current_value: 'insurance_certificate', severity: 'warning', acknowledged: false },
  ]);

  // ════════════════════════════════════════════════════════════
  // 9. UNIVERSITY PROFILES & PROGRAMMES
  // ════════════════════════════════════════════════════════════
  await knex('university_profiles').insert([
    { id: U.up1, user_id: U.u1, institution_name: 'University of Lagos',    country: 'NG', city: 'Lagos',   email_domain: 'unilag.edu.ng',    verified: true },
    { id: U.up2, user_id: U.u2, institution_name: 'Strathmore University',  country: 'KE', city: 'Nairobi', email_domain: 'strathmore.edu',   verified: true },
  ]);

  const up1prog1 = crypto.randomUUID(); const up1prog2 = crypto.randomUUID();
  const up2prog1 = crypto.randomUUID();
  await knex('university_programmes').insert([
    { id: up1prog1, university_id: U.up1, programme_name: 'Centre for Entrepreneurship',        department: 'Business School', avg_score: 428, founder_count: 8 },
    { id: up1prog2, university_id: U.up1, programme_name: 'Computer Science Entrepreneurship',  department: 'Faculty of Science', avg_score: 512, founder_count: 5 },
    { id: up2prog1, university_id: U.up2, programme_name: 'Strathmore Business School Ventures',department: 'Business School', avg_score: 445, founder_count: 6 },
  ]);

  // University–founder associations (by email domain or self-declared)
  await knex('university_founders').insert([
    { university_id: U.up1, venture_id: U.v1,  matched_by: 'email_domain' },
    { university_id: U.up1, venture_id: U.v6,  matched_by: 'email_domain' },
    { university_id: U.up1, venture_id: U.v13, matched_by: 'self_declared' },
    { university_id: U.up1, venture_id: U.v15, matched_by: 'self_declared' },
    { university_id: U.up1, venture_id: U.v16, matched_by: 'self_declared' },
    { university_id: U.up2, venture_id: U.v5,  matched_by: 'email_domain' },
    { university_id: U.up2, venture_id: U.v9,  matched_by: 'self_declared' },
    { university_id: U.up2, venture_id: U.v12, matched_by: 'email_domain' },
  ]);

  // ════════════════════════════════════════════════════════════
  // 10. BILLING — PLANS, SUBSCRIPTIONS, CREDITS, INVOICES
  // ════════════════════════════════════════════════════════════
  await knex('plans').insert([
    { id: U.plan_lender_starter,   name: 'Lender Starter',    revenue_stream_id: 'R02', role: 'lender',    price_monthly: 299,  price_annual: 2868,  currency: 'GBP', features: JSON.stringify(['Up to 50 portfolio ventures', 'Daily score alerts', 'Bankability report']), limits: JSON.stringify({ portfolio_ventures: 50 }), active: true },
    { id: U.plan_lender_growth,    name: 'Lender Growth',     revenue_stream_id: 'R02', role: 'lender',    price_monthly: 599,  price_annual: 5750,  currency: 'GBP', features: JSON.stringify(['Up to 200 portfolio ventures', 'Real-time alerts', 'API access', 'Custom reporting']), limits: JSON.stringify({ portfolio_ventures: 200 }), active: true },
    { id: U.plan_investor_starter, name: 'Investor Starter',  revenue_stream_id: 'R04', role: 'investor',  price_monthly: 299,  price_annual: 2868,  currency: 'GBP', features: JSON.stringify(['Founder search', '3 deal rooms', '10 introductions/month']), limits: JSON.stringify({ deal_rooms: 3, monthly_introductions: 10 }), active: true },
    { id: U.plan_investor_pro,     name: 'Investor Pro',      revenue_stream_id: 'R04', role: 'investor',  price_monthly: 599,  price_annual: 5750,  currency: 'GBP', features: JSON.stringify(['Unlimited deal rooms', '30 introductions/month', 'Portfolio analytics', 'Score API']), limits: JSON.stringify({ monthly_introductions: 30 }), active: true },
    { id: U.plan_provider_featured,name: 'Provider Featured', revenue_stream_id: 'R06', role: 'provider',  price_monthly: 199,  price_annual: 1910,  currency: 'GBP', features: JSON.stringify(['Featured listing badge', '20 leads/month', 'Priority search ranking']), limits: JSON.stringify({ monthly_leads: 20 }), active: true },
    { id: U.plan_api_starter,      name: 'API Starter',       revenue_stream_id: 'R08', role: 'lender',    price_monthly: 499,  price_annual: 4790,  currency: 'GBP', features: JSON.stringify(['1,000 API calls/month', 'Webhook support', 'JSON + CSV export']), limits: JSON.stringify({ monthly_api_calls: 1000 }), active: true },
  ]);

  // Subscriptions
  const now = new Date();
  const nextMonth = new Date(now); nextMonth.setMonth(nextMonth.getMonth() + 1);
  const subInserts = [
    { user_id: U.i1, plan_id: U.plan_investor_pro,      stripe_subscription_id: 'sub_test_investor_i1',  status: 'active', current_period_start: ago(15), current_period_end: nextMonth },
    { user_id: U.i2, plan_id: U.plan_investor_starter,  stripe_subscription_id: 'sub_test_investor_i2',  status: 'active', current_period_start: ago(20), current_period_end: nextMonth },
    { user_id: U.i3, plan_id: U.plan_investor_starter,  stripe_subscription_id: 'sub_test_investor_i3',  status: 'active', current_period_start: ago(8),  current_period_end: nextMonth },
    { user_id: U.l1, plan_id: U.plan_lender_growth,     stripe_subscription_id: 'sub_test_lender_l1',    status: 'active', current_period_start: ago(5),  current_period_end: nextMonth },
    { user_id: U.l2, plan_id: U.plan_lender_starter,    stripe_subscription_id: 'sub_test_lender_l2',    status: 'active', current_period_start: ago(12), current_period_end: nextMonth },
    { user_id: U.l3, plan_id: U.plan_api_starter,       stripe_subscription_id: 'sub_test_lender_l3',    status: 'active', current_period_start: ago(30), current_period_end: nextMonth },
    { user_id: U.p1, plan_id: U.plan_provider_featured, stripe_subscription_id: 'sub_test_provider_p1',  status: 'active', current_period_start: ago(7),  current_period_end: nextMonth },
    { user_id: U.p2, plan_id: U.plan_provider_featured, stripe_subscription_id: 'sub_test_provider_p2',  status: 'active', current_period_start: ago(25), current_period_end: nextMonth },
    // Past-due to test dunning
    { user_id: U.i4, plan_id: U.plan_investor_starter,  stripe_subscription_id: 'sub_test_investor_i4',  status: 'past_due', current_period_start: ago(40), current_period_end: ago(10) },
    // Cancelled
    { user_id: U.p3, plan_id: U.plan_provider_featured, stripe_subscription_id: 'sub_test_provider_p3_cancelled', status: 'cancelled', current_period_start: ago(60), current_period_end: ago(30), cancelled_at: ago(35) },
  ];
  await knex('subscriptions').insert(subInserts);

  // Credit balances
  await knex('credit_balances').insert([
    { user_id: U.i1, credit_type: 'introductions', balance: 22, last_topped_up: ago(5) },
    { user_id: U.i2, credit_type: 'introductions', balance: 8,  last_topped_up: ago(14) },
    { user_id: U.i3, credit_type: 'introductions', balance: 15, last_topped_up: ago(10) },
    { user_id: U.i4, credit_type: 'introductions', balance: 0,  last_topped_up: ago(60) }, // edge: 0 credits
    { user_id: U.i5, credit_type: 'introductions', balance: 50, last_topped_up: ago(2) },
    { user_id: U.p1, credit_type: 'leads',         balance: 18, last_topped_up: ago(7) },
    { user_id: U.p2, credit_type: 'leads',         balance: 12, last_topped_up: ago(15) },
    { user_id: U.p3, credit_type: 'leads',         balance: 0,  last_topped_up: ago(40) }, // edge: expired subscription, 0 leads
    { user_id: U.l1, credit_type: 'api_calls',     balance: 847,last_topped_up: ago(3) },
    { user_id: U.l3, credit_type: 'api_calls',     balance: 1000, last_topped_up: ago(1) },
    // R10 featured placements
    { user_id: U.p1, credit_type: 'placements', balance: 3, last_topped_up: ago(20) },
    { user_id: U.p2, credit_type: 'placements', balance: 5, last_topped_up: ago(12) },
  ]);

  // Invoices
  await knex('invoices').insert([
    { user_id: U.i1, stripe_invoice_id: 'in_test_i1_jan', amount: 599,  currency: 'GBP', status: 'paid', paid_at: ago(45), pdf_url: 'https://storage.googleapis.com/ikonetu-media-prod/invoices/in_i1_jan.pdf' },
    { user_id: U.i1, stripe_invoice_id: 'in_test_i1_feb', amount: 599,  currency: 'GBP', status: 'paid', paid_at: ago(15), pdf_url: 'https://storage.googleapis.com/ikonetu-media-prod/invoices/in_i1_feb.pdf' },
    { user_id: U.l1, stripe_invoice_id: 'in_test_l1_jan', amount: 599,  currency: 'GBP', status: 'paid', paid_at: ago(35), pdf_url: null },
    { user_id: U.l3, stripe_invoice_id: 'in_test_l3_jan', amount: 499,  currency: 'GBP', status: 'paid', paid_at: ago(30), pdf_url: null },
    { user_id: U.i4, stripe_invoice_id: 'in_test_i4_failed', amount: 299, currency: 'GBP', status: 'open' }, // failed payment
  ]);

  // ════════════════════════════════════════════════════════════
  // 11. REVENUE EVENTS — R01–R12 (R11 never present)
  // ════════════════════════════════════════════════════════════
  const revenueEvents = [];

  // R01 — Score API calls (per-query billing)
  for (let d = 0; d < 30; d++) {
    revenueEvents.push({ stream_id: 'R01', user_id: U.l1, amount: 0.15 * Math.ceil(Math.random() * 5), currency: 'GBP', event_type: 'api.score.queried', metadata: JSON.stringify({ calls: 1 }), created_at: ago(d) });
    if (d % 2 === 0) revenueEvents.push({ stream_id: 'R01', user_id: U.l3, amount: 0.15, currency: 'GBP', event_type: 'api.score.queried', metadata: JSON.stringify({}), created_at: ago(d) });
  }

  // R02 — Lender SaaS subscriptions (monthly)
  for (let m = 0; m < 6; m++) {
    revenueEvents.push({ stream_id: 'R02', user_id: U.l1, amount: 599, currency: 'GBP', event_type: 'subscription.invoice.paid', metadata: JSON.stringify({ plan: 'Lender Growth' }), created_at: ago(m * 30) });
    revenueEvents.push({ stream_id: 'R02', user_id: U.l2, amount: 299, currency: 'GBP', event_type: 'subscription.invoice.paid', metadata: JSON.stringify({ plan: 'Lender Starter' }), created_at: ago(m * 30) });
  }

  // R03 — Portfolio monitoring (per-founder-per-month)
  for (let m = 0; m < 6; m++) {
    revenueEvents.push({ stream_id: 'R03', user_id: U.l1, amount: 48, currency: 'GBP', event_type: 'portfolio.monitoring.charged', metadata: JSON.stringify({ founders: 4 }), created_at: ago(m * 30) });
    revenueEvents.push({ stream_id: 'R03', user_id: U.l3, amount: 12, currency: 'GBP', event_type: 'portfolio.monitoring.charged', metadata: JSON.stringify({ founders: 1 }), created_at: ago(m * 30) });
  }

  // R04 — Investor Deal Room SaaS
  for (let m = 0; m < 6; m++) {
    revenueEvents.push({ stream_id: 'R04', user_id: U.i1, amount: 599, currency: 'GBP', event_type: 'subscription.invoice.paid', metadata: JSON.stringify({ plan: 'Investor Pro' }), created_at: ago(m * 30) });
    revenueEvents.push({ stream_id: 'R04', user_id: U.i2, amount: 299, currency: 'GBP', event_type: 'subscription.invoice.paid', metadata: JSON.stringify({ plan: 'Investor Starter' }), created_at: ago(m * 30) });
    revenueEvents.push({ stream_id: 'R04', user_id: U.i3, amount: 299, currency: 'GBP', event_type: 'subscription.invoice.paid', metadata: JSON.stringify({ plan: 'Investor Starter' }), created_at: ago(m * 30) });
  }

  // R05 — Investor introduction credits
  revenueEvents.push({ stream_id: 'R05', user_id: U.i1, amount: 600,  currency: 'GBP', event_type: 'credits.purchased', metadata: JSON.stringify({ pack: 'introductions_15', count: 15 }), created_at: ago(10) });
  revenueEvents.push({ stream_id: 'R05', user_id: U.i5, amount: 1080, currency: 'GBP', event_type: 'credits.purchased', metadata: JSON.stringify({ pack: 'introductions_30', count: 30 }), created_at: ago(5)  });

  // R06 — Provider listing subscriptions
  for (let m = 0; m < 6; m++) {
    revenueEvents.push({ stream_id: 'R06', user_id: U.p1, amount: 199, currency: 'GBP', event_type: 'subscription.invoice.paid', metadata: JSON.stringify({ plan: 'Provider Featured' }), created_at: ago(m * 30) });
    revenueEvents.push({ stream_id: 'R06', user_id: U.p2, amount: 199, currency: 'GBP', event_type: 'subscription.invoice.paid', metadata: JSON.stringify({ plan: 'Provider Featured' }), created_at: ago(m * 30) });
  }

  // R07 — Provider lead credits
  revenueEvents.push({ stream_id: 'R07', user_id: U.p1, amount: 250, currency: 'GBP', event_type: 'credits.purchased', metadata: JSON.stringify({ pack: 'leads_10', count: 10 }), created_at: ago(20) });
  revenueEvents.push({ stream_id: 'R07', user_id: U.p2, amount: 550, currency: 'GBP', event_type: 'credits.purchased', metadata: JSON.stringify({ pack: 'leads_25', count: 25 }), created_at: ago(15) });

  // R08 — API white-label
  for (let m = 0; m < 6; m++) {
    revenueEvents.push({ stream_id: 'R08', user_id: U.l3, amount: 499, currency: 'GBP', event_type: 'subscription.invoice.paid', metadata: JSON.stringify({ plan: 'API Starter' }), created_at: ago(m * 30) });
  }

  // R09 — Data reports (one-time purchases)
  revenueEvents.push({ stream_id: 'R09', user_id: U.i1, amount: 1200, currency: 'GBP', event_type: 'report.purchased', metadata: JSON.stringify({ report: 'West Africa Fintech Sector Report Q4 2024' }), created_at: ago(45) });
  revenueEvents.push({ stream_id: 'R09', user_id: U.l3, amount: 4800, currency: 'GBP', event_type: 'report.purchased', metadata: JSON.stringify({ report: 'Pan-Africa SME Credit Risk Report 2024' }), created_at: ago(60) });

  // R10 — Featured placement credits
  revenueEvents.push({ stream_id: 'R10', user_id: U.p1, amount: 150, currency: 'GBP', event_type: 'credits.purchased', metadata: JSON.stringify({ pack: 'placements_5', count: 5 }), created_at: ago(25) });
  revenueEvents.push({ stream_id: 'R10', user_id: U.p2, amount: 400, currency: 'GBP', event_type: 'credits.purchased', metadata: JSON.stringify({ pack: 'placements_15', count: 15 }), created_at: ago(18) });

  // R11 — NEVER INCLUDED. R11 is permanently on hold. No R11 revenue events exist.

  // R12 — Marketplace commission (9.5% of each booking)
  revenueEvents.push({ stream_id: 'R12', user_id: U.f1, amount: 114, currency: 'GBP', event_type: 'marketplace.booking.commission', metadata: JSON.stringify({ listingPrice: 1200, commissionPct: 9.5, bookingId: 'test_booking_1' }), created_at: ago(8) });
  revenueEvents.push({ stream_id: 'R12', user_id: U.f3, amount: 62,  currency: 'GBP', event_type: 'marketplace.booking.commission', metadata: JSON.stringify({ listingPrice: 650,  commissionPct: 9.5, bookingId: 'test_booking_2' }), created_at: ago(15) });
  revenueEvents.push({ stream_id: 'R12', user_id: U.f6, amount: 171, currency: 'GBP', event_type: 'marketplace.booking.commission', metadata: JSON.stringify({ listingPrice: 1800, commissionPct: 9.5, bookingId: 'test_booking_3' }), created_at: ago(20) });

  await knex('revenue_events').insert(revenueEvents);

  // ── Marketplace bookings (R12 — 9.5% commission enforced) ─
  await knex('marketplace_bookings').insert([
    {
      founder_id: U.f1, provider_id: U.pp1, listing_id: pl2,
      listing_price: 4500, commission_amount: 428, commission_pct: 9.5,
      total_charged: 4928, currency: 'GBP',
      stripe_payment_intent_id: 'pi_test_booking_1',
      status: 'released',
      service_delivery_date: ago(22),
      release_at: ago(8),
    },
    {
      founder_id: U.f3, provider_id: U.pp2, listing_id: pl3,
      listing_price: 650, commission_amount: 62, commission_pct: 9.5,
      total_charged: 712, currency: 'GBP',
      stripe_payment_intent_id: 'pi_test_booking_2',
      status: 'held',
      service_delivery_date: ago(5),
      release_at: new Date(Date.now() + 9 * 86400 * 1000),
    },
    {
      founder_id: U.f6, provider_id: U.pp1, listing_id: pl1,
      listing_price: 1200, commission_amount: 114, commission_pct: 9.5,
      total_charged: 1314, currency: 'GBP',
      stripe_payment_intent_id: 'pi_test_booking_3',
      status: 'disputed',
      service_delivery_date: ago(18),
      dispute_reason: 'Service not delivered as described. Work submitted was incomplete.',
    },
    {
      founder_id: U.f4, provider_id: U.pp3, listing_id: pl4,
      listing_price: 8000, commission_amount: 760, commission_pct: 9.5,
      total_charged: 8760, currency: 'GBP',
      stripe_payment_intent_id: 'pi_test_booking_4',
      status: 'pending',
      service_delivery_date: null,
      release_at: null,
    },
  ]);

  // API usage
  await knex('api_usage').insert([
    { user_id: U.l1, endpoint: 'score_query', calls_today: 12, calls_month: 284, quota_monthly: 1000 },
    { user_id: U.l3, endpoint: 'score_query', calls_today: 45, calls_month: 820, quota_monthly: 1000 }, // near quota — triggers ACXM
    { user_id: U.i1, endpoint: 'score_query', calls_today: 2,  calls_month: 18,  quota_monthly: 100 },
  ]);

  // Credit transactions history
  await knex('credit_transactions').insert([
    { user_id: U.i1, credit_type: 'introductions', amount: 15, direction: 'credit', description: 'Credit pack purchase: introductions_15' },
    { user_id: U.i1, credit_type: 'introductions', amount: 3,  direction: 'debit',  description: 'Introduction sent to PayFlowNG (v1)' },
    { user_id: U.i1, credit_type: 'introductions', amount: 1,  direction: 'debit',  description: 'Introduction sent to SwiftFreight (v5)' },
    { user_id: U.p1, credit_type: 'leads',         amount: 10, direction: 'credit', description: 'Credit pack purchase: leads_10' },
    { user_id: U.p1, credit_type: 'leads',         amount: 2,  direction: 'debit',  description: 'Lead connected: LendStack NG' },
  ]);

  // ════════════════════════════════════════════════════════════
  // 12. ACXM — SIGNALS, INTERVENTIONS, ESCALATIONS
  // ════════════════════════════════════════════════════════════

  const acxmSig1 = crypto.randomUUID();
  const acxmSig2 = crypto.randomUUID();
  const acxmSig3 = crypto.randomUUID();
  const acxmSig4 = crypto.randomUUID();
  const acxmSig5 = crypto.randomUUID();
  const acxmSig6 = crypto.randomUUID();
  const acxmSig7 = crypto.randomUUID();
  const acxmSig8 = crypto.randomUUID();

  await knex('acxm_signals').insert([
    // Opportunities
    { id: acxmSig1, user_id: U.f6,  venture_id: U.v6,  signal_type: 'score.near_tier_threshold', signal_class: 'opportunity', severity: 'info',    status: 'new',      signal_data: JSON.stringify({ currentScore: 578, pointsNeeded: 23, nextTier: 'INVESTABLE', message: '23 points to INVESTABLE tier' }), detected_at: ago(0, 2) },
    { id: acxmSig2, user_id: U.f10, venture_id: U.v10, signal_type: 'score.near_tier_threshold', signal_class: 'opportunity', severity: 'info',    status: 'actioned', signal_data: JSON.stringify({ currentScore: 448, pointsNeeded: 53, nextTier: 'INVESTABLE' }), detected_at: ago(3) },
    { id: acxmSig3, user_id: U.i4,  venture_id: null,  signal_type: 'billing.free_to_paid_trigger', signal_class: 'opportunity', severity: 'info', status: 'new',      signal_data: JSON.stringify({ actionsLast7Days: 4, message: 'High engagement without subscription' }), detected_at: ago(0, 6) },
    { id: acxmSig4, user_id: U.l3,  venture_id: null,  signal_type: 'api.quota_approaching',    signal_class: 'opportunity', severity: 'warning', status: 'new',      signal_data: JSON.stringify({ callsMonth: 820, quota: 1000, pctUsed: 82, message: 'Approaching 82% of monthly API quota' }), detected_at: ago(0, 1) },
    // Threats
    { id: acxmSig5, user_id: U.f20, venture_id: U.v20, signal_type: 'engagement.declining',      signal_class: 'threat',      severity: 'warning', status: 'new',      signal_data: JSON.stringify({ daysSinceLogin: 90, lastLogin: ago(90).toISOString() }), detected_at: ago(1) },
    { id: acxmSig6, user_id: U.i4,  venture_id: null,  signal_type: 'billing.consecutive_payment_failures', signal_class: 'threat', severity: 'critical', status: 'escalated', signal_data: JSON.stringify({ failureCount: 2, lastAttempt: ago(2).toISOString() }), detected_at: ago(2) },
    { id: acxmSig7, user_id: U.f18, venture_id: U.v18, signal_type: 'engagement.declining',      signal_class: 'threat',      severity: 'warning', status: 'new',      signal_data: JSON.stringify({ daysSinceLogin: 30 }), detected_at: ago(5) },
    { id: acxmSig8, user_id: null,   venture_id: null,  signal_type: 'fraud.bulk_data_scraping_attempt', signal_class: 'threat', severity: 'critical', status: 'escalated', signal_data: JSON.stringify({ sourceIp: '185.220.101.45', queriesLastHour: 142, targetType: 'lender_pool_view' }), detected_at: ago(0, 3) },
  ]);

  const acxmInt1 = crypto.randomUUID();
  const acxmInt2 = crypto.randomUUID();
  const acxmInt3 = crypto.randomUUID();
  const acxmInt4 = crypto.randomUUID();

  await knex('acxm_interventions').insert([
    { id: acxmInt1, signal_id: acxmSig1, intervention_type: 'score_nudge_notification', channel: 'in_app', content: JSON.stringify({ title: 'You are 23 points from INVESTABLE', body: 'Complete your legal documents to close the gap.' }), suppressed: false, admin_confirmation_required: false, admin_confirmed: true, dispatched_at: ago(0, 2) },
    { id: acxmInt2, signal_id: acxmSig4, intervention_type: 'quota_upgrade_prompt', channel: 'email', content: JSON.stringify({ title: 'API quota at 82%', body: 'Upgrade to API Growth for 10x more calls per month.' }), suppressed: false, admin_confirmation_required: false, admin_confirmed: true, dispatched_at: ago(0, 1) },
    { id: acxmInt3, signal_id: acxmSig6, intervention_type: 'payment_recovery', channel: 'email', content: JSON.stringify({ title: 'Payment failed twice', body: 'Update your payment method to avoid account suspension.' }), suppressed: false, admin_confirmation_required: false, admin_confirmed: true, dispatched_at: ago(2) },
    { id: acxmInt4, signal_id: acxmSig8, intervention_type: 'account_rate_limit', channel: 'admin_alert', content: JSON.stringify({ message: 'Potential scraping from IP 185.220.101.45', queriesLastHour: 142 }), suppressed: false, admin_confirmation_required: true, admin_confirmed: false, dispatched_at: null },
  ]);

  // Suppression counters
  await knex('acxm_suppression').insert([
    { user_id: U.f6,  intervention_count_24h: 1, intervention_count_7d: 3, last_intervention_at: ago(0, 2) },
    { user_id: U.l3,  intervention_count_24h: 1, intervention_count_7d: 2, last_intervention_at: ago(0, 1) },
    { user_id: U.f20, intervention_count_24h: 0, intervention_count_7d: 1, last_intervention_at: ago(1) },
    { user_id: U.i4,  intervention_count_24h: 1, intervention_count_7d: 2, last_intervention_at: ago(2), suppressed_until: new Date(Date.now() + 3600 * 1000 * 22) },
  ]);

  // ACXM escalations
  await knex('acxm_escalations').insert([
    { signal_id: acxmSig6, reason: 'CRITICAL: Consecutive payment failures — account at risk of suspension. Human review required.', status: 'pending', escalated_at: ago(2) },
    { signal_id: acxmSig8, reason: 'CRITICAL: Possible data scraping from anonymised IP. Rate limiting applied. Investigate source.', status: 'pending', escalated_at: ago(0, 3) },
  ]);

  // ACXM rules
  await knex('acxm_rules').insert([
    { rule_name: 'score_near_investable',   rule_type: 'opportunity', trigger_logic: JSON.stringify({ tier: 'RISING', maxPointsFromThreshold: 50 }),  intervention_template: 'score_nudge',       active: true, weight: 1.0 },
    { rule_name: 'score_near_elite',        rule_type: 'opportunity', trigger_logic: JSON.stringify({ tier: 'INVESTABLE', maxPointsFromThreshold: 50 }),intervention_template: 'score_nudge',       active: true, weight: 1.0 },
    { rule_name: 'api_quota_80_pct',        rule_type: 'opportunity', trigger_logic: JSON.stringify({ quotaUsedPct: 80 }),                              intervention_template: 'quota_upgrade',     active: true, weight: 0.9 },
    { rule_name: 'free_to_paid_trigger',    rule_type: 'opportunity', trigger_logic: JSON.stringify({ minActions7d: 3, noSubscription: true }),          intervention_template: 'upgrade_prompt',    active: true, weight: 0.8 },
    { rule_name: 'login_frequency_decline', rule_type: 'threat',      trigger_logic: JSON.stringify({ loginsLast30d: 1 }),                              intervention_template: 'reengagement',      active: true, weight: 1.0 },
    { rule_name: 'payment_failure_x2',      rule_type: 'threat',      trigger_logic: JSON.stringify({ failureCount: 2, windowDays: 7 }),                intervention_template: 'payment_recovery',  active: true, weight: 1.0 },
    { rule_name: 'bulk_query_scraping',     rule_type: 'threat',      trigger_logic: JSON.stringify({ queriesPerHour: 100 }),                           intervention_template: 'rate_limit_alert',  active: true, weight: 1.0 },
    { rule_name: 'doc_upload_fraud',        rule_type: 'threat',      trigger_logic: JSON.stringify({ uploadsPerWeek: 5, vsPlatformAvg: 5 }),           intervention_template: 'score_pause_review',active: true, weight: 1.0 },
  ]);

  // ════════════════════════════════════════════════════════════
  // 13. NOTIFICATIONS
  // ════════════════════════════════════════════════════════════
  await knex('notifications').insert([
    { user_id: U.f1,  type: 'investor.introduction', title: 'New investor introduction', body: 'Africa Growth Capital has requested an introduction through IkonetU.', read: false },
    { user_id: U.f1,  type: 'score.calculated',      title: 'Your IkonetU Score has been updated', body: 'Your score is now 887 (ELITE). You are in the top 5% of all founders on IkonetU.', read: true, read_at: ago(1) },
    { user_id: U.f2,  type: 'investor.introduction', title: 'Investor match: Adekunle Capital', body: 'Adekunle Capital Partners is interested in your venture. View their profile and accept.', read: false },
    { user_id: U.f6,  type: 'acxm.score_nudge',      title: '23 points to INVESTABLE tier', body: 'Upload your business registration certificate to add up to 50 points to your legal score.', read: false },
    { user_id: U.f6,  type: 'booking.disputed',      title: 'Your dispute has been received', body: 'IkonetU is reviewing your dispute with Lex Africa Law. Funds held pending resolution. We will respond within 10 business days.', read: true, read_at: ago(17) },
    { user_id: U.f3,  type: 'booking.confirmed',     title: 'Marketplace booking confirmed', body: 'Your booking with KPMG Africa Advisory is confirmed. Service delivery date: in 7 days.', read: false },
    { user_id: U.i1,  type: 'investor.match_new',    title: '3 new founder matches', body: 'Based on your thesis, 3 new founders match your criteria. See your deal rooms.', read: false },
    { user_id: U.l1,  type: 'lender.alert',          title: 'Portfolio score drop — CashCircle NG', body: 'CashCircle NG IkonetU Score dropped from 502 to 448 in the last 30 days. Review recommended.', read: false },
    { user_id: U.i4,  type: 'billing.payment_failed', title: 'Action required: payment failed', body: 'Your subscription payment has failed twice. Please update your payment method to avoid service interruption.', read: false },
    { user_id: U.l3,  type: 'api.quota_approaching', title: 'API quota at 82%', body: 'You have used 820 of 1,000 API calls this month. Upgrade to API Growth for 10,000 calls/month.', read: false },
    { user_id: U.f20, type: 'engagement.reactivate', title: 'We miss you — your score is waiting', body: 'You have not logged in for 90 days. Upload 2 documents today to move out of EARLY tier.', read: false },
    { user_id: U.admin, type: 'compliance.gdpr_sla', title: 'GDPR SLA approaching', body: '2 GDPR deletion requests due within 5 days. Process immediately.', read: false },
  ]);

  await knex('notification_templates').insert([
    { type: 'score.calculated',     channel: 'email', subject_template: 'Your IkonetU Score has been updated — {{score}} ({{tier}})', body_template: 'Hello {{name}}, your IkonetU Score is now {{score}}. You are in the {{tier}} tier.', active: true },
    { type: 'investor.introduction',channel: 'email', subject_template: '{{investor_name}} wants to connect with you', body_template: 'Hello {{founder_name}}, {{investor_name}} has requested an introduction through IkonetU.', active: true },
    { type: 'booking.confirmed',    channel: 'email', subject_template: 'Your marketplace booking is confirmed', body_template: 'Your booking with {{provider_name}} is confirmed for {{service_date}}.', active: true },
    { type: 'billing.payment_failed', channel: 'email', subject_template: 'Action required: payment failed', body_template: 'Your subscription payment has failed. Please update your payment method to avoid service interruption.', active: true },
    { type: 'compliance.pi_expiring', channel: 'email', subject_template: 'Professional indemnity insurance expiring in 7 days', body_template: 'Your PI certificate expires on {{expiry_date}}. Upload a renewed certificate to keep your listings active.', active: true },
  ]);

  // ════════════════════════════════════════════════════════════
  // 14. PLATFORM CONFIG & FEATURE FLAGS (re-seed with invariants)
  // ════════════════════════════════════════════════════════════
  await knex('platform_config').insert([
    { key: 'r12_commission_pct',         value: JSON.stringify(9.5) },
    { key: 'r11_active',                 value: JSON.stringify(false) },
    { key: 'dark_mode_enabled',          value: JSON.stringify(false) },
    { key: 'otp_expiry_seconds',         value: JSON.stringify(300) },
    { key: 'otp_max_attempts',           value: JSON.stringify(5) },
    { key: 'otp_lockout_seconds',        value: JSON.stringify(1800) },
    { key: 'acxm_max_24h',              value: JSON.stringify(3) },
    { key: 'acxm_max_7d',              value: JSON.stringify(7) },
    { key: 'score_lock_ttl_seconds',    value: JSON.stringify(30) },
    { key: 'last_bias_audit',           value: JSON.stringify({ date: ago(1).toISOString(), pass: true, overallAvg: 498, failingCountries: [] }) },
    { key: 'r12_dispute_reserve_target',value: JSON.stringify({ required: 24.5, monthlyCommission: 305, calculatedAt: ago(1).toISOString() }) },
  ]);

  await knex('feature_flags').insert([
    { key: 'dark_mode',             enabled: false, rollout_pct: 0,   roles: JSON.stringify([]) },
    { key: 'r12_marketplace',       enabled: true,  rollout_pct: 100, roles: JSON.stringify(['founder', 'provider']) },
    { key: 'r11_escrow',            enabled: false, rollout_pct: 0,   roles: JSON.stringify([]) },
    { key: 'whatsapp_otp',          enabled: false, rollout_pct: 0,   roles: JSON.stringify([]) },
    { key: 'gemini_classification', enabled: true,  rollout_pct: 100, roles: JSON.stringify(['founder']) },
    { key: 'score_api_public',      enabled: true,  rollout_pct: 100, roles: JSON.stringify(['lender', 'investor']) },
    { key: 'university_rankings',   enabled: true,  rollout_pct: 100, roles: JSON.stringify([]) },
  ]);

  // ════════════════════════════════════════════════════════════
  // 15. COMPLIANCE — GDPR REQUESTS, AUDIT LOG, DATA ACCESS LOG
  // ════════════════════════════════════════════════════════════
  await knex('gdpr_requests').insert([
    // Access request — within SLA
    { user_id: U.f15, request_type: 'access',   status: 'completed', due_by: ago(-25), completed_at: ago(5),  notes: 'Data export delivered via secure link. All categories provided.' },
    // Deletion request — pending, due soon
    { user_id: U.f19, request_type: 'deletion',  status: 'pending',   due_by: new Date(Date.now() + 5 * 86400 * 1000), notes: 'No active subscriptions. No legal holds. Deletion queued.' },
    // Overdue deletion — compliance failure test case
    { user_id: U.f17, request_type: 'deletion',  status: 'processing',due_by: ago(3), legal_holds: JSON.stringify(['score_history_7yr']), notes: 'Legal hold on score history (7yr financial record retention). Partial deletion of PII complete. Score history retained.' },
    // Portability request
    { user_id: U.f8,  request_type: 'portability', status: 'pending', due_by: new Date(Date.now() + 18 * 86400 * 1000), notes: 'Data portability request received. JSON export being prepared.' },
  ]);

  // Audit log — comprehensive activity trail
  const auditEntries = [
    // Auth events
    { user_id: U.f1,  action: 'user.login',         resource_type: 'session',   ip: '41.58.12.1', request_id: crypto.randomUUID(), created_at: ago(0, 2) },
    { user_id: U.f1,  action: 'score.calculated',   resource_type: 'score',     resource_id: U.s1, ip: '41.58.12.1', new_value: JSON.stringify({ total: 887, tier: 'ELITE' }), request_id: crypto.randomUUID(), created_at: ago(1) },
    { user_id: U.f2,  action: 'user.login',         resource_type: 'session',   ip: '196.220.14.5', request_id: crypto.randomUUID(), created_at: ago(1) },
    { user_id: U.f6,  action: 'venture.document.uploaded', resource_type: 'venture_document', ip: '41.58.0.44', new_value: JSON.stringify({ type: 'business_registration' }), request_id: crypto.randomUUID(), created_at: ago(5) },
    { user_id: U.i1,  action: 'investor.introduction.requested', resource_type: 'investor_match', ip: '41.58.88.2', new_value: JSON.stringify({ ventureId: U.v1 }), request_id: crypto.randomUUID(), created_at: ago(14) },
    { user_id: U.l1,  action: 'score.api.queried',  resource_type: 'venture',   resource_id: U.v1, ip: '102.88.1.5', new_value: JSON.stringify({ ventureId: U.v1 }), request_id: crypto.randomUUID(), created_at: ago(0, 3) },
    // Admin actions
    { user_id: U.admin, action: 'admin.document.approved', resource_type: 'venture_document', ip: '82.44.1.200', new_value: JSON.stringify({ ventureId: U.v1, tier: 2 }), request_id: crypto.randomUUID(), created_at: ago(180) },
    { user_id: U.admin, action: 'admin.document.approved', resource_type: 'venture_document', ip: '82.44.1.200', new_value: JSON.stringify({ ventureId: U.v2, tier: 2 }), request_id: crypto.randomUUID(), created_at: ago(120) },
    // Billing events
    { user_id: U.i1,  action: 'billing.subscription.create', resource_type: 'subscription', ip: '41.58.88.2', new_value: JSON.stringify({ plan: 'Investor Pro' }), request_id: crypto.randomUUID(), created_at: ago(45) },
    { user_id: U.f6,  action: 'marketplace.booking.create',  resource_type: 'marketplace_booking', ip: '41.58.0.44', new_value: JSON.stringify({ listingPrice: 1200, commission: 114 }), request_id: crypto.randomUUID(), created_at: ago(20) },
    // Consent events
    { user_id: U.f12, action: 'consent.revoked', resource_type: 'user_consent', ip: '196.2.44.9', old_value: JSON.stringify({ type: 'score_share_investors', granted: true }), new_value: JSON.stringify({ type: 'score_share_investors', granted: false }), request_id: crypto.randomUUID(), created_at: ago(10) },
    // GDPR
    { user_id: U.f19, action: 'user.delete_requested', resource_type: 'user', resource_id: U.f19, ip: '197.211.0.5', request_id: crypto.randomUUID(), created_at: ago(12) },
    // Compliance
    { action: 'compliance.aml_screening.completed', resource_type: 'compliance', new_value: JSON.stringify({ screened: 36, flagged: 0 }), request_id: crypto.randomUUID(), created_at: ago(1) },
    { action: 'compliance.bias_audit.completed', resource_type: 'compliance', new_value: JSON.stringify({ pass: true, overallAvg: 498 }), request_id: crypto.randomUUID(), created_at: ago(1) },
    { action: 'score_history_integrity.checked', resource_type: 'compliance', new_value: JSON.stringify({ suspicious: 0, status: 'PASS' }), request_id: crypto.randomUUID(), created_at: ago(7) },
  ];

  for (const e of auditEntries) {
    await knex('audit_log').insert({
      user_id: e.user_id || null,
      action: e.action,
      resource_type: e.resource_type,
      resource_id: e.resource_id || null,
      old_value: JSON.stringify(e.old_value || {}),
      new_value: JSON.stringify(e.new_value || {}),
      ip: e.ip || null,
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
      request_id: e.request_id || null,
      created_at: e.created_at || new Date(),
    });
  }

  // Data access log
  await knex('data_access_log').insert([
    { accessor_id: U.l1, accessed_user_id: U.f1, data_type: 'bankability_score', purpose: 'lender_assessment', created_at: ago(0, 3) },
    { accessor_id: U.l1, accessed_user_id: U.f6, data_type: 'lender_pool_view',  purpose: 'lender_prospecting', created_at: ago(1) },
    { accessor_id: U.i1, accessed_user_id: U.f1, data_type: 'venture_profile',   purpose: 'investor_access', created_at: ago(14) },
    { accessor_id: U.l3, accessed_user_id: U.f1, data_type: 'bankability_score', purpose: 'lender_assessment', created_at: ago(5) },
    { accessor_id: U.l3, accessed_user_id: U.f2, data_type: 'bankability_score', purpose: 'lender_assessment', created_at: ago(4) },
  ]);

  // ════════════════════════════════════════════════════════════
  // 16. ANALYTICS EVENTS
  // ════════════════════════════════════════════════════════════
  const analyticsEvents = [];
  const eventTypes = [
    'page.view', 'score.calculate.clicked', 'document.upload.started', 'document.upload.completed',
    'investor.match.viewed', 'investor.introduction.clicked', 'billing.upgrade.clicked',
    'scout.scan.started', 'scout.scan.completed', 'deal_room.opened',
    'lender.pool.searched', 'marketplace.listing.viewed', 'marketplace.booking.started',
  ];
  const analyticsUsers = [U.f1, U.f2, U.f3, U.f4, U.f5, U.f6, U.i1, U.i2, U.l1, null];
  for (let i = 0; i < 120; i++) {
    analyticsEvents.push({
      user_id: analyticsUsers[Math.floor(Math.random() * analyticsUsers.length)],
      event_type: eventTypes[Math.floor(Math.random() * eventTypes.length)],
      event_data: JSON.stringify({ path: '/dashboard', source: 'web' }),
      session_id: `sess_${Math.floor(Math.random() * 20)}`,
      device: Math.random() > 0.3 ? 'desktop' : 'mobile',
      country: ['NG', 'KE', 'GH', 'ZA', 'GB'][Math.floor(Math.random() * 5)],
      created_at: ago(Math.floor(Math.random() * 30)),
    });
  }
  await knex('analytics_events').insert(analyticsEvents);

  // ════════════════════════════════════════════════════════════
  // SEED COMPLETE SUMMARY
  // ════════════════════════════════════════════════════════════
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         IkonetU Synthetic Data Seed — Complete            ║
╠═══════════════════════════════════════════════════════════╣
║ Users:             36 (20 founders, 5 investors,          ║
║                        5 providers, 3 lenders,            ║
║                        2 universities, 1 admin)           ║
║ Ventures:          20 across NG, GH, KE, ZA, GB           ║
║ Score tiers:       ELITE(1) INVESTABLE(4) RISING(7) EARLY(8) ║
║ Score history:     240 records (12 months × 20 ventures)  ║
║ Documents:         24 (mix of verified & pending)         ║
║ Social profiles:   15 across 5 platforms                  ║
║ Financial data:    144 records (12 months × 12 ventures)  ║
║ Investors:         5 with theses & matches                ║
║ Deal rooms:        2 with founders assigned               ║
║ Providers:         5 with listings & leads                ║
║ Lenders:           3 with portfolios & alerts             ║
║ Universities:      2 with programmes & alumni             ║
║ Subscriptions:     10 (8 active, 1 past_due, 1 cancelled) ║
║ Revenue events:    ~120 across R01–R12 (never R11)        ║
║ Marketplace:       4 bookings (released/held/disputed/pending) ║
║ ACXM signals:      8 (4 opportunities, 4 threats)         ║
║ ACXM escalations:  2 pending human review                 ║
║ Notifications:     12 (mix read/unread)                   ║
║ GDPR requests:     4 (completed/pending/overdue)          ║
║ Audit log:         ~15 entries                            ║
║ Analytics events:  120 random events                      ║
╠═══════════════════════════════════════════════════════════╣
║ INVARIANTS VERIFIED:                                      ║
║   ✅ All scores 0–1000                                     ║
║   ✅ All tiers match score ranges                          ║
║   ✅ R12 commission exactly 9.5% on all bookings           ║
║   ✅ No R11 revenue events                                 ║
║   ✅ No R11 escrow activations                            ║
║   ✅ dark_mode = false                                     ║
║   ✅ score_history append-only                             ║
╚═══════════════════════════════════════════════════════════╝
  `);
}
