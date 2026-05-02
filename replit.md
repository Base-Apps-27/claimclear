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
- **Centralized Error Handling:** Robust error handling for async Express routes.
- **Database Design:** PostgreSQL with Drizzle ORM, featuring 16 entities for comprehensive claim and user management, optimized with database indexes.
- **Authentication:** Session-based authentication supporting general users, admins, and bot tokens.
- **Frontend Serving:** React + Vite frontend served as static files by the Express API server.
- **Claim Workflow & Statuses:** Claims progress through predefined statuses with centralized transition functions for consistent audit logging, timeline notes, and real-time SSE events. Invoice grouping forms the primary unit for dispute resolution.
- **Response Tracking & Classification:** `portal_responses` tracks incoming responses, using a classifier pipeline with phrase-signature matching and Anthropic Claude for AI-powered classification.
- **Per-Leg/Per-Invoice State Machine:** Manages `claims` and `invoice_groups` state using discrete, typed columns, with derived leg sub-status.
- **Included-in-Dispute Management:** Explicit transitions and importer defaults manage `claims.included_in_dispute`.
- **Per-Leg Investigation UI:** Dedicated UI for detailed per-leg investigation, including SOP-advance player and context editor.
- **Portal Submission Readiness Gates:** Enforces ordered readiness gates for operator-initiated submissions.
- **Per-Leg Hold:** Allows individual legs within an invoice group to be put on hold for partial submissions.
- **Post-Response Workflow:** Claims enter a "Needs Review" state after payor response.
- **Decision Trees (SOP Logic):** Integrated workflow system for SOP logic, evidence collection, branching, and dispute reasons.
- **Error Type Model:** Simplified model for error types, including a "Submission Path" picker.
- **Evidence Management:** Supports object storage for evidence files, linked to decision tree nodes and collected for portal submissions.
- **Real-time Updates:** Server-Sent Events (SSE) provide real-time updates and collision detection.
- **API Security:** Role-based authentication middleware protects API routes.
- **Cron Jobs:** Scheduled jobs for processing portal submissions, daily briefs, and payor response scanning.
- **Portal Worker (on-demand):** In-process Playwright bot for MAS Portal interaction.
- **System Health Rollup:** Provides a consolidated view of system health.
- **Header Batch Status Pill:** Persistent UI element displaying live queued-claim count and batch information.
- **Summary Analytics Page:** Provides time-range-aware analytics, including activity and recovery trends.
- **Repeat Offenders Aggregation:** Aggregates rejection statistics per driver/member.
- **Schema Drift Guard:** Automated script to prevent silent divergence between Drizzle schema files and generated SQL migrations.
- **Deploy-time DB Migrations:** Explicit, idempotent SQL migration runner applied before JS build in production.
- **Communication Components:** Integrated email thread components for group and leg detail pages, including rich HTML rendering and a Tiptap-powered rich text reply composer.

## External Dependencies
- **PostgreSQL:** Primary relational database.
- **Anthropic Claude:** AI for SOP analysis, dispute note generation, and email generation.
- **Playwright:** Browser automation for interacting with the MAS Transportation Provider Support Portal.
- **Google Cloud Storage (GCS):** Object storage for evidence files.
- **Microsoft Outlook (Graph API):** For sending daily brief emails and tracking payor responses (with SMTP fallback).
- **Replit Auth:** OpenID Connect for user authentication.
