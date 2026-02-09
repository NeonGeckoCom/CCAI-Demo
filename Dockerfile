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

COPY . /ccai
WORKDIR /ccai/multi_llm_chatbot_backend

RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

FROM base AS backend

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS frontend
WORKDIR /ccai/phd-advisor-frontend

RUN npm install

CMD [ "npm", "start" ]
