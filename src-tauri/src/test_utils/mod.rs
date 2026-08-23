//! Shared utilities for backend tests.
//!
//! This module contains reusable helpers used across unit and integration
//! tests to reduce boilerplate and keep test setup consistent.
//!
//! Currently available:
//!
//! - `fixtures`
//!   - In-memory SQLite database initialization
//!   - Production schema setup
//!   - Test `IndexItem` insertion helpers
//!   - Search result mapping fixtures
//!
//! Test utilities should mimic production behavior whenever possible.
//! Avoid maintaining separate schemas or duplicated business logic inside
//! tests.

pub mod fixtures;
