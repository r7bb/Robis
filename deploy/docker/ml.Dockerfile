# syntax=docker/dockerfile:1
#
# The duplicate-detection and triage service (robis-ml).
#
# Dependencies come from robis-ml/requirements.lock: the exact versions the
# Python tests ran against, each with its hashes, so pip refuses any
# dependency that is not byte-for-byte what was locked.
#
#   docker build -f deploy/docker/ml.Dockerfile -t robis-ml .

# 3.11, the version the tests run on. Pinned by digest.
ARG PYTHON_IMAGE=python:3.11.16-slim-trixie@sha256:e41613d42d4891e4930f79523f93f81bbc7632584ec65e36ab055f41a800b41e

# ---------------------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /venv
COPY robis-ml/requirements.lock /tmp/requirements.lock
RUN /venv/bin/pip install --require-hashes --only-binary=:all: -r /tmp/requirements.lock

# ---------------------------------------------------------------------------
# The service is run from its source directory rather than built as a
# package, so no build backend is ever downloaded: everything installed is
# in the hashed lock. Debian's security updates are applied as in the Bun
# images, so a fix that exists is in the image.
FROM ${PYTHON_IMAGE} AS ml
RUN apt-get update \
  && apt-get -y upgrade --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*
ENV PATH=/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY --from=build /venv /venv
WORKDIR /app
COPY robis-ml/robis_ml ./robis_ml
RUN useradd --system --uid 10001 --no-create-home robis
USER robis
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"]
CMD ["uvicorn", "robis_ml.service:app", "--host", "0.0.0.0", "--port", "8000"]
