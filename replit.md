# ClaimClear Project

## Overview
ClaimClear is a comprehensive NEMT (Non-Emergency Medical Transportation) rejected claims dispute tracker platform. Its main goal is to optimize the claims dispute process, minimize financial losses, and enhance operational efficiency for NEMT providers. It achieves this by enabling the import of rejected claims, guiding staff through decision-tree workflows for dispute resolution, and automating dispute submissions to the MAS Transportation Provider Support Portal. The project aims to significantly reduce the administrative burden associated with claim disputes and improve recovery rates for NEMT services.

## User Preferences
I want to emphasize iterative development and prefer detailed explanations when new features are introduced or significant changes are made. I appreciate clear, concise communication and enjoy seeing functional programming paradigms where they enhance code readability and maintainability. Please ask before making any major architectural changes or introducing new external dependencies.

## System Architecture
The project is structured as a pnpm workspace monorepo utilizing TypeScript, designed for scalability and maintainability.

**Technology Stack:**
-   **Monorepo:** pnpm workspaces
-   **Backend:** Node.js 24, Express 5, PostgreSQL, Drizzle ORM, Zod
-   **Frontend:** React, Vite, Tailwind CSS, shadcn/ui
-   **Authentication:** Replit Auth (OpenID Connect with PKCE)
-   **AI:** Anthropic Claude
-   **Bot Automation:** Playwright
-   **API Codegen:** Orval

**Core Architectural Decisions:**
- **Monorepo Structure:** Uses TypeScript composite projects and pnpm workspaces for type safety and dependency management.
- **UI/UX Design:** Adheres to an Agape brand color scheme (dark navy, blue, orange, gold) with a distinct logo, and utilizes densified detail surfaces for improved information display.
- **Centralized Error Handling:** Robust error handling for async Express routes to prevent information leakage.
- **Database Design:** PostgreSQL with Drizzle ORM, featuring 16 entities for comprehensive claim and user management, and optimized with database indexes.
- **Authentication:** Session-based authentication supporting general users, admins, and bot tokens.
- **Frontend Serving:** React + Vite frontend served as static files by the Express API server from a single port.
- **Claim Workflow & Statuses:** Claims progress through predefined statuses with centralized transition functions to ensure consistent audit logging, timeline notes, and real-time SSE events. A dedicated "Non-Issue" outcome handles claims requiring classification.
- **Invoice Grouping:** Claims are grouped by invoice number, forming the primary unit for dispute resolution, with group-level statuses, outcomes, and evidence tracking.
- **Response Tracking & Classification:** Tracks incoming responses, auto-matching them to claims using a tiered approach. A classifier pipeline uses phrase-signature matching, falling back to Anthropic Claude for AI-powered classification.
- **Per-Leg/Per-Invoice State Machine:** Uses discrete, typed columns for managing `claims` and `invoice_groups` state, with leg sub-status always derived.
- **Included-in-Dispute Management:** Explicit transitions and importer defaults manage `claims.included_in_dispute`, allowing for clear exclusion/inclusion of legs from disputes.
- **Per-Leg investigation UI:** Dedicated UI for detailed per-leg investigation, including SOP-advance player, context editor, and hold/reclassify actions.
- **Portal Submission Readiness Gates:** Enforces ordered readiness gates for operator-initiated submissions, with a system/bot actor path bypassing some gates.
- **Per-Leg Hold (Partial Submissions):** Allows individual legs within a multi-claim invoice group to be put on hold, enabling partial submissions.
- **Post-Response Workflow:** Claims enter a "Needs Review" state after a payor response, prompting staff to choose actions.
- **Decision Trees (SOP Logic):** Integrated workflow system for SOP logic, evidence collection, branching, and dispute reasons, with an "SOP-Hold Escape Hatch" to clear holds and resume workflows.
- **Error Type Model:** Simplified model for error types, including a "Submission Path" picker to determine the dispute submission method.
- **Evidence Management:** Supports object storage for evidence files, linked to decision tree nodes and collected for portal submissions.
- **Real-time Updates:** Server-Sent Events (SSE) provide real-time updates and collision detection.
- **API Security:** Role-based authentication middleware protects API routes.
- **Cron Jobs:** Scheduled jobs for processing portal submissions, daily briefs, and payor response scanning.
- **Portal Worker (on-demand):** In-process Playwright bot for MAS Portal interaction, launching a fresh browser for each invocation.
- **System Health Rollup:** Provides a consolidated view of system health, including connector probes, cron freshness, worker status, and overdue submissions.
- **Header Batch Status Pill:** Persistent UI element displaying live queued-claim count, next batch countdown, and in-flight indicators.
- **Summary Analytics Page:** Provides time-range-aware analytics, including activity trends, recovery trends, team productivity, and breakdowns by status/outcome/error types.
- **Repeat Offenders Aggregation:** Aggregates rejection statistics per driver/member, excluding "Non-Issue" outcomes.
- **Schema Drift Guard:** Automated script to prevent silent divergence between Drizzle schema files and generated SQL migrations.
- **Deploy-time DB Migrations:** Explicit, idempotent SQL migration runner applied before JS build in production, ensuring schema consistency.
- **Communication Components:** Integrated email thread components for group and leg detail pages, including rich HTML rendering, metadata, and Tiptap-powered rich text reply composer.

## External Dependencies
- **PostgreSQL:** Primary relational database.
- **Anthropic Claude:** AI for SOP analysis, dispute note generation, and email generation.
- **Playwright:** Browser automation for interacting with the MAS Transportation Provider Support Portal.
- **Google Cloud Storage (GCS):** Object storage for evidence files.
- **Microsoft Outlook (Graph API):** For sending daily brief emails and tracking payor responses (with SMTP fallback).
- **Replit Auth:** OpenID Connect for user authentication.
