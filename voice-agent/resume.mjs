export const RESUME = `Keerthan Gopalakrishnan
Email: keerthan44@gmail.com
LinkedIn: linkedin.com/in/keerthan44
GitHub: github.com/keerthan44
Website: itskeerthan.com

SUMMARY
Software Engineer with 4+ years of experience turning complex engineering problems into working products. From real-time voice AI reaching 4M people/day to full-stack systems shipped in weeks, focused on building fast, reliable systems at scale.

MAIN STACK (what I use day to day)
Python and TypeScript. Voice AI with LiveKit and Deepgram. Backends in FastAPI with PostgreSQL and Redis. Frontends in Next.js. Workflows with Temporal.

ALSO USED (lighter or occasional experience, mention only if asked about that specific thing)
Voice AI: ElevenLabs, Whisper, OpenAI, Retell, Vapi, STT/TTS, turn detection, LLM evals
Languages: JavaScript, SQL, Java (some Spring Boot), Rust (a little), C, C++, HTML/CSS
Technologies: Flask, Node.js, LangChain, Celery, React, Phoenix/Elixir, Ruby on Rails
Data: Kafka, MongoDB, DuckDB, MariaDB, DynamoDB, Supabase
Tools: Telnyx, SIP, Docker, Kubernetes, Terraform, GitHub Actions, Pytest, REST, AWS/GCP/DO/Azure, Git, Linux
Domains: Applied AI Engineering, Backend Development, Full-Stack Development

EXPERIENCE

Blue Machines AI, Forward Deployed Engineer, India. May 2026 to Oct 2026.
- Reached 4M people a day with AI voice-calling workflows for a globally recognized non-profit donation drive (Temporal, LiveKit Agents).
- Built a multi-lingual fuzzy matching engine (n-gram lookups with alias matching) which cut wrong answers in the live calls by 95% and raised answer accuracy by 2x.
- Built a student outreach platform for 10M records with a state government team, cutting nightly data refresh from 8 to 1.5 hours (5.3x faster) using parallel fetching and bulk DuckDB writes (94x faster).

IntellifyAi, AI Engineer (Contract), UK (Remote). Dec 2025 to Feb 2026.
- Architected and built an English speaking-practice platform with 3-4 AI voice agents in a shared LiveKit room, delivering sub-1.5s responses by overcoming LiveKit's single-voice limitation; shipped in 10 days.
- Extended LiveKit with a custom TTS plugin for self-hosted Kyutai voice models and real-time content moderation; load-tested and sized infrastructure on ECS/EKS and CloudWatch for 500 concurrent rooms and 15,000 DAU.

Kraftx.ai, Founding Engineer, India. Jan 2025 to Nov 2025.
- As the first engineering hire, engineered AI voice agents handling about 200 US healthcare insurance calls/day via SIP (Twilio/Telnyx), navigating IVRs, holds and transfers for eligibility, authorizations, claims and denials; achieved sub-1.5s response latency with LiveKit, Deepgram and LangChain after benchmarking Retell, Vapi and speech models.
- Developed real-time call monitoring with human takeover and agent error feedback, allowing staff to intervene mid-call and flag failures for correction.
- Detected broken prompt changes in under 2 minutes using automated evals across 30+ multi-turn conversations with rule-based checks and LLM judges.
- Owned the Next.js dashboard and auth, and co-developed a HIPAA/SOC 2-compliant FastAPI backend (Celery, Kafka, Redis, PostgreSQL) with EHR integrations, supporting concurrent calls as customers scaled their agents.

IoTReady.co, Software Engineer (Consultant), India. Jul 2023 to Dec 2024.
- Shipped BigBasket's driver invoicing app in 3 weeks, serving 100K+ active users and 2M monthly views across 15+ React pages and 10+ Frappe/MariaDB APIs for earnings, incentives, taxes and deductions.
- Migrated BigBasket's IoT platform from Django to Phoenix/Elixir, cutting response times by 40% across 10,000+ devices; added granular OTA updates (device, batch, organization, location) with 100% test coverage.
- Delivered client projects including MatchFives' (Spain) Firebase-based football skill tracker with automated progress emails and a daily Zoho-to-Supabase sync using Edge Functions.

Neoscale.io, Founding Engineer, India. Oct 2022 to May 2023.
- Developed a working prototype of Spends (getspends.com), automating bank transaction imports via Plaid and expense splitting via Splitwise on iOS and Android (Spring Boot, AWS Lambda/API Gateway/S3, React Native).

SELECTED PROJECTS

LiveKitAgentLoop (LiveKit, Deepgram, Cartesia, OpenAI)
- Reengineered LiveKit's voice agent orchestration from scratch, implementing VAD, streaming STT, turn detection, LLM and TTS pipelines while using LiveKit solely for audio transport.
- Engineered real-time interruption handling with echo rejection and a provider-agnostic interface supporting Deepgram, AssemblyAI, Cartesia and ElevenLabs.

LinkedIn Leads Scraper (Python, Playwright, Supabase, sentence-transformers, LangChain)
- Built a LinkedIn lead-discovery engine using semantic search and LLMs to find prospects missed by native filters.
- Stored raw profiles and vector embeddings in Supabase, decoupled scraping from parsing, and built a Chrome extension for passive profile capture with rate limits and daily quotas to reduce blocks.

Distributed Load Testing (Kafka, Flask, Go, React)
- Engineered a distributed load-testing framework with Kafka-based orchestration, coordinating multiple driver nodes through registration, heartbeats and test execution.
- Implemented avalanche (simultaneous requests) and tsunami (fixed-interval requests) load patterns to stress-test services and measure mean and median response latency.

ACHIEVEMENTS

Trace-Driven Microservice Benchmarking, IEEE CISCON 2025 (Kubernetes, Kafka, Redis, Memcached, Python)
- Published and presented research at IEEE CISCON 2025 on benchmarking cloud microservices using real-world production traces.
- Engineered a framework converting Alibaba's production cluster traces into deployable microservice call graphs and service stubs to evaluate distributed architectures on Kubernetes.

Silicon Rush, IEEE Student Branch, PES University, Participant, 2022
- Built a remotely switchable smart socket with power and cost tracking, plus a smart gardening and watering solution (Django, JavaScript, Embedded C).

EDUCATION
PES University, Bachelor of Technology in Computer Science, CGPA 8.75/10, Bangalore, India. Aug 2021 to Jun 2025.
`;
