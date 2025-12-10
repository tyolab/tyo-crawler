# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Run Commands
- Start crawler: `node index.js [options] url(s)`
- No test commands defined yet; consider using Jest or Mocha
- Redis must be running locally or configure using `--dbhost` and `--dbport`

## Code Style Guidelines
- CommonJS modules with `require()` instead of ES modules
- Async/await patterns for all Redis operations and puppeteer interactions
- Error handling via try/catch blocks with descriptive console.error messages
- Promised-based approach with explicit async functions
- Tabs for indentation, line length maximum 100 characters
- Snake_case for local variables, camelCase for method names
- Class-based components like `Crawler` and `RedisClient`
- Use named functions over anonymous arrow functions for primary methods
- Prefer explicit null/undefined checks with if statements