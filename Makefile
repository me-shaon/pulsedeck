# PulseDeck — common Docker workflows.
#   make up    → production stack (detached)
#   make dev   → development stack with hot reload (foreground)
# Run `make help` for the full list.

DEV := docker compose -f docker-compose.yml -f docker-compose.dev.yml

.DEFAULT_GOAL := help
.PHONY: help setup up down logs build dev dev-down dev-logs dev-fresh fresh db-reset ps clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

## ── Setup ───────────────────────────────────────────────────────────────────
setup: ## Generate production secrets into .env (idempotent; safe to re-run)
	./scripts/gen-secrets.sh

## ── Production ──────────────────────────────────────────────────────────────
up: ## Build + start the production stack (detached)
	docker compose up -d --build

down: ## Stop the production stack
	docker compose down

logs: ## Tail production logs
	docker compose logs -f

build: ## Build the production images
	docker compose build

## ── Development (hot reload) ────────────────────────────────────────────────
dev: ## Start the dev stack with hot reload (foreground; Ctrl-C to stop)
	$(DEV) up --build

dev-down: ## Stop the dev stack
	$(DEV) down

dev-logs: ## Tail dev logs
	$(DEV) logs -f

dev-fresh: ## Wipe the dev DB volume + rebuild/start fresh (first-run setup wizard reappears)
	$(DEV) down -v
	$(DEV) up --build

fresh: dev-fresh ## Alias for dev-fresh

db-reset: ## Wipe ONLY the dev DB data (keep images/volume), then restart api so migrations re-run
	$(DEV) up -d postgres
	$(DEV) exec -T postgres psql -U pulsedeck -d pulsedeck -c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"
	$(DEV) restart api

## ── Misc ────────────────────────────────────────────────────────────────────
ps: ## Show running containers
	docker compose ps

clean: ## Stop everything and remove volumes (DESTROYS the database)
	docker compose down -v
