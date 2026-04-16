# syntax=docker/dockerfile:1

########################################
# 1) BUILDER IMAGE (uv)
########################################
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    UV_NO_CACHE=1

WORKDIR /app

# Install only third-party dependencies first (cached layer)
# Only invalidates when pyproject.toml or uv.lock changes
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

# Copy full project source
COPY . .

# Install the local project package
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev


########################################
# 2) RUNTIME IMAGE (no uv)
########################################
FROM python:3.12-slim-bookworm

# psycopg3 needs libpq5
# Pillow needs libjpeg, zlib, freetype
# curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libjpeg62-turbo \
    zlib1g \
    libfreetype6 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN groupadd --system --gid 999 django \
 && useradd --system --gid 999 --uid 999 --create-home django

WORKDIR /app

# Copy built project + venv from builder
COPY --from=builder --chown=django:django /app /app

# Use the venv from builder
ENV PATH="/app/.venv/bin:$PATH"

# Create runtime dirs and make entrypoint executable
RUN mkdir -p /app/staticfiles /app/media && \
    chmod +x /app/docker-entrypoint.sh && \
    chown -R django:django /app

USER django

EXPOSE 8000

CMD ["/app/docker-entrypoint.sh"]