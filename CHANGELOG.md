# Changelog

All notable changes to the Questbee server platform are documented here.

---

## [1.0.0] — 2026-03-25

First public release of the Community Edition.

### Features
- Form builder with 20+ field types including GPS, media, signatures, barcodes, and repeating groups
- Published/draft versioning — forms are locked on publish; edits create a new draft
- Offline-first mobile sync engine — bulk submission endpoint with device-UUID deduplication
- Web dashboard (Next.js 14) — form builder, submissions browser, media preview, export
- Data export: CSV (flat + repeat groups), GeoJSON, GPX, media ZIP, full package
- Headless API — project/form discovery and submission via API key for IoT and automation
- Webhooks — per-form HTTP callbacks on new submissions
- Role-based access control: Admin, Manager, Field Worker
- Multi-tenancy — one instance serves multiple isolated organizations
- QR code device pairing — no separate login required on the mobile device
- JWT auth for dashboard, API keys for headless, device tokens for mobile
- Docker Compose deployment — single command to run the full stack
- Admin: hard delete forms (cascades submissions and media) and empty projects
