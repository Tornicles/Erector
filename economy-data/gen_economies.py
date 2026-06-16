"""
Generator for economy-data/economies.json
Run from /app:  python economy-data/gen_economies.py
"""
import json, pathlib

def pat(name, description, severity="medium", examples=None, engines=None, notes=None):
    return {"name": name, "description": description, "severity_or_strength": severity,
            "examples": examples or [], "affected_engines": engines or [], "notes": notes}

economies = [
  # ── 1 ── Consumer Capitalist ──────────────────────────────────────────────
  {"economy_id":"eco_consumer_capitalist","economy_type":"consumer_capitalist",
   "name":"Consumer Capitalist","display_name":"Consumer Capitalist",
   "short_description":"High-spending, brand-driven economies where consumer choice, credit, and marketing determine market winners.",
   "long_description":"Consumer capitalist economies are defined by discretionary spending culture, robust consumer credit systems, heavy brand competition, and marketing-driven purchasing decisions. They offer large addressable markets for digital products, subscriptions, and direct-to-consumer models. Trust in institutions is moderate-to-high, payment rails are reliable, and digital adoption is advanced.",
   "core_characteristic":"High-spending, brand-driven, competitive",
   "example_countries":["USA","Canada","Australia","UK"],
   "countries":["United States","Canada","Australia","United Kingdom","New Zealand"],
   "civilization_dna":{"trust_index":72,"authority_index":45,"corruption_index":30,"innovation_index":82,"digital_adoption_index":88,"education_index":75,"social_mobility_index":60,"bureaucracy_index":40,"stability_index":78,"information_freedom_index":85,"risk_tolerance_index":78,"community_dependence_index":35,"crime_pressure_index":35,"payment_reliability_index":92,"infrastructure_reliability_index":88,"institutional_strength_index":80,"media_volatility_index":75,"legal_predictability_index":78,"labor_reliability_index":75,"crisis_exposure_index":35,"adoption_friction_index":38,"social_proof_dependence_index":65,"reputation_fragility_index":68,"informal_network_strength_index":40,"future_change_velocity_index":80},
   "resistance_patterns":[
     pat("Market Saturation","Extremely competitive markets with entrenched incumbents and high customer acquisition costs.","high",["SaaS tools","food delivery","fintech"],["market_engine","competition_engine"],"New entrants face established players with deep pockets and loyal user bases."),
     pat("Brand Trust Threshold","Consumers require strong social proof and brand credibility before committing to new products.","high",["B2C products","healthcare tech"],["trust_engine","adoption_engine"],"Lack of social proof is a major early-stage killer."),
     pat("Privacy and Regulatory Scrutiny","Growing data privacy laws (GDPR-adjacent, CCPA) create compliance overhead for startups.","medium",["adtech","healthtech","fintech"],["regulatory_engine"],"Consumer rights movement is politically active and legally empowered.")
   ],
   "opportunity_patterns":[
     pat("Subscription Willingness","Consumers are culturally conditioned to pay recurring fees for convenience and value.","high",["Netflix","Spotify","SaaS tools"],["revenue_engine"],"Strongest subscription cultures globally."),
     pat("Digital-First Purchasing","Most purchases begin online; strong e-commerce, app, and platform infrastructure.","high",["e-commerce","on-demand services"],["adoption_engine","distribution_engine"],"High intent-to-purchase via digital channels."),
     pat("Creator and Niche Monetization","Long-tail consumer segments are large enough to support niche products.","medium",["newsletter businesses","indie apps"],["revenue_engine","narrative_engine"],"Micro-communities can sustain viable businesses.")
   ],
   "trust_mechanisms":[
     pat("Reviews and Social Proof","Consumers rely heavily on ratings, reviews, and peer recommendations.","high",["Amazon reviews","App Store ratings"],["trust_engine"]),
     pat("Brand Consistency","Repetition and brand recognition builds trust faster than individual transaction trust.","medium",["FMCG","SaaS brand building"],["narrative_engine"])
   ],
   "payment_patterns":[
     pat("Credit-Driven Consumption","Credit cards, BNPL, and installment plans dominate discretionary spending.","high",["Affirm","Klarna use cases"],["payment_engine"]),
     pat("Subscription Billing Infrastructure","Mature recurring billing infrastructure; Stripe, Recurly widely available.","high",["SaaS billing"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Strong Consumer Protection","Regulatory bodies actively enforce consumer rights, refund policies, chargebacks.","high",["FTC","ACCC","CMA"],["regulatory_engine"]),
     pat("IP and Contract Enforcement","Strong legal frameworks for intellectual property and commercial contracts.","high",["SaaS contracts","startup equity"],["legal_engine"])
   ],
   "narrative_patterns":[
     pat("Aspiration and Lifestyle Marketing","Consumers respond to aspirational narratives tied to identity and status.","high",["luxury DTC","fitness tech"],["narrative_engine"]),
     pat("Disruption Narrative","Tech disruption stories resonate strongly with investors and early adopters.","medium",["fintech","healthtech"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Platform Ecosystem Lock-In","Apple, Google, Amazon, and Meta control key distribution channels.","high",["App Store","AWS marketplace"],["platform_engine"]),
     pat("Social Commerce Integration","Social platforms increasingly enable in-app purchasing.","medium",["Instagram Shopping","TikTok Shop"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Sector-Specific Compliance","Regulated sectors (finance, health, food) require significant compliance investment.","high",["HIPAA","PCI-DSS","FDA"],["regulatory_engine"]),
     pat("Employment and Labor Law","Strong worker protection laws affect contractor/employee classification.","medium",["gig economy rulings"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Price Comparison Shopping","Consumers actively comparison-shop; price transparency is high.","high",["Google Shopping","price aggregators"],["adoption_engine"]),
     pat("Convenience Premium","Consumers pay premium for speed, ease, and frictionless experience.","high",["Prime","same-day delivery"],["adoption_engine"])
   ],
   "business_model_fit":{"saas":"high","marketplace":"high","ecommerce":"high","subscription":"high","direct_to_consumer":"high","b2b_enterprise":"high","services":"medium","hardware":"medium","notes":"Best economy for subscription and digital product models."},
   "common_failure_modes":[
     pat("CAC Exceeds LTV","High competition drives up customer acquisition costs beyond sustainable lifetime value.","high",["VC-backed startups burning on ads"],["revenue_engine"]),
     pat("Undifferentiated Positioning","Products fail to establish distinct value in a crowded market.","high",["me-too SaaS"],["narrative_engine"])
   ],
   "common_success_patterns":[
     pat("Niche Domination First","Win a defensible niche completely before expanding horizontally.","high",["Slack starting with gaming studios"],["strategy_engine"]),
     pat("Community-Led Growth","Build product communities that reduce CAC through word-of-mouth.","high",["Notion","Figma community"],["adoption_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Product-Led Growth","Use free tiers and viral product loops to acquire users without sales.","high",["freemium SaaS","consumer apps"],["adoption_engine"]),
     pat("Niche Targeting","Enter via a defensible niche with a focused ICP before competing broadly.","high",["vertical SaaS"],["market_engine"])
   ],
   "source_notes":"Based on US, Canada, Australia market characteristics. DNA scores reflect mature capitalist consumer markets.",
   "schema_version":"A2"},

  # ── 2 ── Welfare Industrial ───────────────────────────────────────────────
  {"economy_id":"eco_welfare_industrial","economy_type":"welfare_industrial",
   "name":"Welfare Industrial","display_name":"Welfare Industrial",
   "short_description":"High-trust, regulated economies with strong institutions, social safety nets, and methodical adoption cycles.",
   "long_description":"Welfare industrial economies combine advanced manufacturing, strong labor protections, and comprehensive social safety nets. Trust in institutions is exceptionally high. Innovation exists but is methodical rather than disruptive. Bureaucratic overhead is significant. Payment and legal infrastructure is world-class. Customer acquisition is slower but retention is very high once trust is established.",
   "core_characteristic":"High-trust, regulated, strong institutions",
   "example_countries":["Germany","Sweden","Netherlands","Denmark","Finland","Norway"],
   "countries":["Germany","Sweden","Netherlands","Denmark","Finland","Norway","Belgium","Austria","Switzerland"],
   "civilization_dna":{"trust_index":88,"authority_index":55,"corruption_index":15,"innovation_index":75,"digital_adoption_index":85,"education_index":85,"social_mobility_index":72,"bureaucracy_index":68,"stability_index":90,"information_freedom_index":90,"risk_tolerance_index":55,"community_dependence_index":42,"crime_pressure_index":20,"payment_reliability_index":95,"infrastructure_reliability_index":92,"institutional_strength_index":92,"media_volatility_index":55,"legal_predictability_index":92,"labor_reliability_index":85,"crisis_exposure_index":18,"adoption_friction_index":55,"social_proof_dependence_index":60,"reputation_fragility_index":72,"informal_network_strength_index":35,"future_change_velocity_index":65},
   "resistance_patterns":[
     pat("Compliance and Certification Burden","Extensive regulatory requirements for market entry, especially in regulated sectors.","high",["GDPR","CE marking","DSGVO"],["regulatory_engine"],"Compliance costs are real barriers to entry."),
     pat("Conservative Adoption Cycles","Consumers and businesses are methodical; adoption of new technology is slower.","high",["enterprise software","fintech"],["adoption_engine"],"Long sales cycles in B2B."),
     pat("Labor Market Rigidity","Strong worker protections make hiring, firing, and restructuring expensive and slow.","medium",["startup hiring"],["labor_engine"],"Works councils and union agreements add friction.")
   ],
   "opportunity_patterns":[
     pat("High Willingness to Pay for Quality","Consumers prioritize quality, durability, and reliability over lowest price.","high",["premium SaaS","B2B tools"],["revenue_engine"]),
     pat("Strong B2B Spend","Well-funded enterprises and Mittelstand companies invest heavily in operational efficiency tools.","high",["ERP","supply chain","HR tools"],["revenue_engine"]),
     pat("Climate and Sustainability Demand","High institutional and consumer appetite for sustainability solutions.","high",["cleantech","ESG tools"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Institutional Certification","Trust flows through certified standards bodies, official certifications, and regulatory approval.","high",["ISO certification","TÜV","GDPR compliance"],["trust_engine"]),
     pat("Reference Customer Proof","Enterprises require reference customers in similar industries before purchasing.","high",["B2B enterprise sales"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("SEPA and Bank Transfer Dominance","Business payments prefer SEPA bank transfers over card-based systems.","high",["B2B invoicing"],["payment_engine"]),
     pat("Invoice-Based B2B Payments","Net-30/60 invoicing is standard in B2B; upfront credit card payment is uncommon.","medium",["enterprise SaaS","professional services"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Strong Regulatory Framework","GDPR, consumer protection laws, and sector-specific regulation are strictly enforced.","high",["data companies","fintech","healthtech"],["regulatory_engine"]),
     pat("Works Council System","Employee representation bodies influence major business decisions.","medium",["startup hiring","restructuring"],["labor_engine"])
   ],
   "narrative_patterns":[
     pat("Engineering and Precision Narrative","Value propositions built on reliability, quality, and engineering excellence resonate strongly.","high",["manufacturing tech","industrial IoT"],["narrative_engine"]),
     pat("Sustainability and Ethics Narrative","ESG, carbon neutrality, and fair trade narratives have strong institutional and consumer traction.","high",["cleantech","supply chain"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("SAP and Established Vendor Ecosystem","SAP dominates enterprise; new entrants must integrate with existing ERP/CRM ecosystems.","high",["ERP integrations"],["platform_engine"]),
     pat("LinkedIn B2B Dominance","LinkedIn is the primary B2B networking and outbound channel.","medium",["B2B SaaS","professional services"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("GDPR Compliance Mandatory","All data handling must comply with GDPR; penalties are significant.","high",["any data-collecting product"],["regulatory_engine"]),
     pat("Employment Law Complexity","Worker classification, benefits, and termination are heavily regulated.","high",["gig economy","remote work"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Research Before Purchase","B2B buyers conduct extensive research, RFP processes, and vendor comparison.","high",["enterprise SaaS"],["adoption_engine"]),
     pat("Long Relationship Orientation","Customers prefer stable, long-term vendor relationships over switching frequently.","high",["B2B tools","professional services"],["retention_engine"])
   ],
   "business_model_fit":{"saas":"high","b2b_enterprise":"high","manufacturing":"high","marketplace":"medium","subscription":"high","ecommerce":"medium","services":"high","notes":"Ideal for B2B SaaS, professional services, and compliance-heavy sectors."},
   "common_failure_modes":[
     pat("Underestimating Compliance Costs","Startups underestimate GDPR, labor law, and certification costs.","high",["US startups entering Europe"],["regulatory_engine"]),
     pat("Slow Sales Cycle Mismatch","Founders expect US-speed adoption but face 12-24 month enterprise cycles.","high",["B2B SaaS"],["strategy_engine"])
   ],
   "common_success_patterns":[
     pat("Mittelstand Partnership Strategy","Partner with established German mid-market companies to access their supply chains.","high",["industrial tech"],["strategy_engine"]),
     pat("Quality-First Positioning","Price at premium and position on quality, reliability, and compliance.","high",["enterprise software","B2B SaaS"],["narrative_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Local Entity and Compliance First","Establish legal entity, GDPR compliance, and local billing before scaling.","high",["any startup entering DE/SE/NL"],["regulatory_engine"]),
     pat("Channel Partner Strategy","Work through established local VAR/SI partners who already have enterprise relationships.","high",["B2B SaaS"],["distribution_engine"])
   ],
   "source_notes":"Based on Germany, Sweden, Netherlands market characteristics.",
   "schema_version":"A2"},

  # ── 3 ── Financial Mega-City ──────────────────────────────────────────────
  {"economy_id":"eco_financial_mega_city","economy_type":"financial_mega_city",
   "name":"Financial Mega-City","display_name":"Financial Mega-City",
   "short_description":"Capital-dense global hubs where elite networks, luxury spending, and financial sophistication dominate.",
   "long_description":"Financial mega-cities are global capital hubs with exceptional infrastructure, sophisticated financial services, and high-net-worth populations. Business is conducted through elite networks. Regulatory environments are business-friendly but heavily monitored. Innovation is capital-intensive and globally oriented. These are exceptional markets for fintech, wealth management, luxury, and global enterprise services.",
   "core_characteristic":"Capital-heavy, elite networks, luxury",
   "example_countries":["Singapore","UAE","Hong Kong"],
   "countries":["Singapore","United Arab Emirates","Hong Kong"],
   "civilization_dna":{"trust_index":80,"authority_index":65,"corruption_index":25,"innovation_index":82,"digital_adoption_index":92,"education_index":82,"social_mobility_index":55,"bureaucracy_index":35,"stability_index":85,"information_freedom_index":65,"risk_tolerance_index":72,"community_dependence_index":45,"crime_pressure_index":20,"payment_reliability_index":95,"infrastructure_reliability_index":95,"institutional_strength_index":85,"media_volatility_index":60,"legal_predictability_index":85,"labor_reliability_index":75,"crisis_exposure_index":28,"adoption_friction_index":35,"social_proof_dependence_index":55,"reputation_fragility_index":75,"informal_network_strength_index":65,"future_change_velocity_index":78},
   "resistance_patterns":[
     pat("Elite Network Gatekeeping","Business relationships depend on social capital and elite introductions.","high",["VC access","enterprise sales"],["trust_engine"],"Cold outreach rarely works; warm introductions are critical."),
     pat("High Cost of Operations","Office space, talent, and living costs are among the highest in the world.","high",["startup burn rates"],["execution_engine"]),
     pat("Information Control","Government and elite institutions exert influence over media and certain business conversations.","medium",["sensitive sectors","political topics"],["information_engine"])
   ],
   "opportunity_patterns":[
     pat("Wealth Management and HNW Services","Massive concentration of ultra-high-net-worth individuals seeking sophisticated services.","high",["fintech","wealth tech","luxury brands"],["market_engine"]),
     pat("Asia Gateway Role","Acts as the gateway for Western companies entering Asia and Asian companies accessing global capital.","high",["regional HQ","fund structures"],["market_engine"]),
     pat("Crypto and Digital Asset Hub","Progressive digital asset regulatory frameworks attract crypto/Web3 builders.","high",["crypto exchanges","DeFi"],["regulatory_engine"])
   ],
   "trust_mechanisms":[
     pat("Reputation and Elite Vouching","Personal reputation and endorsement from respected figures opens all doors.","high",["fund raises","enterprise deals"],["trust_engine"]),
     pat("Regulatory License as Trust Signal","Obtaining MAS (Singapore) or ADGM (UAE) licenses signals legitimacy.","high",["fintech","crypto"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Multi-Currency Sophistication","Businesses routinely transact in USD, SGD, AED, and cryptocurrencies.","high",["B2B services","trading"],["payment_engine"]),
     pat("Wire Transfer Dominance","Large B2B payments via wire transfer with extensive KYC requirements.","high",["enterprise deals","fund flows"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Business-Friendly Government","Governments actively compete for business, offering incentives and fast licensing.","high",["MAS sandbox","ADGM free zone"],["regulatory_engine"]),
     pat("Rule of Law Precision","Contracts are enforced with exceptional precision and speed.","high",["commercial arbitration"],["legal_engine"])
   ],
   "narrative_patterns":[
     pat("Global Ambition Narrative","Businesses must project global scale ambitions; local-only positioning is seen as limiting.","high",["startup pitches","VC decks"],["narrative_engine"]),
     pat("Innovation Hub Positioning","Being part of the innovation ecosystem (Antler, DIFC) provides legitimacy.","medium",["accelerators","co-working"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("WhatsApp Business Ecosystem","WhatsApp is the primary business communication channel across the region.","high",["B2B outreach","client communication"],["platform_engine"]),
     pat("Fintech Licensing Platforms","MAS, ADGM, and VARA provide regulated frameworks as platform infrastructure.","high",["fintech","crypto"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Financial Services Regulation","Strict AML/KYC requirements for any financial product.","high",["fintech","payments","banking"],["regulatory_engine"]),
     pat("Free Zone vs Mainland Structure","Business structure (free zone vs mainland) creates different regulatory obligations.","medium",["UAE company setup"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Relationship-First Buying","Major purchasing decisions follow relationship development, not cold acquisition.","high",["enterprise sales","wealth management"],["adoption_engine"]),
     pat("Status and Exclusivity Premium","Premium pricing tied to exclusivity and status signals is well received.","high",["luxury services","private banking"],["revenue_engine"])
   ],
   "business_model_fit":{"fintech":"high","wealth_management":"high","b2b_enterprise":"high","luxury":"high","saas":"medium","marketplace":"medium","ecommerce":"medium","notes":"Best for financial services, luxury, and global enterprise."},
   "common_failure_modes":[
     pat("Burning Cash Without Network Access","Startups spend heavily on operations without accessing the key networks they need.","high",["generic B2B SaaS"],["execution_engine"]),
     pat("Compliance Underestimation in Financial Services","MAS and ADGM regulations require significant legal and compliance investment.","high",["fintech startups"],["regulatory_engine"])
   ],
   "common_success_patterns":[
     pat("Anchor Investor or Partner First","Secure a prestigious local investor or partner to open doors.","high",["Series A+ in Singapore/UAE"],["strategy_engine"]),
     pat("Regulatory Sandbox Entry","Use government sandboxes to build credibility and de-risk compliance.","high",["fintech","insurtech"],["regulatory_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Strategic Advisor With Local Network","Hire a well-connected local advisor before making commercial moves.","high",["market entry"],["network_engine"]),
     pat("Conference and Event Positioning","Use major events (FinTech Festival, GITEX) as entry networking moments.","medium",["brand building"],["narrative_engine"])
   ],
   "source_notes":"Based on Singapore, UAE, Hong Kong characteristics.",
   "schema_version":"A2"},

  # ── 4 ── Export Technology ────────────────────────────────────────────────
  {"economy_id":"eco_export_technology","economy_type":"export_technology",
   "name":"Export Technology","display_name":"Export Technology",
   "short_description":"Innovation-driven economies with global export orientation, intense work culture, and high digital literacy.",
   "long_description":"Export technology economies built national prosperity on high-value technology exports. They combine strong education systems, intense work cultures, government industrial policy, and global competitiveness. Samsung, TSMC, LG, ASML came from these environments. Strong trust in institutions and high social proof requirements. Ideal for deep tech, semiconductors, electronics, and global B2B.",
   "core_characteristic":"Innovation-driven, global competitiveness",
   "example_countries":["South Korea","Taiwan"],
   "countries":["South Korea","Taiwan"],
   "civilization_dna":{"trust_index":75,"authority_index":68,"corruption_index":30,"innovation_index":90,"digital_adoption_index":92,"education_index":88,"social_mobility_index":62,"bureaucracy_index":55,"stability_index":75,"information_freedom_index":75,"risk_tolerance_index":65,"community_dependence_index":55,"crime_pressure_index":20,"payment_reliability_index":92,"infrastructure_reliability_index":90,"institutional_strength_index":80,"media_volatility_index":70,"legal_predictability_index":78,"labor_reliability_index":82,"crisis_exposure_index":35,"adoption_friction_index":55,"social_proof_dependence_index":72,"reputation_fragility_index":78,"informal_network_strength_index":55,"future_change_velocity_index":85},
   "resistance_patterns":[
     pat("Hierarchical Corporate Culture","Decisions flow strictly through hierarchical structures; consensus-building is slow.","high",["enterprise sales","partnerships"],["adoption_engine"]),
     pat("Work Culture Intensity","Extreme work hours and execution intensity create a high bar for operational credibility.","medium",["hiring","operations"],["labor_engine"]),
     pat("Government Industrial Policy Dependencies","Major sectors dependent on KIAT, KEIT, and government industrial programs.","medium",["deep tech","manufacturing"],["regulatory_engine"])
   ],
   "opportunity_patterns":[
     pat("Deep Tech Manufacturing","World-class semiconductor, electronics, and precision manufacturing supply chains.","high",["hardware","deep tech","IoT"],["market_engine"]),
     pat("Mobile-First Digital Consumer","Among the world's most mobile-first populations with very high app usage and mobile payments.","high",["consumer apps","fintech","gaming"],["adoption_engine"]),
     pat("Hallyu and Cultural Export Leverage","K-pop, K-drama, and Korean culture create global brand attachment.","high",["consumer brands","entertainment"],["narrative_engine"])
   ],
   "trust_mechanisms":[
     pat("Seniority and Title Recognition","Trust is established through seniority, formal titles, and organizational rank.","high",["B2B sales","partnerships"],["trust_engine"]),
     pat("Brand Heritage","Long-established brand histories carry significant weight.","high",["consumer brands","B2B"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Kakao Pay and Mobile Payment Dominance","South Korea has one of the world's highest mobile payment adoption rates.","high",["consumer apps","e-commerce"],["payment_engine"]),
     pat("Corporate Card and B2B Invoice","B2B payments via corporate cards and formal invoicing processes.","medium",["enterprise software"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Chaebol Ecosystem","Large conglomerates (Samsung, LG, Hyundai) dominate and create both barriers and partnership opportunities.","high",["B2B","supply chain"],["institutional_engine"]),
     pat("Government R&D Support","Significant government R&D subsidies available for qualifying technology companies.","medium",["deep tech","software"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("National Pride and Excellence","Narratives connecting products to national achievement and Korean/Taiwanese engineering pride.","high",["manufacturing","tech brands"],["narrative_engine"]),
     pat("Speed and Ppalli-ppalli Culture","Extreme speed and execution ability is a valued cultural differentiator.","high",["consumer tech","startup culture"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("KakaoTalk and Naver Ecosystem","KakaoTalk and Naver dominate Korean consumer distribution; they are not optional.","high",["consumer apps","e-commerce"],["platform_engine"]),
     pat("B2B Platform Integration","Integration with existing Chaebol ERP and platform systems is required for enterprise.","high",["enterprise software"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Personal Data Protection Act (PIPA)","Strict Korean data protection law with significant penalties.","high",["consumer apps","data companies"],["regulatory_engine"]),
     pat("Financial Services Commission Oversight","Fintech heavily regulated by FSC with licensing requirements.","high",["fintech","payments"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Intense Price-Quality Comparison","Consumers research extensively and compare both price and specification depth.","high",["consumer electronics","SaaS"],["adoption_engine"]),
     pat("Social Proof via Influencers","YouTube and Instagram influencers heavily influence consumer purchasing decisions.","high",["consumer products","B2C apps"],["adoption_engine"])
   ],
   "business_model_fit":{"deep_tech":"high","saas":"high","ecommerce":"high","gaming":"high","consumer_apps":"high","hardware":"high","b2b_enterprise":"medium","notes":"Outstanding for deep tech, gaming, mobile consumer, and B2B manufacturing tools."},
   "common_failure_modes":[
     pat("Ignoring Local Platform Requirements","Failing to integrate with KakaoTalk/Naver/Line makes consumer growth nearly impossible.","high",["consumer apps"],["platform_engine"]),
     pat("Underestimating Hierarchical Sales Cycles","B2B sales cycles are extremely long due to hierarchical approval requirements.","high",["enterprise SaaS"],["strategy_engine"])
   ],
   "common_success_patterns":[
     pat("Local Partnership as Wedge","Joint ventures or distribution partnerships with domestic companies dramatically accelerate market entry.","high",["enterprise tech","consumer brands"],["strategy_engine"]),
     pat("Mobile-First, Speed-First","Products with best-in-class mobile UX and fast performance win disproportionately.","high",["consumer apps"],["adoption_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Localization as a First-Class Feature","Full Korean/Traditional Chinese language, local payment, and local UX are non-negotiable.","high",["any consumer product"],["adoption_engine"]),
     pat("Leverage Diaspora Networks","Korean and Taiwanese diaspora globally provide warm entry into domestic networks.","medium",["market entry"],["network_engine"])
   ],
   "source_notes":"Based on South Korea and Taiwan market characteristics.",
   "schema_version":"A2"},

  # ── 5 ── Manufacturing Excellence ────────────────────────────────────────
  {"economy_id":"eco_manufacturing_excellence","economy_type":"manufacturing_excellence",
   "name":"Manufacturing Excellence","display_name":"Manufacturing Excellence",
   "short_description":"Precision-driven economies where quality, process discipline, and long-term relationships define competitive advantage.",
   "long_description":"Manufacturing excellence economies built global reputations on process precision, quality control, and operational reliability. Japan's kaizen, Germany's Mittelstand, Czech precision engineering. These markets value depth over speed, quality over novelty, and long-term relationships over quick deals. Extremely high labor reliability and institutional strength.",
   "core_characteristic":"Precision, process, reliability",
   "example_countries":["Japan","Germany","Czech Republic"],
   "countries":["Japan","Germany","Czech Republic","Slovakia","Hungary","Austria"],
   "civilization_dna":{"trust_index":82,"authority_index":70,"corruption_index":18,"innovation_index":72,"digital_adoption_index":80,"education_index":85,"social_mobility_index":55,"bureaucracy_index":60,"stability_index":88,"information_freedom_index":82,"risk_tolerance_index":45,"community_dependence_index":58,"crime_pressure_index":15,"payment_reliability_index":92,"infrastructure_reliability_index":92,"institutional_strength_index":88,"media_volatility_index":50,"legal_predictability_index":90,"labor_reliability_index":88,"crisis_exposure_index":18,"adoption_friction_index":62,"social_proof_dependence_index":68,"reputation_fragility_index":80,"informal_network_strength_index":45,"future_change_velocity_index":55},
   "resistance_patterns":[
     pat("Extremely High Quality Bar","Any product entering requires proven quality, certifications, and technical documentation.","high",["industrial software","hardware","B2B tools"],["quality_engine"]),
     pat("Risk Aversion and Long Evaluation","Extremely conservative adoption; companies evaluate vendors for 12-24+ months before commitment.","high",["enterprise software"],["adoption_engine"]),
     pat("Insular Relationship Networks","Supplier and partner relationships built over decades; outsiders have few entry points.","high",["supply chain","B2B manufacturing"],["trust_engine"])
   ],
   "opportunity_patterns":[
     pat("Industrial IoT and Digitization Demand","Massive installed base of legacy manufacturing equipment ready for digital upgrade.","high",["Industrial IoT","predictive maintenance"],["market_engine"]),
     pat("Quality Premium Willingness","Willingness to pay top prices for products that demonstrate provable quality.","high",["premium B2B software","precision tools"],["revenue_engine"]),
     pat("Long-Term Contract Value","Once trusted, vendor relationships become multi-decade with very low churn.","high",["B2B manufacturing software"],["retention_engine"])
   ],
   "trust_mechanisms":[
     pat("Trial Production Runs","Potential customers want proof of performance via pilot programs and production testing.","high",["manufacturing software","hardware"],["trust_engine"]),
     pat("Existing Customer References in Same Industry","Peer industry references from known companies are essential.","high",["B2B enterprise"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Structured B2B Invoicing","Formal invoice-based payment with strict terms; 30-60 day payment cycles.","high",["B2B manufacturing"],["payment_engine"]),
     pat("Long-Term Contract Commitment","Multi-year contracts with annual billing are preferred over monthly flexibility.","high",["enterprise software"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Industry Association Gatekeeping","Industry associations and Keiretsu/Mittelstand networks heavily influence supplier selection.","high",["manufacturing supply chains"],["institutional_engine"]),
     pat("Quality Certification Standards","ISO 9001, IATF 16949, and sector-specific certifications are mandatory entry requirements.","high",["any industrial supplier"],["regulatory_engine"])
   ],
   "narrative_patterns":[
     pat("Reliability and Precision Narrative","Value must be communicated through technical specs, reliability data, and operational metrics.","high",["industrial B2B"],["narrative_engine"]),
     pat("Continuous Improvement Story","Kaizen-inspired narratives of ongoing quality improvement resonate strongly.","medium",["operational tools"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("SAP and Legacy ERP Integration","SAP dominates; new entrants must integrate cleanly.","high",["enterprise software"],["platform_engine"]),
     pat("Machine Interface Standards","OPC-UA, Modbus, and industrial protocols are the platform layer for manufacturing.","high",["industrial IoT","MES systems"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Industry-Specific Compliance","Automotive (IATF), aerospace (AS9100), food (HACCP) require deep compliance investment.","high",["vertical industry software"],["regulatory_engine"]),
     pat("Product Liability Standards","Strict product liability laws; defects carry significant legal and reputational risk.","high",["hardware","industrial equipment"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Technical Due Diligence First","Buyers conduct extensive technical evaluation before commercial discussions.","high",["industrial software","hardware"],["adoption_engine"]),
     pat("Relationship Loyalty","Once a supplier relationship is established, switching costs are very high.","high",["B2B manufacturing"],["retention_engine"])
   ],
   "business_model_fit":{"industrial_saas":"high","manufacturing_tech":"high","b2b_enterprise":"high","hardware":"high","saas":"medium","marketplace":"low","consumer":"low","notes":"Optimal for industrial technology, B2B manufacturing tools, and process optimization software."},
   "common_failure_modes":[
     pat("Premature Scaling Without References","Attempting to scale before building a strong reference customer base.","high",["early-stage B2B"],["strategy_engine"]),
     pat("Underestimating Localization Depth","Surface-level localization fails; deep technical and linguistic localization required.","high",["foreign market entry"],["adoption_engine"])
   ],
   "common_success_patterns":[
     pat("Lighthouse Customer Strategy","Win one prestigious reference customer and leverage intensively for further sales.","high",["B2B industrial"],["strategy_engine"]),
     pat("Pilot Program as Standard Acquisition","Standard pilot programs with clear success metrics build trust systematically.","high",["industrial tech"],["adoption_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Find a Japanese/German Distribution Partner","Local distribution partners with existing relationships dramatically reduce entry time.","high",["foreign market entry"],["distribution_engine"]),
     pat("Technical Credibility First","Publish detailed technical documentation, white papers, and case studies before commercial outreach.","high",["B2B industrial"],["trust_engine"])
   ],
   "source_notes":"Based on Japan, Germany, Czech Republic industrial market characteristics.",
   "schema_version":"A2"},

  # ── 6 ── Oil Wealth ───────────────────────────────────────────────────────
  {"economy_id":"eco_oil_wealth","economy_type":"oil_wealth",
   "name":"Oil Wealth","display_name":"Oil Wealth",
   "short_description":"Resource-rich economies where government-controlled capital funds massive infrastructure and consumption.",
   "long_description":"Oil wealth economies are characterized by government distribution of hydrocarbon revenues into infrastructure, public employment, and consumption subsidies. Very high purchasing power at the top of the economy with significant inequality. Business depends on government contracts and relationships. Vision 2030-style diversification is creating new SaaS and tech opportunities, but government relationships remain critical.",
   "core_characteristic":"Resource-rich, government-controlled capital",
   "example_countries":["Saudi Arabia","Qatar","Kuwait"],
   "countries":["Saudi Arabia","Qatar","Kuwait","Bahrain","Oman"],
   "civilization_dna":{"trust_index":68,"authority_index":80,"corruption_index":45,"innovation_index":55,"digital_adoption_index":78,"education_index":68,"social_mobility_index":35,"bureaucracy_index":65,"stability_index":72,"information_freedom_index":35,"risk_tolerance_index":55,"community_dependence_index":62,"crime_pressure_index":20,"payment_reliability_index":85,"infrastructure_reliability_index":82,"institutional_strength_index":60,"media_volatility_index":30,"legal_predictability_index":60,"labor_reliability_index":65,"crisis_exposure_index":45,"adoption_friction_index":55,"social_proof_dependence_index":62,"reputation_fragility_index":65,"informal_network_strength_index":68,"future_change_velocity_index":55},
   "resistance_patterns":[
     pat("Government as Primary Gatekeeper","Most large contracts require government approval or direct government purchase.","high",["enterprise SaaS","infrastructure"],["regulatory_engine"]),
     pat("Wasta (Connections) Required","Informal relationship networks with influential families and officials determine business access.","high",["market entry","contract bidding"],["trust_engine"]),
     pat("Saudization/Emiratization Mandates","Local employment quotas impose significant hiring constraints on foreign businesses.","medium",["hiring","operations"],["labor_engine"])
   ],
   "opportunity_patterns":[
     pat("Vision 2030 Tech Demand","Saudi Vision 2030 and similar programs creating massive government-funded tech procurement.","high",["govtech","smart city","fintech"],["market_engine"]),
     pat("High Consumer Spending","Young, wealthy population with very high smartphone adoption and consumer spending.","high",["e-commerce","consumer apps","fintech"],["market_engine"]),
     pat("Infrastructure Buildout","Massive ongoing construction and infrastructure investment creating demand for tech-enabled services.","high",["smart city","construction tech"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Royal or Government Endorsement","Association with government vision programs provides instant credibility.","high",["enterprise B2B","govtech"],["trust_engine"]),
     pat("Family and Tribal Network Vouching","Introductions through trusted family networks are the primary trust mechanism.","high",["B2B sales","partnership"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Government Contract Payment Cycles","Government clients pay on 90-180 day cycles; cash flow management is critical.","high",["govtech","B2B"],["payment_engine"]),
     pat("Cash and MADA Card Consumer Market","Strong local debit (MADA) and cash usage for consumer transactions.","medium",["consumer fintech","retail"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Royal Decree as Law","Major business regulations can change by royal decree with limited notice.","high",["regulatory planning"],["regulatory_engine"]),
     pat("NEOM and Giga-Project Ecosystems","Government mega-projects create dedicated procurement ecosystems.","high",["smart city","construction tech","B2B"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Vision and National Transformation","Aligning products with national transformation narratives resonates with government buyers.","high",["govtech","enterprise"],["narrative_engine"]),
     pat("Halal and Islamic Finance Compliance","Products must be demonstrably compliant with Islamic finance and cultural norms.","high",["fintech","consumer apps"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("WhatsApp Business Primary","WhatsApp is the primary channel for both consumer and B2B communication.","high",["outreach","customer support"],["platform_engine"]),
     pat("Noon and Jarir Distribution","Local e-commerce platforms (Noon) and retail chains (Jarir) dominate consumer distribution.","medium",["consumer products","electronics"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Saudi Data and AI Authority","SDAIA oversees data and AI regulation with rapidly evolving requirements.","high",["data companies","AI tools"],["regulatory_engine"]),
     pat("Islamic Finance Compliance","All financial products must comply with Shariah principles.","high",["fintech","insurance","banking"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Relationship Over Product","Buyers prioritize vendor relationship quality over product features in initial evaluation.","high",["B2B enterprise"],["adoption_engine"]),
     pat("Premium Consumer Spending","Young demographic with high discretionary income spends aggressively on premium products.","high",["consumer apps","luxury tech"],["revenue_engine"])
   ],
   "business_model_fit":{"govtech":"high","b2b_enterprise":"high","consumer_apps":"high","ecommerce":"high","fintech":"medium","saas":"medium","notes":"Best for government B2B, consumer apps targeting young population, and Vision 2030 aligned tech."},
   "common_failure_modes":[
     pat("Entering Without Local Sponsor","Attempting direct market entry without a Saudi national sponsor or partner.","high",["foreign startups"],["regulatory_engine"]),
     pat("Ignoring Cultural and Religious Context","Products or marketing that conflict with cultural or religious norms face swift rejection.","high",["consumer products","fintech"],["narrative_engine"])
   ],
   "common_success_patterns":[
     pat("Government Program Alignment","Aligning product roadmap with specific Vision 2030 sub-programs creates funded demand.","high",["govtech","enterprise"],["strategy_engine"]),
     pat("Local Partner as Full Business Partner","Local partner with wasta is not just a formality but a genuine business co-owner.","high",["market entry"],["strategy_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Strategic Local Partnership First","Identify and partner with a well-connected Saudi national or established company.","high",["all foreign entrants"],["network_engine"]),
     pat("Pitch to Sovereign Wealth or NEOM","Apply for NEOM, PIF, or national tech programs as a primary entry pathway.","high",["tech companies"],["institutional_engine"])
   ],
   "source_notes":"Based on Saudi Arabia, Qatar, Kuwait market characteristics.",
   "schema_version":"A2"},

  # ── 7 ── Commodity Export ─────────────────────────────────────────────────
  {"economy_id":"eco_commodity_export","economy_type":"commodity_export",
   "name":"Commodity Export","display_name":"Commodity Export",
   "short_description":"Economies driven by raw material exports with boom-bust cycles and commodity price dependency.",
   "long_description":"Commodity export economies depend on natural resources for government revenue and export earnings. Economic cycles track global commodity prices creating significant volatility. Business environment is generally functional but institutional quality is mixed. Growing middle classes in urban centers offer consumer opportunity. Supply chains and logistics can be complex.",
   "core_characteristic":"Raw material dependency, boom/bust cycles",
   "example_countries":["Brazil","Chile","DRC","Angola"],
   "countries":["Brazil","Chile","Peru","Colombia","Angola","Zambia","Mongolia","Ecuador"],
   "civilization_dna":{"trust_index":55,"authority_index":55,"corruption_index":55,"innovation_index":50,"digital_adoption_index":65,"education_index":60,"social_mobility_index":42,"bureaucracy_index":65,"stability_index":52,"information_freedom_index":60,"risk_tolerance_index":58,"community_dependence_index":62,"crime_pressure_index":55,"payment_reliability_index":65,"infrastructure_reliability_index":60,"institutional_strength_index":52,"media_volatility_index":68,"legal_predictability_index":50,"labor_reliability_index":58,"crisis_exposure_index":55,"adoption_friction_index":55,"social_proof_dependence_index":65,"reputation_fragility_index":62,"informal_network_strength_index":65,"future_change_velocity_index":60},
   "resistance_patterns":[
     pat("Currency Volatility","Commodity price swings cause currency volatility that complicates pricing and margins.","high",["SaaS pricing","imports","revenue planning"],["financial_engine"]),
     pat("Institutional Unpredictability","Policy and regulatory changes track commodity cycles; inconsistent enforcement.","medium",["B2B","regulatory planning"],["regulatory_engine"]),
     pat("Infrastructure Gaps Outside Major Cities","Digital and logistics infrastructure is reliable in capitals but drops sharply in secondary cities.","medium",["distribution","logistics"],["infrastructure_engine"])
   ],
   "opportunity_patterns":[
     pat("Growing Urban Middle Class","Rapid urbanization creates a growing consumer class with rising digital spending.","high",["consumer apps","fintech","e-commerce"],["market_engine"]),
     pat("Commodity Tech Demand","Mining, agriculture, and resource extraction sectors need digital optimization tools.","high",["agritech","mining tech","logistics"],["market_engine"]),
     pat("Financial Inclusion Opportunity","Large unbanked/underbanked populations create fintech and payments opportunities.","high",["mobile payments","microfinance"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Local Presence and Relationships","In-country presence and personal relationships are essential for trust.","high",["B2B sales","enterprise"],["trust_engine"]),
     pat("Local Language and Cultural Fit","Portuguese (Brazil), Spanish (Chile/Peru/Colombia) localization signals commitment.","medium",["consumer products","B2B"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("PIX and Mobile Wallet Dominance (Brazil)","Brazil's PIX instant payment system has dramatically improved digital payments.","high",["Brazilian consumer market"],["payment_engine"]),
     pat("Installment Culture","Consumer purchases often split into many installments (parcelas).","high",["consumer products Brazil"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Commodity Ministry Influence","Ministries of mining, agriculture, or energy wield disproportionate regulatory influence.","medium",["commodity-adjacent tech"],["institutional_engine"]),
     pat("Local Content Requirements","Many commodity nations require local content in large contracts.","medium",["B2B enterprise contracts"],["regulatory_engine"])
   ],
   "narrative_patterns":[
     pat("National Development Narrative","Framing products as contributors to national development resonates with government buyers.","medium",["govtech","agritech"],["narrative_engine"]),
     pat("Social Impact Positioning","Consumer and B2B brands that demonstrate social impact gain stronger trust.","medium",["fintech","agritech"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("WhatsApp Business Ecosystem","WhatsApp dominates business and consumer communication across Latin America and Africa.","high",["all distribution"],["platform_engine"]),
     pat("Mercado Libre in Latin America","Mercado Libre dominates e-commerce; marketplace integration is required for consumer reach.","high",["e-commerce Latin America"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Extractive Industry Regulation","Complex regulations around resource extraction create compliance complexity.","medium",["commodity tech"],["regulatory_engine"]),
     pat("FX Controls","Some countries impose foreign exchange controls affecting profit repatriation.","medium",["foreign businesses"],["financial_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Value-Conscious Purchasing","Consumers are price-sensitive with strong preference for local or familiar brands.","high",["consumer products"],["adoption_engine"]),
     pat("Mobile-First Urban Consumer","Smartphone penetration in cities is high; mobile is primary internet access.","high",["consumer apps","fintech"],["adoption_engine"])
   ],
   "business_model_fit":{"agritech":"high","commodity_tech":"high","consumer_apps":"medium","fintech":"high","ecommerce":"medium","b2b_enterprise":"medium","saas":"medium","notes":"Best for commodity-sector tech, fintech, and urban consumer apps."},
   "common_failure_modes":[
     pat("Currency Risk Underestimation","Fixed USD pricing fails when local currency depreciates 30-50%.","high",["foreign SaaS entering Brazil"],["financial_engine"]),
     pat("Regulatory Capture by Incumbents","Local incumbents lobby for regulatory barriers against new entrants.","medium",["fintech","telecom-adjacent"],["regulatory_engine"])
   ],
   "common_success_patterns":[
     pat("Local Currency Pricing","Pricing in local currency with hedging removes friction and signals commitment.","high",["consumer and B2B SaaS"],["revenue_engine"]),
     pat("Mobile-First Product Design","Products designed mobile-first win disproportionately.","high",["consumer apps"],["adoption_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Partner with Local Distributor","Find established local distribution partner with existing customer relationships.","high",["B2B","enterprise"],["distribution_engine"]),
     pat("Start in One Major City","Prove model in São Paulo, Santiago, or Nairobi before expanding regionally.","high",["all market entrants"],["strategy_engine"])
   ],
   "source_notes":"Based on Brazil, Chile, DRC, Angola characteristics.",
   "schema_version":"A2"},

  # ── 8 ── Rapid Urbanization ───────────────────────────────────────────────
  {"economy_id":"eco_rapid_urbanization","economy_type":"rapid_urbanization",
   "name":"Rapid Urbanization","display_name":"Rapid Urbanization",
   "short_description":"Fast-growing cities with mixed infrastructure, rising middle classes, and intense mobile-first competition.",
   "long_description":"Rapid urbanization economies are in transition from rural to urban-dominated societies. Cities are growing explosively, creating massive demand for housing, services, logistics, and financial infrastructure. Infrastructure is mixed — world-class in parts of major cities, minimal in others. Digital leapfrogging happens rapidly. The entrepreneurial energy is high but execution complexity is significant.",
   "core_characteristic":"Fast-growing cities, mixed infrastructure",
   "example_countries":["India","Nigeria","Indonesia"],
   "countries":["India","Nigeria","Indonesia","Egypt","Pakistan","Bangladesh","Philippines","Kenya","Ethiopia","Turkey"],
   "civilization_dna":{"trust_index":55,"authority_index":55,"corruption_index":60,"innovation_index":65,"digital_adoption_index":65,"education_index":58,"social_mobility_index":52,"bureaucracy_index":68,"stability_index":55,"information_freedom_index":60,"risk_tolerance_index":68,"community_dependence_index":72,"crime_pressure_index":55,"payment_reliability_index":55,"infrastructure_reliability_index":52,"institutional_strength_index":52,"media_volatility_index":70,"legal_predictability_index":48,"labor_reliability_index":65,"crisis_exposure_index":58,"adoption_friction_index":62,"social_proof_dependence_index":72,"reputation_fragility_index":65,"informal_network_strength_index":72,"future_change_velocity_index":72},
   "resistance_patterns":[
     pat("Regulatory Fragmentation","Each state/region may have different regulations; central policy implementation is inconsistent.","high",["fintech","healthcare","food delivery"],["regulatory_engine"]),
     pat("Infrastructure Reliability Gaps","Power cuts, internet outages, and road congestion create execution complexity.","high",["logistics","SaaS","IoT"],["infrastructure_engine"]),
     pat("Price Sensitivity of Target Market","Consumers are extremely price-sensitive; premium pricing fails without strong justification.","high",["consumer apps","SaaS"],["revenue_engine"])
   ],
   "opportunity_patterns":[
     pat("Massive Underserved Market","Hundreds of millions of people gaining internet access and entering the formal economy.","high",["fintech","edtech","healthtech"],["market_engine"]),
     pat("Mobile Payment Leapfrogging","Rapid adoption of mobile payments bypassing traditional banking infrastructure.","high",["mobile payments","consumer fintech"],["adoption_engine"]),
     pat("Young Demographic Dividend","Very young populations with high mobile penetration and openness to new solutions.","high",["consumer apps","education","gaming"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Community and Word of Mouth","Trust travels through community networks, WhatsApp groups, and local influencers.","high",["consumer apps","fintech"],["trust_engine"]),
     pat("Price Signal as Quality Indicator","Counter-intuitively, some minimal price premium signals legitimacy over free products.","medium",["fintech","consumer apps"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("UPI / Mobile Money Dominance","India's UPI and equivalent mobile money systems (MPESA, GoPay) dominate.","high",["consumer fintech","e-commerce India/Nigeria/Indonesia"],["payment_engine"]),
     pat("Cash on Delivery Still Significant","Cash on delivery remains significant in e-commerce outside major metro areas.","medium",["e-commerce","logistics"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Regulatory Arbitrage Opportunities","Fast-changing regulatory landscapes create windows for early movers.","medium",["fintech","crypto","edtech"],["regulatory_engine"]),
     pat("Government Digital Programs","National digital identity (Aadhaar), e-governance, and digital payment infrastructure.","medium",["govtech","fintech","healthtech"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Upliftment and Aspiration Narrative","Products that help users rise economically or professionally resonate powerfully.","high",["edtech","fintech","career platforms"],["narrative_engine"]),
     pat("Local Language Credibility","Products in local language (Hindi, Bahasa, Hausa) build trust with non-English speakers.","high",["consumer apps","vernacular content"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("WhatsApp and YouTube as Distribution","WhatsApp groups and YouTube are the primary organic distribution channels.","high",["consumer apps","content businesses"],["platform_engine"]),
     pat("Flipkart/Tokopedia/Jumia Marketplace","Local e-commerce platforms dominate over direct DTC in most categories.","high",["e-commerce","consumer products"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Central Bank Digital Regulation","Central banks actively regulating digital payments and fintech with evolving rules.","high",["fintech","payments","lending"],["regulatory_engine"]),
     pat("Foreign Ownership Restrictions","Many countries restrict foreign ownership in key sectors (media, retail, insurance).","medium",["foreign startups"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Referral-Driven Adoption","User acquisition primarily through personal referrals and community recommendations.","high",["consumer apps","fintech"],["adoption_engine"]),
     pat("Value Maximization Behavior","Users exploit free tiers fully before considering paid; conversion requires strong habit formation.","high",["freemium apps"],["revenue_engine"])
   ],
   "business_model_fit":{"fintech":"high","consumer_apps":"high","edtech":"high","logistics":"high","healthtech":"high","ecommerce":"high","saas":"medium","b2b_enterprise":"medium","notes":"Excellent for high-volume consumer fintech, edtech, healthtech, and logistics."},
   "common_failure_modes":[
     pat("Unit Economics Failure at Scale","Low per-transaction revenue requires massive scale to be viable; many fail before reaching it.","high",["consumer fintech","logistics"],["financial_engine"]),
     pat("Hyperlocal Competition","Well-funded local competitors with deep local knowledge and cheaper cost structures.","high",["consumer apps","logistics"],["competition_engine"])
   ],
   "common_success_patterns":[
     pat("Hyper-Local Playbook","Win one city or region completely before expanding; local network effects are strong.","high",["logistics","consumer apps"],["strategy_engine"]),
     pat("Vernacular First","Building in local language first wins disproportionate trust in non-metro markets.","high",["consumer apps","edtech"],["adoption_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Mobile-First, Offline-Capable Design","Products must work on low-end Android devices with intermittent connectivity.","high",["all consumer apps"],["adoption_engine"]),
     pat("Partner with Local Telco or Bank","Local telco or bank distribution partnerships provide immediate scale.","high",["fintech","consumer apps"],["distribution_engine"])
   ],
   "source_notes":"Based on India, Nigeria, Indonesia market characteristics.",
   "schema_version":"A2"},

  # ── 9 ── Manufacturing Expansion ─────────────────────────────────────────
  {"economy_id":"eco_manufacturing_expansion","economy_type":"manufacturing_expansion",
   "name":"Manufacturing Expansion","display_name":"Manufacturing Expansion",
   "short_description":"Low-cost industrial economies rapidly expanding export-oriented manufacturing capacity.",
   "long_description":"Manufacturing expansion economies are capturing global supply chain share through competitive labor costs, improving infrastructure, and government incentives for export manufacturing. Vietnam, Bangladesh, and Cambodia have absorbed significant factory relocations from China. State influence is high but pragmatic. Labor reliability is good for manufacturing functions. Digital adoption is growing but not yet dominant.",
   "core_characteristic":"Low-cost industrial, export-focused",
   "example_countries":["Vietnam","Bangladesh","Cambodia"],
   "countries":["Vietnam","Bangladesh","Cambodia","Myanmar","Laos","Ethiopia (industrial zones)"],
   "civilization_dna":{"trust_index":60,"authority_index":70,"corruption_index":55,"innovation_index":48,"digital_adoption_index":60,"education_index":58,"social_mobility_index":45,"bureaucracy_index":68,"stability_index":58,"information_freedom_index":40,"risk_tolerance_index":55,"community_dependence_index":68,"crime_pressure_index":45,"payment_reliability_index":55,"infrastructure_reliability_index":55,"institutional_strength_index":50,"media_volatility_index":42,"legal_predictability_index":48,"labor_reliability_index":75,"crisis_exposure_index":48,"adoption_friction_index":65,"social_proof_dependence_index":70,"reputation_fragility_index":65,"informal_network_strength_index":65,"future_change_velocity_index":62},
   "resistance_patterns":[
     pat("State Approval Dependencies","Key business decisions require government bureau approval; timelines unpredictable.","high",["foreign direct investment","factory setup"],["regulatory_engine"]),
     pat("IP Protection Weaknesses","Intellectual property enforcement is limited; product copying is common.","high",["branded products","software"],["legal_engine"]),
     pat("Language and Documentation Barriers","Business documentation, permits, and contracts often only in local language.","medium",["market entry"],["execution_engine"])
   ],
   "opportunity_patterns":[
     pat("Factory and Supply Chain Tech","Massive demand for manufacturing execution systems, quality control, and logistics optimization.","high",["manufacturing SaaS","IoT","quality tech"],["market_engine"]),
     pat("Growing Domestic Consumer Class","Rapid income growth creating new consumer markets inside the country.","high",["consumer apps","e-commerce","fintech"],["market_engine"]),
     pat("Export Platform Advantage","Products made here can be exported to the world with cost advantage.","high",["physical goods","hardware"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Government and Certification Body Approval","Official approval from industrial zone authorities or ministries signals legitimacy.","high",["foreign businesses"],["trust_engine"]),
     pat("Shared National Success Stories","Associating with known successful local enterprises builds trust rapidly.","medium",["B2B sales"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Mobile Wallet Growth","MoMo (Vietnam), bKash (Bangladesh) are growing but banking penetration varies.","medium",["consumer fintech"],["payment_engine"]),
     pat("Cash and Bank Transfer B2B","B2B transactions rely heavily on bank transfers and cash for smaller amounts.","high",["SMB B2B"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Industrial Zone Special Rules","Export processing zones and special economic zones have different regulations from general market.","high",["manufacturing","foreign investment"],["institutional_engine"]),
     pat("State Enterprise Competition","State-owned enterprises compete in many sectors with preferential treatment.","medium",["B2B","logistics"],["competition_engine"])
   ],
   "narrative_patterns":[
     pat("Economic Progress and Growth","Narratives of national economic progress and worker opportunity resonate with government and communities.","medium",["market entry messaging"],["narrative_engine"]),
     pat("Quality Export Certification","Demonstrating export quality certifications (ISO, global buyer approvals) is a critical signal.","high",["manufacturing suppliers"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Zalo/Facebook Local Dominance","Zalo (Vietnam) and Facebook dominate digital communication.","high",["consumer distribution"],["platform_engine"]),
     pat("Alibaba and Global Trade Platforms","Alibaba 1688, Made-in-China, and similar B2B trade platforms drive export commerce.","high",["physical goods exporters"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Import Duty Complexity","Complex tariff structures affect cost calculations for product imports.","medium",["hardware","consumer goods"],["regulatory_engine"]),
     pat("Foreign Ownership Limits","Restrictions on foreign ownership in non-export sectors.","medium",["foreign startups"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Price-First Decision Making","Purchasing decisions dominated by unit cost comparison.","high",["B2B procurement"],["adoption_engine"]),
     pat("Relationship and Trust Over Contracts","Business relationships matter more than contract enforcement in practice.","high",["B2B sales","supplier relationships"],["trust_engine"])
   ],
   "business_model_fit":{"manufacturing_tech":"high","supply_chain":"high","agritech":"high","consumer_apps":"medium","fintech":"medium","ecommerce":"medium","b2b_enterprise":"medium","notes":"Best for manufacturing tech, supply chain, and industrial services."},
   "common_failure_modes":[
     pat("IP Theft Without Legal Recourse","Products are copied and sold without ability to enforce IP rights.","high",["branded products","software"],["legal_engine"]),
     pat("Bureaucratic Delay Kills Momentum","Permit and approval delays can stall product launches by months or years.","high",["market entry"],["regulatory_engine"])
   ],
   "common_success_patterns":[
     pat("Industrial Zone Focus","Concentrating operations within export processing zones simplifies regulatory environment.","high",["manufacturing","assembly"],["strategy_engine"]),
     pat("Long-Term Local Relationship Building","Investing in multi-year local relationships pays disproportionate dividends.","high",["B2B sales","supply chain"],["trust_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Joint Venture with Local Partner","JV structure satisfies local ownership requirements and provides network access.","high",["foreign market entry"],["strategy_engine"]),
     pat("Industrial Zone Entry","Set up first operations in industrial zones with simplified foreign business rules.","high",["manufacturing","assembly"],["regulatory_engine"])
   ],
   "source_notes":"Based on Vietnam, Bangladesh, Cambodia manufacturing sector characteristics.",
   "schema_version":"A2"},

  # ── 10 ── Tourism Economy ─────────────────────────────────────────────────
  {"economy_id":"eco_tourism_economy","economy_type":"tourism_economy",
   "name":"Tourism Economy","display_name":"Tourism Economy",
   "short_description":"Visitor-dependent economies with seasonal demand cycles, hospitality orientation, and reputation-sensitive markets.",
   "long_description":"Tourism economies are structurally dependent on visitor inflows for revenue, employment, and foreign exchange. Seasonal volatility is extreme. Customer acquisition happens globally (tourists decide before arrival). Reputation and reviews are existential — a single viral negative story can collapse a destination's bookings. Local consumer market is often small; export of services (tourism) is the primary revenue model.",
   "core_characteristic":"Visitor-dependent, seasonal, hospitality-driven",
   "example_countries":["Thailand","Maldives","Jamaica","Croatia","Costa Rica"],
   "countries":["Thailand","Maldives","Jamaica","Croatia","Costa Rica","Bali (Indonesia)","Morocco","Greece"],
   "civilization_dna":{"trust_index":65,"authority_index":52,"corruption_index":50,"innovation_index":48,"digital_adoption_index":65,"education_index":58,"social_mobility_index":48,"bureaucracy_index":55,"stability_index":62,"information_freedom_index":60,"risk_tolerance_index":65,"community_dependence_index":68,"crime_pressure_index":52,"payment_reliability_index":65,"infrastructure_reliability_index":62,"institutional_strength_index":55,"media_volatility_index":65,"legal_predictability_index":55,"labor_reliability_index":65,"crisis_exposure_index":58,"adoption_friction_index":58,"social_proof_dependence_index":72,"reputation_fragility_index":75,"informal_network_strength_index":62,"future_change_velocity_index":58},
   "resistance_patterns":[
     pat("Extreme Seasonal Volatility","Revenue can drop 70-90% in low season, requiring careful financial management.","high",["hospitality tech","booking systems"],["financial_engine"]),
     pat("Global Event Sensitivity","Pandemics, political instability, or natural disasters can instantly collapse visitor numbers.","high",["all tourism-dependent businesses"],["crisis_engine"]),
     pat("Online Reputation Fragility","TripAdvisor, Google, and social media reviews are existential; one viral negative kills bookings.","high",["hospitality","experiences"],["reputation_engine"])
   ],
   "opportunity_patterns":[
     pat("Travel Tech and Experience Platforms","Massive demand for booking, experience, and hospitality management technology.","high",["travel tech","hospitality SaaS","experience platforms"],["market_engine"]),
     pat("High-Spending Tourist Demographic","Wealthy tourists create premium spending opportunity in food, experiences, and luxury services.","high",["luxury experiences","premium services"],["revenue_engine"]),
     pat("Digital Nomad Economy","Growing remote worker community creates demand for co-working, long-stay accommodation, and services.","medium",["co-working","long-stay platforms"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Review Platform Reputation","Google, TripAdvisor, and Booking.com ratings are the primary trust mechanism.","high",["hospitality","tourism services"],["trust_engine"]),
     pat("Certification and Safety Standards","Safety certifications (diving, adventure sports) are critical trust signals.","medium",["adventure tourism","experiences"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("International Card and Forex Dominance","Tourism businesses must accept international cards and handle multiple currencies.","high",["hospitality","retail"],["payment_engine"]),
     pat("Cash Tip Economy","Service workers depend on cash tips; digital tipping adoption is slow.","medium",["hospitality operations"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Tourism Board Influence","National and regional tourism boards control destination marketing and standards.","medium",["hospitality businesses"],["institutional_engine"]),
     pat("Foreign Land Ownership Restrictions","Many tourism economies restrict foreign land ownership affecting property investment.","medium",["property-based tourism"],["regulatory_engine"])
   ],
   "narrative_patterns":[
     pat("Authentic Experience Narrative","Tourists respond to authentic, unique local experiences over generic international brands.","high",["hospitality marketing","experience design"],["narrative_engine"]),
     pat("Sustainability and Eco-Tourism","Growing segment of tourists actively seeking sustainable and responsible travel options.","medium",["eco-tourism","sustainable hospitality"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Airbnb and Booking.com Dominance","OTA platforms control primary distribution for accommodation.","high",["hospitality","short-term rental"],["platform_engine"]),
     pat("Viator and GetYourGuide for Experiences","Experience booking platforms control activity and tour distribution.","high",["tours","activities","experiences"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Tourist Visa and Entry Requirements","Complex visa requirements affect which markets visitors come from.","medium",["destination marketing"],["regulatory_engine"]),
     pat("Short-Term Rental Regulation","Airbnb-style regulations increasingly restrict short-term rental in popular destinations.","medium",["property rental","hospitality"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Pre-Trip Research and Booking","Tourists research and book months in advance; last-minute bookings are minority.","high",["booking platforms","travel tech"],["adoption_engine"]),
     pat("Experience Over Price","Premium experience quality justifies premium pricing for tourist segments.","high",["luxury hospitality","experiences"],["revenue_engine"])
   ],
   "business_model_fit":{"travel_tech":"high","hospitality_saas":"high","experience_platforms":"high","luxury_services":"high","ecommerce":"medium","consumer_apps":"medium","notes":"Ideal for travel technology, hospitality management, and tourism experience platforms."},
   "common_failure_modes":[
     pat("Seasonal Revenue Without Reserve","Not building sufficient financial reserves for low season leads to failure.","high",["small hospitality businesses"],["financial_engine"]),
     pat("Over-Reliance on Single OTA","Dependence on one booking platform creates existential vulnerability if algorithm changes.","high",["hospitality businesses"],["distribution_engine"])
   ],
   "common_success_patterns":[
     pat("Direct Booking Channel Investment","Building direct booking capability reduces OTA fee dependency.","high",["hospitality"],["revenue_engine"]),
     pat("Review Management as Core Function","Systematic review generation and response management becomes a core business function.","high",["all tourism businesses"],["reputation_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Multi-Seasonal Business Model","Design business to serve multiple tourist seasons or diversify into local market during low season.","high",["hospitality businesses"],["strategy_engine"]),
     pat("OTA Presence First, Direct Channel Second","Establish OTA presence first for initial bookings, then systematically build direct channel.","high",["accommodation","experiences"],["distribution_engine"])
   ],
   "source_notes":"Based on Thailand, Maldives, Jamaica, Croatia tourism market characteristics.",
   "schema_version":"A2"},

  # ── 11 ── Port Logistics ──────────────────────────────────────────────────
  {"economy_id":"eco_port_logistics","economy_type":"port_logistics",
   "name":"Port Logistics","display_name":"Port Logistics",
   "short_description":"Trade-centered economies built around shipping infrastructure, customs complexity, and global value chain integration.",
   "long_description":"Port logistics economies derive competitive advantage from geographic position and trade facilitation infrastructure. They serve as transshipment and distribution hubs for global commerce. Very high infrastructure reliability. Institutional strength in trade law and commercial arbitration is exceptional. Digital adoption for trade documentation is advancing rapidly.",
   "core_characteristic":"Trade-centered, shipping, customs complexity",
   "example_countries":["Singapore","Panama","Netherlands","UAE (Dubai)"],
   "countries":["Singapore","Panama","Netherlands","United Arab Emirates","Hong Kong"],
   "civilization_dna":{"trust_index":80,"authority_index":60,"corruption_index":20,"innovation_index":72,"digital_adoption_index":90,"education_index":80,"social_mobility_index":55,"bureaucracy_index":40,"stability_index":85,"information_freedom_index":78,"risk_tolerance_index":65,"community_dependence_index":45,"crime_pressure_index":22,"payment_reliability_index":92,"infrastructure_reliability_index":92,"institutional_strength_index":82,"media_volatility_index":55,"legal_predictability_index":82,"labor_reliability_index":78,"crisis_exposure_index":25,"adoption_friction_index":40,"social_proof_dependence_index":55,"reputation_fragility_index":70,"informal_network_strength_index":52,"future_change_velocity_index":72},
   "resistance_patterns":[
     pat("Incumbent Port Operator Dominance","Established port operators and freight forwarders control existing relationships.","high",["logistics tech","supply chain"],["competition_engine"]),
     pat("Complex Multi-Jurisdiction Compliance","Cross-border logistics involves multiple national regulatory systems simultaneously.","high",["trade tech","customs software"],["regulatory_engine"]),
     pat("Capital Intensity","Port and logistics infrastructure requires significant capital investment.","high",["physical logistics"],["financial_engine"])
   ],
   "opportunity_patterns":[
     pat("Trade Digitization Demand","Massive demand for digital trade documentation, customs clearance, and supply chain visibility.","high",["trade tech","customs SaaS","supply chain"],["market_engine"]),
     pat("Global Supply Chain Hub Role","Position as hub creates cross-border commerce opportunity with global reach.","high",["logistics platforms","fintech"],["market_engine"]),
     pat("Blockchain and Trade Finance","Trade finance digitization using distributed ledgers is actively pursued.","medium",["trade finance","blockchain"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Maritime and Trade Certification","IICL, ISO, and customs broker certifications are essential trust signals.","high",["logistics businesses"],["trust_engine"]),
     pat("Track Record of Customs Accuracy","Proven customs compliance record is critical for broker and forwarder trust.","high",["customs brokers","trade compliance"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Letter of Credit and Trade Finance","Trade finance instruments (LC, bank guarantees) dominate large shipment payments.","high",["international trade"],["payment_engine"]),
     pat("Multi-Currency Settlement","Routine multi-currency settlement in USD, EUR, SGD.","high",["trade businesses"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Port Authority as Regulator","Port authorities regulate operations, set tariffs, and control access.","high",["logistics businesses"],["regulatory_engine"]),
     pat("International Trade Treaties","Bilateral and multilateral trade agreements shape costs and market access.","high",["importers/exporters"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Efficiency and Speed Narrative","Trade businesses win on proven speed, reliability, and cost metrics.","high",["logistics tech"],["narrative_engine"]),
     pat("Green Shipping Narrative","Sustainability pressure from large shippers is driving green logistics demand.","medium",["shipping tech","logistics"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("CargoWise and TMS Platform Ecosystem","CargoWise and similar logistics management platforms are the dominant platform layer.","high",["logistics SaaS"],["platform_engine"]),
     pat("Port Community Systems","Port community systems (like PortNet) are mandatory integration points.","high",["trade tech"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Customs and Excise Compliance","Every shipment involves customs documentation, duties, and compliance requirements.","high",["any importer/exporter"],["regulatory_engine"]),
     pat("Cabotage Laws","Many countries restrict domestic shipping routes to national carriers.","medium",["shipping companies"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Reliability Over Price in Critical Shipments","For time-sensitive cargo, reliability trumps cost.","high",["premium logistics"],["adoption_engine"]),
     pat("Long-Term Shipper Relationships","Major shippers lock in preferred forwarder relationships for years.","high",["freight forwarding"],["retention_engine"])
   ],
   "business_model_fit":{"trade_tech":"high","logistics_saas":"high","supply_chain":"high","fintech_trade_finance":"high","b2b_enterprise":"high","consumer":"low","notes":"Ideal for trade technology, logistics platforms, and supply chain management."},
   "common_failure_modes":[
     pat("Underestimating Customs Complexity","Trade compliance requirements vary by route, product, and year.","high",["trade tech startups"],["regulatory_engine"]),
     pat("Wrong Integration Priority","Failing to integrate with existing TMS/Port systems limits adoption.","high",["logistics SaaS"],["platform_engine"])
   ],
   "common_success_patterns":[
     pat("Single Route Specialization","Winning one specific trade route completely before expanding.","high",["freight platforms"],["strategy_engine"]),
     pat("Customs Broker Partnership","Partnering with established customs brokers for compliance credibility.","high",["trade tech"],["trust_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Integrate with Existing TMS First","Build as an add-on to existing CargoWise or similar platforms.","high",["logistics SaaS"],["platform_engine"]),
     pat("One Port Deep Before Many Ports Wide","Win deep customer penetration in one major port before expanding.","high",["port tech"],["strategy_engine"])
   ],
   "source_notes":"Based on Singapore, Panama, Netherlands trade hub characteristics.",
   "schema_version":"A2"},

  # ── 12 ── State-Controlled Hybrid ─────────────────────────────────────────
  {"economy_id":"eco_state_controlled_hybrid","economy_type":"state_controlled_hybrid",
   "name":"State-Controlled Hybrid","display_name":"State-Controlled Hybrid",
   "short_description":"Government-directed economies with censorship, license requirements, and large state enterprise presence.",
   "long_description":"State-controlled hybrid economies combine market mechanisms with heavy state direction. The state controls key infrastructure, media, and strategic sectors. Private enterprise exists but operates within state-defined boundaries. Censorship and information control are active. Licenses and government approvals are required for many business activities. The opportunity is large but the operating model must accommodate state requirements.",
   "core_characteristic":"Government direction, censorship, licenses",
   "example_countries":["China","Vietnam","Laos"],
   "countries":["China","Vietnam","Laos"],
   "civilization_dna":{"trust_index":55,"authority_index":90,"corruption_index":55,"innovation_index":68,"digital_adoption_index":75,"education_index":72,"social_mobility_index":45,"bureaucracy_index":82,"stability_index":72,"information_freedom_index":20,"risk_tolerance_index":55,"community_dependence_index":65,"crime_pressure_index":35,"payment_reliability_index":70,"infrastructure_reliability_index":72,"institutional_strength_index":65,"media_volatility_index":15,"legal_predictability_index":45,"labor_reliability_index":72,"crisis_exposure_index":40,"adoption_friction_index":68,"social_proof_dependence_index":78,"reputation_fragility_index":70,"informal_network_strength_index":68,"future_change_velocity_index":65},
   "resistance_patterns":[
     pat("Mandatory Government Licensing","Operating in key sectors (media, education, finance, health) requires government license.","high",["edtech","fintech","media"],["regulatory_engine"]),
     pat("Data Localization and Censorship","Data must be stored locally; certain content and tools are blocked (VPN, Google, Meta).","high",["all digital businesses"],["infrastructure_engine"]),
     pat("State Enterprise Competition","SOEs compete in most sectors with preferential access to capital and contracts.","high",["B2B enterprise","infrastructure"],["competition_engine"])
   ],
   "opportunity_patterns":[
     pat("Massive Consumer Market","China is the world's largest consumer market; Vietnam and others are fast-growing.","high",["consumer apps","e-commerce","gaming"],["market_engine"]),
     pat("B2B Digital Transformation Demand","Hundreds of millions of SMEs digitizing operations create massive B2B SaaS demand.","high",["B2B SaaS","ERP","e-commerce tools"],["market_engine"]),
     pat("Manufacturing Tech Demand","World's largest manufacturing base creates industrial tech demand.","high",["manufacturing tech","IoT","quality systems"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Government Partnership as Trust Signal","Association with government programs or endorsement is the strongest trust signal.","high",["B2B enterprise","govtech"],["trust_engine"]),
     pat("WeChat and Alibaba Ecosystem Trust","Products within established super-app ecosystems inherit platform trust.","high",["consumer apps"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Alipay and WeChat Pay Dominance","China's mobile payment duopoly controls nearly all consumer transactions.","high",["consumer products China"],["payment_engine"]),
     pat("Domestic Invoice and Tax System","Complex VAT fapiao (invoice) system requires local accounting infrastructure.","high",["B2B operations in China"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Party Guidance over Law","CCP direction can override legal frameworks; political risk is ever-present.","high",["all businesses in China"],["institutional_engine"]),
     pat("National Standard Requirements","Products must often meet GB (Guobiao) national standards.","high",["hardware","food","consumer products"],["regulatory_engine"])
   ],
   "narrative_patterns":[
     pat("National Innovation and Self-Reliance","Xin Chuang (innovation) and domestic supply chain narratives resonate with government buyers.","high",["B2B tech","govtech"],["narrative_engine"]),
     pat("Harmony and Social Stability","Product narratives must avoid any implication of social conflict or political sensitivity.","high",["consumer products","media"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("WeChat Mini Program Ecosystem","WeChat Mini Programs are the primary distribution channel for consumer products.","high",["consumer apps China"],["platform_engine"]),
     pat("Alibaba / JD / Pinduoduo Commerce","Chinese e-commerce triopoloy controls consumer product distribution.","high",["e-commerce China"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("VIE Structure for Foreign Investment","Variable Interest Entity (VIE) structures required for foreign investment in restricted sectors.","high",["foreign investors"],["regulatory_engine"]),
     pat("Cybersecurity Law Compliance","Strict data storage, security review, and user privacy requirements.","high",["all digital businesses"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Social Commerce Dominance","Product discovery and purchase via live-streaming and social commerce is dominant.","high",["consumer products","e-commerce"],["adoption_engine"]),
     pat("Intense Price Competition","Multi-merchant platforms create intense downward price pressure.","high",["e-commerce","consumer products"],["revenue_engine"])
   ],
   "business_model_fit":{"ecommerce":"high","consumer_apps":"high","gaming":"high","manufacturing_tech":"high","b2b_saas":"high","saas_for_smes":"high","notes":"Largest consumer market globally, but requires full local compliance infrastructure."},
   "common_failure_modes":[
     pat("VIE Structure Collapse","Government policy changes can destabilize VIE structures used by foreign investors.","high",["foreign-funded businesses"],["regulatory_engine"]),
     pat("Platform Deplatforming","Regulatory crackdowns can remove apps or businesses from platforms overnight.","high",["edtech","gaming","fintech"],["platform_engine"])
   ],
   "common_success_patterns":[
     pat("Full Localization Including State Compliance","Companies that fully localize (including CCP compliance) succeed; those that resist fail.","high",["any company in China"],["strategy_engine"]),
     pat("Super-App Integration","Building within WeChat or Alibaba ecosystem provides distribution at scale.","high",["consumer apps"],["platform_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Joint Venture with State-Linked Entity","JV with a state-linked company provides regulatory cover and market access.","high",["foreign companies entering China"],["regulatory_engine"]),
     pat("Local Entity with Full ICP and Data Compliance","Establish Chinese legal entity, obtain ICP license, and implement PIPL compliance first.","high",["any digital business"],["regulatory_engine"])
   ],
   "source_notes":"Based on China, Vietnam, Laos market characteristics.",
   "schema_version":"A2"},

  # ── 13 ── Agricultural Labor ──────────────────────────────────────────────
  {"economy_id":"eco_agricultural_labor","economy_type":"agricultural_labor",
   "name":"Agricultural Labor","display_name":"Agricultural Labor",
   "short_description":"Rural, climate-dependent economies with low purchasing power, strong community bonds, and subsistence-oriented markets.",
   "long_description":"Agricultural labor economies depend primarily on smallholder farming, with most of the population in rural areas with limited access to formal financial services, reliable internet, or stable power. Community networks are the primary social and economic infrastructure. The opportunity for technology is in agricultural productivity, health, financial inclusion, and connectivity — but execution complexity is extreme.",
   "core_characteristic":"Rural, climate-dependent, low purchasing power",
   "example_countries":["Niger","Chad","Mali","Uganda","Malawi"],
   "countries":["Niger","Chad","Mali","Uganda","Malawi","Burkina Faso","South Sudan (stable zones)","Mozambique","Guinea","Central African Republic"],
   "civilization_dna":{"trust_index":48,"authority_index":58,"corruption_index":65,"innovation_index":28,"digital_adoption_index":25,"education_index":30,"social_mobility_index":28,"bureaucracy_index":62,"stability_index":40,"information_freedom_index":45,"risk_tolerance_index":45,"community_dependence_index":85,"crime_pressure_index":52,"payment_reliability_index":20,"infrastructure_reliability_index":22,"institutional_strength_index":30,"media_volatility_index":40,"legal_predictability_index":32,"labor_reliability_index":52,"crisis_exposure_index":72,"adoption_friction_index":75,"social_proof_dependence_index":80,"reputation_fragility_index":55,"informal_network_strength_index":82,"future_change_velocity_index":35},
   "resistance_patterns":[
     pat("No Reliable Digital Infrastructure","Mobile internet is unavailable or unaffordable for most of the target population.","high",["all digital businesses"],["infrastructure_engine"]),
     pat("Near-Zero Formal Payment Penetration","Bank accounts and mobile money are unavailable or unused by most of the population.","high",["fintech","subscription businesses"],["payment_engine"]),
     pat("Climate and Harvest Volatility","Agricultural income is seasonal and unpredictable; spending follows harvest cycles.","high",["consumer products","fintech"],["financial_engine"])
   ],
   "opportunity_patterns":[
     pat("Agricultural Productivity Technology","Tools that increase crop yield or reduce post-harvest loss have massive demand at scale.","high",["agritech","input supply","advisory services"],["market_engine"]),
     pat("Village-Level Distribution Networks","Established village-level agent networks can distribute physical and digital products.","medium",["agritech","FMCG","financial services"],["distribution_engine"]),
     pat("Mobile Money First Entry","Mobile money (M-Pesa variants) are fastest-growing financial channel.","medium",["fintech","payments"],["adoption_engine"])
   ],
   "trust_mechanisms":[
     pat("Community Elder Endorsement","Village elders and community leaders endorsing a product is more powerful than any marketing.","high",["agritech","health products"],["trust_engine"]),
     pat("Demonstration at Village Level","Physical product demonstrations at community gatherings build adoption.","high",["agritech","health products"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Harvest-Cycle Payment Timing","Payments must be timed to post-harvest income periods.","high",["agritech","microfinance"],["payment_engine"]),
     pat("Mobile Money Where Available","M-Pesa, Airtel Money are the primary formal payment channels when available.","medium",["fintech","subscription services"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("NGO and Aid Organization Influence","NGOs and international development organizations are major service delivery channels.","high",["health tech","agritech","edtech"],["institutional_engine"]),
     pat("Government Extension Services","Agricultural ministries run extension worker programs that can be co-opted for distribution.","medium",["agritech"],["distribution_engine"])
   ],
   "narrative_patterns":[
     pat("Community Upliftment Narrative","Products that visibly improve community welfare gain trust rapidly.","high",["agritech","health","education"],["narrative_engine"]),
     pat("Local Language Essential","Products in local languages (Hausa, Bambara, Luganda) are dramatically more trusted.","high",["consumer apps","agritech"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("SMS and USSD Platforms","Many products must work over SMS or USSD since smartphones are minority.","high",["fintech","agritech","health"],["platform_engine"]),
     pat("Radio and Oral Communication","Radio remains a primary information distribution channel.","medium",["awareness campaigns"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Informal Land Tenure","Land rights are often informal, creating complications for collateral and property-based products.","high",["agritech","fintech"],["regulatory_engine"]),
     pat("Weak Contract Enforcement","Contract enforcement through formal legal channels is slow and unreliable.","medium",["B2B","lending"],["legal_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Group Decision Making","Purchase decisions are often made by household or community groups, not individuals.","high",["consumer products","agritech"],["adoption_engine"]),
     pat("Trusted Neighbor as Reference","A trusted neighbor's endorsement is the primary driver of product adoption.","high",["consumer products","fintech"],["adoption_engine"])
   ],
   "business_model_fit":{"agritech":"high","last_mile_distribution":"high","health_tech":"medium","microfinance":"medium","sms_based_services":"high","notes":"Requires radical simplification and community distribution. Not viable for complex digital products."},
   "common_failure_modes":[
     pat("Smartphone-Dependent Product Design","Building products that require smartphones when target users have feature phones.","high",["most tech startups"],["adoption_engine"]),
     pat("NGO Dependency Without Commercial Model","Projects funded by aid grants fail to develop commercial sustainability.","high",["social enterprises"],["financial_engine"])
   ],
   "common_success_patterns":[
     pat("Agent Network Distribution","Training local agents as distribution intermediaries dramatically increases reach.","high",["agritech","fintech","FMCG"],["distribution_engine"]),
     pat("USSD-First Product Design","Designing for USSD/SMS first ensures maximum market penetration.","high",["fintech","advisory services"],["adoption_engine"])
   ],
   "recommended_entry_strategies":[
     pat("NGO or Government Partnership Entry","Partner with an established NGO or government program for initial distribution.","high",["market entry"],["institutional_engine"]),
     pat("Village Champion Program","Identify and train influential community members as product champions.","high",["agritech","health"],["adoption_engine"])
   ],
   "source_notes":"Based on Niger, Chad, Mali, Uganda, Malawi agricultural economy characteristics.",
   "schema_version":"A2"},

  # ── 14 ── Informal Cash ───────────────────────────────────────────────────
  {"economy_id":"eco_informal_cash","economy_type":"informal_cash",
   "name":"Informal Cash","display_name":"Informal Cash",
   "short_description":"Trust-based, cash-dominant economies where community networks and mobile money bridge formal and informal commerce.",
   "long_description":"Informal cash economies operate primarily outside formal financial systems. Cash and community trust are the primary transaction mechanisms. Mobile money (M-Pesa, Orange Money) is growing rapidly and creating bridges to formal commerce. Business is highly relationship-driven. Corruption is present but navigable. The informal sector is often 40-60% of GDP. Innovation happens fast at the grassroots level.",
   "core_characteristic":"Trust-based, cash-dominant, community-driven",
   "example_countries":["Nigeria","Kenya","Ghana","Haiti"],
   "countries":["Nigeria","Kenya","Ghana","Haiti","Tanzania","Senegal","Côte d'Ivoire","Cameroon"],
   "civilization_dna":{"trust_index":45,"authority_index":42,"corruption_index":65,"innovation_index":55,"digital_adoption_index":55,"education_index":52,"social_mobility_index":48,"bureaucracy_index":60,"stability_index":45,"information_freedom_index":58,"risk_tolerance_index":65,"community_dependence_index":82,"crime_pressure_index":62,"payment_reliability_index":28,"infrastructure_reliability_index":40,"institutional_strength_index":35,"media_volatility_index":65,"legal_predictability_index":35,"labor_reliability_index":58,"crisis_exposure_index":65,"adoption_friction_index":68,"social_proof_dependence_index":80,"reputation_fragility_index":62,"informal_network_strength_index":88,"future_change_velocity_index":60},
   "resistance_patterns":[
     pat("Financial Infrastructure Gaps","Bank accounts are unavailable, unreliable, or distrusted by large portions of the population.","high",["fintech","subscription services"],["payment_engine"]),
     pat("Electricity and Internet Unreliability","Power outages and expensive mobile data create digital access barriers.","high",["all digital products"],["infrastructure_engine"]),
     pat("Trust Deficit with Formal Institutions","Historical exploitation by banks and institutions creates resistance to formal services.","high",["fintech","insurance","credit"],["trust_engine"])
   ],
   "opportunity_patterns":[
     pat("Mobile Money Explosive Growth","M-Pesa, Flutterwave, and mobile money systems creating new financial rails at speed.","high",["fintech","payments","remittance"],["adoption_engine"]),
     pat("Massive Underserved SME Market","Millions of informal businesses need basic accounting, credit, and digital tools.","high",["B2B SME tools","fintech","SAAS"],["market_engine"]),
     pat("Remittance Economy","Large diaspora sending remittances home creates fintech and conversion opportunity.","high",["remittance tech","cross-border payments"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Susu and Community Savings Groups","Community savings groups (Susu, Chama, Tontine) are primary trust frameworks.","high",["fintech","microfinance","savings"],["trust_engine"]),
     pat("Community Influencer Endorsement","Local pastors, market leaders, and community figures are highest-trust endorsers.","high",["consumer products","fintech"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Mobile Money First","M-Pesa (Kenya), Flutterwave/Paystack (Nigeria), Orange Money dominate where available.","high",["consumer products","B2B SME"],["payment_engine"]),
     pat("Cash as Default","Cash remains the default for many transactions; any product must accommodate cash collection.","high",["consumer products","logistics"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Informal Markets as Real Markets","Oshodi (Lagos), Gikomba (Nairobi) and similar markets operate as independent economic systems.","high",["B2B SME","supply chain"],["institutional_engine"]),
     pat("Mobile Network Operators as Infrastructure","MTN, Airtel, and Safaricom are the primary infrastructure providers for digital services.","high",["fintech","consumer apps"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Hustle and Self-Reliance Narrative","Narratives of entrepreneurial hustle and community resilience resonate deeply.","high",["consumer products","B2B SME"],["narrative_engine"]),
     pat("Local Language and Pidgin Trust","Communication in local language or Pidgin dramatically increases trust.","high",["consumer products","fintech"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("WhatsApp Business Ecosystem","WhatsApp is the dominant business and consumer communication channel.","high",["all distribution"],["platform_engine"]),
     pat("Jumia and Local Marketplaces","Jumia and local marketplace apps growing as distribution infrastructure.","medium",["consumer products","e-commerce"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Central Bank of Nigeria / CBK Oversight","Financial regulations are strict and evolving rapidly, with frequent policy changes.","high",["fintech Nigeria/Kenya"],["regulatory_engine"]),
     pat("Informal Sector Tax Evasion Risk","Operating in informal economy creates tax compliance complexity when formalizing.","medium",["SME B2B tools"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Community Proof Required","No one tries a new product without hearing about it from multiple trusted community members.","high",["consumer products","fintech"],["adoption_engine"]),
     pat("Price Sensitivity Extreme","Unit economics must work at very low transaction sizes and margins.","high",["fintech","consumer apps"],["revenue_engine"])
   ],
   "business_model_fit":{"mobile_fintech":"high","sme_tools":"high","remittance":"high","agritech":"high","consumer_apps":"medium","ecommerce":"medium","b2b_enterprise":"low","notes":"Best for mobile fintech, SME tools, remittance, and agritech."},
   "common_failure_modes":[
     pat("Underestimating Trust Building Time","Assuming product quality alone will drive adoption; ignoring community trust mechanics.","high",["consumer apps","fintech"],["trust_engine"]),
     pat("Internet-Only Product for Offline Market","Building internet-dependent products for markets with expensive or unreliable data.","high",["consumer apps"],["infrastructure_engine"])
   ],
   "common_success_patterns":[
     pat("Leveraging Existing Trust Networks","Integrating with Susu groups, market associations, and church networks for distribution.","high",["fintech","consumer products"],["distribution_engine"]),
     pat("Offline-First Design","Products that work without constant internet connection adopt dramatically faster.","high",["fintech","SME tools"],["adoption_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Mobile Money Integration as Foundation","Integrate with M-Pesa or Flutterwave before building other product features.","high",["any product needing payments"],["payment_engine"]),
     pat("Agent Network for Initial Distribution","Use existing agent networks (airtime sellers, market vendors) as distribution points.","high",["consumer products","fintech"],["distribution_engine"])
   ],
   "source_notes":"Based on Nigeria, Kenya, Ghana, Haiti informal economy characteristics.",
   "schema_version":"A2"},

  # ── 15 ── Aid Dependent ───────────────────────────────────────────────────
  {"economy_id":"eco_aid_dependent","economy_type":"aid_dependent",
   "name":"Aid Dependent","display_name":"Aid Dependent",
   "short_description":"Economies reliant on external donor funding with weak institutions, aid cycles, and development program infrastructure.",
   "long_description":"Aid-dependent economies have insufficient domestic revenue to fund basic public services. International organizations (UN, World Bank, NGOs) provide a significant fraction of GDP. Institutional capacity is very low. Business environment is largely shaped by donor funding cycles. The aid economy itself creates a market — for health commodities, food supply, logistics, communications, and data management — but sustainability is always dependent on continued external funding.",
   "core_characteristic":"External funding, weak institutions, donor cycles",
   "example_countries":["South Sudan","Somalia","Yemen","DRC (conflict zones)"],
   "countries":["South Sudan","Somalia","Yemen","Democratic Republic of Congo (aid zones)","Afghanistan (humanitarian zones)","Central African Republic"],
   "civilization_dna":{"trust_index":28,"authority_index":35,"corruption_index":75,"innovation_index":22,"digital_adoption_index":22,"education_index":22,"social_mobility_index":18,"bureaucracy_index":50,"stability_index":22,"information_freedom_index":35,"risk_tolerance_index":35,"community_dependence_index":78,"crime_pressure_index":75,"payment_reliability_index":15,"infrastructure_reliability_index":18,"institutional_strength_index":18,"media_volatility_index":30,"legal_predictability_index":18,"labor_reliability_index":30,"crisis_exposure_index":88,"adoption_friction_index":80,"social_proof_dependence_index":72,"reputation_fragility_index":52,"informal_network_strength_index":72,"future_change_velocity_index":28},
   "resistance_patterns":[
     pat("Aid Cycle Dependency","Funding arrives in unpredictable cycles; budgets collapse when donor priorities shift.","high",["NGO tech","humanitarian tools"],["financial_engine"]),
     pat("Institutional Void","Government institutions exist on paper but lack capacity to enforce rules or deliver services.","high",["all businesses"],["institutional_engine"]),
     pat("Security Risk to Operations","Active conflict or insecurity forces periodic evacuation and operational disruption.","high",["field operations","logistics"],["crisis_engine"])
   ],
   "opportunity_patterns":[
     pat("Humanitarian Tech Demand","UNHCR, WFP, MSF, and hundreds of NGOs require technology for distribution, tracking, and communication.","high",["humanitarian tech","logistics","data platforms"],["market_engine"]),
     pat("Diaspora Connection","Large diasporas remit funds home and have interest in development solutions.","medium",["remittance tech","diaspora platforms"],["market_engine"]),
     pat("First-Time Digitization","Basic digital tools (registration, ID, health records) have extremely high impact.","high",["govtech","health tech","ID systems"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("UN Agency Endorsement","UN agency approval or USAID compliance creates trust with local actors.","high",["humanitarian tools"],["trust_engine"]),
     pat("Community Liaison System","Working through local community liaison officers builds grassroots trust.","medium",["field operations"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Donor Wire Transfers","Revenue flows through donor wire transfers with strict disbursement requirements.","high",["humanitarian tech"],["payment_engine"]),
     pat("Cash Programming Dominant","Cash transfers to beneficiaries (not digital payment) remain dominant.","high",["financial services","distribution"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("UN Coordination Cluster System","UN clusters (health, logistics, food) coordinate all major humanitarian operations.","high",["humanitarian tech"],["institutional_engine"]),
     pat("Donor Reporting Requirements","All funded work requires extensive reporting to satisfy donor compliance.","high",["NGO tools","humanitarian SaaS"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Impact Measurement Narrative","Quantifiable impact metrics are essential for donor communication and renewal.","high",["humanitarian tech","NGO tools"],["narrative_engine"]),
     pat("Do No Harm Principle","Any product or service must demonstrably avoid causing harm to vulnerable populations.","high",["all humanitarian tech"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Kobo Toolbox and ODK Data Collection","Open-source data collection tools dominate field data gathering.","high",["field data tools","M&E"],["platform_engine"]),
     pat("Satellite Internet Where Available","Starlink and VSAT are primary internet infrastructure in conflict zones.","medium",["communications","remote operations"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("NGO Registration and Operating Permits","NGOs must register with host government ministries and maintain operating permits.","medium",["all NGOs"],["regulatory_engine"]),
     pat("Export Controls on Equipment","Satellite phones, encryption devices, and some tech require export clearances.","medium",["communications tech","field equipment"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("UN Procurement Process","Major sales happen through UNHCR, UNICEF, or WFP procurement processes (long, complex).","high",["humanitarian tech B2B"],["adoption_engine"]),
     pat("Field Staff as Decision Influencers","Frontline field staff using tools advocate for or against products within their organizations.","medium",["field tech","data tools"],["adoption_engine"])
   ],
   "business_model_fit":{"humanitarian_tech":"high","ngo_tools":"high","health_logistics":"high","data_platforms":"high","field_operations":"high","consumer":"low","notes":"Only viable for humanitarian sector B2B and field operations technology."},
   "common_failure_modes":[
     pat("Commercial Revenue Without Donor Exit Plan","Building commercial model that can't survive without donor funding.","high",["humanitarian startups"],["financial_engine"]),
     pat("Security Incident Closure","Operations closed due to security incidents with no recovery plan.","high",["field operations"],["crisis_engine"])
   ],
   "common_success_patterns":[
     pat("UN Agency as Anchor Customer","Securing a UN agency long-term contract as anchor before seeking commercial revenue.","high",["humanitarian SaaS"],["strategy_engine"]),
     pat("Remote-First Operations","Designing products and operations that require minimal physical presence.","high",["humanitarian tech"],["execution_engine"])
   ],
   "recommended_entry_strategies":[
     pat("OCHA or Cluster Partnership","Enter through UN OCHA or specific coordination clusters as first distribution channel.","high",["humanitarian tech"],["institutional_engine"]),
     pat("Open Source with Paid Support Model","Open source core with paid technical support or customization services.","high",["field data tools","information management"],["revenue_engine"])
   ],
   "source_notes":"Based on South Sudan, Somalia, Yemen aid economy characteristics.",
   "schema_version":"A2"},

  # ── 16 ── Corruption Heavy ────────────────────────────────────────────────
  {"economy_id":"eco_corruption_heavy","economy_type":"corruption_heavy",
   "name":"Corruption Heavy","display_name":"Corruption Heavy",
   "short_description":"Economies where informal power networks, bribery, and elite capture define business outcomes.",
   "long_description":"Corruption-heavy economies are characterized by systematic informal payments, selective law enforcement, and elite capture of regulatory mechanisms. Formal rules exist but are inconsistently applied based on political connections. Business success depends heavily on having the right protection relationships. Markets are real but require navigating parallel informal power structures.",
   "core_characteristic":"Bribery, elite networks, selective enforcement",
   "example_countries":["Russia","Venezuela","Zimbabwe"],
   "countries":["Russia","Venezuela","Zimbabwe","Belarus","Turkmenistan","Eritrea"],
   "civilization_dna":{"trust_index":32,"authority_index":72,"corruption_index":85,"innovation_index":45,"digital_adoption_index":65,"education_index":60,"social_mobility_index":25,"bureaucracy_index":78,"stability_index":40,"information_freedom_index":30,"risk_tolerance_index":48,"community_dependence_index":65,"crime_pressure_index":72,"payment_reliability_index":45,"infrastructure_reliability_index":55,"institutional_strength_index":28,"media_volatility_index":25,"legal_predictability_index":25,"labor_reliability_index":52,"crisis_exposure_index":68,"adoption_friction_index":65,"social_proof_dependence_index":68,"reputation_fragility_index":58,"informal_network_strength_index":78,"future_change_velocity_index":42},
   "resistance_patterns":[
     pat("Informal Tax on Business","Demands for unofficial payments ('krisha' protection) are common across sectors.","high",["all businesses"],["financial_engine"]),
     pat("Selective Law Enforcement","Laws are applied inconsistently depending on political connections of parties involved.","high",["all businesses"],["legal_engine"]),
     pat("Asset Seizure Risk","Successful businesses can attract state or criminal interest leading to asset nationalization or extortion.","high",["foreign and domestic businesses"],["crisis_engine"])
   ],
   "opportunity_patterns":[
     pat("Shadow Economy Services","Large informal economy creates demand for services that operate outside official channels.","medium",["fintech","logistics","services"],["market_engine"]),
     pat("Consumer Tech in Urban Centers","Well-educated urban populations with spending power adopt consumer tech readily.","medium",["consumer apps","e-commerce"],["adoption_engine"]),
     pat("Tech Talent at Discount","Highly educated technical talent available at below-market rates due to economic dysfunction.","high",["software development","engineering"],["talent_engine"])
   ],
   "trust_mechanisms":[
     pat("Protection Relationship Network","Business is conducted through mutual protection agreements with influential actors.","high",["any business"],["trust_engine"]),
     pat("Reputation in Informal Networks","Word-of-mouth reputation within informal business networks is the primary trust mechanism.","high",["B2B SME"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Cash and Crypto to Avoid Tracking","Cash and cryptocurrency are preferred to avoid taxation and scrutiny.","high",["all businesses"],["payment_engine"]),
     pat("Barter and Mutual Exchange","Goods and services exchanged directly to avoid formal payment channels.","medium",["B2B SME"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Oligarch and Elite Network Capture","Key sectors controlled by politically connected elites who extract rents.","high",["all major sectors"],["institutional_engine"]),
     pat("Regulatory Arbitrage by Insiders","Connected actors exploit regulatory gaps unavailable to outsiders.","medium",["regulated sectors"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Low Profile Survival Narrative","Successful businesses avoid publicity to prevent attracting official or criminal attention.","high",["all businesses"],["narrative_engine"]),
     pat("Nationalist Alignment","Aligning product with national loyalty narratives reduces political risk.","medium",["B2B","consumer brands"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Telegram Business Ecosystem","Telegram is primary secure business and community communication channel.","high",["all businesses"],["platform_engine"]),
     pat("State-Controlled Payment Rails","Payment systems are monitored by state; transaction data can be accessed by authorities.","high",["fintech","any payments"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Law as Weapon","Legal system can be weaponized against competitors or foreign businesses.","high",["all businesses"],["regulatory_engine"]),
     pat("License Denials for Political Reasons","Operating licenses in key sectors can be denied or revoked for political reasons.","high",["regulated sectors"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Distrust of Formal Products","Decades of institutional betrayal create strong preference for proven informal solutions.","high",["formal sector products"],["adoption_engine"]),
     pat("Cash Hoarding and Parallel Currency","Consumers store value in foreign currency and hard assets rather than domestic banks.","high",["fintech","savings products"],["revenue_engine"])
   ],
   "business_model_fit":{"b2b_informal":"medium","consumer_tech":"medium","services":"medium","notes":"Only viable for operators who deeply understand informal power dynamics. Formal business models face existential risk."},
   "common_failure_modes":[
     pat("Attracting Elite Attention by Success","Becoming too successful makes a business target for appropriation by powerful actors.","high",["all businesses"],["crisis_engine"]),
     pat("Formal Legal Route to Dispute Resolution","Attempting to use courts against politically connected actors fails.","high",["foreign businesses"],["legal_engine"])
   ],
   "common_success_patterns":[
     pat("Operate Under Radar","Deliberately keeping company size and profile small to avoid attracting attention.","high",["SME businesses"],["strategy_engine"]),
     pat("Protection Relationship Investment","Investing in relationships with key political and law enforcement figures.","high",["large businesses"],["network_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Do Not Enter Without Local Protection Partner","Never enter without a well-connected local partner who has genuine protection relationships.","high",["all foreign entrants"],["strategy_engine"]),
     pat("Asset-Light Model","Avoid physical asset ownership that could be seized; use services and software.","high",["tech businesses"],["execution_engine"])
   ],
   "source_notes":"Based on Russia, Venezuela, Zimbabwe corruption economy characteristics.",
   "schema_version":"A2"},

  # ── 17 ── Infrastructure Deficient ────────────────────────────────────────
  {"economy_id":"eco_infrastructure_deficient","economy_type":"infrastructure_deficient",
   "name":"Infrastructure Deficient","display_name":"Infrastructure Deficient",
   "short_description":"Economies where unreliable power, roads, internet, and logistics create severe execution friction.",
   "long_description":"Infrastructure-deficient economies have failed to build the basic operational infrastructure that other markets take for granted. Power cuts are daily occurrences. Road networks are impassable in rainy season. Internet penetration is low and expensive. Logistics are slow and unreliable. Every business must account for massive infrastructure overhead. The opportunity exists primarily for products that solve these infrastructure problems or work completely within infrastructure constraints.",
   "core_characteristic":"Unreliable power, roads, internet, logistics",
   "example_countries":["Liberia","Central African Republic","Madagascar"],
   "countries":["Liberia","Central African Republic","Madagascar","Sierra Leone","Guinea-Bissau","Comoros"],
   "civilization_dna":{"trust_index":42,"authority_index":50,"corruption_index":68,"innovation_index":25,"digital_adoption_index":22,"education_index":28,"social_mobility_index":25,"bureaucracy_index":62,"stability_index":38,"information_freedom_index":42,"risk_tolerance_index":42,"community_dependence_index":80,"crime_pressure_index":62,"payment_reliability_index":15,"infrastructure_reliability_index":10,"institutional_strength_index":25,"media_volatility_index":35,"legal_predictability_index":28,"labor_reliability_index":42,"crisis_exposure_index":78,"adoption_friction_index":80,"social_proof_dependence_index":78,"reputation_fragility_index":52,"informal_network_strength_index":80,"future_change_velocity_index":30},
   "resistance_patterns":[
     pat("Power Outage Operations Disruption","Daily power cuts of 8-16 hours destroy any business model that requires continuous electricity.","high",["all digital businesses"],["infrastructure_engine"]),
     pat("Last-Mile Logistics Impossibility","Road conditions make reliable delivery to most of the country impossible.","high",["e-commerce","logistics","supply chain"],["infrastructure_engine"]),
     pat("Data Cost Barrier","Mobile data costs are 5-20x higher as % of income compared to developed markets.","high",["digital products","consumer apps"],["infrastructure_engine"])
   ],
   "opportunity_patterns":[
     pat("Infrastructure Gap Filling","Products that solve the infrastructure deficit (solar power, offline apps, logistics coordination) have massive demand.","high",["solar tech","offline apps","logistics"],["market_engine"]),
     pat("Leapfrog Technology Adoption","No legacy system to protect means rapid adoption of appropriate technology.","medium",["mobile payments","satellite internet","solar"],["adoption_engine"]),
     pat("Low Competition Landscape","Few formal businesses operate; those that solve real problems have limited competition.","high",["essential services","logistics","fintech"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Physical Presence and Reliability","Simply showing up consistently is a major trust differentiator in unreliable environments.","high",["all businesses"],["trust_engine"]),
     pat("Community Network Vouching","Community networks are the only reliable trust transmission mechanism.","high",["consumer products","services"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Mobile Money as Primary Rail","Orange Money, Airtel Money growing as primary formal payment channels.","medium",["fintech","consumer products"],["payment_engine"]),
     pat("Barter and Informal Exchange","Significant proportion of transactions use barter or informal goods exchange.","medium",["rural markets"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("NGO as Primary Service Provider","NGOs deliver health, education, and infrastructure services state cannot provide.","high",["health tech","edtech"],["institutional_engine"]),
     pat("Customary Law Over Formal Law","Community-based customary law often more effective than formal legal system.","medium",["contracts","dispute resolution"],["legal_engine"])
   ],
   "narrative_patterns":[
     pat("Solving Daily Suffering","Products that visibly reduce daily suffering (power, water, connectivity) have instant narrative value.","high",["energy tech","WASH","connectivity"],["narrative_engine"]),
     pat("International Donor Legitimacy","UN, World Bank, or bilateral donor association provides external credibility.","high",["B2B humanitarian","NGO tools"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("SMS and Radio Primary Channels","SMS and community radio remain primary mass communication channels.","high",["mass awareness","fintech"],["platform_engine"]),
     pat("Facebook as Internet for Many","Facebook Basics and WhatsApp function as primary internet for many users.","medium",["consumer apps"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Regulatory Capacity Absence","Governments lack capacity to enforce regulations; compliance is largely voluntary.","medium",["all businesses"],["regulatory_engine"]),
     pat("International Standards Required by Donors","Products funded by donors must meet international standards (WASH, medical devices).","high",["NGO tools","health tech"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Survival Spending Priority","Spending decisions dominated by immediate survival needs before any discretionary purchasing.","high",["consumer products"],["adoption_engine"]),
     pat("Product Must Work in Conditions","Any product must function without reliable power, internet, or logistics support.","high",["all products"],["adoption_engine"])
   ],
   "business_model_fit":{"energy_tech":"high","last_mile_logistics":"high","offline_tools":"high","humanitarian_tech":"high","agritech":"medium","consumer_apps":"low","notes":"Only viable with radically simplified, offline-capable, resilient product design."},
   "common_failure_modes":[
     pat("Assuming Smartphone Connectivity","Building any product that requires reliable internet access.","high",["all digital startups"],["adoption_engine"]),
     pat("Underestimating Generator and Solar Costs","Not factoring infrastructure costs into unit economics.","high",["all businesses"],["financial_engine"])
   ],
   "common_success_patterns":[
     pat("Solar Plus Digital Bundle","Combining solar power with digital access creates bundled infrastructure solution.","high",["energy tech","edtech"],["market_engine"]),
     pat("Batch Processing Design","Systems that process data in batches when connectivity is available, not real-time.","high",["data tools","field apps"],["adoption_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Partner with Energy Provider","Partner with solar or generator supplier to bundle access to power.","high",["any product requiring power"],["distribution_engine"]),
     pat("Radical Simplification First","Strip product to absolute minimum viable function before worrying about features.","high",["all products"],["strategy_engine"])
   ],
   "source_notes":"Based on Liberia, CAR, Madagascar infrastructure characteristics.",
   "schema_version":"A2"},

  # ── 18 ── Urban Poverty ────────────────────────────────────────────────────
  {"economy_id":"eco_urban_poverty","economy_type":"urban_poverty",
   "name":"Urban Poverty","display_name":"Urban Poverty",
   "short_description":"Dense urban slums and informal settlements with survival spending, high social density, and community resilience.",
   "long_description":"Urban poverty economies exist within larger urban economies but in informal settlements, slums, and low-income neighborhoods where formal economic infrastructure barely reaches. These areas have high population density, complex social networks, and significant social entrepreneurship energy. Smartphone penetration is moderate. The challenge is income levels, not ambition.",
   "core_characteristic":"Dense cities, survival spending, high social pressure",
   "example_countries":["Parts of Mumbai and Dhaka","Jakarta kampungs","Nairobi slums"],
   "countries":["Dense urban areas of India","Bangladesh","Indonesia","Kenya","Nigeria","Philippines"],
   "civilization_dna":{"trust_index":45,"authority_index":52,"corruption_index":60,"innovation_index":42,"digital_adoption_index":48,"education_index":42,"social_mobility_index":30,"bureaucracy_index":65,"stability_index":42,"information_freedom_index":52,"risk_tolerance_index":52,"community_dependence_index":82,"crime_pressure_index":68,"payment_reliability_index":25,"infrastructure_reliability_index":38,"institutional_strength_index":35,"media_volatility_index":60,"legal_predictability_index":35,"labor_reliability_index":52,"crisis_exposure_index":72,"adoption_friction_index":72,"social_proof_dependence_index":78,"reputation_fragility_index":58,"informal_network_strength_index":82,"future_change_velocity_index":45},
   "resistance_patterns":[
     pat("Income Below Viable Threshold","Most residents cannot afford any non-essential spending; unit economics rarely work.","high",["consumer apps","subscription products"],["financial_engine"]),
     pat("Informal Settlement Legal Status","Land and property rights are informal; businesses operating in settlements lack legal protection.","high",["physical businesses","logistics"],["legal_engine"]),
     pat("Crime and Safety Risk","Crime rates are high; physical delivery, installation, or operations face real safety risk.","high",["logistics","field operations"],["crisis_engine"])
   ],
   "opportunity_patterns":[
     pat("Community Service Platforms","Dense populations sharing problems create demand for community-scaled solutions.","high",["health access","financial services","utilities"],["market_engine"]),
     pat("Micro-Entrepreneur Tooling","Large number of micro-entrepreneurs need affordable business tools, credit, and distribution.","high",["fintech","SME tools","FMCG distribution"],["market_engine"]),
     pat("Youth Talent Pool","Young, educated, and unemployed population is available for work at low cost.","high",["talent","customer support","field agents"],["talent_engine"])
   ],
   "trust_mechanisms":[
     pat("Community Leader Endorsement","Community associations, savings groups, and religious leaders are primary trust channels.","high",["all products"],["trust_engine"]),
     pat("Peer Group Demonstration","Product adoption happens in groups; one adopter in a peer group triggers cluster adoption.","high",["consumer products","fintech"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Daily Income Micro-Payments","Income arrives daily, so payment models must accommodate daily micro-payment sizes.","high",["fintech","subscription products"],["payment_engine"]),
     pat("Mobile Money Growing","M-Pesa, bKash, GoPay growing as primary formal payment rails.","medium",["fintech","consumer products"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Community Association Governance","Informal community associations (RWAs, market committees) are de facto local government.","high",["service businesses","B2B"],["institutional_engine"]),
     pat("State Welfare Programs","Government welfare programs (PDS, NREGA) are significant household income source.","medium",["financial services","consumer products"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Dignity and Aspiration","Products that help users achieve dignity and progress rather than highlighting poverty.","high",["consumer products","fintech"],["narrative_engine"]),
     pat("Neighborhood Success Story","Local success stories spread virally within communities.","high",["consumer products","fintech"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("WhatsApp Community Groups","WhatsApp groups function as primary community information and commerce channel.","high",["all distribution"],["platform_engine"]),
     pat("Kirana Network","Local small shop (kirana) networks function as last-mile distribution infrastructure.","high",["FMCG","consumer products"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Informal Settlement Lack of Address","No formal address system in many settlements; delivery and legal identity systems fail.","high",["e-commerce","financial services"],["regulatory_engine"]),
     pat("Eviction Risk for Physical Businesses","Government demolition programs can destroy physical business infrastructure overnight.","high",["physical businesses"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Value Above All Else","Every purchase is a serious trade-off against essential spending; value must be overwhelming.","high",["consumer products"],["adoption_engine"]),
     pat("Group Buying and Sharing","Products and services are often shared among multiple households.","medium",["consumer apps","utilities"],["adoption_engine"])
   ],
   "business_model_fit":{"micro_fintech":"high","community_services":"high","last_mile_distribution":"high","micro_savings":"high","consumer_apps":"low","saas":"low","notes":"Only viable with extreme cost optimization and community distribution model."},
   "common_failure_modes":[
     pat("Non-Essential Product at Non-Survival Price","Any product priced above survival budget fails regardless of quality.","high",["consumer products"],["financial_engine"]),
     pat("Middle-Class Product Design","Designing for middle-class use patterns and assuming low-income users will adapt.","high",["consumer apps","fintech"],["adoption_engine"])
   ],
   "common_success_patterns":[
     pat("Daily or Weekly Payment Model","Accepting daily or weekly micropayments rather than monthly or annual billing.","high",["fintech","subscription services"],["revenue_engine"]),
     pat("Community Agent Model","Training community members as paid agents to distribute and support products.","high",["consumer products","fintech"],["distribution_engine"])
   ],
   "recommended_entry_strategies":[
     pat("FMCG Distribution Partnership","Partner with FMCG companies that already have last-mile distribution to informal settlements.","high",["consumer products"],["distribution_engine"]),
     pat("Savings Group Integration","Integrate product with existing savings groups (Chama, SHG) for built-in distribution.","high",["fintech","micro-insurance"],["trust_engine"])
   ],
   "source_notes":"Based on urban poverty characteristics in India, Bangladesh, Indonesia, Kenya.",
   "schema_version":"A2"},

  # ── 19 ── Black Market War ────────────────────────────────────────────────
  {"economy_id":"eco_black_market_war","economy_type":"black_market_war",
   "name":"Black Market War","display_name":"Black Market War",
   "short_description":"Active conflict zones where underground commerce, smuggling, and survival economics dominate.",
   "long_description":"Black market war economies exist in active conflict zones where formal economic structures have collapsed. Commerce is dominated by smuggling, black market currency exchange, and informal armed actor taxation of trade routes. Population displacement is ongoing. Life and property are at daily risk. No viable commercial business model exists here except for humanitarian operations, communications infrastructure, and conflict-aware logistics.",
   "core_characteristic":"Conflict, smuggling, underground commerce",
   "example_countries":["Parts of Syria","Parts of Libya","Afghanistan conflict zones"],
   "countries":["Syria (active conflict zones)","Libya (militia-controlled areas)","Afghanistan (Taliban-controlled zones)","Parts of Yemen"],
   "civilization_dna":{"trust_index":18,"authority_index":25,"corruption_index":90,"innovation_index":18,"digital_adoption_index":28,"education_index":22,"social_mobility_index":12,"bureaucracy_index":35,"stability_index":8,"information_freedom_index":18,"risk_tolerance_index":42,"community_dependence_index":72,"crime_pressure_index":95,"payment_reliability_index":12,"infrastructure_reliability_index":10,"institutional_strength_index":10,"media_volatility_index":22,"legal_predictability_index":8,"labor_reliability_index":25,"crisis_exposure_index":98,"adoption_friction_index":72,"social_proof_dependence_index":65,"reputation_fragility_index":45,"informal_network_strength_index":75,"future_change_velocity_index":18},
   "resistance_patterns":[
     pat("Active Physical Security Threat","Staff, assets, and customers face daily physical security threats.","high",["all operations"],["crisis_engine"]),
     pat("Zero Institutional Infrastructure","Courts, banks, government agencies, and utilities have ceased to function.","high",["all businesses"],["institutional_engine"]),
     pat("Forced Taxation by Armed Actors","Armed groups impose levies on all commercial activity in territory they control.","high",["all physical businesses"],["financial_engine"])
   ],
   "opportunity_patterns":[
     pat("Humanitarian Communication Needs","Population needs communications, coordination, and access to information.","medium",["communications tech","messaging platforms"],["market_engine"]),
     pat("Diaspora Remittance Flow","Large displaced populations sending money home through hawala and informal channels.","medium",["remittance tech","hawala digitization"],["market_engine"]),
     pat("Post-Conflict Reconstruction Opportunity","Future reconstruction will require massive technology and infrastructure investment.","medium",["long-term planning only"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Armed Faction Protection","Business operates only with protection guarantee from dominant armed faction.","high",["physical businesses"],["trust_engine"]),
     pat("Hawala Network Trust","Centuries-old hawala trust network remains functional when all else collapses.","high",["remittance","cash transfer"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("USD Cash and Gold","Only USD cash and gold are stable value stores in active conflict.","high",["all transactions"],["payment_engine"]),
     pat("Hawala Informal Remittance","Hawala is the primary reliable cross-border value transfer mechanism.","high",["remittance","cross-border"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Armed Faction as De Facto Authority","Armed factions control territory and determine what business activities are permitted.","high",["all businesses"],["institutional_engine"]),
     pat("International Aid Coordination as Order","OCHA and UN coordination is often the only functioning coordination mechanism.","medium",["humanitarian operations"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Survival Communication","Communication about safety, location, and survival resources dominates all attention.","high",["all media"],["narrative_engine"]),
     pat("Resistance or Faction Identity","Business must align with or at least not threaten dominant faction identity.","high",["physical businesses"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Telegram for Secure Communication","Telegram is primary secure communication platform in conflict zones.","high",["all communications"],["platform_engine"]),
     pat("Satellite Internet for Connectivity","Starlink and VSAT are only reliable internet options.","medium",["field operations","communications"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("No Functioning Legal System","No functioning courts or enforcement mechanisms for commercial disputes.","high",["all businesses"],["regulatory_engine"]),
     pat("Sanctions Complexity","International sanctions may apply to transactions with certain factions or territories.","high",["international businesses"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Survival-Only Spending","All spending oriented toward immediate survival; no discretionary commerce.","high",["all consumer products"],["adoption_engine"]),
     pat("Armed Protection Required for Commerce","Market activities require protection arrangement with armed actors.","high",["physical markets"],["adoption_engine"])
   ],
   "business_model_fit":{"humanitarian_tech":"medium","communications":"medium","remittance":"medium","notes":"Extremely limited commercial opportunity. Only humanitarian and communications businesses viable."},
   "common_failure_modes":[
     pat("Assuming Rule of Law","Any business plan that assumes contracts, property rights, or legal protection will fail.","high",["all commercial businesses"],["legal_engine"]),
     pat("Staff Safety Miscalculation","Underestimating security risk leads to staff casualties and operation collapse.","high",["field operations"],["crisis_engine"])
   ],
   "common_success_patterns":[
     pat("Remote Operations Only","Technology operations that require zero physical presence.","high",["humanitarian tech","communications"],["strategy_engine"]),
     pat("Faction Neutrality","Maintaining strict neutrality between competing factions is critical for any operation.","high",["humanitarian operations"],["strategy_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Do Not Enter Without Security Plan","No commercial or humanitarian operation should enter without detailed security protocol.","high",["all organizations"],["crisis_engine"]),
     pat("Remote Technology Support Only","Support local operators remotely rather than deploying staff.","high",["technology providers"],["execution_engine"])
   ],
   "source_notes":"Based on Syria, Libya, Afghanistan conflict zone characteristics.",
   "schema_version":"A2"},

  # ── 20 ── Occupied Territory ──────────────────────────────────────────────
  {"economy_id":"eco_occupied_territory","economy_type":"occupied_territory",
   "name":"Occupied Territory","display_name":"Occupied Territory",
   "short_description":"Externally controlled territories with movement restrictions, permit systems, and suppressed economic autonomy.",
   "long_description":"Occupied territory economies face the challenge of operating under external political and military control. Freedom of movement is restricted. Permits are required for most commercial activities. Import/export is controlled by the occupying power. Despite this, internal economic resilience is significant, driven by community solidarity and parallel informal systems.",
   "core_characteristic":"External control, restricted movement, permits",
   "example_countries":["Palestinian territories (West Bank and Gaza)"],
   "countries":["Palestinian territories"],
   "civilization_dna":{"trust_index":30,"authority_index":25,"corruption_index":55,"innovation_index":38,"digital_adoption_index":55,"education_index":58,"social_mobility_index":18,"bureaucracy_index":75,"stability_index":12,"information_freedom_index":35,"risk_tolerance_index":52,"community_dependence_index":82,"crime_pressure_index":62,"payment_reliability_index":28,"infrastructure_reliability_index":30,"institutional_strength_index":18,"media_volatility_index":45,"legal_predictability_index":15,"labor_reliability_index":45,"crisis_exposure_index":92,"adoption_friction_index":72,"social_proof_dependence_index":75,"reputation_fragility_index":62,"informal_network_strength_index":82,"future_change_velocity_index":28},
   "resistance_patterns":[
     pat("Movement and Trade Restrictions","Physical movement of people and goods requires permits from occupying authorities.","high",["logistics","physical businesses"],["regulatory_engine"]),
     pat("Currency and Banking Dependency","Dependent on occupying power's currency and banking system; limited monetary autonomy.","high",["fintech","banking"],["payment_engine"]),
     pat("Infrastructure Destruction Risk","Infrastructure can be destroyed in military operations, eliminating business assets overnight.","high",["physical businesses"],["crisis_engine"])
   ],
   "opportunity_patterns":[
     pat("Digital Services Bypass Physical Restrictions","Software, digital services, and remote work bypass physical movement restrictions.","high",["software development","digital services"],["market_engine"]),
     pat("Diaspora Economic Connection","Large diaspora maintains economic links and remittance flows.","medium",["remittance","diaspora platforms"],["market_engine"]),
     pat("Tech Talent for Export","Highly educated population builds tech skills for export to global markets.","medium",["software development","remote work"],["talent_engine"])
   ],
   "trust_mechanisms":[
     pat("National Solidarity Network","Community solidarity is extremely high; trust within community is strong.","high",["all local businesses"],["trust_engine"]),
     pat("Family and Clan Networks","Extended family and clan networks are primary business trust frameworks.","high",["B2B","financial services"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Israeli Shekel and JD Dependency","Primary currency depends on occupying/adjacent power.","high",["all transactions"],["payment_engine"]),
     pat("Hawala Cross-Border Transfers","Hawala used for cross-border value transfers where banking is restricted.","medium",["remittance"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Parallel Governance Structures","Both occupying authority and resistance governance structures impose requirements.","high",["all businesses"],["institutional_engine"]),
     pat("International Donor Support","International development organizations provide significant economic support.","high",["NGO sector","development"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Resistance and Sumud (Steadfastness)","Business framed as act of economic resistance and community preservation.","high",["all local businesses"],["narrative_engine"]),
     pat("International Solidarity Market","Global community of supporters creates market for Palestinian products.","medium",["export products","artisan goods"],["market_engine"])
   ],
   "platform_patterns":[
     pat("Social Media Activism Platform","Social media simultaneously an activism tool and a commerce platform.","medium",["consumer products","export"],["platform_engine"]),
     pat("Zoom and Remote Work Platforms","Video conferencing enables global work despite physical restrictions.","high",["digital services","remote work"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Dual Legal System Complexity","Both PA law and Israeli military orders apply simultaneously.","high",["all businesses"],["regulatory_engine"]),
     pat("Import Approval Requirements","Importing goods requires clearance from multiple authorities.","high",["any product importer"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Buy Palestinian Preference","Strong community preference for purchasing from Palestinian suppliers.","high",["consumer products"],["adoption_engine"]),
     pat("Crisis-Resilient Consumer Habits","Consumer habits shaped by experience of sudden economic shock and closure.","high",["FMCG","essential services"],["adoption_engine"])
   ],
   "business_model_fit":{"digital_services":"high","remote_work":"high","export_artisan":"medium","notes":"Digital services and remote work are the most viable commercial models."},
   "common_failure_modes":[
     pat("Physical Asset Investment","Investing in physical assets that can be destroyed or inaccessible.","high",["physical businesses"],["crisis_engine"]),
     pat("Assuming Stable Operating Environment","Any plan assuming stable conditions will be disrupted.","high",["all businesses"],["crisis_engine"])
   ],
   "common_success_patterns":[
     pat("Digital-Only Business Model","Pure digital products and services avoid physical risk entirely.","high",["software","digital services"],["strategy_engine"]),
     pat("Export Market Focus","Focusing on international markets reduces dependency on constrained local economy.","high",["artisan products","digital services"],["market_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Remote Business Model First","Design business to operate without requiring physical presence or movement.","high",["all external entrants"],["strategy_engine"]),
     pat("Partner with Palestinian Tech Ecosystem","Engage with Gaza Sky Geeks, Ramallah Hub, and local tech ecosystem.","medium",["tech businesses"],["network_engine"])
   ],
   "source_notes":"Based on Palestinian territory economic characteristics.",
   "schema_version":"A2"},

  # ── 21 ── Civil War ────────────────────────────────────────────────────────
  {"economy_id":"eco_civil_war","economy_type":"civil_war",
   "name":"Civil War","display_name":"Civil War",
   "short_description":"Countries in active civil conflict with fractured authority, currency collapse, and mass displacement.",
   "long_description":"Civil war economies have no functioning unified government. Multiple armed factions claim authority over different territories. Currency may have collapsed or multiple currencies operate simultaneously. Economic activity continues at a survival level but formal commerce is nearly impossible. Humanitarian operations are the primary functioning economic system.",
   "core_characteristic":"Fractured authority, displacement, currency collapse",
   "example_countries":["Sudan","Myanmar (conflict zones)"],
   "countries":["Sudan","Myanmar (Sagaing, Chin, Kayah conflict zones)","Libya (western conflict zones)","Yemen (contested zones)"],
   "civilization_dna":{"trust_index":15,"authority_index":20,"corruption_index":82,"innovation_index":15,"digital_adoption_index":30,"education_index":28,"social_mobility_index":10,"bureaucracy_index":30,"stability_index":5,"information_freedom_index":22,"risk_tolerance_index":40,"community_dependence_index":75,"crime_pressure_index":90,"payment_reliability_index":10,"infrastructure_reliability_index":12,"institutional_strength_index":8,"media_volatility_index":28,"legal_predictability_index":5,"labor_reliability_index":22,"crisis_exposure_index":98,"adoption_friction_index":75,"social_proof_dependence_index":68,"reputation_fragility_index":48,"informal_network_strength_index":72,"future_change_velocity_index":15},
   "resistance_patterns":[
     pat("Complete Institutional Collapse","All government institutions, courts, banks, and utilities have ceased functioning.","high",["all businesses"],["institutional_engine"]),
     pat("Population Displacement","Mass displacement creates unstable customer base and disrupted supply chains.","high",["all businesses"],["crisis_engine"]),
     pat("Currency Hyperinflation","National currency has collapsed or is hyperinflating; pricing is impossible.","high",["all businesses"],["financial_engine"])
   ],
   "opportunity_patterns":[
     pat("Humanitarian Technology","UNHCR, WFP, and ICRC operations require coordination, data, and communication tools.","medium",["humanitarian tech"],["market_engine"]),
     pat("Diaspora Remittance","Large diaspora sending value to displaced family members.","medium",["remittance","hawala tech"],["market_engine"]),
     pat("Post-War Reconstruction","Long-term reconstruction creates future investment opportunity.","low",["infrastructure tech","construction"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Ethnic and Family Networks","Trust operates exclusively through ethnic, clan, and family networks.","high",["any commerce"],["trust_engine"]),
     pat("Armed Faction Guarantee","Business conducted only with protection guarantee from dominant local faction.","high",["physical commerce"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("USD Cash Exclusively","Only USD or gold are accepted as stores of value.","high",["all transactions"],["payment_engine"]),
     pat("Barter for Daily Needs","Daily needs transacted through barter.","high",["local commerce"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Multiple Competing Authorities","Different armed groups control different areas; any business must manage multiple authority relationships.","high",["all operations"],["institutional_engine"]),
     pat("UN as Neutral Actor","UN agencies are the only broadly accepted neutral coordination bodies.","medium",["humanitarian operations"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Faction Neutrality Essential","Any communication that takes sides in the conflict creates existential risk.","high",["all actors"],["narrative_engine"]),
     pat("Humanitarian Mission as Shield","Humanitarian mission framing provides some protection and access.","medium",["NGOs","humanitarian tech"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Telegram and Encrypted Messaging","Encrypted messaging is primary communication; open communications are dangerous.","high",["all communications"],["platform_engine"]),
     pat("Satellite for Connectivity","Satellite internet is only reliable connectivity in active conflict zones.","medium",["field operations"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("No Functioning Legal System","Courts do not function; no legal recourse for any dispute.","high",["all businesses"],["regulatory_engine"]),
     pat("War Crime and Sanctions Exposure","Engagement with certain actors may violate international law or sanctions.","high",["all organizations"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Pure Survival Spending","All spending directed to immediate survival.","high",["all consumer products"],["adoption_engine"]),
     pat("Asset Preservation Behavior","Remaining assets being protected and hidden; no investment.","high",["financial services"],["adoption_engine"])
   ],
   "business_model_fit":{"humanitarian_only":"high","notes":"No viable commercial business models. Only humanitarian operations."},
   "common_failure_modes":[
     pat("Commercial Business Model Attempt","Any attempt at commercial business in active civil war zones.","high",["all commercial businesses"],["strategy_engine"]),
     pat("Side Selection","Any perceived alignment with one faction makes organization target for others.","high",["all actors"],["crisis_engine"])
   ],
   "common_success_patterns":[
     pat("UN System Alignment","Operating exclusively within UN coordination system.","high",["humanitarian organizations"],["strategy_engine"]),
     pat("Remote Operations Only","All operations managed remotely with no physical presence.","high",["technology providers"],["execution_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Do Not Enter","No commercial organization should enter active civil war zones.","high",["commercial businesses"],["crisis_engine"]),
     pat("Pre-Position for Post-Conflict","Build relationships with diaspora and civil society for post-conflict entry.","medium",["long-term investors"],["strategy_engine"])
   ],
   "source_notes":"Based on Sudan, Myanmar civil conflict characteristics.",
   "schema_version":"A2"},

  # ── 22 ── Militia Controlled ──────────────────────────────────────────────
  {"economy_id":"eco_militia_controlled","economy_type":"militia_controlled",
   "name":"Militia Controlled","display_name":"Militia Controlled",
   "short_description":"Territories where armed non-state groups impose taxation, control trade routes, and extract economic rents.",
   "long_description":"Militia-controlled economies exist in territories where non-state armed groups have displaced government authority. Militias impose taxes on trade routes, extort businesses, and control access to resources. Life under militia control is possible but operates under constant threat. Economic activity exists but all profits are subject to forced extraction.",
   "core_characteristic":"Armed group taxation, coercion, route capture",
   "example_countries":["Parts of DRC","Parts of Somalia"],
   "countries":["Parts of Democratic Republic of Congo","Parts of Somalia","Parts of Mali (northern)","Parts of Mozambique (Cabo Delgado)"],
   "civilization_dna":{"trust_index":10,"authority_index":15,"corruption_index":92,"innovation_index":12,"digital_adoption_index":18,"education_index":15,"social_mobility_index":5,"bureaucracy_index":15,"stability_index":3,"information_freedom_index":15,"risk_tolerance_index":35,"community_dependence_index":72,"crime_pressure_index":98,"payment_reliability_index":8,"infrastructure_reliability_index":8,"institutional_strength_index":5,"media_volatility_index":15,"legal_predictability_index":3,"labor_reliability_index":18,"crisis_exposure_index":98,"adoption_friction_index":72,"social_proof_dependence_index":65,"reputation_fragility_index":42,"informal_network_strength_index":68,"future_change_velocity_index":10},
   "resistance_patterns":[
     pat("Forced Taxation on All Commerce","Militias impose arbitrary levies on all trade; profit margins are unpredictable.","high",["all physical businesses"],["financial_engine"]),
     pat("Zero Property Rights","Property can be seized by militia forces at any time.","high",["all physical assets"],["legal_engine"]),
     pat("Route Monopoly Control","Militias control road and market access; logistics impossible without compliance.","high",["logistics","supply chain"],["infrastructure_engine"])
   ],
   "opportunity_patterns":[
     pat("Mineral Resource Access","Parts of DRC and Somalia have valuable mineral resources despite instability.","medium",["mining","resource extraction - high risk"],["market_engine"]),
     pat("Humanitarian Operations Required","Population needs require humanitarian operations regardless of militia presence.","medium",["humanitarian tech","NGO tools"],["market_engine"]),
     pat("Mobile Connectivity Entry","Mobile network operators negotiate access rights with militias for signal towers.","low",["telecom","mobile services"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Militia Protection Payment","Business operates only through payment of protection fees to militia.","high",["physical businesses"],["trust_engine"]),
     pat("Community Clan Networks","Within communities, clan and family networks maintain trust despite external chaos.","medium",["community commerce"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Cash in Dominant Currency","USD, gold, or local stable currency for all transactions.","high",["all commerce"],["payment_engine"]),
     pat("Resource-for-Goods Barter","Mineral resources exchanged for goods and services.","medium",["resource areas"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Militia as Tax Authority","Militia serves as de facto tax and regulatory authority.","high",["all businesses"],["institutional_engine"]),
     pat("International NGO as Service State","NGOs provide education, health, and food services that government cannot.","medium",["social services"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Neutrality is Survival","Appearing neutral to all militia factions is critical.","high",["all operations"],["narrative_engine"]),
     pat("Humanitarian Framing for Access","Humanitarian identity provides access that commercial identity does not.","high",["NGOs","service providers"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Radio for Mass Communication","Radio remains primary mass communication in militia-controlled territories.","high",["mass awareness"],["platform_engine"]),
     pat("Encrypted Satellite Communication","Satellite phones and encrypted messaging essential for coordination.","medium",["field operations"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("No Government Law","Government law does not apply; militia rules are the only enforceable framework.","high",["all actors"],["regulatory_engine"]),
     pat("International Humanitarian Law","IHL applies in theory; practical enforcement is absent.","medium",["humanitarian operations"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Survival Prioritized","All spending oriented to immediate survival.","high",["all consumer products"],["adoption_engine"]),
     pat("Militia-Approved Commerce Only","Only products and services approved (explicitly or implicitly) by militia can be sold.","high",["all businesses"],["adoption_engine"])
   ],
   "business_model_fit":{"humanitarian_only":"high","notes":"No commercial business models viable. Humanitarian operations only."},
   "common_failure_modes":[
     pat("Attempting Commercial Operations","All commercial operations fail due to militia extraction.","high",["commercial businesses"],["financial_engine"]),
     pat("Single Militia Relationship","Building relationship with one militia and being vulnerable when balance of power shifts.","high",["any organization"],["crisis_engine"])
   ],
   "common_success_patterns":[
     pat("Multi-Faction Negotiation","Organizations that successfully negotiate access with all factions survive longer.","medium",["humanitarian organizations"],["strategy_engine"]),
     pat("Remote Operations Only","Physical presence minimized to reduce extraction exposure.","high",["technology providers"],["execution_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Do Not Enter Without Security Specialist","No organization should enter without experienced humanitarian security advisor.","high",["all organizations"],["crisis_engine"]),
     pat("UN OCHA Coordination First","Enter through UN OCHA coordination mechanisms only.","high",["humanitarian organizations"],["institutional_engine"])
   ],
   "source_notes":"Based on DRC and Somali militia economy characteristics.",
   "schema_version":"A2"},

  # ── 23 ── Sanctioned ──────────────────────────────────────────────────────
  {"economy_id":"eco_sanctioned","economy_type":"sanctioned",
   "name":"Sanctioned","display_name":"Sanctioned",
   "short_description":"Economies cut off from international financial systems with underground alternatives and resource constraints.",
   "long_description":"Sanctioned economies face significant restrictions on international payments, imports, and access to global financial infrastructure. Businesses develop underground alternatives — cryptocurrency, hawala, barter, third-country intermediaries. Innovation continues despite sanctions, particularly in workaround technology. Exports are limited, imports are expensive. The domestic market is the primary addressable market.",
   "core_characteristic":"Blocked payments, restricted imports, underground alternatives",
   "example_countries":["Iran","North Korea","Russia (post-2022)"],
   "countries":["Iran","North Korea","Russia","Belarus","Myanmar (junta-controlled)","Venezuela"],
   "civilization_dna":{"trust_index":40,"authority_index":78,"corruption_index":72,"innovation_index":52,"digital_adoption_index":65,"education_index":68,"social_mobility_index":28,"bureaucracy_index":80,"stability_index":50,"information_freedom_index":15,"risk_tolerance_index":55,"community_dependence_index":68,"crime_pressure_index":60,"payment_reliability_index":22,"infrastructure_reliability_index":58,"institutional_strength_index":45,"media_volatility_index":15,"legal_predictability_index":35,"labor_reliability_index":60,"crisis_exposure_index":68,"adoption_friction_index":70,"social_proof_dependence_index":65,"reputation_fragility_index":52,"informal_network_strength_index":78,"future_change_velocity_index":45},
   "resistance_patterns":[
     pat("International Payment Impossibility","SWIFT exclusion and sanctions make all international financial transactions extremely difficult.","high",["any business needing international payments"],["payment_engine"]),
     pat("Import and Tech Restriction","Critical imports — semiconductors, software, hardware — are blocked or severely restricted.","high",["tech companies","manufacturers"],["infrastructure_engine"]),
     pat("Secondary Sanctions Risk","Third parties transacting with sanctioned entities face secondary sanctions from US/EU.","high",["international businesses"],["regulatory_engine"])
   ],
   "opportunity_patterns":[
     pat("Import Substitution Technology","Massive government demand for domestic alternatives to sanctioned imports.","high",["domestic tech","software"],["market_engine"]),
     pat("Cryptocurrency and Workaround Finance","Domestic crypto adoption and hawala networks create new payment infrastructure.","medium",["fintech","crypto"],["market_engine"]),
     pat("Domestic Market Captivity","Sanctions reduce competition from foreign products, protecting domestic producers.","medium",["domestic businesses"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("State Endorsement Critical","Government certification or endorsement required for large B2B contracts.","high",["B2B enterprise"],["trust_engine"]),
     pat("Informal Network Trust","Personal networks and informal trust critical since formal institutions compromised.","high",["all businesses"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Crypto and Hawala Alternatives","Cryptocurrency and hawala are primary cross-border payment mechanisms.","high",["international transactions"],["payment_engine"]),
     pat("State Banking Forced Usage","Domestic transactions forced through state-controlled banking system.","high",["domestic businesses"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("State Direction of Economy","Government directs investment toward sanctioned sectors as national priority.","high",["tech","energy","defense"],["institutional_engine"]),
     pat("Revolutionary Guard / Parastatal Control","Key economic sectors controlled by security apparatus or government parastatals.","high",["Iran's IRGC-linked sectors"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("National Resistance Narrative","Framing business as contributing to national resistance against sanctions.","high",["domestic businesses"],["narrative_engine"]),
     pat("Self-Sufficiency Achievement","Narrative of achieving self-sufficiency resonates with government and public.","high",["import substitution"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Domestic Social Platforms","Domestic alternatives to banned platforms (RuTube, Aparat) with state-controlled content.","high",["consumer apps"],["platform_engine"]),
     pat("VPN and Circumvention Tools","VPN usage is high despite official restrictions; significant portion accesses banned content.","medium",["all digital services"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Customs Circumvention Mechanisms","Complex parallel import systems legally or semi-legally circumvent trade restrictions.","medium",["importers","distributors"],["regulatory_engine"]),
     pat("State Procurement Dominance","State is the primary customer for major goods and services.","high",["B2B suppliers"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Workaround Culture","Consumers are highly skilled at finding workarounds for blocked services.","high",["digital products","global services"],["adoption_engine"]),
     pat("State Approved Alternatives","For sensitive categories, consumers use only state-approved alternatives.","medium",["media","financial services"],["adoption_engine"])
   ],
   "business_model_fit":{"import_substitution":"high","domestic_saas":"high","b2b_government":"high","consumer_domestic":"medium","notes":"Only domestic-focused businesses viable. International business almost impossible."},
   "common_failure_modes":[
     pat("Assuming Payment Will Work","Any assumption that international payment will function reliably.","high",["all businesses"],["payment_engine"]),
     pat("Secondary Sanctions Exposure","Third-country businesses that fail to check sanctions compliance face asset freezes.","high",["international businesses"],["regulatory_engine"])
   ],
   "common_success_patterns":[
     pat("Full Domestic Business Model","Businesses that operate entirely within domestic economy avoid sanctions risk.","high",["domestic tech"],["strategy_engine"]),
     pat("Government Contract as Revenue Base","State procurement provides stable, domestic-currency revenue base.","high",["tech businesses"],["revenue_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Do Not Enter Without Legal Counsel","International businesses must get comprehensive sanctions legal opinion before any activity.","high",["all international businesses"],["regulatory_engine"]),
     pat("Local Partner with Government Access","Local partner with established government relationships.","high",["any non-domestic business"],["strategy_engine"])
   ],
   "source_notes":"Based on Iran, North Korea, Russia post-2022 sanction characteristics.",
   "schema_version":"A2"},

  # ── 24 ── Post Collapse ────────────────────────────────────────────────────
  {"economy_id":"eco_post_collapse","economy_type":"post_collapse",
   "name":"Post Collapse","display_name":"Post Collapse",
   "short_description":"Economies recovering from institutional failure with barter systems, survival networks, and minimal formal commerce.",
   "long_description":"Post-collapse economies exist after a period of total or near-total institutional failure. Formal economy has collapsed; informal survival economy has taken over. Barter, community sharing, and informal credit based on trust are the primary economic mechanisms. Reconstruction is happening but slowly. Haiti after 2010 and the COVID-19 aftermath in some economies are examples. Basic survival is the economic priority.",
   "core_characteristic":"Institution failure, barter, survival networks",
   "example_countries":["Parts of Haiti","Parts of Somalia (recovering areas)"],
   "countries":["Haiti","Parts of Somalia (post-conflict recovery zones)","Parts of Libya (transitional areas)"],
   "civilization_dna":{"trust_index":18,"authority_index":18,"corruption_index":80,"innovation_index":20,"digital_adoption_index":25,"education_index":20,"social_mobility_index":12,"bureaucracy_index":15,"stability_index":5,"information_freedom_index":30,"risk_tolerance_index":45,"community_dependence_index":80,"crime_pressure_index":88,"payment_reliability_index":5,"infrastructure_reliability_index":8,"institutional_strength_index":8,"media_volatility_index":25,"legal_predictability_index":5,"labor_reliability_index":20,"crisis_exposure_index":95,"adoption_friction_index":78,"social_proof_dependence_index":70,"reputation_fragility_index":48,"informal_network_strength_index":78,"future_change_velocity_index":15},
   "resistance_patterns":[
     pat("Zero Institutional Infrastructure","No functioning courts, banks, government services, or formal infrastructure.","high",["all businesses"],["institutional_engine"]),
     pat("Security and Gang Control","Armed gangs control significant areas and impose economic extraction.","high",["physical businesses"],["crisis_engine"]),
     pat("No Formal Payment System","No functioning banking; cash-only with no reliable currency.","high",["all businesses"],["payment_engine"])
   ],
   "opportunity_patterns":[
     pat("Reconstruction Demand","Post-collapse reconstruction creates demand for basic infrastructure and services.","medium",["construction","basic services","humanitarian"],["market_engine"]),
     pat("Community Resilience Networks","Community solidarity networks are highly functional and can be leveraged for distribution.","medium",["FMCG","health","community services"],["distribution_engine"]),
     pat("International Development Investment","Post-collapse states attract significant international reconstruction funding.","medium",["development tech","infrastructure"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Community Elder and Religious Leadership","Church leaders and community elders are primary trust figures.","high",["all activities"],["trust_engine"]),
     pat("NGO Affiliation","Affiliation with recognized international NGO provides protection and trust.","medium",["service delivery"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("US Dollar Cash Only","USD cash is the only reliable payment medium.","high",["all transactions"],["payment_engine"]),
     pat("Barter for Local Goods","Local goods and services traded by barter.","high",["local commerce"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("NGO as Parallel Government","International NGOs provide services the government cannot.","high",["service delivery"],["institutional_engine"]),
     pat("Gang Territory Control","Gang networks control territory and extract economic rents.","high",["all physical businesses"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Reconstruction and Hope","Narratives of hope and reconstruction resonate with diaspora and international donors.","medium",["development organizations"],["narrative_engine"]),
     pat("Community Dignity","Framing around dignity and community agency rather than charity.","high",["NGOs","social enterprises"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("WhatsApp for Emergency Coordination","WhatsApp is primary coordination tool where connectivity exists.","medium",["emergency services","community coordination"],["platform_engine"]),
     pat("Radio for Mass Communication","Radio reaches populations without smartphones or internet.","high",["mass communication"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Weak or Absent Law","Legal system functions minimally or not at all.","high",["all businesses"],["regulatory_engine"]),
     pat("International Standards Required","Aid organizations impose their own standards as de facto regulation.","medium",["NGO partners"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Pure Survival Mode","All decisions oriented toward immediate survival.","high",["all consumer products"],["adoption_engine"]),
     pat("Community Sharing Norm","Goods are shared within community groups; private ownership norms are weakened.","medium",["consumer goods"],["adoption_engine"])
   ],
   "business_model_fit":{"humanitarian_tech":"high","reconstruction":"medium","notes":"Only humanitarian and reconstruction operations viable."},
   "common_failure_modes":[
     pat("Commercial Business Assumptions","Assuming any normal commercial infrastructure will function.","high",["all commercial businesses"],["strategy_engine"]),
     pat("Ignoring Gang Risk","Underestimating armed group control of territory.","high",["physical operations"],["crisis_engine"])
   ],
   "common_success_patterns":[
     pat("Community-Led Service Delivery","Services delivered through and by community members succeed where external-led efforts fail.","high",["NGOs","social enterprises"],["distribution_engine"]),
     pat("Cash Transfer Programs","Direct cash transfers to households more effective than in-kind aid.","high",["development programs"],["strategy_engine"])
   ],
   "recommended_entry_strategies":[
     pat("NGO or UN Partnership First","Enter through established humanitarian organizations as primary partners.","high",["all external actors"],["institutional_engine"]),
     pat("Diaspora-Led Entry","Diaspora members with family networks provide trusted entry pathway.","medium",["reconstruction businesses"],["network_engine"])
   ],
   "source_notes":"Based on Haiti and Somali post-collapse characteristics.",
   "schema_version":"A2"},

  # ── 25 ── Creator Economy ─────────────────────────────────────────────────
  {"economy_id":"eco_creator_economy","economy_type":"creator_economy",
   "name":"Creator Economy","display_name":"Creator Economy",
   "short_description":"Attention-driven digital economies where personal brands, algorithms, and content monetization determine success.",
   "long_description":"The creator economy is a global attention marketplace operating across YouTube, TikTok, Instagram, Twitch, and emerging platforms. Revenue flows through ads, sponsorships, memberships, merchandise, and courses. Success is determined by algorithm performance, audience attention capture, and platform relationship management. Reputation is fragile and can collapse overnight. The market is simultaneously global and hyper-niche.",
   "core_characteristic":"Attention-driven, algorithm-dependent, personal brands",
   "example_countries":["USA","South Korea","Brazil","Indonesia"],
   "countries":["United States","South Korea","Brazil","Indonesia","India","Nigeria"],
   "civilization_dna":{"trust_index":60,"authority_index":35,"corruption_index":32,"innovation_index":85,"digital_adoption_index":95,"education_index":68,"social_mobility_index":72,"bureaucracy_index":30,"stability_index":58,"information_freedom_index":85,"risk_tolerance_index":82,"community_dependence_index":42,"crime_pressure_index":28,"payment_reliability_index":88,"infrastructure_reliability_index":88,"institutional_strength_index":65,"media_volatility_index":92,"legal_predictability_index":65,"labor_reliability_index":62,"crisis_exposure_index":40,"adoption_friction_index":28,"social_proof_dependence_index":88,"reputation_fragility_index":92,"informal_network_strength_index":58,"future_change_velocity_index":92},
   "resistance_patterns":[
     pat("Algorithm Dependency and Volatility","Revenue completely dependent on platform algorithms that change without notice.","high",["all creator businesses"],["platform_engine"]),
     pat("Audience Attention Fragmentation","Audience attention is constantly competing with thousands of other creators.","high",["all creators"],["competition_engine"]),
     pat("Platform Policy Risk","Demonetization, shadow banning, and policy changes can eliminate income overnight.","high",["all creators"],["platform_engine"])
   ],
   "opportunity_patterns":[
     pat("Global Niche Monetization","Every niche has a global audience large enough to sustain a creator business.","high",["content creators","educators","entertainers"],["market_engine"]),
     pat("Multiple Revenue Stream Architecture","Diversified revenue (ads, sponsors, memberships, merch, courses) creates resilience.","high",["established creators"],["revenue_engine"]),
     pat("Creator Tool Market","Massive demand for editing, scheduling, analytics, and monetization tools from 50M+ creators.","high",["creator SaaS","tools"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Parasocial Relationship","Audience develops parasocial relationships with creators; personal trust is the product.","high",["all creator businesses"],["trust_engine"]),
     pat("Authenticity Signal","Perceived authenticity is the primary trust currency; corporate behavior destroys trust.","high",["brand deals","product promotions"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Platform Revenue Share","Primary revenue via YouTube AdSense, TikTok Creator Fund, etc.","high",["video creators"],["payment_engine"]),
     pat("Stripe and Direct Membership","Substack, Patreon, and direct Stripe billing for premium content.","high",["newsletter/podcast/community creators"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Platform as Regulator","YouTube, TikTok, and Meta set and enforce content rules — effectively as regulators.","high",["all creators"],["regulatory_engine"]),
     pat("MCN and Talent Management","Multi-channel networks and talent managers negotiate deals and provide support.","medium",["large creators"],["institutional_engine"])
   ],
   "narrative_patterns":[
     pat("Personal Story as Brand","Creator's personal journey IS the brand narrative; authenticity is the product.","high",["all creators"],["narrative_engine"]),
     pat("Community Identity","Successful creators build community identities (fandom names, inside jokes, rituals).","high",["all creators"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("YouTube Primary for Long-Form","YouTube dominates long-form discovery and monetization.","high",["video creators"],["platform_engine"]),
     pat("TikTok for Short-Form Discovery","TikTok is primary short-form discovery engine for new audience growth.","high",["all creators"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("FTC Disclosure Requirements","Sponsored content must be disclosed; failure creates legal and reputational risk.","high",["US-based creators"],["regulatory_engine"]),
     pat("Copyright and DMCA","Music and content copyright claims can demonetize or remove creator content.","high",["video creators"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Attention Follows Entertainment + Value","Audiences follow creators who entertain or provide clear value; education alone is not enough.","high",["all creators"],["adoption_engine"]),
     pat("Tribal Community Participation","Fans want to participate in community, not just consume.","high",["community-building creators"],["adoption_engine"])
   ],
   "business_model_fit":{"creator_tools":"high","membership_platforms":"high","content_creation":"high","creator_education":"high","sponsorship_platforms":"high","notes":"Optimal for creator tools, membership platforms, and creator education businesses."},
   "common_failure_modes":[
     pat("Single Platform Dependency","Depending on one platform for all revenue and audience.","high",["all creators"],["platform_engine"]),
     pat("Audience Mismatch with Monetization","Building large audience in demographic that doesn't match sponsorship or purchase behavior.","high",["creators targeting young broke audiences"],["revenue_engine"])
   ],
   "common_success_patterns":[
     pat("Own the Email List","Building owned email list and newsletter independent of platform algorithms.","high",["all creators"],["distribution_engine"]),
     pat("Diversified Revenue Stack","Building 5+ revenue streams (ads, sponsors, memberships, courses, merch, services).","high",["established creators"],["revenue_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Niche Domination Before Broadening","Dominate one specific niche before expanding to broader topics.","high",["new creators"],["strategy_engine"]),
     pat("Cross-Platform Presence from Day One","Build simultaneously on 2-3 platforms to avoid single-platform dependency.","high",["all creators"],["platform_engine"])
   ],
   "source_notes":"Based on creator economy characteristics in USA, South Korea, Brazil.",
   "schema_version":"A2"},

  # ── 26 ── Gig Platform ────────────────────────────────────────────────────
  {"economy_id":"eco_gig_platform","economy_type":"gig_platform",
   "name":"Gig Platform","display_name":"Gig Platform",
   "short_description":"App-mediated flexible labor economies where platform algorithms control access to work.",
   "long_description":"Gig platform economies are built around algorithmic labor marketplaces where platform companies match demand with supply of flexible workers. Uber, DoorDash, Bolt, TaskRabbit, and similar platforms have created a new labor category. Workers have flexibility but face algorithmic control, volatile earnings, and lack of benefits. Platform companies capture value through percentage fees.",
   "core_characteristic":"App-based work, flexible labor, platform control",
   "example_countries":["USA","India","Indonesia","Nigeria"],
   "countries":["United States","India","Indonesia","Nigeria","Kenya","Brazil","Mexico"],
   "civilization_dna":{"trust_index":58,"authority_index":40,"corruption_index":38,"innovation_index":78,"digital_adoption_index":88,"education_index":62,"social_mobility_index":58,"bureaucracy_index":42,"stability_index":52,"information_freedom_index":78,"risk_tolerance_index":75,"community_dependence_index":50,"crime_pressure_index":35,"payment_reliability_index":82,"infrastructure_reliability_index":72,"institutional_strength_index":60,"media_volatility_index":72,"legal_predictability_index":58,"labor_reliability_index":55,"crisis_exposure_index":45,"adoption_friction_index":38,"social_proof_dependence_index":78,"reputation_fragility_index":78,"informal_network_strength_index":55,"future_change_velocity_index":82},
   "resistance_patterns":[
     pat("Platform Lock-In and Fee Extraction","Platform takes 20-35% of all transactions; worker margins are thin.","high",["any competitor to existing platforms"],["competition_engine"]),
     pat("Worker Classification Legal Risk","Gig worker vs employee classification battles in multiple jurisdictions.","high",["gig platforms"],["regulatory_engine"]),
     pat("Cold Start Problem","Two-sided marketplace requires simultaneous worker and customer density to function.","high",["new gig platforms"],["market_engine"])
   ],
   "opportunity_patterns":[
     pat("Underserved Service Categories","Many service categories still lack efficient digital matching platforms.","high",["new gig categories"],["market_engine"]),
     pat("Worker Income Diversification Tools","Workers using multiple platforms need management tools.","high",["gig worker SaaS","fintech"],["market_engine"]),
     pat("B2B Flex Staffing Automation","Enterprise flex staffing solutions using gig worker infrastructure.","high",["B2B staffing tech"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Star Rating System","Bidirectional star ratings are primary trust mechanism for both workers and customers.","high",["all gig platforms"],["trust_engine"]),
     pat("Identity Verification","Background checks and ID verification provide safety trust signals.","high",["home services","ride-sharing"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("In-App Payment Mandatory","All transactions handled in-app; cash payments are platform policy violation.","high",["gig platforms"],["payment_engine"]),
     pat("Instant Pay Options Growing","Workers increasingly demanding instant or daily payout options.","medium",["gig platforms"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Platform as Labor Market","Platforms function as labor markets, setting prices, allocating work, and managing quality.","high",["all gig businesses"],["institutional_engine"]),
     pat("Regulatory Pressure on Classification","AB5 (California), Uber UK ruling, EU gig law create employment reclassification pressure.","high",["all gig platforms"],["regulatory_engine"])
   ],
   "narrative_patterns":[
     pat("Flexibility and Freedom Narrative","Marketing to workers emphasizes flexibility and being your own boss.","high",["worker recruitment"],["narrative_engine"]),
     pat("Convenience and On-Demand Narrative","Marketing to customers emphasizes convenience and instant availability.","high",["customer acquisition"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Google Maps Integration","Navigation and location services are core platform infrastructure.","high",["ride-sharing","delivery"],["platform_engine"]),
     pat("App Store and Play Store Dependency","Entirely dependent on Apple and Google app distribution.","high",["all gig platforms"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Worker Misclassification Liability","Reclassification of workers as employees creates massive cost exposure.","high",["all gig platforms"],["regulatory_engine"]),
     pat("City-Level Transport Regulations","Ride-sharing and delivery regulated at city level with varying requirements.","medium",["ride-sharing","food delivery"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Price Sensitivity and Surge Resistance","Customers abandon platforms during price surges; price elasticity is high.","high",["ride-sharing","delivery"],["adoption_engine"]),
     pat("App Switching Behavior","Customers use multiple competing platforms to find best price/availability.","high",["all gig services"],["retention_engine"])
   ],
   "business_model_fit":{"gig_marketplace":"high","gig_worker_tools":"high","b2b_flex_staffing":"high","notes":"Ideal for gig labor infrastructure, worker tools, and B2B flex staffing."},
   "common_failure_modes":[
     pat("Geographic Density Failure","Launching in too many cities simultaneously, achieving critical mass nowhere.","high",["new gig platforms"],["strategy_engine"]),
     pat("Race to Zero Pricing","Competing on price until margins are destroyed for both platform and workers.","high",["gig marketplaces"],["financial_engine"])
   ],
   "common_success_patterns":[
     pat("Single City Critical Mass First","Achieve undeniable density in one city before geographic expansion.","high",["all gig platforms"],["strategy_engine"]),
     pat("Supply Side First Strategy","Signing up and subsidizing workers first to ensure service availability before demand push.","high",["new gig platforms"],["strategy_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Vertical Specialization","Enter one specific service vertical deeply rather than competing with Uber/DoorDash broadly.","high",["new gig entrants"],["market_engine"]),
     pat("Worker Benefits as Differentiator","Offering worker benefits (insurance, income stability) as differentiation against incumbents.","medium",["gig platforms"],["strategy_engine"])
   ],
   "source_notes":"Based on global gig economy characteristics in USA, India, Indonesia.",
   "schema_version":"A2"},

  # ── 27 ── Freelance Digital ───────────────────────────────────────────────
  {"economy_id":"eco_freelance_digital","economy_type":"freelance_digital",
   "name":"Freelance Digital","display_name":"Freelance Digital",
   "short_description":"Global remote services economy where skilled workers compete for international clients on digital platforms.",
   "long_description":"The freelance digital economy is a global labor marketplace for knowledge workers — software developers, designers, writers, marketers, and consultants. Upwork, Fiverr, Toptal, and LinkedIn connect workers from lower-income countries with clients in higher-income markets. Platform fee structures (10-20%) and reputation systems govern the market. Income arbitrage between labor markets creates significant opportunity for skilled workers in emerging economies.",
   "core_characteristic":"Global remote services, platform competition",
   "example_countries":["India","Pakistan","Philippines","Bangladesh","Ukraine"],
   "countries":["India","Pakistan","Philippines","Bangladesh","Ukraine","Nigeria","Kenya","Brazil","Argentina"],
   "civilization_dna":{"trust_index":60,"authority_index":42,"corruption_index":42,"innovation_index":72,"digital_adoption_index":82,"education_index":68,"social_mobility_index":62,"bureaucracy_index":50,"stability_index":52,"information_freedom_index":72,"risk_tolerance_index":72,"community_dependence_index":55,"crime_pressure_index":38,"payment_reliability_index":72,"infrastructure_reliability_index":65,"institutional_strength_index":52,"media_volatility_index":65,"legal_predictability_index":52,"labor_reliability_index":70,"crisis_exposure_index":45,"adoption_friction_index":42,"social_proof_dependence_index":78,"reputation_fragility_index":78,"informal_network_strength_index":62,"future_change_velocity_index":78},
   "resistance_patterns":[
     pat("Platform Reputation Cold Start","New freelancers face impossible task of getting first review without prior reviews.","high",["new freelancers"],["trust_engine"]),
     pat("Race to Bottom on Pricing","High volume of low-cost competitors drives prices down; positioning as premium is difficult.","high",["all freelancers"],["revenue_engine"]),
     pat("Payment Rail Friction","International payment collection via PayPal, Wise, Payoneer adds friction and fees.","medium",["all freelancers"],["payment_engine"])
   ],
   "opportunity_patterns":[
     pat("Income Arbitrage Opportunity","Skilled workers in emerging markets can earn 5-10x local rates by serving global clients.","high",["skilled workers in emerging markets"],["revenue_engine"]),
     pat("AI Tool Leverage","AI coding, design, and writing tools dramatically increase output per freelancer.","high",["all freelancers"],["productivity_engine"]),
     pat("Freelancer Community and Education Market","50M+ freelancers need courses, tools, and community support.","high",["freelancer education","tools"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Review History is Everything","Star ratings, client testimonials, and portfolio work are the primary trust signal.","high",["all freelancers"],["trust_engine"]),
     pat("Niche Expertise Signaling","Deep specialization in a specific technology or domain signals expertise faster.","high",["all freelancers"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Escrow-Based Project Payments","Platform escrow (Upwork) or milestone-based payment is standard.","high",["project freelancers"],["payment_engine"]),
     pat("Payoneer, Wise, PayPal Withdrawal","Multiple payout options but all carry fees; bank transfer is cheapest at scale.","medium",["all freelancers"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("Platform as Labor Market Regulator","Upwork, Fiverr, Toptal set rules, enforce quality, and manage payment disputes.","high",["all freelancers"],["institutional_engine"]),
     pat("Tax Compliance Complexity","International income creates tax complexity in both client and freelancer jurisdictions.","medium",["high-earning freelancers"],["regulatory_engine"])
   ],
   "narrative_patterns":[
     pat("Portfolio and Case Study Power","Work samples and case studies are primary sales collateral.","high",["all freelancers"],["narrative_engine"]),
     pat("Thought Leadership as Lead Generation","Sharing expertise publicly generates inbound leads.","high",["experienced freelancers"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Upwork and Fiverr as Primary Marketplaces","These platforms control the primary discovery layer for freelance work.","high",["most freelancers"],["platform_engine"]),
     pat("LinkedIn for Direct Client Acquisition","LinkedIn increasingly used to bypass platform fees through direct outreach.","high",["experienced freelancers"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("Foreign Income Tax Obligations","Income from foreign clients often taxable in both countries.","medium",["all freelancers"],["regulatory_engine"]),
     pat("Platform Terms of Service","Platform TOS can ban entire categories of work or penalize off-platform billing.","medium",["platform freelancers"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Portfolio and Sample-Driven Hiring","Clients hire based on portfolio, not interviews or credentials.","high",["all freelance hiring"],["adoption_engine"]),
     pat("Fixed-Price Project Preference","Most clients prefer fixed-price projects over hourly to control budget.","high",["project work"],["revenue_engine"])
   ],
   "business_model_fit":{"freelancer_marketplace":"high","freelancer_tools":"high","freelancer_education":"high","remote_services":"high","notes":"Best for freelancer platforms, tools, and education businesses."},
   "common_failure_modes":[
     pat("Generalist Positioning","Positioning as 'web developer' rather than 'Shopify conversion optimization specialist'.","high",["new freelancers"],["strategy_engine"]),
     pat("Platform Fee Avoidance","Taking clients off-platform to avoid fees violates TOS and loses protection.","medium",["platform freelancers"],["strategy_engine"])
   ],
   "common_success_patterns":[
     pat("Hyper-Specific Niche Claim","Owning one very specific keyword and problem set before expanding.","high",["all freelancers"],["strategy_engine"]),
     pat("Retainer Conversion from Project","Converting one-time projects into monthly retainer relationships.","high",["experienced freelancers"],["revenue_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Upwork Profile Optimization First","Build Upwork profile with portfolio, specialized service offering, and competitive initial pricing.","high",["new freelancers entering global market"],["strategy_engine"]),
     pat("First Clients at Loss-Leader Price","Accept first 3-5 projects at very low rates to build review history.","high",["new freelancers"],["trust_engine"])
   ],
   "source_notes":"Based on global freelance digital economy characteristics.",
   "schema_version":"A2"},

  # ── 28 ── SaaS Startup ────────────────────────────────────────────────────
  {"economy_id":"eco_saas_startup","economy_type":"saas_startup",
   "name":"SaaS Startup","display_name":"SaaS Startup",
   "short_description":"Subscription software ecosystems with product-market fit obsession, churn risk, and VC-fueled growth dynamics.",
   "long_description":"The SaaS startup economy is a global phenomenon concentrated in certain hubs (SF Bay Area, NYC, London, Tel Aviv, Bangalore, Tallinn) but operating globally. Subscription software businesses compete on product-market fit, net revenue retention, and growth metrics. VC funding cycles heavily influence market dynamics. Customer success is the primary retention mechanism. Competition is intense; commoditization is constant.",
   "core_characteristic":"Subscription software, product-market fit, churn risk",
   "example_countries":["USA","Israel","Estonia","India (SaaS)","Canada"],
   "countries":["United States","Israel","Estonia","India (SaaS hubs)","Canada","UK","Germany"],
   "civilization_dna":{"trust_index":72,"authority_index":35,"corruption_index":28,"innovation_index":92,"digital_adoption_index":95,"education_index":82,"social_mobility_index":75,"bureaucracy_index":35,"stability_index":72,"information_freedom_index":88,"risk_tolerance_index":88,"community_dependence_index":32,"crime_pressure_index":22,"payment_reliability_index":95,"infrastructure_reliability_index":90,"institutional_strength_index":75,"media_volatility_index":75,"legal_predictability_index":75,"labor_reliability_index":80,"crisis_exposure_index":32,"adoption_friction_index":32,"social_proof_dependence_index":70,"reputation_fragility_index":82,"informal_network_strength_index":50,"future_change_velocity_index":92},
   "resistance_patterns":[
     pat("Feature Parity Commoditization","Core SaaS features are rapidly commoditized; differentiation requires constant innovation.","high",["all SaaS products"],["competition_engine"]),
     pat("Customer Acquisition Cost Inflation","Cost to acquire B2B customers is rising across all channels.","high",["all SaaS companies"],["financial_engine"]),
     pat("Churn Rate Pressure","Monthly or annual churn must stay below threshold or growth is impossible.","high",["all SaaS companies"],["retention_engine"])
   ],
   "opportunity_patterns":[
     pat("AI-Native Product Disruption","AI-native alternatives to existing SaaS categories creating new market entries.","high",["AI-first SaaS"],["market_engine"]),
     pat("Vertical SaaS Opportunity","Industry-specific SaaS with deep vertical integration commands premium pricing.","high",["vertical SaaS"],["market_engine"]),
     pat("International Market Expansion","Many SaaS categories remain under-served in non-US markets.","high",["SaaS with international product-market fit"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("G2 and Capterra Reviews","Software review platforms are critical discovery and trust mechanism.","high",["all B2B SaaS"],["trust_engine"]),
     pat("SOC2 and Compliance Certifications","Enterprise buyers require security certifications before evaluating products.","high",["enterprise SaaS"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Stripe Subscription Infrastructure","Stripe dominates SaaS billing infrastructure globally.","high",["all SaaS companies"],["payment_engine"]),
     pat("Annual vs Monthly Billing Trade-off","Annual billing improves cash flow; monthly billing reduces adoption friction.","medium",["SaaS pricing strategy"],["revenue_engine"])
   ],
   "institutional_patterns":[
     pat("VC Funding Cycle Dependency","SaaS ecosystem is heavily influenced by VC availability and interest rate cycles.","high",["VC-backed SaaS"],["financial_engine"]),
     pat("Cloud Provider Ecosystem","AWS, GCP, Azure marketplace presence influences enterprise sales.","medium",["B2B SaaS"],["platform_engine"])
   ],
   "narrative_patterns":[
     pat("10x ROI Narrative","B2B SaaS must clearly articulate quantifiable ROI for buyer justification.","high",["all B2B SaaS"],["narrative_engine"]),
     pat("Category Creation vs Category Entry","Category-creating companies command premium valuations and attention.","medium",["venture-funded SaaS"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Salesforce and HubSpot App Ecosystem","CRM platform ecosystems are primary B2B distribution channels.","high",["B2B SaaS"],["platform_engine"]),
     pat("Product Hunt and SaaS Community Launch","Product Hunt, Hacker News, and SaaS communities drive initial user acquisition.","high",["early-stage SaaS"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("SOC2 Type II Requirement","Enterprise customers require SOC2 Type II for any significant deal.","high",["enterprise SaaS"],["regulatory_engine"]),
     pat("GDPR and Privacy Compliance","European customers require GDPR-compliant data handling.","high",["SaaS with European customers"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Free Trial Expectation","Buyers expect free trial or freemium tier before any purchase commitment.","high",["all B2B SaaS"],["adoption_engine"]),
     pat("Champion-Driven Internal Adoption","One internal champion drives SaaS adoption within enterprises.","high",["B2B SaaS"],["adoption_engine"])
   ],
   "business_model_fit":{"b2b_saas":"high","vertical_saas":"high","product_led_growth":"high","enterprise_saas":"high","notes":"Optimal economy type for all SaaS business models."},
   "common_failure_modes":[
     pat("Premature Scaling Before PMF","Scaling sales and marketing before achieving clear product-market fit.","high",["all early-stage SaaS"],["strategy_engine"]),
     pat("Feature Bloat Without Core Value","Adding features to satisfy every request without deepening core value.","high",["post-PMF SaaS"],["product_engine"])
   ],
   "common_success_patterns":[
     pat("Net Revenue Retention > 100%","Expansion revenue from existing customers exceeds churn — the compounding SaaS engine.","high",["all SaaS companies"],["retention_engine"]),
     pat("PLG Flywheel","Product-led growth where the product itself drives acquisition, conversion, and expansion.","high",["developer tools","productivity SaaS"],["growth_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Solve One Problem Perfectly","Find one painful problem for one specific ICP and solve it better than anyone else.","high",["all new SaaS"],["strategy_engine"]),
     pat("ICP Definition First","Define Ideal Customer Profile precisely before any sales or marketing investment.","high",["all B2B SaaS"],["strategy_engine"])
   ],
   "source_notes":"Based on US, Israel, Estonia SaaS startup ecosystem characteristics.",
   "schema_version":"A2"},

  # ── 29 ── AI Automation ───────────────────────────────────────────────────
  {"economy_id":"eco_ai_automation","economy_type":"ai_automation",
   "name":"AI Automation","display_name":"AI Automation",
   "short_description":"AI-driven productivity economies with rapid labor displacement, regulation uncertainty, and massive infrastructure investment.",
   "long_description":"The AI automation economy is transforming work, business models, and competitive dynamics globally. AI-first companies are replacing entire categories of human work. GPU infrastructure investment is massive. Regulatory uncertainty is high. Winners are capturing disproportionate value while many workers face displacement. The economy rewards those who use AI tools most effectively and punishes those who ignore it.",
   "core_characteristic":"AI-driven productivity, labor displacement, regulation",
   "example_countries":["USA (AI hubs)","China (AI sector)","Japan (robotics)"],
   "countries":["United States (AI sector)","China (AI sector)","Japan","Germany","UK","Canada","Israel"],
   "civilization_dna":{"trust_index":68,"authority_index":50,"corruption_index":30,"innovation_index":95,"digital_adoption_index":98,"education_index":85,"social_mobility_index":62,"bureaucracy_index":45,"stability_index":68,"information_freedom_index":72,"risk_tolerance_index":82,"community_dependence_index":35,"crime_pressure_index":28,"payment_reliability_index":92,"infrastructure_reliability_index":92,"institutional_strength_index":72,"media_volatility_index":80,"legal_predictability_index":68,"labor_reliability_index":72,"crisis_exposure_index":40,"adoption_friction_index":42,"social_proof_dependence_index":72,"reputation_fragility_index":78,"informal_network_strength_index":45,"future_change_velocity_index":98},
   "resistance_patterns":[
     pat("Regulatory Uncertainty","AI regulation is evolving rapidly; products built today may be restricted tomorrow.","high",["all AI businesses"],["regulatory_engine"]),
     pat("Incumbent AI Capability","OpenAI, Anthropic, Google, Meta have massive R&D advantages; competing at foundation model level is near impossible.","high",["AI foundation model startups"],["competition_engine"]),
     pat("Hallucination and Trust Problem","AI output reliability is still insufficient for many high-stakes applications.","high",["AI in healthcare, legal, finance"],["trust_engine"])
   ],
   "opportunity_patterns":[
     pat("Vertical AI Application Layer","Building domain-specific AI applications on top of foundation models is enormous opportunity.","high",["AI SaaS","vertical AI"],["market_engine"]),
     pat("AI Workflow Automation","Every knowledge work process is a potential AI automation target.","high",["AI tools","workflow automation"],["market_engine"]),
     pat("AI Infrastructure Market","GPU compute, vector databases, AI observability are massive B2B market opportunities.","high",["AI infrastructure"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Accuracy and Reliability Benchmarks","Quantitative accuracy benchmarks are primary trust mechanism for AI products.","high",["all AI products"],["trust_engine"]),
     pat("Human-in-the-Loop Controls","Products with human oversight controls are trusted faster in regulated sectors.","high",["AI in regulated sectors"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Usage-Based Pricing Dominance","AI products predominantly use token/API/usage-based pricing models.","high",["AI API businesses"],["payment_engine"]),
     pat("Enterprise Procurement for AI","Large enterprises procure AI through standard SaaS channels with security review.","high",["enterprise AI"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("EU AI Act and Global Regulation","EU AI Act and emerging global AI regulation create compliance requirements.","high",["all AI businesses in Europe"],["regulatory_engine"]),
     pat("Big Tech AI Platform Lock-In","OpenAI, Anthropic, Google offer APIs that create deep dependency.","high",["AI app builders"],["platform_engine"])
   ],
   "narrative_patterns":[
     pat("Productivity Multiplier Narrative","AI products sold as force multipliers; ROI must be demonstrable and fast.","high",["B2B AI tools"],["narrative_engine"]),
     pat("Safe and Responsible AI","Enterprises require responsible AI commitments; safety narrative is increasingly mandatory.","high",["enterprise AI"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("OpenAI and Anthropic API Ecosystem","Building on these APIs creates product dependency but provides massive capability immediately.","high",["AI application builders"],["platform_engine"]),
     pat("Hugging Face Open Source Ecosystem","Open source model community provides alternative to proprietary API dependency.","medium",["AI infrastructure","model fine-tuning"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("EU AI Act Risk Classification","High-risk AI applications face significant compliance requirements under EU AI Act.","high",["AI in healthcare, education, employment"],["regulatory_engine"]),
     pat("Data Privacy in AI Training","Using customer data for AI training creates GDPR and privacy compliance requirements.","high",["all AI businesses"],["regulatory_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Proof of Value Before Commitment","Enterprise AI buyers demand extensive POC before purchase commitment.","high",["enterprise AI sales"],["adoption_engine"]),
     pat("Shadow AI Adoption","Employees adopting AI tools before official enterprise approval — bypassing IT/legal.","high",["consumer AI tools in enterprise context"],["adoption_engine"])
   ],
   "business_model_fit":{"vertical_ai":"high","ai_infrastructure":"high","ai_workflow":"high","ai_developer_tools":"high","notes":"Peak opportunity window for vertical AI application builders and AI infrastructure."},
   "common_failure_modes":[
     pat("Foundation Model Competition","Building products too close to foundation model capabilities; OpenAI ships a feature that kills your product.","high",["AI wrappers"],["competition_engine"]),
     pat("Hallucination in High-Stakes Context","Deploying AI in medical, legal, or financial contexts without sufficient accuracy safeguards.","high",["AI in regulated sectors"],["trust_engine"])
   ],
   "common_success_patterns":[
     pat("Proprietary Data Moat","Combining AI with unique proprietary data creates defensible differentiation.","high",["vertical AI"],["strategy_engine"]),
     pat("Workflow Lock-In","Embedding AI deeply into existing workflows makes it very hard to replace.","high",["B2B AI tools"],["retention_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Vertical Domain + AI Combination","Pick one specific domain with valuable but messy data and apply AI as primary product.","high",["new AI companies"],["strategy_engine"]),
     pat("Agent + Human Workflow Design","Build AI agents with clear human oversight checkpoints for regulated sector trust.","high",["AI in regulated sectors"],["trust_engine"])
   ],
   "source_notes":"Based on US, China, Japan AI automation economy characteristics.",
   "schema_version":"A2"},

  # ── 30 ── Cybercrime Dark Web ─────────────────────────────────────────────
  {"economy_id":"eco_cybercrime_dark_web","economy_type":"cybercrime_dark_web",
   "name":"Cybercrime / Dark Web","display_name":"Cybercrime / Dark Web",
   "short_description":"Hostile digital actor networks operating outside all legal frameworks with fraud, hacking, and underground commerce.",
   "long_description":"The cybercrime dark web economy is a global network of hostile digital actors engaged in fraud, ransomware, data theft, scam operations, and underground commerce. It operates through anonymizing networks (Tor), cryptocurrency payments, and dark web marketplaces. This is not a target market — it is a hostile operating environment that any legitimate business faces. Understanding it is about defense, not offense. Products sold to consumers in regions with high cybercrime pressure must account for fraud, account takeover, and identity theft as design constraints.",
   "core_characteristic":"Fraud, hacking, hostile digital actors",
   "example_countries":["Global networks (concentrated in Eastern Europe, West Africa, Southeast Asia)"],
   "countries":["Global hostile actor networks"],
   "civilization_dna":{"trust_index":5,"authority_index":5,"corruption_index":98,"innovation_index":78,"digital_adoption_index":95,"education_index":55,"social_mobility_index":22,"bureaucracy_index":5,"stability_index":15,"information_freedom_index":88,"risk_tolerance_index":88,"community_dependence_index":52,"crime_pressure_index":100,"payment_reliability_index":12,"infrastructure_reliability_index":72,"institutional_strength_index":3,"media_volatility_index":25,"legal_predictability_index":2,"labor_reliability_index":35,"crisis_exposure_index":78,"adoption_friction_index":22,"social_proof_dependence_index":45,"reputation_fragility_index":82,"informal_network_strength_index":88,"future_change_velocity_index":80},
   "resistance_patterns":[
     pat("Active Fraud Against Your Business","Any business with digital payment or account systems faces active fraud attack campaigns.","high",["all digital businesses"],["security_engine"]),
     pat("Data Breach and Ransomware Exposure","Every business with data assets is a ransomware target.","high",["all businesses with data"],["security_engine"]),
     pat("Platform Account Takeover Campaigns","Credential stuffing and account takeover campaigns target all consumer platforms.","high",["consumer apps","fintech"],["security_engine"])
   ],
   "opportunity_patterns":[
     pat("Cybersecurity Product Market","Massive and growing demand for fraud prevention, endpoint security, and threat intelligence.","high",["cybersecurity SaaS"],["market_engine"]),
     pat("Fraud Detection and Prevention","Fintech and e-commerce businesses spend heavily on fraud prevention infrastructure.","high",["fraud detection SaaS"],["market_engine"]),
     pat("Security Awareness Training","Organizations pay heavily for employee security awareness training.","high",["security training platforms"],["market_engine"])
   ],
   "trust_mechanisms":[
     pat("Reputation within Dark Web Communities","Underground marketplaces use escrow and community reputation to enable trust between criminals.","high",["underground commerce"],["trust_engine"]),
     pat("Technical Demonstration of Capability","Demonstrating exploit capability is the primary trust signal between criminal actors.","high",["criminal technical collaboration"],["trust_engine"])
   ],
   "payment_patterns":[
     pat("Cryptocurrency Exclusivity","Monero, Bitcoin, and other cryptocurrencies are the only accepted payment methods.","high",["all underground commerce"],["payment_engine"]),
     pat("Escrow Services for Criminal Transactions","Third-party escrow used to reduce exit scam risk.","medium",["dark web marketplaces"],["payment_engine"])
   ],
   "institutional_patterns":[
     pat("No Legal Framework","Operates entirely outside any legal framework; no dispute resolution exists.","high",["all underground operations"],["institutional_engine"]),
     pat("Law Enforcement as Adversary","International law enforcement agencies actively pursue and infiltrate operations.","high",["all criminal operations"],["crisis_engine"])
   ],
   "narrative_patterns":[
     pat("Operational Security is Everything","Maintaining anonymity is the only narrative that matters.","high",["all underground actors"],["narrative_engine"]),
     pat("Criminal Community Reputation","Reputation for reliable delivery of promised criminal services is primary competitive advantage.","medium",["criminal service providers"],["narrative_engine"])
   ],
   "platform_patterns":[
     pat("Tor and I2P Networks","Anonymizing networks are the primary infrastructure.","high",["all dark web operations"],["platform_engine"]),
     pat("Telegram Encrypted Groups","Telegram used for criminal coordination and marketing.","medium",["criminal coordination"],["platform_engine"])
   ],
   "regulatory_patterns":[
     pat("All Operations Illegal","All activities are illegal in virtually all jurisdictions.","high",["all operations"],["regulatory_engine"]),
     pat("International Law Enforcement Cooperation","Interpol, FBI, Europol coordinate to disrupt operations.","high",["all actors"],["crisis_engine"])
   ],
   "customer_behavior_patterns":[
     pat("Fraud Targeting of Legitimate Businesses","Legitimate businesses are the primary victims of cybercrime — not customers.","high",["all legitimate businesses"],["security_engine"]),
     pat("Social Engineering Targets","Employees and consumers are targeted through phishing and social engineering.","high",["all organizations"],["security_engine"])
   ],
   "business_model_fit":{"cybersecurity":"high","fraud_prevention":"high","notes":"This is a hostile environment context, not a market to enter. Build defenses against it."},
   "common_failure_modes":[
     pat("Insufficient Fraud Prevention Investment","Underinvesting in fraud prevention creates existential financial exposure.","high",["fintech","e-commerce"],["security_engine"]),
     pat("No Security Culture","Failing to build security culture means single employee phishing can compromise entire organization.","high",["all organizations"],["security_engine"])
   ],
   "common_success_patterns":[
     pat("Zero Trust Security Architecture","Implementing zero-trust network security prevents lateral movement after breaches.","high",["all organizations"],["security_engine"]),
     pat("Fraud Velocity Detection","Real-time transaction monitoring catching fraud patterns before damage scales.","high",["fintech","e-commerce"],["security_engine"])
   ],
   "recommended_entry_strategies":[
     pat("Threat Intelligence Integration","Integrate threat intelligence feeds into product security layer.","high",["all digital products"],["security_engine"]),
     pat("Bug Bounty Program","Public bug bounty programs incentivize security researchers to find vulnerabilities first.","high",["all digital products"],["security_engine"])
   ],
   "source_notes":"Based on global cybercrime network characteristics. Not a market to enter but an adversarial context to defend against.",
   "schema_version":"A2"}
]

out = pathlib.Path(__file__).parent / "economies.json"
with open(out, "w") as f:
    json.dump(economies, f, indent=2, default=str)
print(f"Written {len(economies)} economies to {out}")
