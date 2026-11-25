# HaieRag frontend

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Query + Zustand.

```bash
pnpm install
pnpm dev                      # http://localhost:3000, proxies /api/v1 → $BACKEND_URL (default http://localhost:8080)

# without the Spring Boot backend: in-memory mock of the public API (login admin@haierag.local / password123)
pnpm mock:backend             # :8099
BACKEND_URL=http://localhost:8099 pnpm dev

pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

API calls go through `app/api/v1/[...path]/route.ts`, a streaming reverse proxy that reads `BACKEND_URL` at runtime
(so one Docker image works anywhere) and passes SSE through unbuffered.
