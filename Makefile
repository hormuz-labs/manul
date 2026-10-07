.DEFAULT_GOAL := help

.PHONY: help install build dev run start preview dashboard typecheck test test-watch test-e2e smoke package package-dir clean whisper

help: ## Show this help message
	@grep -E '^[-a-zA-Z0-9_]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies and binaries (ffmpeg, bsk, whisper-cli)
	npm install
	./scripts/build-whisper.sh

whisper: ## Build the bundled whisper-cli binary
	./scripts/build-whisper.sh

dev: ## Run Manul in development mode with hot reload
	npm run dev

run: dev ## Alias for dev

build: ## Build Electron main, preload, and renderer bundles
	npm run build

start: ## Preview the built application
	npm run start

preview: start ## Alias for start

dashboard: ## Start Metabase locally; open https://analytics.manul.si/dashboard
	docker compose --env-file .env -f telemetry/metabase.compose.yml up -d
	python3 telemetry/metabase_setup.py
	@printf 'Manul analytics: https://analytics.manul.si/dashboard\n'

typecheck: ## Run TypeScript type checks
	npm run typecheck

test: ## Run unit and integration tests (Vitest)
	npm run test

test-watch: ## Run Vitest in watch mode
	npm run test:watch

test-e2e: ## Run end-to-end tests (Playwright)
	npm run test:e2e

smoke: ## Build and run smoke tests
	npm run smoke

package: ## Package production binaries (.deb, AppImage, or .dmg)
	npm run package

package-dir: ## Package unpacked production directory into dist/
	npm run package:dir

clean: ## Remove build outputs (out/ and dist/)
	rm -rf out dist
