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
-   **Monorepo Structure:** Leverages TypeScript composite projects and pnpm workspaces for robust type safety and efficient dependency management across the application.
-   **UI/UX Design:** Employs an Agape brand color scheme (dark navy, blue, orange, gold) with a unique logo, and features densified detail surfaces for optimal information display.
-   **Centralized Error Handling:** Implements robust error handling for asynchronous Express routes to prevent data leakage and ensure system stability.
-   **Database Design:** Uses PostgreSQL with Drizzle ORM, featuring 16 entities for comprehensive claim and user management, optimized with database indexes.
-   **Authentication:** Utilizes session-based authentication supporting general users, administrators, and bot tokens.
-   **Frontend Serving:** The React + Vite frontend is served as static files by the Express API server from a single port.
-   **Claim Workflow & Statuses:** Claims progress through predefined statuses with centralized transition functions for consistent audit logging, timeline notes, and real-time SSE events.
-   **Invoice Grouping:** Claims are grouped by invoice number, serving as the primary unit for dispute resolution, with group-level statuses, outcomes, and evidence tracking.
-   **Response Tracking & Classification:** `portal_responses` tracks incoming responses, using a tiered classification pipeline that prioritizes phrase-signature matching and falls back to Anthropic Claude for AI-powered classification.
-   **State Management:** Utilizes discrete, typed columns for managing `claims` and `invoice_groups` state, ensuring consistent representation.
-   **Portal Submission Readiness Gates:** Enforces ordered readiness gates for operator-initiated submissions, with a system/bot actor path for bypassing some gates.
-   **Decision Trees (SOP Logic):** Integrates a workflow system for SOP logic, evidence collection, branching, and dispute reasons.
-   **Evidence Management:** Supports object storage for evidence files, linked to decision tree nodes and collected for portal submissions.
-   **Real-time Updates:** Server-Sent Events (SSE) provide real-time updates and collision detection.
-   **API Security:** Role-based authentication middleware protects API routes.
-   **Cron Jobs:** Scheduled jobs for processing portal submissions, daily briefs, and payor response scanning.
-   **Portal Worker:** An in-process Playwright bot for MAS Portal interaction, launching a fresh browser for each invocation.
-   **System Health Rollup:** Provides a consolidated view of system health, including connector probes, cron freshness, worker status, and overdue submissions.
-   **Summary Analytics Page:** Offers time-range-aware analytics for activity trends, recovery trends, team productivity, and breakdowns by status/outcome/error types.
-   **Repeat Offenders Aggregation:** Aggregates rejection statistics per driver/member, focusing on dispute-worthy claims.
-   **Deploy-time DB Migrations:** Explicit, idempotent SQL migration runner ensures schema consistency before JS build in production.
-   **Communication Components:** Integrated email thread components for rich HTML rendering, metadata, and a rich text reply composer.

## External Dependencies
-   **PostgreSQL:** Primary relational database for all application data.
-   **Anthropic Claude:** Utilized for AI-driven SOP analysis, dispute note generation, and email generation via Replit AI Integrations proxy.
-   **Playwright:** Used for browser automation to interact with the MAS Transportation Provider Support Portal.
-   **Google Cloud Storage (GCS):** Provides object storage for evidence files associated with claims.
-   **Microsoft Outlook (Graph API):** Used for sending daily brief emails and tracking payor responses, with SMTP fallback for resilience.
-   **Replit Auth:** Serves as the OpenID Connect provider for user authentication within the platform.