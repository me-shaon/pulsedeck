# Basic dev image for the PulseDeck API. Build context is the repo root so the
# whole pnpm workspace is available for install.
FROM node:22-alpine

RUN corepack enable

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile

EXPOSE 3001
CMD ["pnpm", "--filter", "@pulsedeck/api", "dev"]
