# syntax=docker/dockerfile:1
FROM node:24-bookworm AS base

LABEL vendor=neon.ai \
    ai.neon.name="CCAI-Demo"

ENV OVOS_CONFIG_BASE_FOLDER=neon
ENV OVOS_CONFIG_FILENAME=neon.yaml
ENV XDG_CONFIG_HOME=/config

RUN apt-get update && \
    apt-get install -y \
    python3 \
    python3-pip

# ---- Python dependencies (cached unless requirements.txt changes) ----------
WORKDIR /ccai/multi_llm_chatbot_backend
COPY multi_llm_chatbot_backend/requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --break-system-packages -r requirements.txt

# ---- Node dependencies (cached unless package.json changes) ----------------
WORKDIR /ccai/phd-advisor-frontend
COPY phd-advisor-frontend/package.json phd-advisor-frontend/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install

# ---- Copy the rest of the source code (this layer changes often) -----------
WORKDIR /ccai
COPY . .

# ---- Backend target --------------------------------------------------------
FROM base AS backend
WORKDIR /ccai/multi_llm_chatbot_backend
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# ---- Frontend target -------------------------------------------------------
FROM base AS frontend
WORKDIR /ccai/phd-advisor-frontend
CMD [ "npm", "start" ]
