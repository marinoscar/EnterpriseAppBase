# Spec 01: Project Setup

**Domain:** Infrastructure
**Agent:** N/A (Manual or orchestration)
**Depends On:** None
**Estimated Complexity:** Low

---

## Objective

Initialize the monorepo structure with `apps/api` and `apps/web` projects, configure TypeScript, and set up the basic folder structure.

---

## Deliverables

### 1. Root Configuration Files

Create at repository root:

```
/
├── package.json          # Workspace root (if using npm/pnpm workspaces)
├── tsconfig.base.json    # Shared TypeScript config
├── .gitignore
├── .prettierrc           # Code formatting
├── .eslintrc.js          # Linting (optional root config)
└── README.md
```

### 2. API Project (`apps/api/`)

```
apps/api/
├── src/
│   ├── main.ts           # Entry point
│   └── app.module.ts     # Root NestJS module
├── test/
│   └── .gitkeep
├── prisma/
│   └── .gitkeep          # Schema added in database spec
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
└── Dockerfile            # Multi-stage build
```

### 3. Web Project (`apps/web/`)

```
apps/web/
├── src/
│   ├── main.tsx          # Entry point
│   ├── App.tsx           # Root component
│   └── vite-env.d.ts
├── src/__tests__/
│   └── .gitkeep
├── public/
│   └── .gitkeep
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── Dockerfile            # Multi-stage build
```

---

## Implementation Details

### Root `package.json`

```json
{
  "name": "enterprise-app",
  "private": true,
  "workspaces": ["apps/*"],
  "scripts": {
    "api": "npm -w apps/api",
    "web": "npm -w apps/web",
    "api:dev": "npm -w apps/api run start:dev",
    "web:dev": "npm -w apps/web run dev",
    "api:test": "npm -w apps/api test",
    "web:test": "npm -w apps/web test"
  }
}
```

### Root `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### API `package.json` Dependencies

```json
{
  "name": "api",
  "version": "0.0.1",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage"
  },
  "dependencies": {
    "@nestjs/common": "^11.x",
    "@nestjs/core": "^11.x",
    "@nestjs/platform-fastify": "^11.x",
    "@prisma/client": "^7.x",
    "reflect-metadata": "^0.2.x",
    "rxjs": "^7.x"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.x",
    "@nestjs/schematics": "^11.x",
    "@nestjs/testing": "^11.x",
    "@types/jest": "^30.x",
    "@types/node": "^22.x",
    "jest": "^30.x",
    "prisma": "^7.x",
    "ts-jest": "^29.x",
    "typescript": "^6.x"
  }
}
```

### Web `package.json` Dependencies

```json
{
  "name": "web",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@emotion/react": "^11.x",
    "@emotion/styled": "^11.x",
    "@mui/material": "^9.x",
    "@mui/icons-material": "^9.x",
    "react": "^19.x",
    "react-dom": "^19.x",
    "react-router-dom": "^7.x"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.x",
    "@testing-library/react": "^16.x",
    "@types/react": "^19.x",
    "@types/react-dom": "^19.x",
    "@vitejs/plugin-react": "^6.x",
    "typescript": "^6.x",
    "vite": "^8.x",
    "vitest": "^4.x",
    "jsdom": "^29.x"
  }
}
```

### API Dockerfile

```dockerfile
# =============================================================================
# API Dockerfile - Multi-stage build
# =============================================================================

# -----------------------------------------------------------------------------
# Base stage
# -----------------------------------------------------------------------------
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

# -----------------------------------------------------------------------------
# Dependencies stage
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# -----------------------------------------------------------------------------
# Development stage
# -----------------------------------------------------------------------------
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# -----------------------------------------------------------------------------
# Build stage
# -----------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Production stage
# -----------------------------------------------------------------------------
FROM base AS production
COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma ./prisma/
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
```

### Web Dockerfile

```dockerfile
# =============================================================================
# Web Dockerfile - Multi-stage build
# =============================================================================

# -----------------------------------------------------------------------------
# Base stage
# -----------------------------------------------------------------------------
FROM node:24-alpine AS base
WORKDIR /app

# -----------------------------------------------------------------------------
# Dependencies stage
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package*.json ./
RUN npm ci

# -----------------------------------------------------------------------------
# Development stage
# -----------------------------------------------------------------------------
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# -----------------------------------------------------------------------------
# Build stage
# -----------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Production stage (nginx to serve static files)
# -----------------------------------------------------------------------------
FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Web nginx.conf (for production static serving)

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

---

## Acceptance Criteria

- [ ] Running `npm install` at root installs all workspace dependencies
- [ ] `apps/api/src/main.ts` starts a NestJS application with Fastify
- [ ] `apps/web/src/main.tsx` renders a basic React app
- [ ] TypeScript compiles without errors in both projects
- [ ] Docker builds succeed for both api and web Dockerfiles
- [ ] Folder structure matches the specification

---

## Notes

- Use exact versions or caret (`^`) for patch/minor updates
- The API uses Fastify adapter for better performance
- The web app uses Vite for fast development builds
- Both Dockerfiles use multi-stage builds for smaller production images
