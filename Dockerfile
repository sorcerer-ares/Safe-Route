# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /build

COPY Frontend/package*.json ./
RUN npm install --no-audit --no-fund

COPY Frontend/ ./
RUN npm run build

# Stage 2: Python production runtime
FROM python:3.11-slim
WORKDIR /app

# System dependencies for database connections
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root system user first
RUN useradd -m -u 1000 appuser

# Switch to appuser so all subsequent installations belong to appuser natively
USER appuser
ENV PATH="/home/appuser/venv/bin:$PATH"

# Create virtual environment directly in appuser home
RUN python -m venv /home/appuser/venv

# Install Python packages inside user-owned venv
COPY --chown=appuser:appuser Backend/requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend source code directly with user ownership
COPY --chown=appuser:appuser Backend/ ./

# Copy compiled frontend assets from stage 1
COPY --from=frontend-builder --chown=appuser:appuser /build/dist ./static

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
