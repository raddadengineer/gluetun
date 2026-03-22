# Stage 1: Build the React Application
FROM node:18-alpine AS frontend-builder
WORKDIR /app
COPY app/package*.json ./
RUN npm install
COPY app/ ./
RUN npm run build

# Stage 2: Setup the Express Backend
FROM node:18-alpine
WORKDIR /usr/src/app
COPY server/package*.json ./
RUN npm install --production
COPY server/ ./

# Copy compiled frontend to the backend's 'public' directory
COPY --from=frontend-builder /app/dist ./public/

EXPOSE 3000

# Start the Express API and Static File Server
CMD ["node", "index.js"]
