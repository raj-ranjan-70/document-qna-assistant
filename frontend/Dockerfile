# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: Serve ──────────────────────────────────────────────────────────
FROM nginx:alpine AS serve
WORKDIR /usr/share/nginx/html

# Remove default Nginx static content
RUN rm -rf ./*

# Copy Vite production build (output dir: dist/)
COPY --from=build /app/dist .

# Custom Nginx config: handle SPA client-side routing + proxy /api to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
